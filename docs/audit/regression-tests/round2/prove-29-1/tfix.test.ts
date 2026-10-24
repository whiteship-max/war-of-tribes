import {trimmed} from './fixed.ts';
import {expect,test} from 'bun:test';
test('expired-but-hunted order survives trim', () => {
  const H=3600_000, now=1e12;
  const old = Array.from({length:20},(_,i)=>({id:'E'+i,state:'expired',at:now-24*H+i,until:now-23*H}));
  const fresh={id:'NEW',state:'created',at:now,until:now+30*60_000};
  const out=trimmed([...old,fresh] as any,now);
  // E0 is 1 day old: still inside 7-day late window, huntTransfers would look for it
  expect(out.map(o=>o.id)).toContain('E0');
});
