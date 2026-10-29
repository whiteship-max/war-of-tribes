// Выключатель Пути меча (ПН-1, docs/gdd/path_of_sword.md, 7.5, У1; «Решения ПН-1»; с 30.10.2026 — по игроку): до выпуска Среза 1
// фаза бродяги закрыта игрокам целиком, админам — открыта. Выключатель здесь настоящий, без подмены; слово сервера об админе —
// `setRoamOpen` (его зовёт записка админки, `net/admin`). Что путь работает, когда открыт, держит `sim/roam.test.ts`.
//
// Граница области — партия, у которой правда есть фаза и отряд бродяги (записанные рукой или пришедшие чужим сохранением):
// выключатель обязан не пустить именно их у игрока и пустить у админа, а партия без фазы и так лорд.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameState, RoamState } from './types';
import { ROAM_ON, roamOn, roamOpenFor, setRoamOpen } from './roamflag';
import { createInitialState, SAVE_VERSION } from './state';
import { MIN_SAVE_VERSION, deserialize } from './save';
import { liveStep } from './sim/tick';
import { beginRoam } from './sim/roam';
import { addStock } from './sim/stock';
import { spiritView } from './sim/spirit';
// Кусок пути (ПН-5, хвост а): у админа он докачан до чтения партии — тест держит его так же; у игрока реестр его не отдаёт.
import './roamdoor';

const BAND: RoamState = {
  origin: 'warrior',
  hero: { name: 'Ратко', war: 2 },
  band: { spearman: 4, clubman: 2 },
  wounded: [],
  purse: 120,
  cargo: { food: 40 },
  gear: {},
  way: { from: { x: 3, y: 4 }, to: { x: 3, y: 4 }, at: 0, until: 0 },
  camp: { kind: 'open', since: 0, builders: 6 },
};

/** Партия, которой фазу бродяги записали мимо входа: рукой или чужим сохранением. */
function forced(): GameState {
  const s = createInitialState(20261029);
  s.phase = 'roam';
  s.roam = structuredClone(BAND);
  return s;
}

afterEach(() => setRoamOpen(false));

describe('выключатель Пути меча — по игроку: админу открыт, остальным закрыт', () => {
  it('правило одно: до выпуска путь открыт только админу', () => {
    expect(ROAM_ON, 'граница: путь не выпущен').toBe(false);
    expect(roamOpenFor(false)).toBe(false);
    expect(roamOpenFor(true)).toBe(true);
    expect(roamOn(), 'устройство без слова сервера — не админ').toBe(false);
    setRoamOpen(true);
    expect(roamOn()).toBe(true);
  });

  it('админ входит в путь, его партия бродяги читается бродягой, обоз пишется', () => {
    setRoamOpen(true);
    const s = createInitialState(1);
    expect(beginRoam(s, { origin: 'warrior', hero: { name: 'x', war: 1 }, band: { spearman: 4 }, purse: 120, food: 40 })).toBeNull();
    expect(s.phase).toBe('roam');
    const back = deserialize(JSON.stringify(forced())) as GameState;
    expect(back.phase).toBe('roam');
    expect(back.roam?.band).toEqual(BAND.band);
    expect(addStock(forced(), 'food', 10, 1e6, 'cargo')).toBe(10);
  });
});

describe('выключатель Пути меча закрыт игрокам до выпуска', () => {
  it('ROAM_ON выключен, и версия сохранения не растёт (её поднимает выпуск Среза 1)', () => {
    expect(ROAM_ON).toBe(false);
    expect(roamOn(), 'граница: игрок не админ').toBe(false);
    expect(SAVE_VERSION).toBe(24);
    expect(MIN_SAVE_VERSION).toBe(8);
  });

  it('войти в путь нельзя', () => {
    const s = createInitialState(1);
    expect(beginRoam(s, { origin: 'warrior', hero: { name: 'x', war: 1 }, band: { spearman: 4 }, purse: 120, food: 40 })).toBe('Путь меча ещё не открыт.');
    expect(Object.keys(s)).not.toContain('phase');
    expect(Object.keys(s)).not.toContain('roam');
  });

  it('чтение сохранения не пускает фазу и отряд: партия читается лордом', () => {
    const back = deserialize(JSON.stringify(forced()));
    expect(back).not.toBeNull();
    expect(Object.keys(back as GameState)).not.toContain('phase');
    expect(Object.keys(back as GameState)).not.toContain('roam');
  });

  it('шаг не выбирает дверь бродяги: партия с фазой шагает посёлком, отряд не тронут', () => {
    const s = forced();
    const food = s.resources.food;
    liveStep(s, 1, Date.UTC(2026, 9, 1, 12));
    expect(s.resources.food, 'посёлок ел').not.toBe(food);
    expect(s.roam).toEqual(BAND);
  });

  it('обоз не пишется', () => {
    const s = forced();
    expect(addStock(s, 'food', 100, 1e6, 'cargo')).toBe(0);
    expect(addStock(s, 'food', -100, 1e6, 'cargo')).toBe(0);
    expect(s.roam?.cargo).toEqual(BAND.cargo);
  });

  it('дух читается входами города, а не отряда', () => {
    const s = forced();
    const lord = createInitialState(20261029);
    expect(spiritView(s)).toEqual(spiritView(lord));
  });

  it('каждая развилка по фазе бродяги в коде игры стоит за выключателем', () => {
    // Развилка без `ROAM_ON` прошла бы в сборку и открыла путь игроку, у которого фаза пришла чужим сохранением.
    const ROOT = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(ROOT);
    const forks: string[] = [];
    for (const p of files) {
      const lines = readFileSync(p, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // Развилка — по фазе партии (`s.phase`); чтение фазы из записи (`sim/roam.mergeRoam`) стоит за выключателем у чтения сохранения.
        if (!/\bs\.phase\s*===\s*'roam'/.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
        forks.push(relative(ROOT, p).split(sep).join('/'));
        // За выключателем — `roamOn() && …` или кусок пути `roamDoor()` (ПН-5, хвост а): реестр отдаёт его только тому, кому путь
        // открыт (`roamlazy.roamDoor` спрашивает `roamOn`, держит тест ниже).
        expect(line, `${relative(ROOT, p)}:${i + 1} — развилка без выключателя`).toMatch(/\broamOn\(\)\s*&&|\?\s*roamDoor\(\)/);
      });
    }
    // Граница области: развилки есть — шаг, отлучка, дух, чей счёт дел (ПН-2: герой пути или правитель), какой мир открыть и
    // чья карта (ПН-3: мир и карта бродяги своими кусками или лорда), куда ложится указ админа (30.10.2026: посёлку или отряду).
    expect([...new Set(forks)].sort()).toEqual(['game/rulernow.ts', 'game/sim/admin.ts', 'game/sim/spirit.ts', 'game/sim/tick.ts', 'ui/map/WorldMap.tsx', 'world/store.ts']);
  });
});
