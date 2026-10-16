import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { RESOURCE_IDS } from '@/game/constants';
import { currentSite, maxLevelFor, storageCap, upgradeInfo } from '@/game/derived';
import { startUpgrade } from '@/game/sim/actions';
import { tick } from '@/game/sim/tick';
import { gameSeconds } from '@/game/pace';
import type { WatchCard } from '../../netlify/lib/contract';
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
