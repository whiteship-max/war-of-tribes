import { it, expect } from 'vitest';
import { createInitialState } from '@/game/state';
import { goodsStep } from '../../netlify/lib/goods';
import { watchOf } from './snapshot';
it('bumped deeds hides stock from the goods book', () => {
  const s = createInitialState(5);
  const a = watchOf(s);
  a.stock.wood = 500; a.stock.gold = 5000;
  const ctx = { levels: a.buildings, pop: a.pop, soldiers: 0 };
  const book = goodsStep(null, undefined, 0, a, 0, ctx).book;
  const b = { ...a, stock: { ...a.stock, wood: 0, gold: 0 }, deeds: a.deeds + 1 };
  const step = goodsStep(book, a, 0, b, 60_000, ctx);
  console.log(JSON.stringify(step));
  expect(step.book.have.wood).toBeGreaterThan(400);
  expect(step.hidden.length).toBeGreaterThan(0);
});
