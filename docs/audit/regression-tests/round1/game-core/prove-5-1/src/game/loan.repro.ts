import { createInitialState } from './state';
import { EVENT_BY_ID } from './data/events';
const s = createInitialState(11); s.pop = 300; s.gold = 0;
EVENT_BY_ID.merchant_loan.options[0].apply(s);
const got = s.gold;
s.pop = 30; // shrink before merchant returns
const owed = (EVENT_BY_ID.merchant_due.options[0].cost as any)(s).gold;
console.log({ got, owed });
if (owed < got) { console.log('FAIL: debt', owed, '< loan received', got); process.exit(1); }
console.log('PASS');
