// Прибор «ветвь, которую учат, как только хватает очков» обязан давать то же, что настоящая дверь
// игры: те же дни проходятся партией, где ступени покупает `sim/tech.study`, а очки читает
// `sim/points.pointsOf`. Решает партия раз в полдня — как автопилот отчётов (`decide: 30`), — поэтому
// очки сверяются с точностью до полудня притока.
import { describe, expect, it } from 'vitest';
import type { GameState, RealmBranch } from '@/game/types';
import { createInitialState } from '@/game/state';
import { settleHires } from '@/game/sim/hire';
import { dynastyStep } from '@/game/sim/dynasty';
import { study, techLevel } from '@/game/sim/tech';
import { pointsOf } from '@/game/sim/points';
import { DAY_LENGTH } from '@/game/pace';
import { POINTS_CAP, levelsOf, pointsPerDay } from '@/game/data/realm';
import { paceOf } from './branchpace';

/** Партия, где ветвь учат «когда хватило — купил», до дня `day`; навык правителя задан. */
function lived(branch: RealmBranch, skill: number, day: number): GameState {
  const s = createInitialState(7);
  settleHires(s);
  dynastyStep(s);
  s.realm.ruler.skills[branch] = skill;
  const step = DAY_LENGTH / 2;
  while (s.time + step <= day * DAY_LENGTH) {
    s.time += step;
    while (study(s, branch) === null);
  }
  return s;
}

describe('прибор ветви сходится с дверью игры', () => {
  it('уровень и очки — те же, что у партии, которая учит настоящей дверью', () => {
    for (const branch of ['admin', 'war'] as RealmBranch[]) {
      for (const skill of [1, 3, 5]) {
        for (const day of [60, 171, 360]) {
          const s = lived(branch, skill, day);
          const p = paceOf(branch, skill, day);
          const tag = `${branch}, навык ${skill}, день ${day}`;
          expect(techLevel(s, branch), `${tag}: уровень`).toBe(p.level);
          // Партия решает раз в полдня: купленное прибором в середине полудня партия купит на его конце.
          expect(Math.abs(pointsOf(s, branch) - p.held), `${tag}: очки`).toBeLessThanOrEqual(pointsPerDay(skill) / 2 + 1e-9);
        }
      }
    }
  });

  /**
   * Горят очки только у ветви, изученной целиком, — и тогда партия и правда стоит у потолка.
   * Область: у сильного правителя к 360-му дню административная ветвь пройдена и очки горят.
   */
  it('сгорает только у изученной целиком ветви, и партия тогда у потолка', () => {
    const p = paceOf('admin', 5, 360);
    expect(p.doneAt, 'точка внутри области: ветвь изучена').not.toBeNull();
    expect(p.burned, 'и очки горят').toBeGreaterThan(0);
    const s = lived('admin', 5, 360);
    expect(techLevel(s, 'admin'), 'партия прошла ветвь').toBe(levelsOf('admin'));
    expect(pointsOf(s, 'admin'), 'и стоит у потолка').toBe(POINTS_CAP);
    for (const day of [60, 171, 360]) {
      const q = paceOf('admin', 1, day);
      expect(q.doneAt, `навык 1, день ${day}: ветвь не пройдена`).toBeNull();
      expect(q.burned, `навык 1, день ${day}: не горит ничего`).toBe(0);
    }
  });
});
