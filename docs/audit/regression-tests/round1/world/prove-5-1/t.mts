const p = await import(process.env.P!);
const m = p.intercept({x:10,y:0},0.05,{from:{x:0,y:0},to:{x:100,y:0},departAt:1000,arriveAt:2000},0);
console.log(JSON.stringify(m));
if (!m) throw new Error('null');
const pos = p.positionAt({from:{x:0,y:0},to:{x:100,y:0},departAt:1000,arriveAt:2000}, m.time);
const dist = Math.hypot(pos.x-10,pos.y);
if (0.05*m.time + 1e-6 < dist) { console.log(`FAIL: chaser covers ${0.05*m.time}, needs ${dist}`); process.exit(1);} console.log('PASS');
