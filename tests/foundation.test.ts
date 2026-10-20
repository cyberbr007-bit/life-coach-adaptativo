import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,inbound} from './helpers.ts';
import {compileContext} from '../src/context.ts';
import {Worker,deliverOne} from '../src/worker.ts';
import {CoachService} from '../src/service.ts';
import {migrate} from '../src/db.ts';

test('PostgreSQL migrations are idempotent and unauthorized messages never persist',async()=>{
  const f=await fixture();try{
    await migrate(f.db);
    assert.equal(await f.service.receive(inbound('secret',{senderId:'999'})),'denied');
    assert.equal((await f.db.query('SELECT * FROM lc_events')).rows.length,0);
    assert.equal(await f.service.receive(inbound('secret',{chatType:'group'})),'denied');
  }finally{await f.db.close();}
});
test('duplicate Telegram delivery produces one event and one queued job',async()=>{
  const f=await fixture();try{const e=inbound('planeje meu dia');
    assert.equal(await f.service.receive(e),'accepted');assert.equal(await f.service.receive(e),'duplicate');
    assert.equal((await f.db.query('SELECT * FROM lc_jobs')).rows.length,1);
    assert.equal((await f.db.query('SELECT * FROM lc_events')).rows.length,1);
  }finally{await f.db.close();}
});
test('memory correction preserves evidence and context uses current declaration',async()=>{
  const f=await fixture();try{
    await f.service.receive(inbound('/guardar limite manhã | não sugerir treino às 5h'));
    const m=(await f.db.query('SELECT * FROM lc_memory')).rows[0];
    await f.service.receive(inbound('/corrigir '+m.id+' | não sugerir treino antes das 8h'));
    await f.service.receive(inbound('qual o plano?'));
    const e=(await f.db.query("SELECT * FROM lc_events WHERE payload->>'text'='qual o plano?'")).rows[0];
    const c=await compileContext(f.db,'owner',e.id);
    assert.match(c.input[0].content,/8h/);assert.equal(c.manifest.memory[0].version,2);
    assert.equal((await f.db.query('SELECT * FROM lc_memory_versions')).rows.length,2);
  }finally{await f.db.close();}
});
test('expired state is omitted from compiled context',async()=>{
  const f=await fixture();try{
    await f.service.receive(inbound('/guardar estado energia | cansado'));
    await f.db.query("UPDATE lc_memory_versions SET valid_to=now()-interval '1 hour'");
    await f.service.receive(inbound('oi'));const e=(await f.db.query("SELECT * FROM lc_events WHERE payload->>'text'='oi'")).rows[0];
    const c=await compileContext(f.db,'owner',e.id);assert.equal(c.manifest.memory.length,0);
  }finally{await f.db.close();}
});
test('temporal snapshot retrieves old version rather than leaking future correction',async()=>{
  const f=await fixture();try{
    await f.service.receive(inbound('/guardar meta rotina | versão antiga'));
    const m=(await f.db.query('SELECT * FROM lc_memory')).rows[0];
    await f.db.query("UPDATE lc_memory_versions SET recorded_at=now()-interval '2 hours',valid_from=now()-interval '2 hours'");
    await f.service.receive(inbound('/corrigir '+m.id+' | versão futura'));
    await f.service.receive(inbound('plano'));
    const e=(await f.db.query("SELECT * FROM lc_events WHERE payload->>'text'='plano'")).rows[0];
    await f.db.query("UPDATE lc_events SET recorded_at=now()-interval '2 hours' WHERE id=$1",[e.id]);
    const c=await compileContext(f.db,'owner',e.id,new Date(Date.now()-3600000));
    assert.equal(c.manifest.memory[0].version,1);assert.doesNotMatch(c.input[0].content,/futura/);
  }finally{await f.db.close();}
});
test('worker persists completed result and outbox survives dispatcher restart',async()=>{
  const f=await fixture();try{
    await f.service.receive(inbound('me ajude'));
    const w=new Worker(f.db,{async respond(){return {text:'Uma ação pequena.',model:'fake'};}});
    assert.equal(await w.runOne(),true);
    assert.equal((await f.db.query("SELECT * FROM lc_jobs WHERE state='done'")).rows.length,1);
    const sent:string[]=[];
    assert.equal(await deliverOne(f.db,{async send(_chat,p){sent.push(p.text);return {messageId:'1'};}}),true);
    assert.equal(await deliverOne(f.db,{async send(){throw new Error('must not resend');}}),false);
    assert.deepEqual(sent,['Uma ação pequena.']);
  }finally{await f.db.close();}
});
test('stop cancels generation and prevents stale output from entering outbox',async()=>{
  const f=await fixture();try{
    let started!:()=>void;const ready=new Promise<void>(r=>started=r);
    let finish!:()=>void;const done=new Promise<void>(r=>finish=r);
    const w=new Worker(f.db,{async respond(){started();await done;return {text:'should not be delivered',model:'fake'};}});
    const svc=new CoachService(f.db,'12345','12345',()=>w.stop());await svc.initialize();
    await svc.receive(inbound('gerar'));const running=w.runOne();await ready;
    await svc.receive(inbound('/parar'));finish();await running;
    assert.equal((await f.db.query("SELECT * FROM lc_outbox WHERE payload->>'text'='should not be delivered'")).rows.length,0);
    assert.equal((await f.db.query("SELECT * FROM lc_jobs WHERE state='cancelled'")).rows.length,1);
  }finally{await f.db.close();}
});
test('pause is immediate, no opt-in is inferred from silence',async()=>{
  const f=await fixture();try{
    await f.service.receive(inbound('/retomar'));await f.service.receive(inbound('pare de me cobrar'));
    const u=(await f.db.query("SELECT * FROM lc_user WHERE id='owner'")).rows[0];
    assert.equal(u.proactive_paused,true);assert.equal(u.learning_paused,true);
  }finally{await f.db.close();}
});
test('deletion callback is owner-bound, expiring, one-time and clears derived data',async()=>{
  const f=await fixture();try{
    await f.service.receive(inbound('/guardar fato nome | dado pessoal'));
    await f.service.receive(inbound('/esquecer'));
    const a=(await f.db.query('SELECT * FROM lc_actions')).rows[0];
    assert.equal(await f.service.receive(inbound('',{senderId:'999',callbackData:'delete:'+a.id})),'denied');
    assert.equal((await f.db.query('SELECT * FROM lc_memory')).rows.length,1);
    await f.service.receive(inbound('',{callbackData:'delete:'+a.id}));
    assert.equal((await f.db.query('SELECT * FROM lc_memory')).rows.length,0);
    assert.equal((await f.db.query('SELECT * FROM lc_events')).rows.length,0);
    assert.equal((await f.db.query('SELECT * FROM lc_audit')).rows[0].type,'deletion_completed');
    await f.service.receive(inbound('',{callbackData:'delete:'+a.id}));
    assert.equal((await f.db.query("SELECT * FROM lc_audit WHERE type='deletion_completed'")).rows.length,1);
  }finally{await f.db.close();}
});
test('interrupted model never writes an assistant message',async()=>{
  const f=await fixture();try{
    await f.service.receive(inbound('oi'));
    await new Worker(f.db,{async respond(){throw new Error('STREAM_INTERRUPTED');}}).runOne();
    assert.equal((await f.db.query("SELECT * FROM lc_events WHERE type='assistant'")).rows.length,0);
    assert.equal((await f.db.query("SELECT * FROM lc_jobs")).rows[0].error_code,'STREAM_INTERRUPTED');
  }finally{await f.db.close();}
});
test('durable local PostgreSQL fixture survives close and reopen',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lc-pg-'));
  try{
    const f=await fixture(dir);await f.service.receive(inbound('persistir'));await f.db.close();
    const next=await fixture(dir);try{assert.equal((await next.db.query('SELECT * FROM lc_jobs')).rows.length,1);}
    finally{await next.db.close();}
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('expired deletion confirmation does not delete memories',async()=>{
  const f=await fixture();try{
    await f.service.receive(inbound('/guardar fato nome | preservar'));
    await f.service.receive(inbound('/esquecer'));
    const a=(await f.db.query('SELECT * FROM lc_actions')).rows[0];
    await f.db.query("UPDATE lc_actions SET expires_at=now()-interval '1 second'");
    await f.service.receive(inbound('',{callbackData:'delete:'+a.id}));
    assert.equal((await f.db.query('SELECT * FROM lc_memory')).rows.length,1);
  }finally{await f.db.close();}
});
test('configuration cannot silently replace the owner binding',async()=>{
  const f=await fixture();try{
    await assert.rejects(new CoachService(f.db,'99999','99999').initialize(),/OWNER_BINDING_MISMATCH/);
    assert.equal((await f.db.query('SELECT telegram_id FROM lc_user')).rows[0].telegram_id,'12345');
  }finally{await f.db.close();}
});

