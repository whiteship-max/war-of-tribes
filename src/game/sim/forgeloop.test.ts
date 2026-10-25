// ECO-6 (план аудита, этап 7): «купить сырьё → выковать → продать» печатает золото? Проверка, а не починка.
//
// Изделие на рынке дороже своих материалов нарочно — за клинок платят и работой кузницы (`data/market.EQUIPMENT_GOODS`), и
// с прибавкой Казначея и купечества продажа изделия выходит дороже покупки сырья. Печатью золота это было бы, будь выручка без
// потолка. Потолок есть — кошель купцов на привоз (`marketrules.PURSE`, `saleCheck`), и он не зависит ни от товара, ни от
// прибавки. Тест держит именно его: сколько ни выковать и ни продать, за привоз продажа даёт не больше кошеля.
//
// Область (правило 11): рынок 10-го уровня (кошель наибольший), сырья на складе на любую ковку; тридцать привозов
// подряд по сетке 3 ч; в каждом продаём все шесть изделий, пока купцы берут.
import { beforeEach, describe, expect, it } from 'vitest';
import type { EquipmentId, GameState, ResourceId } from '../types';
import { createInitialState } from '../state';
import { MAX_BUILDING_LEVEL } from '../constants';
import { GOODS } from '../data/market';
import { SHIFT, purseOf, shiftOf, shiftStart } from '../marketrules';
import { buildingOfType } from '../derived';
import { marketPurse, sellGoods } from './market';
import { forgeCost } from './smithy';
import { pay } from './pay';
import { seeded, setRandom } from './random';

beforeEach(() => setRandom(seeded(7)));

const NOW = Date.UTC(2026, 9, 23, 10, 0);

function town(): GameState {
  const s = createInitialState(7);
  s.tutorialDone = true;
  for (const b of s.buildings) if (b.type === 'market' || b.type === 'storage') b.level = MAX_BUILDING_LEVEL;
  s.gold = 50_000_000;
  s.tax = 'none';
  return s;
}

describe('ECO-6: петля ковки не печатает золото — выручку держит кошель купцов', () => {
  it('тридцать привозов: сырьё куплено, изделия выкованы и проданы, — за привоз продажа не дороже кошеля', () => {
    const s = town();
    const level = buildingOfType(s, 'market')!.level;
    expect(level, 'область: рынок 10-го уровня').toBe(MAX_BUILDING_LEVEL);
    const purse = purseOf(level);
    expect(purse).toBeGreaterThan(0);
    const items = GOODS.filter((g) => g.equipment);
    expect(items.length).toBe(6);
    const w0 = shiftOf(NOW);
    let capped = 0;
    for (let k = 0; k < 30; k++) {
      const now = shiftStart(w0 + k) + SHIFT / 2;
      expect(marketPurse(s, now), `привоз ${k}: кошель полон`).toBe(purse);
      // Ковка — та же плата, что берёт кузница (`forgeCost`): сырьё со склада, изделие ложится на полку.
      for (const def of items) {
        const id = def.equipment as EquipmentId;
        const cost = forgeCost(id, 40);
        for (const [r, n] of Object.entries(cost)) s.resources[r as ResourceId] = Math.max(s.resources[r as ResourceId], n ?? 0);
        pay(s, cost);
        s.equipment[id] = (s.equipment[id] ?? 0) + 40;
      }
      const gold = s.gold;
      // Продаём дверью сделки поштучно, пока купцы берут, — мимо «Всё» окна (`marketMax`), чтобы потолок держала сама сделка.
      for (const def of items) for (let i = 0; i < 400 && sellGoods(s, def.id, 1, now) === null; i++);
      const got = s.gold - gold;
      expect(got, `привоз ${k}`).toBeLessThanOrEqual(purse);
      if (marketPurse(s, now) < purse / 10) capped++;
    }
    // Точки внутри области: кошель правда кончался — продавали до упора, а не мимо потолка.
    expect(capped).toBeGreaterThanOrEqual(25);
  });
});
