import { readTxs } from './netlify/lib/ton';
const r = readTxs({ transactions: [{ hash: 'a'.repeat(64), now: 1, in_msg: { message_content: { body: 'x' } } }] });
console.log('final=', r[0].final);
if (r[0].final) { console.log('FAIL: tx without mc_block_seqno marked final'); process.exit(1); }
console.log('PASS');
