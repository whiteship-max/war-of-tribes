// Лагерь по месту и погоде (ПН-12л, docs/gdd/path_of_sword.md, «Решения ПН-12л») — выборка мест и вывод делителя фуража места.
//
// Цели (ГДД, «Решения ПН-12л», Ц1–Ц3): в среднем по земле, где встают отряды, лагерь кормит, как прежде (фураж сезона ПН-1); лес и
// берег — больше среднего, голое поле — меньше; пустыня не кормит. Вывод — делитель `WILD_MEAN`: средний вольный корм выборки
// (`campsite.wildFood`), округлённый до десятой. Неподвижная точка вырождена — делитель от себя не зависит, — и раздел печатает
// «записано = выведено» или разницу.
import type { Coord } from '../../src/world/types';
import { SICILY } from '../../src/world/spawn';
import { roamCellBlock } from '../../src/world/roam';
import { siteAt, wildMeanOf, type Site } from '../../src/world/campsite';

/** Радиус выборки вокруг мест теста с игроками, клеток: весь остров с берегом. */
export const SAMPLE_REACH = 12;

/** Клетки, где отряд может встать (`roam.roamCellBlock`), в `SAMPLE_REACH` от мест теста с игроками (`world/spawn.SICILY`). */
export function campSample(spots: readonly Coord[] = SICILY, reach = SAMPLE_REACH): Site[] {
  const seen = new Set<string>();
  const out: Site[] = [];
  for (const p of spots) {
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (dx * dx + dy * dy > reach * reach) continue;
        const c = { x: p.x + dx, y: p.y + dy };
        const key = `${c.x}|${c.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (roamCellBlock(c) === null) out.push(siteAt(c));
      }
    }
  }
  return out;
}

/** Делитель фуража места, выведенный на выборке: средний вольный корм, до десятой. */
export const deriveWildMean = (sample: readonly Site[] = campSample()): number => Math.round(wildMeanOf(sample) * 10) / 10;
