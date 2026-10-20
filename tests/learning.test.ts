import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,inbound} from './helpers.ts';
import {registerStandard,verify,recordIncident,proposeRule,changeDecision} from '../src/learning.ts';
const criteria=[{id:'constraint',description:'Preservar o limite explícito'}];
const fail=[{id:'constraint',result:'FAIL',evidence:'fixture de limite omitido'}];
test('verification standard is frozen and scores cannot substitute PASS/FAIL',async()=>{
  const f=await fixture();try{
    await registerStandard(f.db,'v1',criteria);
    await assert.rejects(registerStandard(f.db,'v1',[{id:'easy',description:'critério enfraquecido'}]),/STANDARD_IMMUTABLE/);
    await assert.rejects(f.db.query("UPDATE lc_verification_standards SET digest='changed' WHERE id='v1'"),/STANDARD_IMMUTABLE/);
    await assert.rejects(verify(f.db,'owner','v1',[{id:'constraint',result:5,evidence:'opinião'}]));
    await assert.rejects(verify(f.db,'owner','v1',[]),/CRITERIA_COVERAGE_MISMATCH/);
  }finally{await f.db.close();}
});
test('observed failure is logged but only reproduced failures become confirmed',async()=>{
  const f=await fixture();try{
    await f.service.receive(inbound('fonte de teste'));const event=(await f.db.query('SELECT id FROM lc_events')).rows[0];
    await registerStandard(f.db,'v1',criteria);const first=await verify(f.db,'owner','v1',fail);
    const base={kind:'defect' as const,fingerprint:'omitted-limit',summary:'limite omitido',eventId:event.id,criterionId:'constraint',scope:'compiler',rollback:'restore compiler v0.1'};
    assert.equal((await recordIncident(f.db,'owner',{...base,evidenceRuns:[first.id,first.id]})).confirmed,false);
    const second=await verify(f.db,'owner','v1',fail);
    assert.equal((await recordIncident(f.db,'owner',{...base,evidenceRuns:[first.id,second.id]})).confirmed,true);
  }finally{await f.db.close();}
});
test('three separate recurring incidents yield only a candidate, never an active rule',async()=>{
  const f=await fixture();try{
    await registerStandard(f.db,'v1',criteria);
    for(let i=0;i<3;i++){
      await f.service.receive(inbound('episódio '+i));
      const e=(await f.db.query('SELECT id FROM lc_events ORDER BY recorded_at DESC,id DESC LIMIT 1')).rows[0];
      const a=await verify(f.db,'owner','v1',fail),b=await verify(f.db,'owner','v1',fail);
      await recordIncident(f.db,'owner',{kind:'defect',fingerprint:'repeat',summary:'limite omitido',eventId:e.id,
        evidenceRuns:[a.id,b.id],criterionId:'constraint',scope:'compiler',rollback:'restore compiler v0.1'});
      if(i<2)await assert.rejects(proposeRule(f.db,'owner','repeat','Sempre carregar limites'),/RECURRENCE_NOT_ESTABLISHED/);
    }
    const candidate=await proposeRule(f.db,'owner','repeat','Sempre carregar limites');
    assert.equal(candidate.status,'candidate');
    await assert.rejects(f.db.query("UPDATE lc_rule_candidates SET status='active'"));
  }finally{await f.db.close();}
});
test('opportunities and protected changes cannot self-authorize; two failures stop the loop',()=>{
  assert.equal(changeDecision({kind:'opportunity',confirmed:true,protectedScope:false,failedAttempts:0}),'PROPOSAL_ONLY');
  assert.equal(changeDecision({kind:'defect',confirmed:true,protectedScope:true,failedAttempts:0}),'HUMAN_REVIEW_REQUIRED');
  assert.equal(changeDecision({kind:'defect',confirmed:true,protectedScope:false,failedAttempts:2}),'STOP_AND_REPORT');
  assert.equal(changeDecision({kind:'defect',confirmed:false,protectedScope:false,failedAttempts:0}),'LOG_AND_REPRODUCE');
});

