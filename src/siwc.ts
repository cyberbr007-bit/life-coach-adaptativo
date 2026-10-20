import type {CompiledContext} from './context.ts';
import type {Model,ModelResult} from './types.ts';
export class ProviderError extends Error{
  code:string;requestId:string|null;
  constructor(code:string,requestId:string|null=null){super(code);this.code=code;this.requestId=requestId;}
}
export async function parseResponse(response:Response,signal?:AbortSignal):Promise<ModelResult>{
  const requestId=response.headers.get('x-request-id');
  if(!response.ok){
    const body=await response.json().catch(()=>({})) as any;
    const code=body?.error?.code;
    throw new ProviderError(typeof code==='string'&&/^[a-zA-Z0-9_]+$/.test(code)?code.toUpperCase():'HTTP_'+response.status,requestId);
  }
  if(!response.body)throw new ProviderError('STREAM_MISSING',requestId);
  const reader=response.body.getReader();const decoder=new TextDecoder();
  let buffer='';let text='';let completed=false;let model='';let total=0;
  const consume=(block:string)=>{
    const raw=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!raw||raw==='[DONE]')return;
    let event:any;try{event=JSON.parse(raw);}catch{throw new ProviderError('INVALID_STREAM_JSON',requestId);}
    if(completed)return;
    if(event.type==='response.output_text.delta')text+=event.delta??'';
    if(event.type==='response.failed'||event.type==='response.incomplete'||event.type==='error')
      throw new ProviderError(String(event.response?.error?.code??'RESPONSE_NOT_COMPLETED').replace(/[^a-zA-Z0-9_]/g,'_').toUpperCase(),requestId);
    if(event.type==='response.completed'){
      if(event.response?.status&&event.response.status!=='completed')throw new ProviderError('RESPONSE_NOT_COMPLETED',requestId);
      completed=true;model=event.response?.model??'';
      if(!text)text=(event.response?.output??[]).flatMap((o:any)=>o.content??[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('');
    }
  };
  try{
    while(true){
      signal?.throwIfAborted();
      const {value,done}=await reader.read();
      if(done){buffer+=decoder.decode();break;}
      total+=value.byteLength;if(total>2000000)throw new ProviderError('STREAM_TOO_LARGE',requestId);
      buffer=(buffer+decoder.decode(value,{stream:true})).replaceAll('\r\n','\n');
      let idx;while((idx=buffer.indexOf('\n\n'))>=0){consume(buffer.slice(0,idx));buffer=buffer.slice(idx+2);}
      if(completed)break;
    }
    if(buffer.trim())consume(buffer);
    if(!completed)throw new ProviderError('STREAM_INTERRUPTED',requestId);
    if(!text.trim())throw new ProviderError('EMPTY_RESPONSE',requestId);
    return {text,model,requestId:requestId??undefined};
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export class SiwcModel implements Model{
  model:string;getToken:()=>Promise<string>;fetcher:typeof fetch;
  constructor(model:string,getToken:()=>Promise<string>,fetcher:typeof fetch=fetch){
    this.model=model;this.getToken=getToken;this.fetcher=fetcher;
  }
  async listModels(){
    const r=await this.fetcher('https://api.openai.com/v1/models',{headers:{Authorization:'Bearer '+await this.getToken()},signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!r.ok)throw new ProviderError('MODEL_CATALOG_UNAVAILABLE');
    const b=await r.json() as any;
    if(!Array.isArray(b.models))throw new ProviderError('INVALID_MODEL_CATALOG');
    return b.models.filter((x:any)=>x.visibility==='list').map((x:any)=>({slug:x.slug,display_name:x.display_name}));
  }
  async respond(context:CompiledContext,signal:AbortSignal){
    if(!this.model)throw new ProviderError('MODEL_NOT_CONFIGURED');
    const r=await this.fetcher('https://api.openai.com/v1/responses',{
      method:'POST',headers:{Authorization:'Bearer '+await this.getToken(),'Content-Type':'application/json'},
      body:JSON.stringify({model:this.model,instructions:context.instructions,input:context.input,store:false,stream:true}),
      signal,redirect:'error'});
    const result=await parseResponse(r,signal);return {...result,model:result.model||this.model};
  }
}

