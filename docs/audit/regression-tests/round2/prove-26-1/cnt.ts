import '@/game/pace.minute';
import { LocalWorld } from '@/world/local/LocalWorld';
for (const seed of [11,7,3]) { const w:any = new LocalWorld({ seed, now: () => 1.7e12, storage: null });
const ss=w.gen.settlements; console.log(seed, ss.length, ss.filter((s:any)=>s.tribeId).length, ss.filter((s:any)=>s.tribeId&&w.inRealm(s)).length);}
