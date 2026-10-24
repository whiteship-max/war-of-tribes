import { createInitialState } from './src/game/state';
import { startDaily, finishDaily } from './src/game/sim/daily';
const s:any = (createInitialState as any)(1);
const d = 20000;
startDaily(s,d); finishDaily(s,d,false);
const w0=s.stats.dailyWins; const r=finishDaily(s,d,true);
console.log('second call returned', r, 'dailyWins', w0,'->',s.stats.dailyWins, 'result', s.daily.result);
if (r===null || s.stats.dailyWins!==w0) { console.log('FAIL: win accepted after loss'); process.exit(1);} console.log('PASS');
