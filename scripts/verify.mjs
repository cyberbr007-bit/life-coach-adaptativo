import {spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=()=>createHash('sha256').update(readFileSync('verification-standard.md')).digest('hex');
const initial=hash();const results=[];
mkdirSync('docs/validation-logs',{recursive:true});
for(const [id,args] of [['TYPECHECK',['run','typecheck']],['REGRESSION',['test']],['EVE_BUILD',['run','eve:build']]]){
  const r=spawnSync(process.platform==='win32'?'npm.cmd':'npm',args,{encoding:'utf8',
    env:{...process.env,ENABLE_EVE_SPIKE:'no'},timeout:240000,maxBuffer:10000000});
  const log='docs/validation-logs/'+id+'.log';
  writeFileSync(log,(r.stdout??'')+'\n'+(r.stderr??''));
  process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');
  results.push({id,result:r.status===0?'PASS':'FAIL',exitCode:r.status,evidence:log});
}
results.push({id:'STANDARD_UNCHANGED',result:hash()===initial?'PASS':'FAIL',evidence:initial});
const report={at:new Date().toISOString(),mode:'local-synthetic',criteria:results,
  externalGates:{vps:'NOT_RUN',telegram:'NOT_RUN',siwcLive:'NOT_RUN',docker:'UNAVAILABLE',offsiteRestore:'NOT_RUN'},
  productionReady:false};
writeFileSync('docs/VALIDACAO.json',JSON.stringify(report,null,2)+'\n');
process.exitCode=results.every(r=>r.result==='PASS')?0:1;

