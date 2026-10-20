#!/usr/bin/env python3
"""Prepare private configuration; never prints secrets or overwrites them."""
from pathlib import Path
import os, secrets, getpass, re, base64, uuid

root=Path(__file__).resolve().parent.parent
sec=root/'secrets'; creds=root/'credentials'
for directory in (sec,creds):
    directory.mkdir(mode=0o700,exist_ok=True)
    if os.name!='nt': directory.chmod(0o700)

def create(path,text):
    descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(descriptor,'w') as stream: stream.write(text+'\n')

def password(filename):
    path=sec/filename
    if not path.exists(): create(path,secrets.token_hex(24))
    return path.read_text().strip()

admin=password('postgres.password')
migrator=password('migrator.password')
runtime=password('app.password')
for name,text in (
 ('database-url','postgresql://lc_runtime:'+runtime+'@db:5432/life_coach'),
 ('migrator-url','postgresql://lc_owner:'+migrator+'@db:5432/life_coach'),
 ('vault.key',base64.b64encode(secrets.token_bytes(32)).decode()),
):
    path=sec/name
    if not path.exists(): create(path,text)
token_path=sec/'telegram.token'
if not (creds/'host-id').exists(): create(creds/'host-id','urn:uuid:'+str(uuid.uuid4()))
if not token_path.exists():
    token=getpass.getpass('Token do NOVO bot Telegram (entrada oculta): ').strip()
    if not re.fullmatch(r'[0-9]+:[A-Za-z0-9_-]{20,}',token): raise SystemExit('Token com formato inválido.')
    create(token_path,token)
if not (root/'.env').exists():
    owner=input('Telegram user_id numérico verificado: ').strip()
    if not re.fullmatch(r'[1-9][0-9]*',owner): raise SystemExit('ID inválido.')
    create(root/'.env','\n'.join([
      'TELEGRAM_ALLOWED_USER_ID='+owner,'TELEGRAM_PRIVATE_CHAT_ID='+owner,
      'OPENAI_MODEL=','SIWC_ELIGIBILITY_CONFIRMED=no',
      'SIWC_CREDENTIAL_FILE=./credentials/siwc.enc.json',
      'SIWC_VAULT_KEY_FILE=./secrets/vault.key',
      'SIWC_HOST_FILE=./credentials/host-id',
      'TELEGRAM_BOT_TOKEN_FILE=./secrets/telegram.token',
      'DATABASE_URL_FILE=./secrets/database-url']))
# Local Compose file-backed secrets preserve host ownership.
if hasattr(os,'geteuid') and os.geteuid()==0:
    os.chown(creds,1000,1000)
    for name in ('database-url','migrator-url','telegram.token','vault.key'):
        os.chown(sec/name,1000,1000)
    for path in creds.iterdir():
        if path.is_file(): os.chown(path,1000,1000)
print('Configuração privada preparada. Nenhum serviço foi iniciado.')
print('Conecte o ChatGPT localmente, selecione o modelo e siga docs/EXECUTAR.md.')
print('Antes de iniciar o banco, execute bash scripts/prepare-compose-secrets.sh como root.')

