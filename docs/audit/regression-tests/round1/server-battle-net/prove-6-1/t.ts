import { deploy } from './b/setup';
const s = deploy({ cavalry: 1 }, 20);
console.log(JSON.stringify(s));
if (s.R.cavalry !== 0) { console.log('FAIL: lone rider in reserve'); process.exit(1); }
console.log('PASS');
