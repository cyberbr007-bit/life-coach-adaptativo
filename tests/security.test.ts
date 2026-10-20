import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Vault,createVaultKey,type Profile} from '../src/credentials.ts';
import {SiwcModel,parseResponse} from '../src/siwc.ts';
import {authParameters,verifyState} from '../src/login.ts';
import {nudgeDecision,splitMessage,authorized} from '../src/policy.ts';
import {eveSiwcModel} from '../src/eve-model.ts';
import {generateText} from 'ai';
import {normalize,TelegramApi} from '../src/telegram.ts';
const context:any={instructions:'regras',input:[{role:'user',content:'oi'}],manifest:{}};
function sse(events:any[],trailer=true){
  return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')+(trailer?'data: [DONE]\n\n':''));
}
test('SSE requires completed terminal event, not partial text or DONE',async()=>{
  await assert.rejects(parseResponse(sse([{type:'response.output_text.delta',delta:'parcial'}])),/STREAM_INTERRUPTED/);
});
test('SSE preserves successful text and rejects mid-stream quota failure',async()=>{
  const ok=await parseResponse(sse([{type:'response.output_text.delta',delta:'Olá'},{type:'response.completed',response:{status:'completed',model:'fake'}}]));
  assert.equal(ok.text,'Olá');
  await assert.rejects(parseResponse(sse([{type:'response.output_text.delta',delta:'x'},{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}])),/SUBSCRIPTION_SHARING_USAGE_LIMIT_EXCEEDED/);
});
test('SSE handles UTF-8 and CRLF split across byte boundaries',async()=>{
  const data=new TextEncoder().encode('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{content:[{type:'output_text',text:'ação'}]}]}})+'\r\n\r\n');
  const stream=new ReadableStream({start(c){for(const b of data)c.enqueue(new Uint8Array([b]));c.close();}});
  assert.equal((await parseResponse(new Response(stream))).text,'ação');
});
test('SIWC payload allowlist never leaks unsupported parameters or private endpoints',async()=>{
  let request:any;
  const model=new SiwcModel('selected',async()=>'synthetic-token',async(url,init)=>{
    request={url,body:JSON.parse(String(init?.body))};
    return sse([{type:'response.completed',response:{status:'completed',output:[{content:[{type:'output_text',text:'ok'}]}]}}]);
  });
  await model.respond(context,new AbortController().signal);
  assert.equal(request.url,'https://api.openai.com/v1/responses');
  assert.deepEqual(Object.keys(request.body).sort(),['input','instructions','model','store','stream']);
  assert.equal(request.body.store,false);assert.equal(request.body.stream,true);
});
test('OAuth uses PKCE, stable host identity, separate plan scope and exact state',()=>{
  const p=authParameters('urn:uuid:00000000-0000-4000-8000-000000000000');
  const url=new URL(p.url);
  assert.equal(url.searchParams.get('client_id'),'dynamic_agent_client');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.match(url.searchParams.get('scope')??'',/chatgpt.tokens.use.direct/);
  assert.equal(url.searchParams.get('redirect_uri'),'http://127.0.0.1:1455/auth/callback');
  assert.throws(()=>verifyState('wrong',p.state),/INVALID_OAUTH_STATE/);
  verifyState(p.state,p.state);
  assert.equal(new URL(authParameters('host','oaiapp_saved').url).searchParams.has('agent_name_hint'),false);
});
test('vault encrypts secrets and rejects permissive file modes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lc-vault-'));
  try{
    const key=join(dir,'key'),file=join(dir,'profile');
    await createVaultKey(key);
    const v=new Vault(file,key);
    const p:Profile={client_id:'issued',subject:'user',issuer:'https://auth.openai.com',access_token:'sensitive-access',refresh_token:'sensitive-refresh',
      scopes:['chatgpt.tokens.use.direct'],expires_at:Date.now()+999999,saved_at:new Date().toISOString()};
    await v.save(p);assert.doesNotMatch(await readFile(file,'utf8'),/sensitive/);
    assert.equal(await v.token(),'sensitive-access');
    await chmod(file,0o644);await assert.rejects(v.load(),/UNSAFE_SECRET_PERMISSIONS/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('intensity cannot overcome explicit stop or lack of capacity',()=>{
  const i:any={explicitStop:true,paused:false,goalConfirmed:true,capacity:'yes',intensity:'challenge',contactsToday:0,dailyLimit:2,unanswered:0,quiet:false};
  assert.equal(nudgeDecision(i),'stop');assert.equal(nudgeDecision({...i,explicitStop:false,capacity:'no'}),'adapt');
  assert.equal(nudgeDecision({...i,explicitStop:false,unanswered:2}),'defer');
  assert.equal(nudgeDecision({...i,explicitStop:false,goalConfirmed:false}),'clarify_goal');
});
test('numeric owner and private chat are required; message splitting preserves unicode',()=>{
  assert.equal(authorized('1','1','private','1','1'),true);
  assert.equal(authorized('1','1','group','1','1'),false);
  const s='😀'.repeat(7001);assert.equal(splitMessage(s).join(''),s);
  assert.ok(splitMessage(s).every(chunk=>chunk.length<=3500));
});
test('AI SDK bridge is fail-closed and interoperates for text-only synthetic calls',async()=>{
  const transport=new SiwcModel('fixture',async()=>'synthetic',async()=>sse([{type:'response.completed',response:{status:'completed',output:[{content:[{type:'output_text',text:'bridge ok'}]}]}}]));
  await assert.rejects(generateText({model:eveSiwcModel(transport,false),prompt:'oi',maxRetries:0}),/EVE_LIVE_GATE_DISABLED/);
  const r=await generateText({model:eveSiwcModel(transport,true),prompt:'oi',maxRetries:0});assert.equal(r.text,'bridge ok');
});
test('refresh is serialized across vault instances and stores rotated credentials atomically',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lc-refresh-'));
  try{
    const key=join(dir,'key'),file=join(dir,'profile');await createVaultKey(key);
    let started!:()=>void;const ready=new Promise<void>(r=>started=r);
    let release!:()=>void;const wait=new Promise<void>(r=>release=r);let calls=0;
    const fetcher:typeof fetch=async()=>{calls++;started();await wait;return Response.json({access_token:'new-access',refresh_token:'new-refresh',expires_in:3600});};
    const a=new Vault(file,key,fetcher),b=new Vault(file,key,fetcher);
    await a.save({client_id:'issued',subject:'owner',issuer:'https://auth.openai.com',access_token:'old',refresh_token:'old-refresh',
      scopes:['chatgpt.tokens.use.direct'],expires_at:0,saved_at:new Date().toISOString()});
    const first=a.token();await ready;await assert.rejects(b.token(),/VAULT_REFRESH_BUSY/);
    release();assert.equal(await first,'new-access');assert.equal((await b.load()).refresh_token,'new-refresh');assert.equal(calls,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('identity-only grant cannot make inference calls',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lc-scope-'));
  try{
    const key=join(dir,'key'),file=join(dir,'profile');await createVaultKey(key);
    const v=new Vault(file,key,async()=>{throw new Error('network must not run');});
    await v.save({client_id:'issued',subject:'owner',issuer:'https://auth.openai.com',access_token:'x',refresh_token:'y',
      scopes:['openid'],expires_at:Date.now()+999999,saved_at:new Date().toISOString()});
    await assert.rejects(v.token(),/PLAN_USAGE_NOT_GRANTED/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('Telegram raw normalization preserves update identity and edits',()=>{
  const e=normalize({update_id:77,edited_message:{message_id:6,date:100,chat:{id:12345,type:'private'},from:{id:12345,is_bot:false,first_name:'Owner'},text:'correção'}});
  assert.equal(e?.updateId,'77');assert.equal(e?.edited,true);assert.equal(e?.senderId,'12345');
});
test('Telegram respects provider flood-control delay without exposing the bot token',async()=>{
  const api=new TelegramApi('not-a-real-token',async()=>Response.json({ok:false,error_code:429,parameters:{retry_after:120}},{status:429}));
  await assert.rejects(api.send('12345',{text:'x'}),(e:any)=>e.message==='TELEGRAM_RATE_LIMIT'&&e.retryAfter===120&&!String(e).includes('not-a-real-token'));
});

