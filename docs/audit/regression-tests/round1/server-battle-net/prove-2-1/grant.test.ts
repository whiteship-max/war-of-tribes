import { bookAfter, seedBook } from './netlify/lib/book.ts';
const T0 = 1_900_000_000_000, MIN = 60_000, A = 'tg-1001';
const b = { barracks: 1 };
const s0 = bookAfter(seedBook(T0), T0 + MIN, { troops: {}, buildings: b }, [], null, A, [], b);
const grants = [{ n: 1, troops: { spearman: 100 } }];
const s1 = bookAfter(s0.book, T0 + 2 * MIN, { troops: {}, buildings: b }, grants, null, A, [], b); // client not yet applied
const s2 = bookAfter(s1.book, T0 + 3 * MIN, { troops: { spearman: 100 }, buildings: b }, grants, null, A, [], b); // applied
console.log('s1', s1.book, 's2 bodies', s2.book.bodies, 'forged', s2.forged);
if (s2.forged > 0 || (s2.book.bodies.spearman ?? 0) < 100) { console.log('FAIL: granted troops lost / forged'); process.exit(1); }
console.log('PASS');
