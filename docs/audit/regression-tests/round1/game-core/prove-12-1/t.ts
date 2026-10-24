import { defenseOf, militiaOf } from './s/game/build';
const a = militiaOf(defenseOf({}, 0, 0, 0.2), 0);
const b = militiaOf(defenseOf({}, 0, 1000, 0.2), 1000);
console.log({a,b}); if (a!==b) { console.log('FAIL militia depends on army'); process.exit(1);} console.log('PASS');
