import { Address } from '@ton/core';
import { incoming, type Fetch } from './netlify/lib/ton';
const W = Address.parse('0:' + '11'.repeat(32));
const cfg = { net: 'testnet' as const, wallet: W, master: W, decimals: 6, api: 'x', key: '' };
const T0 = 1_700_000_000; // oldest hunted (expired, unpaid) order
const all = Array.from({ length: 600 }, (_, i) => ({ hash: i.toString(16).padStart(64, '0'), now: T0 + i, mc_block_seqno: 1, in_msg: { source: null, message_content: { body: 'te6' } } }));
const f: Fetch = async (url) => { const q = new URL('http://h' + url.slice(1)).searchParams;
  const s = +q.get('start_utime')!, o = +q.get('offset')!, l = +q.get('limit')!;
  const r = all.filter(t => t.now >= s).slice(o, o + l); return { ok: true, status: 200, json: async () => ({ transactions: r }) }; };
const got = await incoming(cfg, f, T0 * 1000);
const newest = all[599].hash;
console.log('returned', got.length, 'newest (new paid order) seen:', got.some(t => t.hash === newest));
if (!got.some(t => t.hash === newest)) { console.log('FAIL'); process.exit(1); }
console.log('PASS');
