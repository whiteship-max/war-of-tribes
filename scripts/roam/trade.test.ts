// Модель рейса прибора (ПН-Э2в, docs/gdd/path_of_sword.md, 23.10): кошель — та же единица, что у игры (`world/townspec.townCaravan`),
// нога не берёт больше кошеля покупателя, вариант доли продажи — тот же вывод Ц1, что `SALE_SHARE`.
import { describe, expect, it } from 'vitest';
import { BOOST_MAX, SALE_SHARE, shareFor, shiftOf } from '../../src/game/marketrules';
import { townMarketLevel } from '../../src/game/townrules';
import { roamStub } from '../../src/game/roamstubs';
import { ETALONS } from '../../src/game/data/contracts';
import { pointsIn } from '../../src/world/roampoints';
import { townCaravan, townSpecOf } from '../../src/world/townspec';
import { bestLeg, gameRules, purseOnLoop, unitOf } from './trade';

const TOWNS = pointsIn(0, 600, 1200, 900, 1500).filter((p) => p.kind === 'town' && p.tier > 0);
const T = Date.UTC(2026, 9, 1);

describe('модель рейса торговца (ПН-Э2в)', () => {
  it('кошель модели на правилах игры — кошель игры: та же единица и тот же размер', () => {
    const rules = gameRules(roamStub('townSpec'), roamStub('caravanSize'), roamStub('caravanRefill'));
    expect(TOWNS.length).toBeGreaterThan(10);
    for (const t of TOWNS.slice(0, 16)) {
      const game = townCaravan(t.x, t.y, townMarketLevel(t.tier as 1 | 2 | 3));
      expect(Math.floor(unitOf(t, rules) * rules.caravan!.size)).toBe(game.cap);
      // Круг дольше срока пополнения застаёт кошель полным; короче — долей.
      expect(purseOnLoop(t, rules, rules.caravan!.refillH * 2)).toBe(game.cap);
      expect(purseOnLoop(t, rules, rules.caravan!.refillH / 4)).toBeCloseTo(game.cap / 4, 6);
    }
  });

  it('нога не берёт больше кошеля покупателя; без кошеля берёт больше — граница правда в кошеле', () => {
    const maker = TOWNS.find((t) => townSpecOf(t.x, t.y) === 'ore')!;
    const buyer = TOWNS.find((t) => townSpecOf(t.x, t.y) === 'granary')!;
    const rules = { ...gameRules(0.9, 1, 24), share: shareFor(1) };
    const free = bestLeg(maker, buyer, ETALONS[1], { ...rules, caravan: null }, shiftOf(T), shiftOf(T), Infinity)!;
    expect(free.gain).toBeGreaterThan(1000);
    const purse = Math.floor(free.gain / 2);
    const cut = bestLeg(maker, buyer, ETALONS[1], rules, shiftOf(T), shiftOf(T), purse)!;
    expect(cut.cap).toBe('purse');
    expect(cut.gain).toBeLessThanOrEqual(purse);
  });

  it('вариант доли продажи без прибавок — тот же вывод Ц1, что доля игры при наибольшей прибавке', () => {
    expect(shareFor(BOOST_MAX)).toBe(SALE_SHARE);
    expect(shareFor(1)).toBeGreaterThan(SALE_SHARE);
    expect(shareFor(1)).toBeLessThan(1);
  });
});
