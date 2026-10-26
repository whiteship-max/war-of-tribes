// Прочее в мире из подозрений аудита (MAP-10, docs/audit/WORKPLAN.md: «пункты не доказаны — перед исправлением тест»).
// Переправа при штурме по прибытии — свой файл (`assaultford.test.ts`); здесь остальные четыре.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import type { GameState } from '@/game/types';
import { tribePulse, type PulseTribe } from './bridge';
import { LocalWorld } from './local/LocalWorld';
import { worldSaveJson, type StoredMarch, type WorldSave } from './local/state';
import type { FigureView, MarchView } from './types';
import type { SpyView } from '../../netlify/lib/contract';

const START = 1_700_000_000_000;
const src = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('п. 1: итоги сервера после пересборки мира', () => {
  // Не подтвердилось: все итоги сервера, которые мир применяет (бои и падения войн, дань, починки, орудия, кольцо,
  // выстрелы, повороты, тайные дела, предложения), отмечаются в одном списке `warSeen`, и он переезжает в мир, собранный
  // заново (`!keep`). Тест гонит полный цикл: кража принята, мир собран заново другим сидом, кража не ложится второй раз.
  it('кража, принятая прежним миром, не ложится второй раз после пересборки', async () => {
    let now = START;
    const theft: SpyView = {
      id: 'x1', role: 'atk', deed: 'theft', atkCastle: 'c-me', atkCity: 'Альфа', defCastle: 'c-b', defCity: 'Бета',
      from: { x: 0, y: 0 }, to: { x: 3, y: 0 }, sentAt: START - 3_600_000, arriveAt: START - 1_800_000, chance: 1, peril: 0,
      phase: 'done', endAt: START - 60_000,
      out: { at: START - 1_800_000, ok: true, slipped: false, held: false, dead: false, stolen: { gold: 10 } },
    };
    const s: GameState = createInitialState();
    s.gold = 100;
    const tribe: PulseTribe = { get: () => s, apply: (change) => change(s) };
    const opts = { now: () => now, wars: () => [], spies: () => [theft], warsKnown: () => true };
    const old = new LocalWorld({ seed: 11, storage: null, ...opts });
    let last: { marches: MarchView[]; figures: FigureView[] } = { marches: [], figures: [] };
    await tribePulse(old, tribe, last);
    expect(s.gold, 'точка внутри области: кража принята прежним миром').toBe(110);
    const json = worldSaveJson((old as unknown as { save: WorldSave }).save);
    const fresh = new LocalWorld({ seed: 12, storage: { read: () => json, write: () => {} }, ...opts });
    expect((fresh as unknown as { save: WorldSave }).save.seed, 'мир правда собран заново').toBe(12);
    now += 60_000;
    last = { marches: [], figures: [] };
    await tribePulse(fresh, tribe, last);
    expect(s.gold).toBe(110);
  });
});

describe('п. 3: удар полководца и его занятость', () => {
  // Не подтвердилось: `attack()` не спрашивает `busyUntil`, но полководцу его не ставит никто — занятость заводят только
  // дипломат (переговоры) и лазутчик (дело и плен у соседа). Замок: так и остаётся; появится занятость полководца —
  // тест упадёт, и проверка в ударе понадобится.
  it('занятость (`busyUntil` в будущем) ставят только дипломату и лазутчику', () => {
    const code = src('./local/LocalWorld.ts');
    const sets = [...code.matchAll(/(\w+)\.busyUntil = (?!0;)/g)].map((m) => {
      const before = code.slice(0, m.index);
      const owner = [...before.matchAll(/const \w+ = this\.save\.figures\.(\w+);/g)].pop()?.[1];
      return owner;
    });
    expect(sets.length, 'точка внутри области: занятость заводится').toBeGreaterThan(0);
    for (const owner of sets) expect(['diplomat', 'spy']).toContain(owner);
  });
});

describe('п. 5: вместимость добычи — уцелевшие как воины', () => {
  // Не подтвердилось как ошибка: у родов войска своей грузоподъёмности нет, мерка добычи — воин на каждого уцелевшего,
  // одна у мира (`LocalWorld.haul`) и у сервера войны (`war.ts`, «той же меркой, что у полководца против логова»).
  it('мир и сервер войны мерят обоз одной меркой', () => {
    expect(src('./local/LocalWorld.ts')).toContain('this.haul({ warrior: survivors }, true)');
    expect(src('../../netlify/lib/war.ts')).toContain('carry: stackCarry({ warrior: survivors })');
  });
});

type Inner = {
  save: WorldSave;
  resolveRelief(m: StoredMarch, at: number): void;
};

describe('п. 2: выручка после боя', () => {
  // Подтвердилось: отряд выручки снимался с карты в любом исходе, хотя слова говорили «разворачивается и уходит домой».
  // Теперь уцелевшие уходят домой, как у похода соседа на соседа (`resolveWar`).
  it('осаду сняли без них — отряд разворачивается домой целым', async () => {
    const world = new LocalWorld({ seed: 7, now: () => START, storage: null });
    const w = world as unknown as Inner;
    const m: StoredMarch = {
      id: 'relief-1', seed: 3, mission: 'raid', units: { warrior: 10 }, own: false, fromId: 'x', targetId: 'y',
      from: { x: 0, y: 0 }, to: { x: 5, y: 0 }, fromName: 'Альфа', toName: 'Бета', departAt: START - 60_000, arriveAt: START,
      phase: 'out', power: 10, loot: null, relief: 'nobody-besieged',
    };
    w.save.marches.push(m);
    w.resolveRelief(m, START);
    const left = w.save.marches.find((x) => x.id === m.id);
    expect(left?.phase).toBe('back');
    expect(left?.to).toEqual({ x: 0, y: 0 });
    expect(left?.relief).toBeUndefined();
  });
});
