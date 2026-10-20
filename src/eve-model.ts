import type {LanguageModelV4,LanguageModelV4CallOptions,LanguageModelV4GenerateResult} from '@ai-sdk/provider';
import {SiwcModel} from './siwc.ts';
import {RELEASE} from './context.ts';
export function eveSiwcModel(transport:SiwcModel,enabled=false):LanguageModelV4 {
  const generate=async(options:LanguageModelV4CallOptions):Promise<LanguageModelV4GenerateResult>=>{
    if(!enabled)throw new Error('EVE_LIVE_GATE_DISABLED');
    if(options.tools?.length)throw new Error('EVE_TOOLS_NOT_REVIEWED');
    const instructions:string[]=[];const input:Array<{role:'developer'|'user'|'assistant';content:string}>=[];
    for(const m of options.prompt){
      if(m.role==='system'){instructions.push(m.content);continue;}
      if(m.role==='tool')throw new Error('EVE_TOOLS_NOT_REVIEWED');
      const parts=m.content;
      if(parts.some(p=>p.type!=='text'))throw new Error('EVE_INPUT_NOT_REVIEWED');
      input.push({role:m.role,content:parts.map(p=>'text' in p?p.text:'').join('')});
    }
    const r=await transport.respond({instructions:instructions.join('\n'),input,
      manifest:{release:RELEASE,memory:[],hash:'eve-spike',cutoff:new Date().toISOString()}},options.abortSignal??AbortSignal.timeout(60000));
    return {content:[{type:'text',text:r.text}],finishReason:{unified:'stop',raw:'completed'},
      usage:{inputTokens:{total:undefined,noCache:undefined,cacheRead:undefined,cacheWrite:undefined},
        outputTokens:{total:undefined,text:undefined,reasoning:undefined}},warnings:[]};
  };
  return {specificationVersion:'v4',provider:'life-coach-siwc',modelId:transport.model||'unconfigured',supportedUrls:{},
    doGenerate:generate,
    async doStream(options){
      const r=await generate(options);
      return {stream:new ReadableStream({start(c){
        c.enqueue({type:'stream-start',warnings:[]});c.enqueue({type:'text-start',id:'0'});
        c.enqueue({type:'text-delta',id:'0',delta:r.content.filter(x=>x.type==='text').map(x=>x.text).join('')});
        c.enqueue({type:'text-end',id:'0'});c.enqueue({type:'finish',usage:r.usage,finishReason:r.finishReason});c.close();
      }})};
    }};
}

