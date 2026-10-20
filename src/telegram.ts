import {TelegramAdapter,type TelegramUpdate} from '@chat-adapter/telegram';
import type {CoachService} from './service.ts';
import type {Delivery,Outgoing,Inbound} from './types.ts';
export function normalize(update:TelegramUpdate):Inbound|null {
  const callback=update.callback_query;
  const msg=callback?.message??update.edited_message??update.message;
  const from=callback?.from??msg?.from;
  if(!msg||!from)return null;
  return {updateId:String(update.update_id),senderId:String(from.id),chatId:String(msg.chat.id),
    chatType:msg.chat.type,text:callback?'':msg.text??'',occurredAt:new Date(msg.date*1000),
    callbackId:callback?.id,callbackData:callback?.data,edited:Boolean(update.edited_message)};
}
export class TelegramApiError extends Error {
  retryAfter:number; permanent:boolean;
  constructor(code:string,retryAfter=30,permanent=false){super(code);this.retryAfter=retryAfter;this.permanent=permanent;}
}
export class TelegramApi implements Delivery {
  token:string;fetcher:typeof fetch;
  constructor(token:string,fetcher:typeof fetch=fetch){this.token=token;this.fetcher=fetcher;}
  async call(method:'sendMessage'|'answerCallbackQuery'|'getWebhookInfo'|'getMe',body:unknown):Promise<any>{
    const r=await this.fetcher('https://api.telegram.org/bot'+this.token+'/'+method,{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error'});
    const b=await r.json().catch(()=>({})) as any;
    if(!r.ok||b.ok!==true)throw new TelegramApiError(b.error_code===429?'TELEGRAM_RATE_LIMIT':'TELEGRAM_REQUEST_FAILED',
      Math.max(1,Math.min(86400,Number(b.parameters?.retry_after)||30)),b.error_code===403);
    return b.result;
  }
  async send(chatId:string,payload:Outgoing){
    const result=await this.call('sendMessage',{chat_id:chatId,text:payload.text,
      link_preview_options:{is_disabled:true},
      ...(payload.buttons?{reply_markup:{inline_keyboard:payload.buttons.map(b=>[{text:b.text,callback_data:b.data}])}}:{})});
    return {messageId:String(result.message_id)};
  }
}
// Preserve the SDK's persistent polling/retry logic; replace routing with a durable ingress.
// This uses the protected processUpdate extension point. Pin adapter version and regression-test it.
export class DurableTelegramAdapter extends TelegramAdapter {
  service:CoachService;api:TelegramApi;
  constructor(service:CoachService,api:TelegramApi){
    const quiet:any={debug(){},info(){},warn(){console.error('TELEGRAM_TRANSPORT_WARNING');},
      error(){console.error('TELEGRAM_TRANSPORT_ERROR');},child(){return this;}};
    super({botToken:api.token,allowedUserIds:[service.ownerId],mode:'polling',apiUrl:'https://api.telegram.org',
      logger:quiet,longPolling:{deleteWebhook:false,dropPendingUpdates:false,timeout:25,
        allowedUpdates:['message','edited_message','callback_query'],limit:25}});
    this.service=service;this.api=api;
  }
  protected override processUpdate(update:TelegramUpdate):Promise<void>[]|void {
    const item=normalize(update);if(!item)return;
    return [(async()=>{
      const result=await this.service.receive(item);
      if(item.callbackId&&result!=='denied')await this.api.call('answerCallbackQuery',{callback_query_id:item.callbackId}).catch(()=>{});
    })()];
  }
}

