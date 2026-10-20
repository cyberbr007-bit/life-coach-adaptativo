import {createServer} from 'node:http';
import {randomBytes,createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {Vault,type Profile} from './credentials.ts';
export function authParameters(hostId:string,clientId='dynamic_agent_client'){
  const verifier=randomBytes(48).toString('base64url');
  const state=randomBytes(32).toString('base64url');const nonce=randomBytes(32).toString('base64url');
  const redirectUri='http://127.0.0.1:1455/auth/callback';
  const url=new URL('https://auth.openai.com/api/accounts/authorize');
  const params:Record<string,string>={client_id:clientId,ext_agent_host_id:hostId,response_type:'code',redirect_uri:redirectUri,
    scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',resource:'https://api.openai.com/v1',
    state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')};
  if(clientId==='dynamic_agent_client')params.agent_name_hint='Life Coach Adaptativo';
  url.search=new URLSearchParams(params).toString();
  return {url:url.toString(),state,nonce,verifier,redirectUri,clientId};
}
export function verifyState(actual:string,expected:string){
  const a=Buffer.from(actual);const b=Buffer.from(expected);
  if(a.length!==b.length||!timingSafeEqual(a,b))throw new Error('INVALID_OAUTH_STATE');
}
export async function login(vault:Vault,hostFile:string){
  let host:string;
  try{host=(await readFile(hostFile,'utf8')).trim();}
  catch(e:any){if(e.code!=='ENOENT')throw e;host='urn:uuid:'+randomUUID();await mkdir(dirname(hostFile),{recursive:true,mode:0o700});await writeFile(hostFile,host,{mode:0o600,flag:'wx'});}
  let previous:Profile|undefined;try{previous=await vault.load();}catch(e:any){if(e.code!=='ENOENT')throw e;}
  const p=authParameters(host,previous?.client_id);
  const jwks=createRemoteJWKSet(new URL('https://auth.openai.com/.well-known/jwks.json'));
  await new Promise<void>((resolve,reject)=>{
    let consumed=false;
    const server=createServer(async(req,res)=>{
      const url=new URL(req.url??'/',p.redirectUri);
      if(url.pathname!=='/auth/callback'){res.writeHead(404).end();return;}
      try{
        verifyState(url.searchParams.get('state')??'',p.state);
        if(consumed)throw new Error('OAUTH_ALREADY_USED');consumed=true;
        if(url.searchParams.has('error'))throw new Error('OAUTH_DENIED');
        const returned=url.searchParams.get('client_id');
        const clientId=p.clientId==='dynamic_agent_client'?returned:p.clientId;
        if(!clientId||clientId==='dynamic_agent_client'||(returned&&returned!==clientId))throw new Error('INVALID_OAUTH_CLIENT');
        const code=url.searchParams.get('code');if(!code)throw new Error('OAUTH_CODE_MISSING');
        const r=await fetch('https://auth.openai.com/api/accounts/oauth/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
          headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',
            client_id:clientId,code,code_verifier:p.verifier,redirect_uri:p.redirectUri,resource:'https://api.openai.com/v1'})});
        if(!r.ok)throw new Error('OAUTH_EXCHANGE_FAILED');
        const t=await r.json() as any;
        const {payload}=await jwtVerify(t.id_token,jwks,{issuer:'https://auth.openai.com',audience:clientId,requiredClaims:['sub','exp','iat'],clockTolerance:5});
        if(payload.nonce!==p.nonce||!payload.sub||(previous&&payload.sub!==previous.subject))throw new Error('OAUTH_IDENTITY_MISMATCH');
        if(!Number.isFinite(t.expires_in)||t.expires_in<=0||typeof t.scope!=='string')throw new Error('INVALID_OAUTH_TOKENS');
        const scopes=t.scope.split(' ');
        await vault.save({issuer:'https://auth.openai.com',client_id:clientId,subject:payload.sub,
          access_token:t.access_token,refresh_token:t.refresh_token,id_token:t.id_token,
          scopes,expires_at:Date.now()+t.expires_in*1000,saved_at:new Date().toISOString()});
        res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}).end('Conexão salva com proteção local. Você pode fechar esta aba.');
        clearTimeout(timer);server.close();resolve();
      }catch(e){res.writeHead(400,{'Content-Type':'text/plain','Cache-Control':'no-store'}).end('Conexão não concluída. Consulte o terminal.');
        if(consumed){clearTimeout(timer);server.close();reject(e);}}
    });
    const timer=setTimeout(()=>{server.close();reject(new Error('OAUTH_TIMEOUT'));},600000);
    server.on('error',e=>{clearTimeout(timer);reject(e);});
    server.listen(1455,'127.0.0.1',()=>console.log('Continue with ChatGPT — abra no navegador DESTE computador:\n'+p.url));
  });
}

