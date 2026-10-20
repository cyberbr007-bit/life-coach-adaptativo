import {mkdir,readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {Chat} from 'chat';
import {createPostgresState,postgresSchemaStatements} from '@chat-adapter/state-pg';
import {postgresDb,migrate} from './db.ts';
import {secret,config} from './config.ts';
import {CoachService,OWNER} from './service.ts';
import {Worker,deliverOne} from './worker.ts';
import {Vault,createVaultKey} from './credentials.ts';
import {SiwcModel} from './siwc.ts';
import {login} from './login.ts';
import {TelegramApi,DurableTelegramAdapter} from './telegram.ts';
import {eveSiwcModel} from './eve-model.ts';
import {generateText} from 'ai';

const command=process.argv[2]??'help';
const credentialFile=process.env.SIWC_CREDENTIAL_FILE||'./credentials/siwc.enc.json';
const keyFile=process.env.SIWC_VAULT_KEY_FILE||'./secrets/vault.key';
const vault=new Vault(credentialFile,keyFile);
async function main(){
  if(command==='help'){
    console.log('Comandos: doctor | vault-init | siwc-login | models | probe | eve-probe | migrate | serve');
    return;
  }
  if(command==='vault-init'){await createVaultKey(keyFile);console.log('Chave criada; mantenha-a privada e separada do arquivo de credenciais.');return;}
  if(command==='siwc-login'){await login(vault,process.env.SIWC_HOST_FILE||'./credentials/host-id');console.log('Conexão salva. Use models e probe para validar o acesso.');return;}
  if(command==='doctor'){
    const flags={node:process.version,telegramIdConfigured:/^[1-9][0-9]*$/.test(process.env.TELEGRAM_ALLOWED_USER_ID??''),
      databaseConfigured:Boolean(await secret(process.env,'DATABASE_URL')),
      telegramTokenConfigured:Boolean(await secret(process.env,'TELEGRAM_BOT_TOKEN')),
      modelConfigured:Boolean(process.env.OPENAI_MODEL),
      credentialsReadable:false,planScopeGranted:false};
    try{const p=await vault.load();flags.credentialsReadable=true;flags.planScopeGranted=p.scopes.includes('chatgpt.tokens.use.direct');}catch{}
    console.log(JSON.stringify(flags,null,2));return;
  }
  const model=new SiwcModel(process.env.OPENAI_MODEL??'',()=>vault.token());
  if(command==='models'){console.log(JSON.stringify(await model.listModels(),null,2));return;}
  if(command==='probe'||command==='eve-probe'){
    if(process.env.SIWC_ELIGIBILITY_CONFIRMED!=='yes')throw new Error('ELIGIBILITY_NOT_CONFIRMED');
    const catalog=await model.listModels();if(!catalog.some((x:any)=>x.slug===model.model))throw new Error('MODEL_NOT_IN_CATALOG');
    const result=command==='eve-probe'
      ?await generateText({model:eveSiwcModel(model,true),prompt:'Responda exatamente: conexão validada',maxRetries:0})
      :await model.respond({instructions:'Responda de forma breve.',input:[{role:'user',content:'Responda exatamente: conexão validada'}],
        manifest:{release:'probe',memory:[],hash:'probe',cutoff:new Date().toISOString()}},AbortSignal.timeout(60000));
    console.log(JSON.stringify({completed:true,text:result.text,model:model.model}));return;
  }
  const url=await secret(process.env,'DATABASE_URL');if(!url)throw new Error('DATABASE_REQUIRED');
  const db=postgresDb(url);
  if(command==='migrate'){
    try{await migrate(db);for(const statement of postgresSchemaStatements)await db.query(statement);
      console.log('Migrations de fundação e transporte aplicadas.');}finally{await db.close();}return;
  }
  if(command!=='serve'){await db.close();throw new Error('UNKNOWN_COMMAND');}
  if(process.env.SIWC_ELIGIBILITY_CONFIRMED!=='yes')throw new Error('ELIGIBILITY_NOT_CONFIRMED');
  const c=await config();if(!c.model)throw new Error('MODEL_NOT_CONFIGURED');
  const profile=await vault.load();if(!profile.scopes.includes('chatgpt.tokens.use.direct'))throw new Error('PLAN_USAGE_NOT_GRANTED');
  const lock=new pg.Client({connectionString:url});await lock.connect();
  if(!(await lock.query('SELECT pg_try_advisory_lock(733716) AS acquired')).rows[0].acquired)throw new Error('BOT_ALREADY_RUNNING');
  const worker=new Worker(db,model);const service=new CoachService(db,c.telegramUserId,c.telegramChatId,()=>worker.stop());
  await service.initialize();
  const api=new TelegramApi(c.telegramToken);
  const webhook=await api.call('getWebhookInfo',{});if(webhook.url)throw new Error('EXISTING_WEBHOOK_REQUIRES_REVIEW');
  const state=createPostgresState({url,autoCreateSchema:false,keyPrefix:'life-coach-v01'});
  const adapter=new DurableTelegramAdapter(service,api);
  const bot=new Chat({userName:'life-coach',adapters:{telegram:adapter},state});
  let running=true;
  const stop=()=>{running=false;worker.stop();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
  await bot.initialize();console.log('Life Coach iniciado; acesso privado e aprendizado autônomo desabilitado.');
  const loop=async(task:()=>Promise<boolean>)=>{
    while(running){try{const worked=await task();if(!worked)await delay(500);}catch{console.error('BACKGROUND_TASK_FAILED');await delay(1000);}}
  };
  try{await Promise.all([loop(()=>worker.runOne()),loop(()=>deliverOne(db,api))]);}
  finally{await adapter.stopPolling();await state.disconnect();await db.close();await lock.end();}
}
main().catch(e=>{const msg=e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:'OPERATION_FAILED';
  console.error(msg);process.exitCode=1;setTimeout(()=>process.exit(1),100).unref();});

