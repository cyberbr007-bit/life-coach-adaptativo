import {randomUUID} from 'node:crypto';
import type {Db} from './db.ts';
import type {Model,Delivery} from './types.ts';
import {compileContext,RELEASE} from './context.ts';
import {enqueue} from './service.ts';
import {splitMessage} from './policy.ts';

export class Worker {
  db:Db; model:Model; active:AbortController|null=null;
  constructor(db:Db,model:Model){this.db=db;this.model=model;}
  stop(){this.active?.abort();}
  async runOne():Promise<boolean>{
    const lease=randomUUID();
    const job=await this.db.transaction(async tx=>{
      const row=(await tx.query("SELECT * FROM lc_jobs WHERE (state='queued' OR (state='running' AND lease_until<now())) AND attempts<3 ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
      if(!row)return null;
      await tx.query("UPDATE lc_jobs SET state='running',lease_token=$2,lease_until=now()+interval '90 seconds',attempts=attempts+1 WHERE id=$1",[row.id,lease]);
      return row;
    });
    if(!job)return false;
    const controller=new AbortController();this.active=controller;
    const deadline=setTimeout(()=>controller.abort(),60000);
    let runId:string|null=null;
    try{
      const before=(await this.db.query('SELECT epoch FROM lc_user WHERE id=$1',[job.user_id])).rows[0];
      if(before.epoch!==job.epoch)throw new Error('STALE_EPOCH');
      const context=await compileContext(this.db,job.user_id,job.event_id);
      runId=randomUUID();
      await this.db.query("INSERT INTO lc_runs(id,job_id,context,release,status) VALUES($1,$2,$3,$4,'running')",[runId,job.id,JSON.stringify(context.manifest),RELEASE]);
      const result=await this.model.respond(context,controller.signal);
      if(controller.signal.aborted)throw new Error('CANCELLED');
      await this.db.transaction(async tx=>{
        const user=(await tx.query('SELECT epoch FROM lc_user WHERE id=$1 FOR UPDATE',[job.user_id])).rows[0];
        const owned=(await tx.query("SELECT id FROM lc_jobs WHERE id=$1 AND lease_token=$2 AND state='running'",[job.id,lease])).rows[0];
        if(!owned)return;
        if(user.epoch!==job.epoch){
          await tx.query("UPDATE lc_jobs SET state='cancelled',lease_until=NULL WHERE id=$1 AND lease_token=$2",[job.id,lease]);
          await tx.query("UPDATE lc_runs SET status='cancelled' WHERE id=$1",[runId]);
          return;
        }
        await tx.query("INSERT INTO lc_events(id,user_id,source_id,type,payload,occurred_at) VALUES($1,$2,$3,'assistant',$4,now())",
          [randomUUID(),job.user_id,'run:'+runId,JSON.stringify({role:'assistant',text:result.text})]);
        for(const [i,text] of splitMessage(result.text).entries()) await enqueue(tx,'run:'+job.id+':'+i,{text},job.epoch);
        await tx.query("UPDATE lc_runs SET status='completed',model=$2,request_id=$3 WHERE id=$1",[runId,result.model,result.requestId??null]);
        await tx.query("UPDATE lc_jobs SET state='done',lease_until=NULL WHERE id=$1 AND lease_token=$2",[job.id,lease]);
      });
    }catch(err){
      const code=controller.signal.aborted?'CANCELLED':err instanceof Error&&/^[A-Z_0-9]+$/.test(err.message)?err.message:'INFERENCE_FAILED';
      await this.db.transaction(async tx=>{
        const owned=(await tx.query("SELECT id FROM lc_jobs WHERE id=$1 AND lease_token=$2 AND state='running'",[job.id,lease])).rows[0];
        if(!owned)return;
        const epoch=(await tx.query('SELECT epoch FROM lc_user WHERE id=$1',[job.user_id])).rows[0].epoch;
        await tx.query("UPDATE lc_jobs SET state=$3,error_code=$4,lease_until=NULL WHERE id=$1 AND lease_token=$2",
          [job.id,lease,epoch!==job.epoch||code==='CANCELLED'||code==='STALE_EPOCH'?'cancelled':'failed',code]);
        if(runId)await tx.query("UPDATE lc_runs SET status='failed' WHERE id=$1",[runId]);
        if(epoch===job.epoch&&code!=='CANCELLED'&&code!=='STALE_EPOCH')
          await enqueue(tx,'failed:'+job.id,{text:'Não consegui concluir esta resposta. Sua mensagem foi preservada. Verifique /status; não houve troca para cobrança API.'},job.epoch);
      });
    }finally{clearTimeout(deadline);this.active=null;}
    return true;
  }
}
export async function deliverOne(db:Db,delivery:Delivery):Promise<boolean>{
  const lease=randomUUID();
  const row=await db.transaction(async tx=>{
    const r=(await tx.query("SELECT o.*,u.chat_id,u.epoch AS user_epoch,u.proactive_paused FROM lc_outbox o JOIN lc_user u ON u.id=o.user_id WHERE (o.state='pending' OR (o.state='sending' AND o.lease_until<now())) AND o.next_attempt<=now() AND o.attempts<3 ORDER BY o.created_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1")).rows[0];
    if(!r)return null;
    if((r.epoch!==null&&r.epoch!==r.user_epoch)||(r.proactive&&r.proactive_paused)){
      await tx.query("UPDATE lc_outbox SET state='cancelled' WHERE id=$1",[r.id]);return {cancelled:true};
    }
    await tx.query("UPDATE lc_outbox SET state='sending',lease_token=$2,lease_until=now()+interval '30 seconds',attempts=attempts+1 WHERE id=$1",[r.id,lease]);
    return r;
  });
  if(!row)return false;
  if(row.cancelled)return true;
  try{
    for(const [part,text] of splitMessage(row.payload.text).entries()){
      const reply=await delivery.send(row.chat_id,{text,buttons:part===0?row.payload.buttons:undefined});
      await db.query('UPDATE lc_outbox SET telegram_message_id=$3 WHERE id=$1 AND lease_token=$2',[row.id,lease,reply.messageId]);
    }
    await db.query("UPDATE lc_outbox SET state='sent',lease_until=NULL WHERE id=$1 AND lease_token=$2",[row.id,lease]);
  }catch(e){
    const error=e as {retryAfter?:number;permanent?:boolean};
    const retryAt=new Date(Date.now()+Math.max(30,error.retryAfter??30)*1000).toISOString();
    await db.query("UPDATE lc_outbox SET state=CASE WHEN attempts>=3 OR $4 THEN 'failed' ELSE 'pending' END,error_code='DELIVERY_FAILED',next_attempt=$3,lease_until=NULL WHERE id=$1 AND lease_token=$2",[row.id,lease,retryAt,Boolean(error.permanent)]);
  }
  return true;
}

