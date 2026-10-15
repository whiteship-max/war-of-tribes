/**
 * Щуп добычи (docs/minigames.md, 18.4): условие владельца этапа 6 — «средняя добыча за выход не выше нынешней».
 * Добыча — доля потолка (`sim/minigames.harvest`), потолок не тронут, значит сравнивается доля: прежние правила
 * (`bots.CLASSIC`) против новых — часа, редкой добычи и серии — у трёх рук автоматов на одном наборе зёрен. Новые
 * правила усреднены по часам суток города (`bots.hourWeights`).
 *
 * Набор — 24 зерна на игру и руку (правило 17): тест держит сравнение и падает на правке, поднявшей выход. Таблица на
 * 200 зёрнах — стенд (`BUDGET=1 npm run mini:shots`, раздел «добыча за выход»), её числа — в документе.
 */
import { describe, expect, it } from 'vitest';
import { HANDS, hourWeights, yieldSeeds, yieldTable } from './bots';
import { HOURS } from './rules';
import { MINIGAMES } from '@/game/data/minigames';

describe('щуп добычи: средняя доля за выход — не выше прежней', () => {
  it('часы суток — доли года, в сумме единица, и ни одного часа нет', () => {
    const w = hourWeights();
    expect(HOURS.reduce((n, h) => n + w[h], 0)).toBeCloseTo(1, 9);
    for (const h of HOURS) expect(w[h], h).toBeGreaterThan(0);
  });

  it('у каждой игры и каждой руки новая доля не выше прежней', () => {
    const rows = yieldTable(yieldSeeds(24));
    expect(rows.length).toBe(MINIGAMES.length * HANDS.length);
    for (const r of rows) {
      // Область: рука правда берёт добычу — сравнивать нули нечего.
      expect(r.before, `${r.game} ${r.hand}`).toBeGreaterThan(0.05);
      expect(r.after, `${r.game} ${r.hand}: ${r.after.toFixed(4)} против ${r.before.toFixed(4)}`).toBeLessThanOrEqual(r.before + 1e-12);
    }
  }, 120_000);
});
