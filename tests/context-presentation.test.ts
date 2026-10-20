import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,inbound} from './helpers.ts';
import {compileContext,RELEASE} from '../src/context.ts';

test('updated boundary retains its effective dates alongside an older assistant plan',async()=>{
  const f=await fixture();
  try{
    await f.service.receive(inbound('/guardar limite teste | atividades após as 6h'));
    const memory=(await f.db.query('SELECT id FROM lc_memory')).rows[0];
    await f.db.query("INSERT INTO lc_events(id,user_id,source_id,type,payload,occurred_at) VALUES($1,'owner',$2,'assistant',$3,now())",
      [randomUUID(),'synthetic:old-plan',JSON.stringify({role:'assistant',text:'Plano anterior: começar às 6h.'})]);
    await f.service.receive(inbound('/corrigir '+memory.id+' | atividades após as 8h'));
    await f.service.receive(inbound('atualize o plano'));
    const event=(await f.db.query("SELECT id FROM lc_events WHERE payload->>'text'='atualize o plano'")).rows[0];
    const version=(await f.db.query('SELECT valid_from,recorded_at FROM lc_memory_versions WHERE memory_id=$1 AND version=2',[memory.id])).rows[0];
    const context=await compileContext(f.db,'owner',event.id);
    const declared=JSON.parse(context.input[0].content.split('Memórias declaradas: ')[1]);
    assert.equal(declared.length,1);
    assert.equal(declared[0].version,2);
    assert.equal(declared[0].value,'atividades após as 8h');
    assert.equal(new Date(declared[0].valid_from).toISOString(),new Date(version.valid_from).toISOString());
    assert.equal(new Date(declared[0].recorded_at).toISOString(),new Date(version.recorded_at).toISOString());
    assert.ok(context.input.some(x=>x.role==='assistant'&&x.content==='Plano anterior: começar às 6h.'));
    assert.equal(context.manifest.release,RELEASE);
    assert.equal((await f.db.query('SELECT version FROM lc_memory_versions WHERE memory_id=$1',[memory.id])).rows.length,2);
  }finally{await f.db.close();}
});
