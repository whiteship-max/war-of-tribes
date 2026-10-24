const m = await import(process.env.W!);
const now=Date.now();
const wars:any[]=[];
for(let i=0;i<400;i++) wars.push({id:'a'+i,phase:'march',sentAt:now,atk:'x',to:'c'});
for(let i=0;i<50;i++) wars.push({id:'d'+i,phase:'done',sentAt:now-1000,endAt:now-1000,atk:'x',to:'c'});
const f:any={wars};
m.pruneWars(f,now);
console.log('len',f.wars.length);
if(f.wars.length!==400){console.log('FAIL expected 400');process.exit(1)}
console.log('PASS');
