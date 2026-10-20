"""Synthetic Linux ownership regression tests; Docker itself is not exercised."""
import os
from pathlib import Path
import shutil
import runpy
from unittest.mock import patch
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]


class ConfigurationRegression(unittest.TestCase):
    def test_existing_credentials_preserved_and_migrator_receives_access(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'scripts').mkdir()
            shutil.copyfile(SOURCE / 'scripts/configure.py', root / 'scripts/configure.py')
            (root / 'secrets').mkdir()
            (root / 'credentials').mkdir()
            (root / '.env').write_text('SYNTHETIC_CONFIG=yes\n')
            (root / 'secrets/telegram.token').write_text('synthetic-token\n')
            (root / 'credentials/siwc.enc.json').write_text('synthetic-encrypted-session\n')
            owners = {}
            with patch('os.chown', side_effect=lambda p, u, g: owners.update({Path(p): (u, g)})), \
                    patch('os.geteuid', return_value=0, create=True):
                runpy.run_path(str(root / 'scripts/configure.py'))
                before = {p.relative_to(root): p.read_bytes() for p in root.rglob('*') if p.is_file()}
                runpy.run_path(str(root / 'scripts/configure.py'))
            after = {p.relative_to(root): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            self.assertEqual(before, after)
            self.assertEqual(owners[root / 'secrets/migrator-url'], (1000, 1000))
            self.assertEqual(owners[root / 'credentials/siwc.enc.json'], (1000, 1000))
            self.assertEqual((root / 'secrets/migrator-url').stat().st_mode & 0o777, 0o600)


@unittest.skipUnless(hasattr(os, 'geteuid') and os.geteuid() == 0,
                     'Requires root on Linux to verify consumer UID isolation')
class SecretPermissions(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        try:
            os.chown(self.root, 1000, 1000)
            os.chown(self.root, 0, 0)
        except OSError:
            self.skipTest('Host does not permit real UID changes; run on dedicated Linux VPS')
        self.root.chmod(0o755)
        (self.root / 'scripts').mkdir()
        for name in ('configure.py', 'prepare-compose-secrets.sh'):
            shutil.copyfile(SOURCE / 'scripts' / name, self.root / 'scripts' / name)
        (self.root / 'secrets').mkdir(mode=0o700)
        (self.root / 'secrets/telegram.token').write_text('synthetic-token\n')
        (self.root / '.env').write_text('SYNTHETIC_CONFIG=yes\n')

    def configure(self):
        return subprocess.run(['python3', str(self.root / 'scripts/configure.py')],
                              capture_output=True, text=True, check=True)

    def readable(self, name, uid):
        # A leaf-file bind mount bypasses the host parent directory permissions.
        leaf = self.root / ('mounted-' + name)
        if leaf.exists():
            leaf.unlink()
        os.link(self.root / 'secrets' / name, leaf)

        def consumer_identity():
            os.setgroups([])
            os.setgid(uid)
            os.setuid(uid)

        return subprocess.run(['python3', '-c',
                               'import sys; open(sys.argv[1], "rb").read()', str(leaf)],
                              preexec_fn=consumer_identity, capture_output=True).returncode == 0

    def test_configure_preserves_secrets_and_allows_migrator_user(self):
        self.configure()
        before = {p.name: p.read_bytes() for p in (self.root / 'secrets').iterdir()}
        self.configure()
        self.assertEqual(before, {p.name: p.read_bytes() for p in (self.root / 'secrets').iterdir()})
        self.assertTrue(self.readable('migrator-url', 1000))
        self.assertFalse(self.readable('migrator-url', 1001))
        self.assertEqual((self.root / 'secrets').stat().st_mode & 0o777, 0o700)

    def prepare(self):
        fakebin = self.root / 'bin'
        fakebin.mkdir(exist_ok=True)
        docker = fakebin / 'docker'
        docker.write_text('''#!/usr/bin/env python3
import os,sys
from pathlib import Path
a=sys.argv[1:]
if a == ['compose','config','--format','json']:
    print('{"services":{"db":{"image":"synthetic-postgres"}}}')
elif a == ['compose','pull','db']:
    pass
elif a == ['run','--rm','--entrypoint','/bin/sh','synthetic-postgres','-c','id -u postgres; id -g postgres']:
    print('997\\n997')
elif a[:6] == ['compose','run','--rm','--no-deps','--user','997:997']:
    root=Path(os.environ['COACH_TEST_ROOT'])
    files=[]
    for name in ('postgres.password','migrator.password','app.password'):
        leaf=root/('db-mounted-'+name)
        if leaf.exists(): leaf.unlink()
        os.link(root/'secrets'/name,leaf)
        files.append(leaf)
    os.setgroups([]); os.setgid(997); os.setuid(997)
    for leaf in files: leaf.read_bytes()
else:
    raise SystemExit('Unexpected Docker invocation in synthetic test')
''')
        docker.chmod(0o755)
        return subprocess.run(['bash', str(self.root / 'scripts/prepare-compose-secrets.sh')],
                              env={**os.environ, 'PATH': str(fakebin) + ':' + os.environ['PATH'],
                                   'COACH_TEST_ROOT': str(self.root)}, capture_output=True, text=True)

    def test_bootstrap_consumer_access_and_idempotency(self):
        self.configure()
        before = {p.name: p.read_bytes() for p in (self.root / 'secrets').iterdir()}
        for _ in range(2):
            result = self.prepare()
            self.assertEqual(result.returncode, 0, result.stderr)
        for name in ('postgres.password', 'migrator.password', 'app.password'):
            self.assertTrue(self.readable(name, 997))
            self.assertFalse(self.readable(name, 1000))
        self.assertTrue(self.readable('migrator-url', 1000))
        self.assertFalse(self.readable('migrator-url', 997))
        self.assertEqual(before, {p.name: p.read_bytes() for p in (self.root / 'secrets').iterdir()})

    def test_symlink_rejected_before_any_ownership_change(self):
        self.configure()
        path = self.root / 'secrets/migrator.password'
        target = self.root / 'outside'
        path.rename(target)
        path.symlink_to(target)
        before = (self.root / 'secrets/postgres.password').stat().st_uid
        result = self.prepare()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(before, (self.root / 'secrets/postgres.password').stat().st_uid)
        self.assertEqual(target.stat().st_uid, 0)


if __name__ == '__main__':
    unittest.main()
