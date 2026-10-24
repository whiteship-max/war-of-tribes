import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
import { freeName, rotate } from './netlify/vps/backup';
const d = mkdtempSync(join(tmpdir(), 'b9')); const now = Date.UTC(2026, 9, 4, 3, 30);
const made: string[] = [];
for (let i = 0; i < 10; i++) { const n = freeName(d, now); writeFileSync(join(d, n), ''); made.push(n); }
rotate(d, 1);
const left = readdirSync(d);
console.log('made last:', made.at(-1), 'kept:', left);
if (left[0] !== made.at(-1)) { console.log('FAIL: newest deleted'); process.exit(1); } console.log('PASS');
