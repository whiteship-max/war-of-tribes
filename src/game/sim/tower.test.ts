// Башня: места лучников, орудие, его цена и срок.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { deserialize, serialize } from '../save';
import { ENGINES } from '../data/engines';
import { BUILDING_BY_ID } from '../data/buildings';
import { MAX_BUILDING_LEVEL } from '../constants';
import { buildingOfType, towerSeats, upgradeCost } from '../derived';
import { engineInfo, engineSeconds, readyEngine, setEngine } from './tower';
import { playerProfile } from '@/world/bridge';
import type { GameState } from '../types';

function towerAt(level: number): GameState {
  const s = createInitialState(1);
  buildingOfType(s, 'tower')!.level = level;
  for (const r of Object.keys(s.resources) as (keyof typeof s.resources)[]) s.resources[r] = 1_000_000;
  return s;
}

describe('башня: места лучников', () => {
  it('одно место на первом уровне и ещё одно каждые три', () => {
    const seats = Array.from({ length: MAX_BUILDING_LEVEL }, (_, i) => towerSeats(towerAt(i + 1)));
    expect(seats).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4]);
  });

  it('на уровне, где орудие открывается, мест хватает на его расчёт', () => {
    for (const def of ENGINES) {
      expect(def.level, `${def.id}: уровень внутри шкалы`).toBeLessThanOrEqual(MAX_BUILDING_LEVEL);
      expect(towerSeats(towerAt(def.level)), `${def.id}: мест на ${def.level}-м уровне`).toBeGreaterThanOrEqual(def.crew);
    }
  });
});

describe('башня: орудие', () => {
  it('ниже нужного уровня не ставится, а на нём стоит ровно улучшение башни', () => {
    for (const def of ENGINES) {
      const low = towerAt(def.level - 1);
      expect(setEngine(low, def.id)).toBe(`Нужна башня ${def.level} уровня — сейчас ${def.level - 1}.`);
      expect(low.engine.id).toBeNull();

      const s = towerAt(def.level);
      const before = { ...s.resources };
      expect(setEngine(s, def.id)).toBeNull();
      const cost = upgradeCost(BUILDING_BY_ID.tower, def.level);
      for (const r of Object.keys(before) as (keyof typeof before)[]) {
        expect(before[r] - s.resources[r], `${def.id}: ${r}`).toBe(cost[r] ?? 0);
      }
      expect(s.engine).toEqual({ id: def.id, until: s.time + engineSeconds(def) });
    }
  });

  it('пока ставят, башня молчит; готово — бьёт; башня ниже уровня орудия — молчит снова', () => {
    const def = ENGINES.find((e) => e.id === 'ballista')!;
    const s = towerAt(def.level);
    expect(setEngine(s, def.id)).toBeNull();
    const until = s.engine.until;
    expect(until, 'ставят не мгновенно').toBeGreaterThan(s.time);
    s.time = until - 1;
    expect(readyEngine(s), 'за секунду до отметки').toBeNull();
    expect(playerProfile(s).tower, 'слепок без орудия').toBeUndefined();
    expect(setEngine(s, 'catapult'), 'занятая башня').toBe('Башня занята: ставят балисту.');
    s.time = until;
    expect(readyEngine(s)?.id).toBe('ballista');
    expect(playerProfile(s).tower).toEqual({ slow: def.slow, thin: def.thin, crew: def.crew, seats: towerSeats(s) });
    buildingOfType(s, 'tower')!.level = def.level - 1;
    expect(readyEngine(s), 'башню снесли на уровень').toBeNull();
    expect(engineInfo(s).ready).toBe(false);
  });

  it('слепок деревни без орудия — без поля, и старое сохранение приезжает башней без орудия', () => {
    const s = createInitialState(1);
    expect('tower' in playerProfile(s)).toBe(false);
    const data = JSON.parse(serialize(s));
    delete data.engine;
    const back = deserialize(JSON.stringify(data))!;
    expect(back.engine).toEqual({ id: null, until: 0 });
    expect(back.version, 'версия сохранения не выросла').toBe(s.version);
  });
});
