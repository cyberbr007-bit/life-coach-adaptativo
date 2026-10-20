import {mkdir,readFile,writeFile,rename,stat,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
import {z} from 'zod';
export const ProfileSchema=z.object({
  client_id:z.string().min(1),subject:z.string().min(1),issuer:z.literal('https://auth.openai.com'),
  access_token:z.string().min(1),refresh_token:z.string().min(1),id_token:z.string().optional(),
  scopes:z.array(z.string()),expires_at:z.number(),saved_at:z.string()
});
export type Profile=z.infer<typeof ProfileSchema>;
export async function atomicPrivate(path:string,body:string){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temp=path+'.'+randomUUID()+'.tmp';
  try{await writeFile(temp,body,{mode:0o600,flag:'wx'});await rename(temp,path);}
  finally{await unlink(temp).catch(()=>{});}
}
async function privateRead(path:string){
  const s=await stat(path);
  if(process.platform!=='win32'&&(s.mode&0o077)!==0)throw new Error('UNSAFE_SECRET_PERMISSIONS');
  return readFile(path,'utf8');
}
export class Vault {
  file:string;keyFile:string;fetcher:typeof fetch;
  constructor(file:string,keyFile:string,fetcher:typeof fetch=fetch){this.file=file;this.keyFile=keyFile;this.fetcher=fetcher;}
  async key(){
    const key=Buffer.from((await privateRead(this.keyFile)).trim(),'base64');
    if(key.length!==32)throw new Error('INVALID_VAULT_KEY');return key;
  }
  async save(profile:Profile){
    const p=ProfileSchema.parse(profile);const key=await this.key();const iv=randomBytes(12);
    const cipher=createCipheriv('aes-256-gcm',key,iv);
    const data=Buffer.concat([cipher.update(JSON.stringify(p),'utf8'),cipher.final()]);
    await atomicPrivate(this.file,JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}));
  }
  async load():Promise<Profile>{
    const data=JSON.parse(await privateRead(this.file));const key=await this.key();
    if(data.v!==1)throw new Error('INVALID_VAULT_FORMAT');
    const d=createDecipheriv('aes-256-gcm',key,Buffer.from(data.iv,'base64'));d.setAuthTag(Buffer.from(data.tag,'base64'));
    return ProfileSchema.parse(JSON.parse(Buffer.concat([d.update(Buffer.from(data.data,'base64')),d.final()]).toString('utf8')));
  }
  async token():Promise<string>{
    let p=await this.load();
    if(!p.scopes.includes('chatgpt.tokens.use.direct'))throw new Error('PLAN_USAGE_NOT_GRANTED');
    if(p.expires_at>Date.now()+60000)return p.access_token;
    const lock=this.file+'.refresh-lock';
    try{await mkdir(lock,{mode:0o700});}catch{throw new Error('VAULT_REFRESH_BUSY');}
    try{
      p=await this.load();
      if(p.expires_at>Date.now()+60000)return p.access_token;
      const response=await this.fetcher('https://auth.openai.com/api/accounts/oauth/token',{
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({grant_type:'refresh_token',client_id:p.client_id,refresh_token:p.refresh_token,resource:'https://api.openai.com/v1'}),
        signal:AbortSignal.timeout(15000),redirect:'error'});
      if(!response.ok)throw new Error(response.status===400?'AUTH_RECONNECT_REQUIRED':'AUTH_REFRESH_UNAVAILABLE');
      const t=await response.json() as any;
      if(typeof t.access_token!=='string'||typeof t.refresh_token!=='string'||!Number.isFinite(t.expires_in)||t.expires_in<=0)throw new Error('INVALID_REFRESH_RESPONSE');
      const scopes=typeof t.scope==='string'?t.scope.split(' '):p.scopes;
      if(!scopes.includes('chatgpt.tokens.use.direct'))throw new Error('PLAN_USAGE_NOT_GRANTED');
      await this.save({...p,access_token:t.access_token,refresh_token:t.refresh_token,expires_at:Date.now()+t.expires_in*1000,
        scopes,saved_at:new Date().toISOString()});
      return t.access_token;
    }finally{await import('node:fs/promises').then(fs=>fs.rmdir(lock));}
  }
}
export async function createVaultKey(path:string){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  await writeFile(path,randomBytes(32).toString('base64'),{mode:0o600,flag:'wx'});
}

