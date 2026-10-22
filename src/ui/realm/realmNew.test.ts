// Держава нового интерфейса: подписи ступеней — из двери гейта, очки — из `sim/points` (правило 18).
import { describe, expect, it } from 'vitest';
import { POINTS_CAP, REALM_BRANCHES, levelsOf } from '@/game/data/realm';
import { levelName } from '@/game/sim/tech';
import { createInitialState } from '@/game/state';
import { TUTORIAL } from '@/game/data/tutorial';
import { BRANCH_WORD, NEW_TABS, cellName, pointsTip, questCell, questCellWord } from './RealmNew';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUESTS } from '@/game/data/quests';
import { dailyStatus } from '@/game/sim/daily';
import { coatView } from './open';
import { count } from '@/ui/parts/plural';

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
          expect(cell).toBe(count(Number(n), 'место', 'места', 'мест'));
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
    expect(pointsTip('admin', POINTS_CAP, 2).body).toContain('На потолке, новые не копятся.');
    // «Приток нулевой» → «Очки не копятся» (docs/voice.md: слово дела, а не счётчика).
    expect(pointsTip('diplo', 10, 0).body).toBe('Очки не копятся.');
  });

  // СБ-2б (решение владельца 22.10.2026): «Стабильность» — разделом в ряду на месте «Заданий», «Задания» — ячейкой строки очков.
  it('ряд: пять разделов, «Стабильность» на месте «Заданий» своим значком; «Заданий» в ряду нет', () => {
    expect(NEW_TABS.map((t) => t.id)).toEqual(['lineage', 'government', 'tech', 'faith', 'stability']);
    expect(NEW_TABS.find((t) => t.id === 'stability')?.icon).toBe('ui-stability');
    const src = readFileSync(join(__dirname, 'RealmNew.tsx'), 'utf8');
    // Строка очков: ячейка «Задания» ведёт в раздел заданий, ячейки ступени больше нет.
    expect(src).toMatch(/data-tut="realm-quests"[\s\S]{0,200}onClick=\{\(\) => go\('quests'\)\}/);
    expect(src).not.toMatch(/go\('stability'\)/);
  });

  it('ячейка «Задания»: число открытых заданий и отметка, пока задание дня сегодня ждёт', () => {
    const s = createInitialState(5);
    const day = 20_000;
    // Область: новая партия — заданий открыто больше нуля, задание дня сегодня не сыграно.
    expect(dailyStatus(s, day).played, 'точка внутри: задание дня не начато').toBe(false);
    const fresh = questCell(s, day);
    expect(fresh.open).toBe(QUESTS.length);
    expect(fresh.open).toBeGreaterThan(0);
    expect(fresh.daily).toBe(true);
    expect(questCellWord(fresh)).toBe(`Задания: открыто ${QUESTS.length}, задание дня ждёт`);
    s.completedQuests.push(QUESTS[0].id);
    expect(questCell(s, day).open).toBe(QUESTS.length - 1);
    s.daily = { ...s.daily, day, result: 'won' };
    expect(dailyStatus(s, day).played, 'точка внутри: сегодня уже сыграно').toBe(true);
    expect(questCell(s, day).daily, 'сыграно — отметки нет').toBe(false);
    expect(questCellWord(questCell(s, day))).toBe(`Задания: открыто ${QUESTS.length - 1}`);
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
