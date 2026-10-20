import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Db} from './db.ts';
const Criterion=z.object({id:z.string().min(1),description:z.string().min(1)}).strict();
const Check=z.object({id:z.string().min(1),result:z.enum(['PASS','FAIL']),evidence:z.string().min(1)}).strict();
export type CheckResult=z.infer<typeof Check>;
export function digest(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export async function registerStandard(db:Db,id:string,input:unknown){
  const criteria=z.array(Criterion).min(1).parse(input);
  if(new Set(criteria.map(x=>x.id)).size!==criteria.length)throw new Error('DUPLICATE_CRITERION');
  const hash=digest(criteria);
  await db.query('INSERT INTO lc_verification_standards(id,digest,criteria) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,hash,JSON.stringify(criteria)]);
  const row=(await db.query('SELECT digest FROM lc_verification_standards WHERE id=$1',[id])).rows[0];
  if(row.digest!==hash)throw new Error('STANDARD_IMMUTABLE');
  return hash;
}
export async function verify(db:Db,userId:string,standardId:string,input:unknown){
  const row=(await db.query('SELECT * FROM lc_verification_standards WHERE id=$1',[standardId])).rows[0];
  if(!row||digest(row.criteria)!==row.digest)throw new Error('STANDARD_INTEGRITY_FAILURE');
  const checks=z.array(Check).parse(input);
  const expected=row.criteria.map((x:any)=>x.id).sort();
  const actual=checks.map(x=>x.id).sort();
  if(new Set(actual).size!==actual.length||JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('CRITERIA_COVERAGE_MISMATCH');
  const id=randomUUID();const passed=checks.every(x=>x.result==='PASS');
  await db.query('INSERT INTO lc_verification_runs(id,user_id,standard_id,results,passed) VALUES($1,$2,$3,$4,$5)',
    [id,userId,standardId,JSON.stringify(checks),passed]);
  return {id,passed};
}
export function changeDecision(i:{kind:'defect'|'opportunity'|'observation';confirmed:boolean;protectedScope:boolean;failedAttempts:number}){
  if(i.protectedScope)return 'HUMAN_REVIEW_REQUIRED';
  if(i.failedAttempts>=2)return 'STOP_AND_REPORT';
  if(i.kind==='opportunity')return 'PROPOSAL_ONLY';
  if(i.kind==='observation'||!i.confirmed)return 'LOG_AND_REPRODUCE';
  return 'SMALL_REVERSIBLE_FIX_ALLOWED';
}
export async function recordIncident(db:Db,userId:string,input:{
  kind:'defect'|'opportunity'|'observation';fingerprint:string;summary:string;eventId:string;
  evidenceRuns:string[];criterionId?:string;scope:string;rollback:string;
}){
  if(!input.scope||!input.rollback||!input.summary||!input.fingerprint)throw new Error('INCIDENT_PROVENANCE_REQUIRED');
  const source=await db.query('SELECT id FROM lc_events WHERE id=$1 AND user_id=$2',[input.eventId,userId]);
  if(source.rows.length===0)throw new Error('INCIDENT_SOURCE_REQUIRED');
  const unique=[...new Set(input.evidenceRuns)];
  const runs=[];
  for(const id of unique){
    const row=(await db.query('SELECT * FROM lc_verification_runs WHERE id=$1 AND user_id=$2',[id,userId])).rows[0];
    if(!row)throw new Error('INVALID_VERIFICATION_EVIDENCE');runs.push(row);
  }
  const failures=runs.filter(r=>!r.passed&&r.results.some((c:any)=>c.result==='FAIL'&&c.id===input.criterionId));
  const confirmed=input.kind==='defect'&&failures.length>=2&&new Set(failures.map(r=>r.standard_id)).size===1;
  if(input.kind==='defect'&&failures.length===0)throw new Error('DEFECT_REQUIRES_FAILED_CHECK');
  const id=randomUUID();
  await db.query('INSERT INTO lc_learning_incidents(id,user_id,event_id,kind,fingerprint,summary,evidence_runs,confirmed,scope,rollback) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [id,userId,input.eventId,input.kind,input.fingerprint,input.summary,JSON.stringify(unique),confirmed,input.scope,input.rollback]);
  return {id,confirmed};
}
export async function proposeRule(db:Db,userId:string,fingerprint:string,rule:string){
  // Recurrence makes a candidate, never a constitution edit or an active strategy.
  const rows=(await db.query("SELECT i.id,i.event_id FROM lc_learning_incidents i WHERE user_id=$1 AND fingerprint=$2 AND kind='defect' AND confirmed=true ORDER BY created_at,id",[userId,fingerprint])).rows;
  const distinct=[...new Map(rows.map(r=>[r.event_id,r])).values()];
  if(distinct.length<3)throw new Error('RECURRENCE_NOT_ESTABLISHED');
  if(!rule.trim())throw new Error('EMPTY_RULE');
  const id=randomUUID();
  await db.query('INSERT INTO lc_rule_candidates(id,user_id,fingerprint,proposed_rule,evidence_ids) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,fingerprint) DO NOTHING',
    [id,userId,fingerprint,rule,JSON.stringify(distinct.map(x=>x.id))]);
  return (await db.query('SELECT * FROM lc_rule_candidates WHERE user_id=$1 AND fingerprint=$2',[userId,fingerprint])).rows[0];
}
export async function learningSummary(db:Db,userId:string){
  const incidents=(await db.query('SELECT kind,confirmed,summary FROM lc_learning_incidents WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5',[userId])).rows;
  const candidates=(await db.query('SELECT proposed_rule FROM lc_rule_candidates WHERE user_id=$1',[userId])).rows;
  return 'Aprendizado em sombra. Nenhuma regra foi promovida automaticamente.\n'+
    (incidents.length?incidents.map(x=>x.kind+' — '+(x.confirmed?'defeito reproduzido':'a confirmar')+': '+x.summary).join('\n'):'Sem incidentes registrados.')+
    '\nRegras candidatas: '+candidates.length+'.';
}

