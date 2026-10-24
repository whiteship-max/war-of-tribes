import { readTxs } from './lib/fixed';
const tx = { hash: 'a'.repeat(64), now: 1700000000, in_msg: { source: null, message_content: { body: 'te6cc' } } };
const [t] = readTxs({ transactions: [tx] });
console.log('final =', t.final);
if (t.final !== false) { console.log('FAIL: tx without mc_block_seqno treated as final'); process.exit(1); }
console.log('PASS');
