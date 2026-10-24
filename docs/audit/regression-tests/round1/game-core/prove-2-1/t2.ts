import { battleWeight, spreadLosses, kindsOf } from './src/game/battle/price';
import { TROOP_IDS } from './src/game/data/troops';
import { KIND_OF } from './src/game/battle/kinds';
let bad=0;
for (const id of TROOP_IDS){const w=battleWeight(id); const k=KIND_OF[id]; const men=kindsOf({[id]:1})[k];
 for(let l=1;l<men;l++){const r=spreadLosses({[id]:1},k,l); if(!r[id]){bad++;console.log(`FAIL ${id} w=${w.toFixed(2)} men=${men} lost=${l} -> removed`,r)}}}
if(bad){process.exit(1)} else console.log('PASS');
