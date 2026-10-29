// Видимость отряда бродяги (ПН-4у, docs/gdd/path_of_sword.md, 3.5.4, 3.14 и «Решения ПН-4у»): одна функция у клиента и сервера,
// руины прячут до вместимости, размер, ночь и сезон, наблюдатели — ровно перечисленные.
//
// Граница области — утверждениями (правило 11): точка «видят» лежит внутри радиуса × заметность, «не видят» — снаружи; ночь —
// правда ночь по часам партии, зима — правда зима; руины — правда вмещают или правда не вмещают.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUIN_CAP, SIGHT } from './data/sight';
import { SEASON_MODIFIERS, SEASONS, SEASON_SECONDS } from '@/game/data/seasons';
import { DAY_LENGTH } from '@/game/constants';
import { dayPartAt, seasonOf } from '@/game/derived';
import { ROAM_STUBS } from '@/game/roamstubs';
import {
  WATCHER_KINDS,
  bandLook,
  conspicuity,
  detectRange,
  partyTimeAt,
  sees,
  seenBy,
  sightParts,
  sizeMult,
  watchRadius,
  type Look,
  type Watcher,
} from './sight';
import { homeSight, liveSight } from './lookout';
import { HOME_SIGHT } from './data/tuning';
import { SICILY, SICILY_SIGHT } from './spawn';
import { FIGURE_BY_ID } from './data/figures';
import { roamSeat } from './roam';
import { terrainAt } from './geography';
import { WAR_GROUND_SEED } from './pvp';
import { ruinsIn } from './ruins';
import { gameSecondsOfMs } from '@/game/pace';
import { bandTime, lookOfRow, seenOf } from '../../netlify/lib/bandsight';
import type { BandRow, RosterFile } from '../../netlify/lib/contract';

const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (rel: string): string => strip(readFileSync(join(process.cwd(), rel), 'utf8'));

const base: Look = { terrain: 'plain', ruinCap: null, stance: { camp: 'hidden' }, men: 20, night: false, season: 'summer' };
const look = (over: Partial<Look>): Look => ({ ...base, ...over });
const CASTLE: Watcher = { kind: 'castle', at: { x: 0, y: 0 } };

describe('одна функция у клиента и сервера', () => {
  it('дверь без `@/`: её собирает сервер', () => {
    const src = read('src/world/sight.ts');
    const specs = [...src.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.filter((s) => s.startsWith('@/') || !s.startsWith('.'))).toEqual([]);
  });

  it('заметность и радиус складывает только `world/sight`: у сервера, мира и карты своей арифметики нет', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|mts)$/.test(name) && !/\.test\./.test(name)) files.push(p);
      }
    };
    for (const d of ['src', 'netlify']) walk(join(process.cwd(), d));
    const owners = new Set(['src/world/sight.ts', 'src/world/data/sight.ts']);
    for (const f of files) {
      const rel = f.slice(process.cwd().length + 1).replace(/\\/g, '/');
      if (owners.has(rel)) continue;
      const src = strip(readFileSync(f, 'utf8'));
      // Таблицу видимости и множитель сезона читает только дверь (прибор берёт таблицу, чтобы её вывести, — он не код игры).
      expect([rel, /\bSIGHT\b|\.camouflage\b|\bsizeMult\(|\bwatchRadius\(/.test(src)], rel).toEqual([rel, false]);
    }
  });

  it('сервер и клиент считают одно и то же: строка реестра — та же заметность, что запись хода партии', () => {
    const at = { x: 400, y: 600 };
    const T = 1_900_000_000_000;
    const row: BandRow = { ...roamSeat(at, T), camp: { kind: 'hidden', since: T, builders: 20 }, born: T, name: 'Ратко', prestige: 0, men: 20, seenAt: T, clock: { time: 777, at: T } };
    const now = T + 3_600_000;
    const party = 777 + gameSecondsOfMs(now - T);
    expect(bandTime(row, now)).toBe(party);
    expect(lookOfRow(row, now)).toEqual(bandLook({ way: row.way, camp: row.camp ?? null }, 20, party, now));
    // Замок в пределах обнаружения и за ним — сервер и правило двери говорят одно.
    const c = conspicuity(lookOfRow(row, now));
    const r = detectRange(CASTLE, c);
    expect(r).toBeGreaterThan(1);
    for (const d of [Math.floor(r) - 1, Math.ceil(r) + 1]) {
      const file: RosterFile = { v: 1, epoch: 0, rows: { lord: { x: at.x + d, y: at.y, name: 'Вождь', power: 1, pop: 1, seenAt: T } }, bands: { me: row } };
      const server = seenOf(file, 'me', now);
      const door = seenBy([{ kind: 'castle', at: { x: at.x + d, y: at.y } }], at, lookOfRow(row, now));
      expect(server?.count, `замок в ${d} кл. при дальности ${r.toFixed(2)}`).toBe(door.length);
      expect(server?.count).toBe(d <= r ? 1 : 0);
    }
  });
});

