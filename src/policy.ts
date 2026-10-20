export type Intensity = 'none' | 'reminder' | 'support' | 'challenge';
export interface NudgeInput {
  explicitStop: boolean; paused: boolean; goalConfirmed: boolean;
  capacity: 'yes' | 'no' | 'unknown'; intensity: Intensity;
  contactsToday: number; dailyLimit: number; unanswered: number; quiet: boolean;
}
export function nudgeDecision(i: NudgeInput): string {
  if (i.explicitStop || i.paused) return 'stop';
  if (i.quiet || i.contactsToday >= i.dailyLimit || i.unanswered >= 2) return 'defer';
  if (!i.goalConfirmed) return 'clarify_goal';
  if (i.capacity === 'no') return 'adapt';
  if (i.capacity === 'unknown') return 'clarify_capacity';
  if (i.intensity === 'none') return 'offer_only';
  return i.intensity;
}
export function control(text: string): 'stop' | 'pause' | 'resume' | null {
  const t = text.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if (t === '/parar' || t === 'pare' || t === 'pare agora') return 'stop';
  if (t === '/pausar' || t === 'pare de me cobrar' || t === 'nao me cobre mais') return 'pause';
  if (t === '/retomar') return 'resume';
  return null;
}
export function authorized(userId: string, chatId: string, chatType: string, owner: string, ownerChat: string): boolean {
  return /^[1-9][0-9]*$/.test(userId) && userId === owner && chatId === ownerChat && chatType === 'private';
}
export function splitMessage(text: string, limit = 3500): string[] {
  if (!text.trim()) throw new Error('EMPTY_RESPONSE');
  const chunks:string[]=[];let current='';
  for(const ch of text){
    if(current.length+ch.length>limit){chunks.push(current);current='';}
    current+=ch;
  }
  if(current)chunks.push(current);
  return chunks;
}

