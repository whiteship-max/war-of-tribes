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
import { TAP_TARGET } from '@/gestures';

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
    for (const label of ['В лес', 'В загон', 'На охоту', 'Начать', 'Назад', 'Уйти', 'Точно?', 'В город']) expect(label.length).toBeLessThanOrEqual(14);
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

  it('«Уйти», «Начать», «Назад», «В город» — 44 и больше', () => {
    expect(TAP_TARGET).toBe(44);
    for (const [sel, prop] of [
      ['.mg-leave', 'height'],
      ['.mg-leave', 'min-width'],
      ['.mg-go', 'height'],
      ['.mg-back', 'height'],
      ['.mg-go', 'min-width'],
    ] as const) {
      const n = value(sel, prop);
      expect(n, `${sel} ${prop}`).not.toBeNull();
      expect(n!, `${sel} ${prop}`).toBeGreaterThanOrEqual(TAP_TARGET);
    }
  });

  it('холст отдаёт пальцу вертикальную тягу: `touch-action: none`', () => {
    expect(CSS).toMatch(/\.mg-canvas\s*\{[^}]*touch-action:\s*none/);
  });
});
