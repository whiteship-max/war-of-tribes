// Черты агентов в мире: у каждого числа, которое черта двигает, ровно одна дверь, и
// множитель из слепка доходит до настоящего действия.
//
// Области (правило 11): множитель проверяется **не единицей** — при единице любое
// место, забывшее дверь, дало бы то же число; и рядом всегда стоит прогон без черт,
// который обязан дать прежние числа ровно.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { stackCarry, stackEscort } from './data/units';
import {
  FIGURE_SCOUT_CATCH,
  HANDOVER_BASE,
  HANDOVER_MAX,
  HANDOVER_PER_MAN,
  SPY_BUSY,
  SPY_HELD,
} from './data/tuning';
import type { PlayerProfile } from './types';

const WORLD = readFileSync(join(__dirname, 'local', 'LocalWorld.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Тело метода класса по имени — до закрывающей скобки. */
function methodBody(name: string): string {
  const m = new RegExp(String.raw`(?:private|protected)\s+${name}\s*\(`).exec(WORLD);
  if (!m) throw new Error(`не нашёл ${name}`);
  // Тело открывает скобка в конце строки: у `{ carry: number } {` первая — тип возврата.
  const open = /\{[ \t]*\r?\n/g;
  open.lastIndex = m.index;
  const start = open.exec(WORLD);
  if (!start) throw new Error(`у ${name} нет тела`);
  let depth = 0;
  for (let i = start.index; i < WORLD.length; i++) {
    if (WORLD[i] === '{') depth++;
    else if (WORLD[i] === '}' && --depth === 0) return WORLD.slice(m.index, i + 1);
  }
  throw new Error(`тело ${name} не закрылось`);
}

describe('одна дверь на каждое число, которое двигают черты', () => {
  const DOORS: [RegExp, string][] = [
    [/\bstackCarry\(/g, 'haul'],
    [/\bstackEscort\(/g, 'haul'],
    [/\bFIGURE_SCOUT_CATCH\b/g, 'scoutCatch'],
    // Срок сбора — правило `world/muster.musterMs` (одно на мир и на слова черты «Мясника», 14.35); в мире его зовёт
    // только дверь черты, а числа сбора мир не читает вовсе (ниже).
    [/\bmusterMs\(/g, 'musterWait'],
    [/\bSPY_BUSY\b/g, 'spyTimes'],
    [/\bSPY_HELD\b/g, 'spyTimes'],
  ];

  it('числа сбора читает одно правило — `world/muster.musterMs`, а не мир и не слова черты', () => {
    expect(WORLD, 'LocalWorld читает числа сбора мимо правила').not.toMatch(/\bHANDOVER_(?:BASE|PER_MAN|MAX)\b/);
    const muster = readFileSync(join(__dirname, 'muster.ts'), 'utf8');
    expect(muster, 'правило сбора читает числа сбора').toMatch(/HANDOVER_MAX/);
    const words = readFileSync(join(__dirname, '..', 'ui', 'parts', 'traitLines.ts'), 'utf8');
    expect(words, 'слова черты считают сбор своим кодом').not.toMatch(/\bHANDOVER_(?:BASE|PER_MAN|MAX)\b/);
    expect(words, 'слова черты зовут правило сбора').toMatch(/musterMs\(/);
  });

  it('в LocalWorld эти числа читает только их дверь (не считая импорта)', () => {
    const body = WORLD.replace(/^import[\s\S]*?from\s+'[^']+';$/gm, ' ');
    for (const [re, door] of DOORS) {
      const all = body.match(re)?.length ?? 0;
      const inside = methodBody(door).match(re)?.length ?? 0;
      expect(inside, `${re} в двери ${door}`).toBeGreaterThan(0);
      expect(all, `${re} мимо двери ${door}`).toBe(inside);
    }
  });
});

describe('множитель из слепка доходит до действия', () => {
  const NOW = 1_700_000_000_000;
  const base: PlayerProfile = {
    name: 'Тест',
    pop: 120,
    defense: 30,
    units: { warrior: 20, scout: 4 },
    army: { spearman: 40 },
    intelKeen: 1,
    warning: 40,
    stock: { food: 120 },
    stash: 0,
  };
  const TRAITS = { muster: 1.5, carry: 1.15, catch: 1.32, busy: 0.75, held: 1.5 };

  type Inner = {
    gen: { settlements: { id: string }[] };
    haul(units: { warrior?: number }, ours: boolean): { carry: number; escort: number };
    scoutCatch(): number;
  };

  async function worldWith(profile: PlayerProfile): Promise<{ w: LocalWorld; inner: Inner }> {
    const w = new LocalWorld({ seed: 17, now: () => NOW, storage: null });
    await w.sync(profile);
    return { w, inner: w as unknown as Inner };
  }

  it('без черт — прежние числа ровно', async () => {
    const { w, inner } = await worldWith(base);
    expect(inner.haul({ warrior: 10 }, true)).toEqual({ carry: stackCarry({ warrior: 10 }), escort: stackEscort({ warrior: 10 }) });
    expect(inner.scoutCatch()).toBe(FIGURE_SCOUT_CATCH);
    const spy = await w.orders('spy', inner.gen.settlements[0].id);
    expect(spy.map((o) => [o.seconds, o.held])).toEqual(spy.map(() => [SPY_BUSY / 1000, SPY_HELD / 1000]));
    expect(await w.setGarrison({ spearman: 10 })).toBeNull();
    const g = (await w.figures()).find((f) => f.id === 'general')!;
    expect(g.readyAt - NOW).toBe(Math.min(HANDOVER_MAX, HANDOVER_BASE + 10 * HANDOVER_PER_MAN));
  });

  it('с чертами: обоз — только у своего отряда, часовые, срок сбора, занятость и задержание лазутчика', async () => {
    const { w, inner } = await worldWith({ ...base, traits: TRAITS });
    expect(TRAITS.carry, 'множитель не единица').not.toBe(1);
    expect(inner.haul({ warrior: 10 }, true).carry).toBeCloseTo(stackCarry({ warrior: 10 }) * TRAITS.carry, 9);
    expect(inner.haul({ warrior: 10 }, false).carry, 'чужой отряд черт нашего полководца не несёт').toBe(stackCarry({ warrior: 10 }));
    expect(inner.scoutCatch()).toBeCloseTo(FIGURE_SCOUT_CATCH * TRAITS.catch, 9);
    const spy = await w.orders('spy', inner.gen.settlements[0].id);
    expect(spy.length).toBeGreaterThan(0);
    for (const o of spy) {
      expect(o.seconds).toBe(Math.round((SPY_BUSY * TRAITS.busy) / 1000));
      expect(o.held).toBe(Math.round((SPY_HELD * TRAITS.held) / 1000));
    }
    expect(await w.setGarrison({ spearman: 10 })).toBeNull();
    const g = (await w.figures()).find((f) => f.id === 'general')!;
    expect(g.readyAt - NOW).toBe(Math.round(Math.min(HANDOVER_MAX, HANDOVER_BASE + 10 * HANDOVER_PER_MAN) * TRAITS.muster));
  });
});
