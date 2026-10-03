// Имя города при первом входе (docs/ui_audit.md, 13): имена на выбор, когда встаёт шаг имени и что он пишет.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CITY_MAX, DEFAULT_CITY, cityName } from '../../../netlify/lib/contract';
import { createInitialState } from '@/game/state';
import { setCity } from '@/profile/stats';
import { profileCity } from '@/profile/identity';
import { startStep } from '../start';
import { CITY_SUGGESTIONS, suggestCity } from './cityNames';

const SEEDS = [1, 7, 42, 20260912, 2 ** 31 - 1];

describe('имена на выбор', () => {
  it('каждое проходит очистку договора без изменений, короче предела и не «Безымянный город»', () => {
    expect(CITY_SUGGESTIONS.length).toBeGreaterThanOrEqual(20);
    for (const name of CITY_SUGGESTIONS) {
      expect(cityName(name), name).toBe(name);
      expect(name.length, name).toBeLessThanOrEqual(CITY_MAX);
      expect(name).not.toBe(DEFAULT_CITY);
    }
    expect(new Set(CITY_SUGGESTIONS).size, 'повторов в списке нет').toBe(CITY_SUGGESTIONS.length);
  });

  it('кубик не повторяет имя, пока список не кончился, и идёт по кругу', () => {
    const len = CITY_SUGGESTIONS.length;
    for (const seed of SEEDS) {
      const round = Array.from({ length: len }, (_, n) => suggestCity(seed, n));
      expect(new Set(round).size, `сид ${seed}: круг — перестановка`).toBe(len);
      expect(suggestCity(seed, len), `сид ${seed}: второй круг`).toBe(round[0]);
      expect(suggestCity(seed, 3), 'тот же сид — то же имя').toBe(round[3]);
    }
  });

  it('первое имя зависит от сида: у соседей поле не одно и то же', () => {
    const firsts = new Set(SEEDS.map((seed) => suggestCity(seed, 0)));
    expect(firsts.size).toBeGreaterThan(1);
  });
});

describe('шаг имени у главной кнопки', () => {
  it('встаёт, только если шаг есть и у города нет имени', () => {
    expect(startStep(true, false)).toBe('name');
    expect(startStep(true, true), 'назван — входит').toBe('enter');
    expect(startStep(false, false), 'прежний вид — без шага').toBe('enter');
    expect(startStep(false, true)).toBe('enter');
  });

  it('назван ли город — по сохранению: пустое и невидимое — не имя, названное — имя', () => {
    // Область: те же входы, что приходят в шаг, — пусто, пробелы, невидимые знаки и годное имя.
    const s = createInitialState(7);
    expect(cityName(s.profile.city), 'новая партия без имени').toBeNull();
    for (const raw of ['', '   ', '​‎']) {
      setCity(s, raw);
      expect(startStep(true, cityName(s.profile.city) !== null), JSON.stringify(raw)).toBe('name');
    }
    setCity(s, suggestCity(s.seed, 0));
    expect(profileCity(s.profile)).toBe(suggestCity(s.seed, 0));
    expect(startStep(true, cityName(s.profile.city) !== null)).toBe('enter');
  });

  it('стартовый экран спрашивает шаг этой функцией и по имени из сохранения', () => {
    const src = readFileSync(join(__dirname, '..', 'StartScreen.tsx'), 'utf8');
    expect(src).toContain("startStep(naming !== null, named) === 'name'");
    expect(src).toContain('cityName(g.s.profile.city) !== null');
    const naming = readFileSync(join(__dirname, 'CityNaming.tsx'), 'utf8');
    // Имя пишет одна дверь — `setCity` (очистка договора), и партия сохраняется сразу.
    expect(naming).toMatch(/act\(\(st\) => setCity\(st, draft\)\);\s*save\(\);/);
  });
});
