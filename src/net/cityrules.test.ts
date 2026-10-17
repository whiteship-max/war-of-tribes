import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { RESOURCE_IDS } from '@/game/constants';
import { currentSite, maxLevelFor, storageCap, upgradeInfo } from '@/game/derived';
import { startUpgrade } from '@/game/sim/actions';
import { tick } from '@/game/sim/tick';
import { DAY_LENGTH, gameSeconds, realMs } from '@/game/pace';
import { STOCK_KEYS, type WatchCard } from '../../netlify/lib/contract';
import { flagsBetween, startedCost } from '../../netlify/lib/watch';
import { watchOf } from './snapshot';

/**
 * Правило «цена списана» таблицы города сервера (`watch.CITY_RULES`, docs/security.md) на настоящей партии игры: опись —
 * та, что шлёт игра (`watchOf`), стройка — `sim/actions.startUpgrade`, время — `sim/tick`. Честный посёлок, который
 * строится без передышки, флага «стройка без платы» не получает ни разу, а подделка той же партии — получает.
 */
const quiet = (a: WatchCard, b: WatchCard): boolean =>
  a.deeds === b.deeds && a.seen === b.seen && a.games === b.games && a.away === b.away && a.caravans === b.caravans;

describe('стройка без платы: честная партия против подделки', () => {
  it('четыре часа стройки без передышки: правило спрошено много раз, флага нет; склад, не убывший на цену, — флаг', () => {
    const s = createInitialState(5);
    for (const r of RESOURCE_IDS) s.resources[r] = storageCap(s);
    s.morale = 100;
    let a = watchOf(s);
    let asked = 0;
    let caught = 0;
    for (let m = 1; m <= 240; m++) {
      if (!currentSite(s)) {
        const next = s.buildings
          .filter((b) => b.level < maxLevelFor(b.type) && !upgradeInfo(s, b).blocked)
          .sort((x, y) => upgradeInfo(s, x).work - upgradeInfo(s, y).work)[0];
        if (next) startUpgrade(s, next.id);
      }
      tick(s, gameSeconds(60));
      const b = watchOf(s);
      const flags = flagsBetween(a, (m - 1) * 60_000, b, m * 60_000).map((f) => f.kind);
      expect(flags, `минута ${m}`).not.toContain('unpaid');
      // Точка внутри правила: на первой описи стройки не было, между описями её начали, разовых дел не было.
      if (!a.site && startedCost(a, b).levels > 0 && quiet(a, b)) {
        asked++;
        // Подделка той же минуты: уровень заложен, а склад остался прежним — цена не ушла.
        const forged = { ...b, stock: { ...a.stock } };
        if (flagsBetween(a, (m - 1) * 60_000, forged, m * 60_000).some((f) => f.kind === 'unpaid')) caught++;
      }
      a = b;
    }
    expect(asked, 'правило спрошено').toBeGreaterThanOrEqual(5);
    expect(caught).toBe(asked);
  });
});

/**
 * Часы описи — целые игровые секунды (`watchOf`, `contract.readWatch`), а при шкале ×30 игровая секунда — полминуты
 * настоящего времени. Две записи внутри одной секунды (быстрая запись после смены раскладки, перезапуск) показывают одно
 * время, хотя выработка шла: 16.10.2026 так легло «Древесина +29 за 21 с … не больше 1» (docs/security.md, раздел 8).
 */
describe('рост склада: часы описи — целые игровые секунды', () => {
  it('записи через 21 с внутри одной игровой секунды: выработка этой секунды флага не даёт, тройная — даёт', () => {
    const REAL_MS = 21_000;
    // Граница области: промежуток короче игровой секунды — только в нём две описи могут показать одно время.
    expect(REAL_MS).toBeLessThan(realMs(1));
    const s = createInitialState(5);
    for (const r of RESOURCE_IDS) s.resources[r] = 0;
    s.morale = 100;
    let asked = 0;
    let caught = 0;
    for (let i = 0; i < 300; i++) {
      const a = watchOf(s);
      tick(s, gameSeconds(REAL_MS / 1000));
      const b = watchOf(s);
      const at = i * 60_000;
      expect(flagsBetween(a, at, b, at + REAL_MS).map((f) => f.kind), `запись ${i}`).not.toContain('stock');
      // Точка внутри правила: разовых дел не было, часы описи не сдвинулись, а припас вырос больше единицы — без поправки
      // на точность часов правило разрешило бы ровно единицу.
      const k = STOCK_KEYS.reduce((x, y) => ((b.stock[y] ?? 0) - (a.stock[y] ?? 0) > (b.stock[x] ?? 0) - (a.stock[x] ?? 0) ? y : x));
      if (quiet(a, b) && b.time === a.time && (b.stock[k] ?? 0) - (a.stock[k] ?? 0) > 1) {
        asked++;
        // Подделка той же записи: втрое больше выработки игровой секунды.
        const tick1 = Math.ceil(Math.max(a.prod[k] ?? 0, b.prod[k] ?? 0) / DAY_LENGTH);
        const forged = { ...b, stock: { ...b.stock, [k]: (a.stock[k] ?? 0) + 3 * tick1 + 2 } };
        if (flagsBetween(a, at, forged, at + REAL_MS).some((f) => f.kind === 'stock')) caught++;
      }
    }
    expect(asked, 'правило спрошено').toBeGreaterThanOrEqual(20);
    expect(caught).toBe(asked);
  });
});
