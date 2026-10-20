import {PGlite} from '@electric-sql/pglite';
import type {Db,Result} from '../src/db.ts';
import {migrate} from '../src/db.ts';
import {CoachService} from '../src/service.ts';
import type {Inbound} from '../src/types.ts';
let seq=0;
export async function fixture(path?:string){
  const engine=new PGlite(path);
  const wrap=(p:any):Db=>({
    async query<T>(sql:string,params:any[]=[]):Promise<Result<T>>{
      if(params.length===0&&sql.includes(';')){
        const results=await p.exec(sql);const last=results.at(-1);return {rows:last?.rows??[],rowCount:last?.affectedRows??0};
      }
      const r=await p.query(sql,params);return {rows:r.rows,rowCount:r.affectedRows??r.rows.length};
    },
    async transaction(fn){return p.transaction((tx:any)=>fn(wrap(tx)));},
    async close(){await engine.close();}
  });
  const db=wrap(engine);await migrate(db);
  const service=new CoachService(db,'12345','12345');await service.initialize();
  return {db,service,engine};
}
export function inbound(text:string,extra:Partial<Inbound>={}):Inbound{
  return {updateId:String(++seq),senderId:'12345',chatId:'12345',chatType:'private',text,occurredAt:new Date(),...extra};
}

