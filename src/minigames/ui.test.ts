/**
 * Строки и цели касания промыслов (docs/minigames.md, 3–4): числа подсказки энергии — функциями двери (правило 18),
 * голос — правилами текстов (docs/ui_audit.md, 4.1–4.4), всё нажимаемое — не меньше `--tap`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { ENERGY_MAX, MINIGAME_COST } from '@/game/data/minigames';
import { beginMinigame, energyFullIn, energyShown } from '@/game/sim/minigames';
import { realSpanText } from '@/ui/parts/wait';
import { energyTip } from '@/ui/next/hudTips';
import { TIP_MAX } from '@/ui/next/tip';
import { BANNED, playerStrings } from '@/ui/next/voice.test';
import { TAP_SLIP, TAP_TARGET } from '@/gestures';
import { STICK_DEAD, STICK_FULL } from '@/prologue/controls';
import { HOW, verdictOf } from './Minigame';
import { BEASTS } from './herd';
import { PIN_DISTS } from './hunt';
import { FISH } from './fishing';
import { MINIGAMES } from '@/game/data/minigames';

const T0 = Date.UTC(2026, 9, 4, 6, 0, 0);

describe('подсказка энергии — числами двери', () => {
  it('сколько из полного, когда полная и сколько стоит игра — функциями `sim/minigames`', () => {
    const s = createInitialState();
    const full = energyTip(s, T0, () => undefined);
    expect(full.title).toBe(`Энергия · ${energyShown(s, T0)} из ${ENERGY_MAX}`);
    expect(full.body).toContain('Запас полон');
    expect(full.body).toContain(String(MINIGAME_COST));
    expect(full.link?.label).toBe('Промыслы');
    // Область: после траты запас не полон, и срок — настоящим временем той же функцией.
    expect(typeof beginMinigame(s, 'berries', T0)).toBe('object');
    const at = T0 + 3_600_000;
    expect(energyFullIn(s, at)).toBeGreaterThan(0);
    const tip = energyTip(s, at, () => undefined);
    expect(tip.title).toContain(`${energyShown(s, at)} из ${ENERGY_MAX}`);
    expect(tip.body).toContain(realSpanText(Math.ceil(energyFullIn(s, at) / 1000)));
    expect(`${tip.title} ${tip.body}`.length).toBeLessThanOrEqual(TIP_MAX);
  });
});

describe('голос промыслов', () => {
  const FILES = [
    'minigames/Minigame.tsx',
    'minigames/berriesPlay.ts',
    'minigames/herdPlay.ts',
    'minigames/huntPlay.ts',
    'minigames/berries.ts',
    'minigames/herd.ts',
    'minigames/hunt.ts',
    'minigames/fishPlay.ts',
    'minigames/fishing.ts',
    'ui/next/Trades.tsx',
    'game/data/minigames.ts',
  ];
  const SRC = join(__dirname, '..');

  it('ни канцелярита, ни восклицаний, ни слов, которые словарь убрал; кнопки — до 14 знаков', () => {
    let seen = 0;
    for (const f of FILES) {
      for (const t of playerStrings(readFileSync(join(SRC, f), 'utf8'))) {
        seen++;
        for (const re of BANNED) expect(re.test(t), `${f}: «${t}» — ${re}`).toBe(false);
      }
    }
    // Точка внутри области: щуп видит строки.
    expect(seen).toBeGreaterThan(20);
    for (const label of ['В лес', 'В загон', 'На охоту', 'К воде', 'Начать', 'Назад', 'Уйти', 'Точно?', 'В город']) expect(label.length).toBeLessThanOrEqual(14);
  });
});

describe('цели касания промыслов — не меньше порога проекта', () => {
  const CSS = readFileSync(join(__dirname, 'minigames.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const value = (sel: string, prop: string): number | null => {
    const v = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, s]) => s.split(',').map((x) => x.trim()).includes(sel))
      .map(([, , body]) => body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`))?.[1].trim())
      .filter((x): x is string => x !== undefined)
      .pop();
    if (!v) return null;
    if (v === 'var(--tap)') return TAP_TARGET;
    const m = v.match(/^(\d+)px$/);
    return m ? Number(m[1]) : null;
  };

  it('«Уйти», «Начать», «Назад», «В город», «Как играть» — 44 и больше', () => {
    expect(TAP_TARGET).toBe(44);
    for (const [sel, prop] of [
      ['.mg-leave', 'height'],
      ['.mg-leave', 'min-width'],
      ['.mg-go', 'height'],
      ['.mg-back', 'height'],
      ['.mg-go', 'min-width'],
      ['.mg-howbtn', 'height'],
    ] as const) {
      const n = value(sel, prop);
      expect(n, `${sel} ${prop}`).not.toBeNull();
      expect(n!, `${sel} ${prop}`).toBeGreaterThanOrEqual(TAP_TARGET);
    }
  });

  it('руки (docs/minigames.md, 18.1): кнопка действия и кружок пальца — не меньше порога; полный ход стика — в кружке', () => {
    for (const sel of ['.mg-act', '.mg-pad']) {
      for (const prop of ['width', 'height']) {
        const n = value(sel, prop);
        expect(n, `${sel} ${prop}`).not.toBeNull();
        expect(n!, `${sel} ${prop}`).toBeGreaterThanOrEqual(TAP_TARGET);
      }
    }
    // Палец, доведённый до полного хода (`STICK_FULL` от точки, где лёг), не уходит дальше кружка пальца.
    expect(STICK_FULL).toBeLessThanOrEqual(value('.mg-pad', 'width')!);
    // Мёртвая зона стика — меньше порога тапа: палец, ещё не пошедший, кнопку обхода жмёт как тап.
    expect(STICK_DEAD).toBeLessThan(TAP_SLIP);
  });

  it('холст отдаёт пальцу вертикальную тягу: `touch-action: none`', () => {
    expect(CSS).toMatch(/\.mg-canvas\s*\{[^}]*touch-action:\s*none/);
  });
});

// Итог, «как играть» и трофеи голосом игры (docs/voice.md, 11): числа правил — данными игры (правило 18), итог —
// ступенью доли той же функцией, что начисление, у каждой рыбы своё имя трофея.
describe('промыслы голосом игры', () => {
  it('«как играть» называет числа правил данными игры, а не руками', () => {
    expect(HOW.herd.join(' ')).toContain(`корове надо ${BEASTS.cow.need}`);
    for (const d of PIN_DISTS) expect(HOW.hunt.join(' ')).toContain(String(d));
  });

  it('итог — своя строка на каждую ступень, и ступень растёт с долей', () => {
    for (const g of MINIGAMES) {
      const lines = [0, 0.2, 0.5, 0.9].map((x) => verdictOf(g.id, x));
      expect(new Set(lines).size, g.id).toBe(4);
      for (const t of lines) for (const re of BANNED) expect(re.test(t), `${g.id}: «${t}»`).toBe(false);
      // Область: пороги ступеней лежат внутри [0, 1] — крайние доли дают верх и «ничего».
      expect(verdictOf(g.id, 1), g.id).toBe(lines[3]);
      expect(verdictOf(g.id, 0), g.id).toBe(lines[0]);
    }
  });

  it('у каждой рыбы своё имя трофея, без запретных слов', () => {
    const names = FISH.map((f) => f.big);
    expect(new Set(names).size).toBe(FISH.length);
    for (const f of FISH) {
      expect(f.big.length, f.id).toBeLessThanOrEqual(20);
      for (const re of BANNED) expect(re.test(f.big), f.big).toBe(false);
    }
  });
});
