import { Address } from '@ton/core';
import { incoming } from './netlify/lib/ton';
const w = Address.parse('0:' + '1'.repeat(64));
const cfg: any = { net: 'mainnet', wallet: w, master: w, decimals: 6, api: 'http://x', key: '' };
const N = 650;
const all = Array.from({ length: N }, (_, i) => ({ hash: i.toString(16).padStart(64, '0'), now: 1000 + i, mc_block_seqno: 1, in_msg: { source: null, message_content: { body: 'te6' } } }));
const f: any = async (url: string) => { const u = new URL(url); const o = +u.searchParams.get('offset')!, l = +u.searchParams.get('limit')!; return { ok: true, status: 200, json: async () => ({ transactions: all.slice(o, o + l) }) }; };
const r = await incoming(cfg, f, 0);
console.log('returned', r.length, 'of', N, 'last payment seen:', r.some((t) => t.hash === all[N - 1].hash));
if (r.length !== N) { console.log('FAIL'); process.exit(1); }
