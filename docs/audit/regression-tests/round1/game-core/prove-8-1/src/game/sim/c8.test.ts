import { createInitialState } from '../state';
import { applyExpedition } from './expedition';
const s: any = createInitialState();
for (const k of Object.keys(s.army)) s.army[k] = 0;
s.army.clubman = 10; s.pop = Math.max(s.pop, 20);
applyExpedition(s, { warriorsLost: 3, troopsLost: { knight: 3 }, scoutsLost: 0, resources: {}, gold: 0, prestige: 0, morale: 0, battle: 'won', text: '', kind: 'bad' } as any);
console.log(JSON.stringify(s.army),'club after', s.army.clubman, s.army.clubman === 10 ? 'PASS' : 'FAIL');
process.exit(s.army.clubman === 10 ? 0 : 1);