describe('заметность по множителям', () => {
  it('местность, лагерь, колонна режимом марша — множители таблицы', () => {
    expect(conspicuity(look({}))).toBeCloseTo(SIGHT.ground.plain * SIGHT.camp.hidden, 10);
    expect(conspicuity(look({ terrain: 'forest' }))).toBeCloseTo(SIGHT.ground.forest * SIGHT.camp.hidden, 10);
    expect(conspicuity(look({ stance: { camp: 'open' } }))).toBeCloseTo(SIGHT.camp.open, 10);
    expect(conspicuity(look({ stance: { field: true } })), 'стоит без лагеря — как открытый').toBeCloseTo(SIGHT.camp.open, 10);
    for (const g of ['light', 'normal', 'train'] as const) expect(conspicuity(look({ stance: { march: g } }))).toBeCloseTo(SIGHT.march * SIGHT.gait[g], 10);
    // Режим марша — только в пути: налегке тише обычного, с обозом громче.
    expect(SIGHT.gait.light).toBeLessThan(1);
    expect(SIGHT.gait.train).toBeGreaterThan(1);
  });

  it('руины прячут до вместимости: помещается — множитель руин вместо местности; больше — укрытие пропадает', () => {
    const inRuins = (men: number): Look => look({ terrain: 'forest', stance: { camp: 'ruin' }, ruinCap: RUIN_CAP, men });
    // Граница — утверждением: первая точка внутри вместимости, вторая — за ней.
    expect(RUIN_CAP).toBeLessThanOrEqual(RUIN_CAP);
    expect(RUIN_CAP + 1).toBeGreaterThan(RUIN_CAP);
    expect(sightParts(inRuins(RUIN_CAP)).map((p) => p.id)).toEqual(['ruin', 'size']);
    expect(conspicuity(inRuins(RUIN_CAP))).toBeCloseTo(SIGHT.camp.ruin * sizeMult(RUIN_CAP), 10);
    const over = sightParts(inRuins(RUIN_CAP + 1));
    expect(over.map((p) => p.id)).toEqual(['ground', 'stance', 'size']);
    expect(conspicuity(inRuins(RUIN_CAP + 1))).toBeCloseTo(SIGHT.ground.forest * SIGHT.camp.hidden * sizeMult(RUIN_CAP + 1), 10);
    // Переросший руины виден дальше, чем один лишний человек объясняет размером.
    expect(conspicuity(inRuins(RUIN_CAP + 1)) / conspicuity(inRuins(RUIN_CAP))).toBeGreaterThan(sizeMult(RUIN_CAP + 1) / sizeMult(RUIN_CAP) + 0.2);
    // Лагерь «в руинах», под которым руин нет, — скрытый на своей земле.
    expect(conspicuity(look({ stance: { camp: 'ruin' } }))).toBeCloseTo(SIGHT.camp.hidden, 10);
    // Руины, стоять на которых без лагеря в руинах, не прячут.
    expect(conspicuity(look({ ruinCap: RUIN_CAP }))).toBeCloseTo(SIGHT.camp.hidden, 10);
  });

  it('размер: пол у одиночки, единица у двадцати, степень у сотни; не убывает с людьми', () => {
    expect(sizeMult(0)).toBe(SIGHT.size.floor);
    expect(sizeMult(1)).toBe(SIGHT.size.floor);
    expect(sizeMult(SIGHT.size.per)).toBe(1);
    expect(sizeMult(100)).toBeCloseTo(Math.pow(100 / SIGHT.size.per, SIGHT.size.pow), 10);
    // Пол правда держит одиночку: кривая у одного человека — ниже пола.
    expect(Math.pow(1 / SIGHT.size.per, SIGHT.size.pow)).toBeLessThan(SIGHT.size.floor);
    let prev = 0;
    for (let m = 0; m <= 300; m++) {
      expect(sizeMult(m), `${m} чел.`).toBeGreaterThanOrEqual(prev);
      prev = sizeMult(m);
    }
  });

  it('ночь и сезон: ночью — множитель ночи, зимой — поле таблицы сезонов; в остальные сезоны множителя нет', () => {
    expect(conspicuity(look({ night: true })) / conspicuity(look({}))).toBeCloseTo(SIGHT.night, 10);
    const winter = SEASON_MODIFIERS.winter.camouflage;
    expect(winter).toBeGreaterThan(1);
    expect(conspicuity(look({ season: 'winter' })) / conspicuity(look({}))).toBeCloseTo(winter as number, 10);
    for (const s of SEASONS.filter((x) => x !== 'winter')) {
      expect(SEASON_MODIFIERS[s].camouflage, s).toBeUndefined();
      expect(sightParts(look({ season: s })).some((p) => p.id === 'season'), s).toBe(false);
    }
  });

  it('ночь и сезон отряда — по часам его партии', () => {
    const at = { x: 400, y: 600 };
    const m = roamSeat(at, 0);
    // Точки — внутри своих окон: полдень лета второго дня и глубокая ночь зимы, как их видит строка состояния.
    const summerNoon = SEASON_SECONDS + DAY_LENGTH * 1.2;
    let winterNight = 3 * SEASON_SECONDS + DAY_LENGTH * 2;
    while (dayPartAt(winterNight) !== 'night') winterNight += 1;
    expect([seasonOf(summerNoon), dayPartAt(summerNoon)]).toEqual(['summer', 'day']);
    expect([seasonOf(winterNight), dayPartAt(winterNight)]).toEqual(['winter', 'night']);
    expect(bandLook(m, 20, summerNoon, 0)).toMatchObject({ night: false, season: 'summer', terrain: terrainAt(WAR_GROUND_SEED, at.x, at.y) });
    expect(bandLook(m, 20, winterNight, 0)).toMatchObject({ night: true, season: 'winter' });
    // Часы партии сервера: отметка и минута мира — та же дверь времени.
    expect(partyTimeAt({ time: 100, at: 0 }, 3_600_000)).toBe(100 + gameSecondsOfMs(3_600_000));
  });

  it('положение: идёт — колонна в режиме марша; стоит лагерем — лагерь; стоит без лагеря — в поле; руины — из клетки', () => {
    const s0 = SICILY[0];
    const ruin = ruinsIn(s0.x - 40, s0.y - 40, s0.x + 40, s0.y + 40)[0];
    expect(ruin, 'руины в рамке правда есть').toBeDefined();
    const at = { x: ruin.x, y: ruin.y };
    const seated = roamSeat(at, 0);
    expect(bandLook(seated, 10, 0, 0)).toMatchObject({ stance: { field: true }, ruinCap: RUIN_CAP });
    expect(bandLook({ ...seated, camp: { kind: 'ruin', since: 0, builders: 10 } }, 10, 0, 0).stance).toEqual({ camp: 'ruin' });
    const walking = { ...seated, way: { from: at, to: { x: at.x + 10, y: at.y }, at: 0, until: 3_600_000, gait: 'train' as const } };
    expect(bandLook(walking, 10, 0, 1_800_000).stance).toEqual({ march: 'train' });
    expect(bandLook(walking, 10, 0, 3_600_000).stance, 'дошёл — стоит').toEqual({ field: true });
  });
});

