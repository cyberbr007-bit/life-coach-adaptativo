export interface Inbound {
  updateId:string; senderId:string; chatId:string; chatType:string;
  text:string; occurredAt:Date; callbackId?:string; callbackData?:string; edited?:boolean;
}
export interface Outgoing { text:string; buttons?:Array<{text:string;data:string}>; }
export interface ModelResult {text:string;model:string;requestId?:string;}
export interface Model {
  respond(context:import('./context.ts').CompiledContext,signal:AbortSignal):Promise<ModelResult>;
}
export interface Delivery {
  send(chatId:string,payload:Outgoing):Promise<{messageId:string}>;
}

