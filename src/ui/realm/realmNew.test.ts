// Держава нового интерфейса: подписи ступеней — из двери гейта, очки — из `sim/points` (правило 18).
import { describe, expect, it } from 'vitest';
import { POINTS_CAP, REALM_BRANCHES, levelsOf } from '@/game/data/realm';
import { levelName } from '@/game/sim/tech';
import { createInitialState } from '@/game/state';
import { TUTORIAL } from '@/game/data/tutorial';
import { BRANCH_WORD, cellName, pointsTip } from './RealmNew';
import { coatView } from './open';

describe('держава нового вида', () => {
  it('ячейка ступени говорит то же, что дверь гейта: у управления — число мест из её имени', () => {
    let admin = 0;
    for (const b of REALM_BRANCHES) {
      // Область: все ступени всех ветвей, кроме первой — она начало и ничего не открывает.
      for (let l = 2; l <= levelsOf(b); l++) {
        const name = levelName(b, l);
        const cell = cellName(b, l);
        if (b === 'admin') {
          admin++;
          const n = /(\d+)$/.exec(name)?.[1];
          expect(n, `${b} ${l}: в имени ступени управления есть число мест`).toBeDefined();
          expect(cell).toBe(`${n} мест`);
        } else {
          expect(cell, `${b} ${l}`).toBe(name);
        }
      }
      expect(cellName(b, 1)).toBe('Начало');
    }
    expect(admin, 'ступени управления проверены').toBeGreaterThan(3);
  });

  it('подсказка очков: сколько из потолка и приток в игровой день; на потолке — что новые не копятся', () => {
    const t = pointsTip('war', 34, 3);
    expect(t.title).toBe(`${BRANCH_WORD.war} · 34 из ${POINTS_CAP}`);
    expect(t.body).toBe('+3 в игровой день.');
    expect(pointsTip('admin', POINTS_CAP, 2).body).toContain('Потолок');
    expect(pointsTip('diplo', 10, 0).body).toBe('Приток нулевой.');
  });

  it('герб на шаге обучения «Изучи копьё» открывает технологии: путь словами шагу не нужен', () => {
    const s = createInitialState(5);
    const tech = TUTORIAL.findIndex((st) => st.id === 'tech');
    // Область: шаг технологий есть, и до него обучение идёт — на нём и после него герб ведёт по-разному.
    expect(tech, 'шаг технологий в обучении есть').toBeGreaterThan(0);
    s.tutorialStep = tech;
    expect(coatView(s, true, 'government')).toBe('tech');
    expect(coatView(s, false, 'decisions')).toBe('tech');
    s.tutorialStep = tech + 1;
    expect(coatView(s, true, 'government'), 'после шага — раздел, где закрыли').toBeUndefined();
    expect(coatView(s, true, 'decisions'), 'из вестей нового вида — в разделы державы').toBe('government');
    expect(coatView(s, false, 'decisions'), 'прежний вид помнит вести').toBeUndefined();
    s.tutorialStep = tech;
    s.tutorialDone = true;
    expect(coatView(s, true, 'government'), 'пропущенное обучение не ведёт').toBeUndefined();
  });
});