describe('наблюдатели — ровно перечисленные в ГДД 3.5.4', () => {
  it('круг у замка, лазутчик-наблюдатель, стоящий отряд, дружина в поле — и больше никого', () => {
    expect([...WATCHER_KINDS]).toEqual(['castle', 'spy', 'band', 'army']);
    // `watchRadius` разбирает ровно эти виды — и ни одного больше.
    const body = read('src/world/sight.ts');
    const fn = body.slice(body.indexOf('export function watchRadius'), body.indexOf('/** На каком расстоянии'));
    expect([...fn.matchAll(/case '(\w+)':/g)].map((m) => m[1]).sort()).toEqual(['army', 'band', 'castle', 'spy']);
    // Сервер ставит наблюдателями только тех, кого знает сам: замок и стоящий отряд.
    const server = read('netlify/lib/bandsight.ts');
    expect([...new Set([...server.matchAll(/kind: '(\w+)', at:/g)].map((m) => m[1]))].sort()).toEqual(['band', 'castle']);
  });

  it('радиусы: круг замка — живой обзор города (остров шире), лазутчик — свой обзор, отряд и дружина — таблица, следопыт — заглушка', () => {
    expect(watchRadius({ kind: 'castle', at: { x: 0, y: 0 } })).toBe(HOME_SIGHT);
    expect(watchRadius({ kind: 'castle', at: SICILY[0] })).toBe(SICILY_SIGHT);
    expect(watchRadius({ kind: 'castle', at: SICILY[0] })).toBe(homeSight(SICILY[0]));
    // Лазутчик-наблюдатель: тот же радиус, что даёт ему живой обзор, стоящему с приказом смотреть.
    expect(watchRadius({ kind: 'spy', at: { x: 0, y: 0 } })).toBe(liveSight('spy', { phase: 'field', departAt: 0, watching: true }));
    expect(watchRadius({ kind: 'spy', at: { x: 0, y: 0 } })).toBe(FIGURE_BY_ID.spy.sight);
    expect(watchRadius({ kind: 'band', at: { x: 0, y: 0 } })).toBe(SIGHT.band);
    expect(watchRadius({ kind: 'army', at: { x: 0, y: 0 } })).toBe(SIGHT.band);
    expect(watchRadius({ kind: 'band', at: { x: 0, y: 0 }, tracker: true })).toBe(SIGHT.band * ROAM_STUBS.tracker.value);
  });

  it('виден — ровно на расстоянии радиус × заметность и ближе; дальше — нет', () => {
    const c = conspicuity(look({ terrain: 'forest' }));
    const r = detectRange(CASTLE, c);
    expect(r).toBeCloseTo(HOME_SIGHT * c, 10);
    expect(sees(CASTLE, { x: r, y: 0 }, c)).toBe(true);
    expect(sees(CASTLE, { x: r + 0.01, y: 0 }, c)).toBe(false);
    expect(seenBy([CASTLE, { kind: 'band', at: { x: 100, y: 0 } }], { x: r - 1, y: 0 }, look({ terrain: 'forest' }))).toEqual([CASTLE]);
  });
});
