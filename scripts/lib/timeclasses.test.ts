// Классы величин времени (docs/time.md, раздел 13): у каждой величины класс записан там же, где
// число, — конструктором из `game/pace.ts`, — и класс делает то, что обещает, при шкале, отличной
// от единицы. При единице все классы неотличимы, и тест на них был бы зелёным даром (правило 11):
// шкала подменяется в свежем графе модулей, чтобы величины пересчитались при ней с объявления.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CTOR_CLASS, dayConsts, tableRows, timeConsts, unclassified, type TimeConst } from './timeclasses';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCALE = 30;

type Pace = typeof import('@/game/pace');

/** Значения величин при шкале `k` — в свежем графе модулей, с объявления. */
async function valuesAt(k: number, consts: TimeConst[]): Promise<{ pace: Pace; values: Map<string, number> }> {
  vi.resetModules();
  const pace = (await import('@/game/pace')) as Pace;
  pace.setTimeScale(k);
  const values = new Map<string, number>();
  for (const file of new Set(consts.map((c) => c.file))) {
    const mod = (await import(/* @vite-ignore */ `/${file}`)) as Record<string, unknown>;
    for (const c of consts.filter((x) => x.file === file)) {
      const v = mod[c.name];
      if (typeof v === 'number') values.set(`${c.file}:${c.name}`, v);
    }
  }
  return { pace, values };
}

afterEach(() => vi.resetModules());

describe('классы величин времени: по исходникам', () => {
  const all = timeConsts(ROOT);

  it('величины найдены, и у каждого класса есть свои', () => {
    // Точка внутри области: чтение исходников видит объявления — иначе всё ниже зелёное даром.
    expect(all.length, 'величин с классом').toBeGreaterThan(50);
    for (const cls of ['game', 'real', 'owner'] as const) expect(all.filter((c) => c.cls === cls).length, cls).toBeGreaterThan(0);
    expect(all.map((c) => c.name)).toEqual(expect.arrayContaining(['AI_ATTACK_MIN', 'LETTER_TTL', 'MUTINY_ANSWER', 'AI_WARNING_BASE']));
    expect(dayConsts(ROOT).length, 'сроки в игровых днях').toBeGreaterThan(5);
    expect(tableRows(ROOT).reduce((n, r) => n + r.n, 0), 'строки таблиц').toBeGreaterThan(5);
  });

  // Счёт по классам — число, на которое ссылаются документы (docs/time.md, раздел 13; правило 12).
  // Новая величина времени меняет его сознательно: ей выбирают класс и правят число здесь.
  it('сколько величин в каждом классе', () => {
    const rows = tableRows(ROOT);
    const count = (cls: 'game' | 'real' | 'owner') => ({
      named: all.filter((c) => c.cls === cls).length,
      inTables: rows.filter((r) => r.cls === cls).reduce((n, r) => n + r.n, 0),
    });
    expect({ game: count('game'), real: count('real'), owner: count('owner'), days: dayConsts(ROOT).length }).toEqual({
      game: { named: 37, inTables: 10 },
      real: { named: 25, inTables: 0 },
      owner: { named: 7, inTables: 2 },
      days: 11,
    });
    expect(all.filter((c) => c.cls === 'owner').map((c) => c.name).sort()).toEqual(
      ['AI_WARNING_BASE', 'BURN_IMMUNE', 'DEFENSE_FREEZE', 'GEM_SECONDS', 'LAIR_RUIN', 'REVOLT_DURATION', 'SACK_DURATION'].sort(),
    );
  });

  it('величины времени без класса нет ни одной', () => {
    expect(unclassified(ROOT), 'объявлена единицей настоящего времени, но без конструктора класса').toEqual([]);
  });

  it('у «решает владелец» вопрос назван словами', () => {
    const silent = all.filter((c) => c.cls === 'owner' && !(c.why && c.why.length > 10)).map((c) => c.name);
    expect(silent).toEqual([]);
  });
});

describe('класс делает, что обещает: прогоном при шкале, отличной от единицы', () => {
  it('игровое время идёт со шкалой, настоящее и «решает владелец» — нет', async () => {
    const all = timeConsts(ROOT);
    const base = await valuesAt(1, all);
    const slow = await valuesAt(SCALE, all);
    expect(slow.pace.timeScale(), 'точка внутри области: шкала отлична от единицы').toBe(SCALE);
    expect(base.values.size, 'точка внутри области: значения прочитаны').toBeGreaterThan(50);
    const wrong: string[] = [];
    for (const c of all) {
      const key = `${c.file}:${c.name}`;
      const a = base.values.get(key);
      const b = slow.values.get(key);
      if (a === undefined || b === undefined || a === 0) continue;
      if (c.cls === 'owner') {
        // Пока владелец не решил, величина идёт, как шла: число не меняется.
        if (a !== b) wrong.push(`${c.name} (${c.ctor}): было ${a}, стало ${b}`);
        continue;
      }
      // Чем измерена величина, говорит конструктор: у мира — настоящие мс, у племени — игровые секунды,
      // у ставки — работа в игровую секунду. Сколько НАСТОЯЩИХ секунд она длится при каждой шкале:
      const seconds = (p: Pace, v: number): number =>
        c.ctor === 'worldDays' || c.ctor === 'realTime' ? v / 1000 : c.ctor === 'realSec' ? v : c.ctor === 'gameRate' ? p.realSeconds(1 / v) : p.realSeconds(v);
      const ratio = seconds(slow.pace, b) / seconds(base.pace, a);
      const want = c.cls === 'game' ? SCALE : 1;
      if (Math.abs(ratio - want) > 1e-9) wrong.push(`${c.name} (${c.ctor}): настоящая длительность ×${ratio}, по классу ×${want}`);
    }
    expect(wrong).toEqual([]);
  });

  it('решение владельца: ритм угрозы — в игровых днях, окно ответа и почта — в настоящем времени', async () => {
    const names = ['AI_ATTACK_MIN', 'LAIR_RIPE', 'SIEGE_IMMUNE', 'CAMP_WORKS_RIPE', 'LETTER_TTL', 'MUTINY_ANSWER'];
    const pick = timeConsts(ROOT).filter((c) => names.includes(c.name));
    expect(pick.map((c) => c.name).sort(), 'точка внутри области: величины на месте').toEqual([...names].sort());
    const base = await valuesAt(1, pick);
    const slow = await valuesAt(SCALE, pick);
    const at = (v: Map<string, number>, name: string): number => [...v.entries()].find(([k]) => k.endsWith(`:${name}`))![1];
    const dayMs = (p: Pace): number => p.realMs(p.DAY_LENGTH);
    for (const name of ['AI_ATTACK_MIN', 'LAIR_RIPE', 'SIEGE_IMMUNE', 'CAMP_WORKS_RIPE']) {
      expect(at(slow.values, name) / dayMs(slow.pace), `${name} в игровых днях`).toBeCloseTo(at(base.values, name) / dayMs(base.pace), 9);
      expect(at(slow.values, name), `${name} в настоящих мс`).toBeCloseTo(at(base.values, name) * SCALE, 6);
    }
    expect(at(slow.values, 'LETTER_TTL'), 'срок донесения — настоящие сутки').toBe(at(base.values, 'LETTER_TTL'));
    expect(slow.pace.realSeconds(at(slow.values, 'MUTINY_ANSWER')), 'окно ответа — настоящие секунды').toBeCloseTo(45, 9);
  });

  it('конструкторы сведены в классы без дыр', () => {
    expect(Object.values(CTOR_CLASS).sort().filter((c, i, a) => a.indexOf(c) === i)).toEqual(['game', 'owner', 'real']);
  });
});
