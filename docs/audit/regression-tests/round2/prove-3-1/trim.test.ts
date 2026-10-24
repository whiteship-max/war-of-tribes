// open/hunted/trimmed copied verbatim from /tmp/src/netlify/lib/pay.ts:99-111 (pay.ts not importable: @ton/core absent).
import { readFileSync } from 'node:fs';
const src = readFileSync(process.argv[2] ?? '/tmp/src/netlify/lib/pay.ts', 'utf8');
const body = src.slice(src.indexOf('const open ='), src.indexOf('/**\n * Одна дверь'));
const transpiler = new Bun.Transpiler({ loader: 'ts' });
const js = transpiler.transformSync(`const PAY_LATE_MS=${7*24*3600_000};const KEEP=20;${body};globalThis.T={trimmed,hunted};`);
eval(js);
const { trimmed, hunted } = (globalThis as any).T;
const H = 3600_000, NOW = 1e12;
// order A placed at NOW, expired (unpaid in time); then 20 more orders, one per 31 min, all expired except newest
const orders = Array.from({ length: 21 }, (_, i) => ({ id: 'O' + i, at: NOW + i * 31 * 60_000, until: NOW + i * 31 * 60_000 + 30 * 60_000, state: i < 20 ? 'expired' : 'created' }));
const now = NOW + 20 * 31 * 60_000;
console.log('A still hunted (within 7d):', hunted(orders[0], now));
const after = trimmed(orders, now);
const kept = after.some((o: any) => o.id === 'O0');
console.log('A kept after trim:', kept);
if (!kept) { console.log('FAIL: hunted expired order evicted -> late payment for O0 never found'); process.exit(1); }
console.log('PASS');
