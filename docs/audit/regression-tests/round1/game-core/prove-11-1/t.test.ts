import { createInitialState } from './src/game/state';
import { upkeepInfo, armySize, mouthCount, foodShortfall, mastersCount } from './src/game/derived';
import { DESERT_SHARE } from './src/game/data/upkeep';
const s:any = createInitialState(1);
for (const k of Object.keys(s.army ?? {})) s.army[k]=0;
s.army.rider = 5000; s.recruits=[]; s.resources.food=0;
s.pay = { ...(s.pay??{}), late: 1e9, debt: s.pay?.debt??0, from: 0 };
const u = upkeepInfo(s);
const share=Math.max(u.unpaid,u.unfed);
const expected = DESERT_SHARE*share*(armySize(s)+mastersCount(s));
console.log({army:armySize(s),mouths:mouthCount(s),unfed:u.unfed,why:u.why,leaving:u.leavingPerDay,expected});
if (!(u.unfed>0)) { console.log('SETUP: no shortfall'); process.exit(2); }
if (Math.abs(u.leavingPerDay-expected)>1e-9) { console.log('FAIL: leavingPerDay overstates'); process.exit(1);} console.log('PASS');
