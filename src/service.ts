import {randomUUID} from 'node:crypto';
import type {Db} from './db.ts';
import type {Inbound,Outgoing} from './types.ts';
import {authorized,control} from './policy.ts';
import {learningSummary} from './learning.ts';

export const OWNER='owner';
export const HELP='Life Coach — fundação v0.1\n/hoje: conversar sobre o dia\n/memoria: ver dados declarados\n/guardar fato|estado|meta|preferencia|limite chave | valor\n/corrigir ID | novo valor\n/cobranca: limites de acompanhamento\n/pausar e /retomar: contato proativo\n/parar: interromper trabalho atual\n/esquecer: excluir dados locais com confirmação\n/status: modo e controles\nAprendizado autônomo e calendário ainda não estão habilitados.';
export async function enqueue(db:Db,key:string,payload:Outgoing,epoch:number|null=null):Promise<void>{
  await db.query('INSERT INTO lc_outbox(id,user_id,dedupe_key,payload,epoch) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dedupe_key) DO NOTHING',
    [randomUUID(),OWNER,key,JSON.stringify(payload),epoch]);
}
export class CoachService {
  db:Db; ownerId:string; ownerChat:string; onStop:()=>void;
  constructor(db:Db,ownerId:string,ownerChat:string,onStop=()=>{}){
    this.db=db;this.ownerId=ownerId;this.ownerChat=ownerChat;this.onStop=onStop;
  }
  async initialize(){
    await this.db.query('INSERT INTO lc_user(id,telegram_id,chat_id) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[OWNER,this.ownerId,this.ownerChat]);
    const u=(await this.db.query('SELECT * FROM lc_user WHERE id=$1',[OWNER])).rows[0];
    if(u.telegram_id!==this.ownerId||u.chat_id!==this.ownerChat)throw new Error('OWNER_BINDING_MISMATCH');
  }
  async receive(e:Inbound):Promise<'accepted'|'duplicate'|'denied'>{
    if(!authorized(e.senderId,e.chatId,e.chatType,this.ownerId,this.ownerChat))return 'denied';
    let stopped=false;
    const result=await this.db.transaction(async tx=>{
      const inserted=await tx.query('INSERT INTO lc_updates(update_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING update_id',[e.updateId]);
      if(!inserted.rowCount)return 'duplicate' as const;
      await tx.query('SELECT id FROM lc_user WHERE id=$1 FOR UPDATE',[OWNER]);
      const eventId=randomUUID();
      await tx.query('INSERT INTO lc_events(id,user_id,source_id,type,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6)',
        [eventId,OWNER,'telegram:'+e.updateId,e.edited?'edit':e.callbackData?'callback':'message',
          JSON.stringify({role:'user',text:e.text,message_id:e.updateId}),e.occurredAt.toISOString()]);
      const reply=(text:string,buttons?:Outgoing['buttons'])=>enqueue(tx,'reply:'+e.updateId,{text,buttons});
      if(e.callbackData){
        if(!/^delete:[a-f0-9-]{36}$/.test(e.callbackData)){await reply('Este botão não é válido.');return 'accepted' as const;}
        const action=(await tx.query('UPDATE lc_actions SET consumed_at=now() WHERE id=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING id',[e.callbackData.slice(7),OWNER])).rows[0];
        if(!action){await reply('Este botão venceu ou já foi usado.');return 'accepted' as const;}
        await tx.query('UPDATE lc_user SET epoch=epoch+1,proactive_paused=true,learning_paused=true WHERE id=$1',[OWNER]);
        await tx.query('DELETE FROM lc_memory WHERE user_id=$1',[OWNER]);
        await tx.query('DELETE FROM lc_rule_candidates WHERE user_id=$1',[OWNER]);
        await tx.query('DELETE FROM lc_learning_incidents WHERE user_id=$1',[OWNER]);
        await tx.query('DELETE FROM lc_verification_runs WHERE user_id=$1',[OWNER]);
        await tx.query('DELETE FROM lc_events WHERE user_id=$1',[OWNER]);
        await tx.query('DELETE FROM lc_outbox WHERE user_id=$1',[OWNER]);
        await tx.query('DELETE FROM lc_actions WHERE user_id=$1',[OWNER]);
        await tx.query('DELETE FROM lc_audit WHERE user_id=$1',[OWNER]);
        for(const table of ['chat_state_cache','chat_state_lists','chat_state_queues','chat_state_subscriptions']){
          const exists=(await tx.query('SELECT to_regclass($1) AS relation',[table])).rows[0];
          if(exists.relation)await tx.query('DELETE FROM '+table+' WHERE key_prefix=$1',['life-coach-v01']);
        }
        await tx.query('INSERT INTO lc_audit(id,user_id,type) VALUES($1,$2,$3)',[randomUUID(),OWNER,'deletion_completed']);
        stopped=true;
        await reply('Dados pessoais desta instalação apagados. Identidade de acesso preservada; acompanhamento e aprendizado pausados. Isso não apaga cópias no Telegram nem em backups externos.');
        return 'accepted' as const;
      }
      const c=control(e.text);
      if(c){
        if(c==='stop'){
          await tx.query('UPDATE lc_user SET epoch=epoch+1 WHERE id=$1',[OWNER]);
          await tx.query("UPDATE lc_jobs SET state='cancelled' WHERE user_id=$1 AND state IN ('queued','running')",[OWNER]);
          await tx.query("UPDATE lc_outbox SET state='cancelled' WHERE user_id=$1 AND epoch IS NOT NULL AND state IN ('pending','sending')",[OWNER]);
          stopped=true;await reply('Interrompido. Uma operação que já chegou a um serviço externo pode precisar de verificação.');
        }else{
          await tx.query('UPDATE lc_user SET proactive_paused=$2 WHERE id=$1',[OWNER,c==='pause']);
          await reply(c==='pause'?'Contatos proativos pausados. Não há agendamentos ativos nesta versão.':'Pausa retirada. Isso não cria novos lembretes ou autorizações.');
        }return 'accepted' as const;
      }
      if(e.edited){await reply('Edição registrada. Para corrigir uma memória use /corrigir ID | novo valor.');return 'accepted' as const;}
      const t=e.text.trim();
      if(t==='/aprendizados'){await reply(await learningSummary(tx,OWNER));return 'accepted' as const;}
      if(t==='/start'||t==='/help'){await reply(HELP);return 'accepted' as const;}
      if(t==='/status'){
        const u=(await tx.query('SELECT proactive_paused,learning_paused FROM lc_user WHERE id=$1',[OWNER])).rows[0];
        await reply('Fundação v0.1. Memória PostgreSQL. Proatividade: '+(u.proactive_paused?'pausada':'sem jobs configurados')+'. Aprendizado: em desenvolvimento, sem alterações autônomas. Inferência real depende da conexão SIWC.');
        return 'accepted' as const;
      }
      if(t==='/cobranca'){await reply('Padrão: sem cobrança proativa e sem aumento autônomo de intensidade. Seus limites explícitos têm prioridade. Use /guardar limite nome | descrição. Acordos por domínio serão habilitados após a prova real.');return 'accepted' as const;}
      if(t==='/memoria'){
        const rows=(await tx.query('SELECT m.id,m.kind,m.name,v.value FROM lc_memory m JOIN lc_memory_versions v ON v.memory_id=m.id AND v.version=m.current_version WHERE m.user_id=$1 ORDER BY m.kind,m.name',[OWNER])).rows;
        await reply(rows.length?rows.map(x=>x.id+'\n'+x.kind+' — '+x.name+': '+x.value).join('\n\n'):'Ainda não há memórias confirmadas. Use /guardar tipo chave | valor.');
        return 'accepted' as const;
      }
      const save=/^\/guardar (fato|estado|meta|preferencia|limite) ([^|\n]{1,80})\|([\s\S]{1,2000})$/.exec(t);
      const edit=/^\/corrigir ([a-f0-9-]{36})\s*\|([\s\S]{1,2000})$/.exec(t);
      if(save||edit){
        let m:any;
        if(save){
          const kinds:Record<string,string>={fato:'fact',estado:'state',meta:'goal',preferencia:'preference',limite:'boundary'};
          m=(await tx.query('INSERT INTO lc_memory(id,user_id,kind,name) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,kind,name) DO UPDATE SET current_version=lc_memory.current_version+1 RETURNING *',
          [randomUUID(),OWNER,kinds[save[1]],save[2].trim()])).rows[0];
        }else{
          m=(await tx.query('UPDATE lc_memory SET current_version=current_version+1 WHERE id=$1 AND user_id=$2 RETURNING *',[edit![1],OWNER])).rows[0];
        }
        if(!m){await reply('Memória não encontrada.');return 'accepted' as const;}
        const value=(save?save[3]:edit![2]).trim();
        if(!value)throw new Error('EMPTY_MEMORY');
        await tx.query('INSERT INTO lc_memory_versions(memory_id,version,value,event_id,valid_to) VALUES($1,$2,$3,$4,$5)',
          [m.id,m.current_version,value,eventId,m.kind==='state'?new Date(Date.now()+86400000).toISOString():null]);
        await tx.query('UPDATE lc_user SET epoch=epoch+1 WHERE id=$1',[OWNER]);
        stopped=true;
        await reply('Memória confirmada: '+m.id+' (versão '+m.current_version+').'+(m.kind==='state'?' Estado válido por 24h.':'')+' Nenhuma inferência foi promovida automaticamente.');
        return 'accepted' as const;
      }
      if(t==='/esquecer'){
        const id=randomUUID();
        await tx.query("INSERT INTO lc_actions(id,user_id,type,expires_at) VALUES($1,$2,'delete_all',now()+interval '2 minutes')",[id,OWNER]);
        await reply('Apagar todos os dados pessoais desta instalação? Inclui eventos, memórias, contexto e respostas pendentes. O acesso será preservado e o acompanhamento pausado. Telegram e backups externos não são apagados por este comando.',
          [{text:'Confirmar exclusão local',data:'delete:'+id}]);return 'accepted' as const;
      }
      if(t.startsWith('/')&&!['/hoje','/semana'].includes(t)){
        await reply('Comando indisponível nesta versão. Use /help.');return 'accepted' as const;
      }
      if(!t||t.length>8000){await reply('Envie texto de até 8.000 caracteres nesta versão.');return 'accepted' as const;}
      const epoch=(await tx.query('SELECT epoch FROM lc_user WHERE id=$1',[OWNER])).rows[0].epoch;
      await tx.query('INSERT INTO lc_jobs(id,event_id,user_id,epoch) VALUES($1,$2,$3,$4)',[randomUUID(),eventId,OWNER,epoch]);
      return 'accepted' as const;
    });
    if(stopped)this.onStop();
    return result;
  }
}

