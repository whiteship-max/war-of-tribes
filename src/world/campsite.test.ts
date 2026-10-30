// Лагерь бродяги по месту и погоде (ПН-12л, docs/gdd/path_of_sword.md, «Решения ПН-12л»): вид по земле и погоде, ступени, скрытый
// без огня, польза места через прежние двери (шаг отряда, дух, видимость), погода — одна дверь и детерминирована, окно «Встать
// лагерем» показывает то же, что считает игра.
//
// Путь включён подменой модуля (`vi.mock`), как в `roamworld.test.ts`. Граница области — утверждениями: клетки правда той земли, о
// которой речь (лес, голое поле, берег, руины на поле), минуты — правда сухие, дождливые или туманные, сезон — тот, о котором речь.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { beginRoam, campGain, foodAfter, roamStep, setMove, setTrip } from '@/game/sim/roam';
import { takeFight } from '@/game/sim/roamfight';
import { failDeal } from '@/game/sim/contracts';
import { bandSpiritIn } from '@/game/sim/bandspirit';
import { spiritOfIn } from '@/game/spiritrules';
import { bandRationPerDay, campSpirit, forageShare } from '@/game/roamrules';
import { roamStub } from '@/game/roamstubs';
import { seasonMods, seasonOf, dayPartAt } from '@/game/derived';
import { DAY_LENGTH } from '@/game/constants';
import { SEASONS, SEASON_MODIFIERS, SEASON_SECONDS } from '@/game/data/seasons';
import { gameDaysOfMs } from '@/game/pace';
import * as climate from '@/render/climate';
import * as weather from './weather';
import { placeWeather, regionAt, lyingSnow, CLEAR } from './weather';
import {
  bandPlace,
  campFaces,
  campGround,
  campLook,
  campRest,
  campSky,
  fireLit,
  groundOf,
  largeMen,
  openSky,
  placeForage,
  rationWeather,
  siteAt,
  siteWords,
  tierOf,
  weatherMorale,
  type Site,
} from './campsite';
import { sizeUnit, bandLook, conspicuity, fogMult } from './sight';
import { SIGHT } from './data/sight';
import { groundAt } from './place';
import { WAR_GROUND_SEED } from './pvp';
import { roamCamp, roamCellBlock, roamSeat, type RoamMove } from './roam';
import { townAt } from './roampoints';
import { SICILY } from './spawn';
import { RoamWorld, type RoamPort } from './local/RoamWorld';
import '@/game/roamdoor';

vi.mock('@/game/roamflag', () => ({ ROAM_ON: true, roamOpenFor: () => true, roamOn: () => true, setRoamOpen: () => {} }));

const T0 = Date.UTC(2026, 9, 29, 12);
/** Полоса погоды — полдня игры в мс мира. */
const SPELL_MS = (12 * 60 * 60 * 1000) / (gameDaysOfMs(24 * 3600 * 1000) * 24);

/** Часы партии: сезон `season` года 2, доля суток `frac`. */
const timeOf = (season: (typeof SEASONS)[number], frac: number): number => SEASON_SECONDS * (SEASONS.length + SEASONS.indexOf(season)) + DAY_LENGTH * (2 + frac);
const SUMMER_DAY = timeOf('summer', 0.35);
const WINTER_DAY = timeOf('winter', 0.4);

/** Клетка острова, где отряд может встать, с местом `pred` (не на постое в вольном городе). */
function cellWhere(pred: (s: Site) => boolean): Site {
  for (const p of SICILY) {
    for (let dy = -12; dy <= 12; dy++) {
      for (let dx = -12; dx <= 12; dx++) {
        const c = { x: p.x + dx, y: p.y + dy };
        if (roamCellBlock(c) !== null || townAt(c.x, c.y)) continue;
        const s = siteAt(c);
        if (pred(s)) return s;
      }
    }
  }
  throw new Error('нет такой клетки на острове');
}

const FOREST = cellWhere((s) => s.terrain === 'forest' && !s.shore && !s.ruin);
const PLAIN = cellWhere((s) => s.terrain === 'plain' && !s.shore && !s.ruin);
const SHORE = cellWhere((s) => s.terrain === 'plain' && s.shore && !s.ruin);
const RUIN = cellWhere((s) => s.terrain === 'plain' && !s.shore && s.ruin);

/** Минута мира, где погода над клеткой `at` при часах `t` отвечает `pred`. */
function minuteWhere(at: Site['at'], t: number, pred: (w: weather.Weather) => boolean): number {
  for (let i = 0; i < 4000; i++) {
    const ms = T0 + i * SPELL_MS;
    if (pred(placeWeather(at, ms, t))) return ms;
  }
  throw new Error('нет такой погоды');
}

const DRY = minuteWhere(PLAIN.at, SUMMER_DAY, (w) => w.rain === 0 && w.snow === 0 && w.fog === 0);
const RAIN = minuteWhere(PLAIN.at, WINTER_DAY, (w) => w.rain > 0.6);

/** Партия бродяги, стоящая лагерем вида `kind` в клетке `at` с часами `t` и минутой мира `now`. */
function camped(at: Site['at'], kind: 'open' | 'hidden' | 'ruin' | null, t: number, now: number, band = { spearman: 8, clubman: 4 }): GameState {
  const s = createInitialState(20261029);
  expect(beginRoam(s, { origin: 'warrior', hero: { name: 'Ратко', war: 2 }, band, purse: 100, food: 200 })).toBeNull();
  s.time = t;
  setMove(s, roamSeat(at, now));
  if (kind) {
    const m = roamCamp({ way: s.roam?.way as RoamMove['way'], camp: null }, kind, 12, now);
    expect(typeof m, `лагерь ${kind} в ${at.x}|${at.y}`).not.toBe('string');
    setMove(s, m as RoamMove);
  }
  return s;
}

describe('погода — одна дверь', () => {
  it('город и лагерь читают одну функцию: `render/climate` — реэкспорт `world/weather`, второй формулы нет', () => {
    expect(climate.weatherAt).toBe(weather.weatherAt);
    expect(climate.lyingSnow).toBe(weather.lyingSnow);
    const ROOT = join(__dirname, '..');
    const own: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const code = readFileSync(p, 'utf8');
          if (/function (weatherAt|spell|snowCover)\(/.test(code)) own.push(relative(ROOT, p).split(sep).join('/'));
        }
      }
    };
    walk(ROOT);
    expect(own).toEqual(['world/weather.ts']);
    // Дверь собирает сервер: без `@/`.
    const specs = [...readFileSync(join(ROOT, 'world/weather.ts'), 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(specs.filter((x) => x.startsWith('@/'))).toEqual([]);
  });

  it('детерминирована: то же место, та же минута, те же часы партии — та же погода; регион общий для всех его клеток', () => {
    expect(placeWeather(PLAIN.at, RAIN, WINTER_DAY)).toEqual(placeWeather(PLAIN.at, RAIN, WINTER_DAY));
    expect(regionAt(PLAIN.at)).toBe(regionAt(FOREST.at));
    expect(placeWeather(FOREST.at, RAIN, WINTER_DAY)).toEqual(placeWeather(PLAIN.at, RAIN, WINTER_DAY));
    // Часы мира двигают погоду: дождливая и сухая минуты — разные.
    expect(placeWeather(PLAIN.at, RAIN, WINTER_DAY).rain).toBeGreaterThan(0.6);
    expect(placeWeather(PLAIN.at, DRY, SUMMER_DAY).rain).toBe(0);
  });
});

describe('вид лагеря', () => {
  it('земля по клетке: лес, голое поле, берег, руины (только лагерем в них), холмы, пустыня', () => {
    const sky = campSky(PLAIN.at, DRY, SUMMER_DAY);
    expect(campLook(FOREST, sky, 'open', 10).ground).toBe('forest');
    expect(campLook(PLAIN, sky, 'open', 10).ground).toBe('field');
    expect(campLook(SHORE, sky, 'open', 10).ground).toBe('shore');
    expect(campLook(RUIN, sky, 'ruin', 10).ground).toBe('ruin');
    expect(campLook(RUIN, sky, 'open', 10).ground, 'открытым лагерем у руин — не внутри стен').toBe('field');
    expect(groundOf({ terrain: 'hills', shore: false, ruin: false }, 'open')).toBe('hills');
    expect(groundOf({ terrain: 'mountains', shore: false, ruin: false }, 'open')).toBe('hills');
    expect(groundOf({ terrain: 'desert', shore: true, ruin: false }, 'open')).toBe('desert');
    expect(siteWords(SHORE)).toBe('голое поле у воды');
  });

  it('снег на земле — по сезону и земле: летом нет, зимой — как у города', () => {
    expect(seasonOf(SUMMER_DAY)).toBe('summer');
    expect(seasonOf(WINTER_DAY)).toBe('winter');
    expect(campSky(PLAIN.at, RAIN, SUMMER_DAY).snowGround).toBe(0);
    expect(campSky(PLAIN.at, RAIN, WINTER_DAY).snowGround).toBe(lyingSnow(regionAt(PLAIN.at), RAIN, null));
  });

  it('зной — пустыня под ясным небом в тёплый сезон; зимой и не в пустыне — нет', () => {
    expect(campSky(PLAIN.at, DRY, SUMMER_DAY, 'desert').heat).toBeGreaterThan(0.5);
    expect(campSky(PLAIN.at, DRY, SUMMER_DAY, 'plain').heat).toBe(0);
    expect(campSky(PLAIN.at, DRY, WINTER_DAY, 'desert').heat).toBe(0);
  });

  it('две ступени по людям: граница — размер отряда с заметностью единица', () => {
    expect(largeMen()).toBe(sizeUnit());
    expect(tierOf(largeMen() - 1)).toBe('small');
    expect(tierOf(largeMen())).toBe('large');
  });

  it('скрытый лагерь — без огня; дождь заливает костры открытого', () => {
    const dry = campSky(PLAIN.at, DRY, SUMMER_DAY);
    const wet = campSky(PLAIN.at, RAIN, WINTER_DAY);
    expect(campLook(PLAIN, dry, 'open', 10).fire).toBe(true);
    expect(campLook(PLAIN, dry, 'hidden', 10).fire).toBe(false);
    expect(campLook(RUIN, dry, 'ruin', 10).fire).toBe(false);
    expect(campLook(PLAIN, dry, null, 10).fire).toBe(false);
    expect(wet.rain).toBeGreaterThan(0.6);
    expect(campLook(PLAIN, wet, 'open', 10).fire).toBe(false);
    expect(fireLit('open', { rain: 0.4 })).toBe(true);
    expect(fireLit('open', { rain: 0.6 })).toBe(false);
  });
});

describe('польза места — прежними дверями', () => {
  it('фураж: лес и берег кормят больше, голое поле — меньше; шаг отряда ест из обоза ровно остаток', () => {
    const dt = DAY_LENGTH / 4;
    const eaten = (at: Site['at']): number => {
      const s = camped(at, 'open', SUMMER_DAY, DRY);
      const before = s.roam?.cargo.food ?? 0;
      const r = s.roam as NonNullable<GameState['roam']>;
      const open = openSky(r.way as RoamMove['way'], DRY, s.time);
      expect(open, 'стоит под открытым небом').not.toBeNull();
      const want = ((bandRationPerDay(r, seasonMods(s).food * rationWeather(open!.sky)) * dt) / DAY_LENGTH) * (1 - forageShare(seasonMods(s), r, open));
      roamStep(s, dt, DRY);
      const got = before - (s.roam?.cargo.food ?? 0);
      expect(got).toBeCloseTo(want, 6);
      return got;
    };
    const forest = eaten(FOREST.at);
    const plain = eaten(PLAIN.at);
    const shore = eaten(SHORE.at);
    expect(placeForage(FOREST)).toBeGreaterThan(1);
    expect(placeForage(SHORE)).toBeGreaterThan(1);
    expect(placeForage(PLAIN)).toBeLessThan(1);
    expect(forest).toBeLessThan(plain);
    expect(shore).toBeLessThan(plain);
  });

  it('дождь: сбор стоит, костры гаснут, дух ниже — строкой «Непогода» и меньшей строкой «Лагерь»', () => {
    const s = camped(PLAIN.at, 'open', WINTER_DAY, RAIN);
    const r = s.roam as NonNullable<GameState['roam']>;
    const open = openSky(r.way as RoamMove['way'], RAIN, s.time);
    expect(open?.sky.rain).toBeGreaterThan(0.6);
    const lines = spiritOfIn(bandSpiritIn(s, r, RAIN)).morale.lines;
    const w = lines.find((l) => l.id === 'weather')?.value ?? 0;
    expect(w).toBeCloseTo(weatherMorale(open!.sky), 9);
    expect(w).toBeLessThan(-3);
    expect(campSpirit(r.camp, seasonMods(s), open!.sky)).toBeLessThan(campSpirit(r.camp, seasonMods(s)) * 0.5);
    const mods = seasonMods(s);
    // Фураж — та же доля, урезанная дождём (зимой поле мертво — мерим летним полем той же двери).
    const summer = SEASON_MODIFIERS.summer;
    expect(forageShare(summer, r, open)).toBeLessThan(forageShare(summer, r, { site: open!.site, sky: CLEAR }) * 0.5);
    expect(forageShare(mods, r, open)).toBe(0);
    // Сухо — строки «Непогода» нет.
    const d = camped(PLAIN.at, 'open', SUMMER_DAY, DRY);
    const dLines = spiritOfIn(bandSpiritIn(d, d.roam!, DRY)).morale.lines;
    expect(dLines.some((l) => l.id === 'weather')).toBe(false);
    // Без минуты мира (автопилот прибора) — средняя земля без неба.
    expect(spiritOfIn(bandSpiritIn(s, r, null)).morale.lines.some((l) => l.id === 'weather')).toBe(false);
  });

  it('отдых: огонь, вода и укрытие — раненые встают быстрее; шаг двигает их срок той же долей', () => {
    const h = roamStub('healOpen');
    expect(campRest('open', PLAIN, CLEAR)).toBeCloseTo(h, 9);
    expect(campRest('open', SHORE, CLEAR)).toBeCloseTo(1 + 2 * (h - 1), 9);
    expect(campRest('hidden', PLAIN, CLEAR)).toBe(1);
    expect(campRest('hidden', FOREST, CLEAR)).toBeCloseTo(h, 9);
    expect(campRest('ruin', RUIN, CLEAR)).toBeCloseTo(h, 9);
    expect(campRest('open', PLAIN, { rain: 1 })).toBe(1);
    expect(campRest(null, SHORE, CLEAR)).toBe(1);
    const dt = DAY_LENGTH / 8;
    const ahead = (at: Site['at']): number => {
      const s = camped(at, 'hidden', SUMMER_DAY, DRY);
      const until = s.time + 30 * DAY_LENGTH;
      s.roam!.wounded = [{ troops: { spearman: 2 }, until }];
      roamStep(s, dt, DRY);
      return until - (s.roam!.wounded[0]?.until ?? until);
    };
    expect(ahead(PLAIN.at), 'скрытый на голом поле — как часы').toBeCloseTo(0, 6);
    expect(ahead(SHORE.at), 'у воды — на долю удобства').toBeCloseTo(dt * (h - 1), 6);
  });

  it('снегопад дорожит паёк: ещё одна зима долей снега', () => {
    const peak = Math.max(...SEASONS.map((x) => SEASON_MODIFIERS[x].food));
    expect(rationWeather({ snow: 0 })).toBe(1);
    expect(rationWeather({ snow: 1 })).toBeCloseTo(peak, 9);
    expect(rationWeather({ snow: 0.5 })).toBeCloseTo(1 + (peak - 1) * 0.5, 9);
  });

  it('оборона: лагерь в руинах — грань кости нападающему, как холмы; открытым лагерем у руин — земля клетки', () => {
    expect(groundAt(WAR_GROUND_SEED, RUIN.at).land ?? 0, 'руины на голом поле: земля граней не даёт').toBe(0);
    expect(campGround(RUIN.at, 'ruin').land).toBe(1);
    expect(campGround(RUIN.at, 'open')).toEqual(groundAt(WAR_GROUND_SEED, RUIN.at));
    expect(campFaces(campGround(FOREST.at, 'open'))).toBe(1);
    expect(campFaces(campGround(PLAIN.at, 'hidden'))).toBe(groundAt(WAR_GROUND_SEED, PLAIN.at).crossing ?? 0);
  });

  it('туман прячет отряд — дверью `world/sight`, как ночь долей густоты', () => {
    const dawn = timeOf('autumn', 0.02);
    const foggy = minuteWhere(PLAIN.at, dawn, (w) => w.fog > 0.3);
    const m: RoamMove = { ...roamSeat(PLAIN.at, foggy), camp: { kind: 'hidden', since: foggy, builders: 12 } };
    const look = bandLook(m, 12, dawn, foggy);
    expect(look.fog).toBeGreaterThan(0.3);
    expect(dayPartAt(dawn)).not.toBe('night');
    const clear = { ...look, fog: 0 };
    expect(conspicuity(look) / conspicuity(clear)).toBeCloseTo(fogMult(look.fog ?? 0), 9);
    expect(fogMult(1)).toBe(SIGHT.night);
  });

  it('на постое в вольном городе — под крышей: места и непогоды нет; в пути — тоже', () => {
    const town = (() => {
      for (const p of SICILY) for (let d = -14; d <= 14; d++) for (let e = -14; e <= 14; e++) if (townAt(p.x + d, p.y + e)) return { x: p.x + d, y: p.y + e };
      throw new Error('нет вольного города');
    })();
    expect(openSky(roamSeat(town, RAIN).way, RAIN, WINTER_DAY)).toBeNull();
    const going = { from: PLAIN.at, to: FOREST.at, at: RAIN, until: RAIN + 3_600_000 };
    expect(bandPlace({ way: going }, RAIN + 60_000, WINTER_DAY).moving).toBe(true);
    expect(openSky(going, RAIN + 60_000, WINTER_DAY)).toBeNull();
  });
});

describe('окно «Встать лагерем» — то же, что считает игра', () => {
  const port = (s: GameState): RoamPort => ({
    band: () => s.roam ?? null,
    apply: (m) => void setMove(s, m),
    foodAfter: (ms, g) => foodAfter(s, ms, g),
    campGain: (k, open) => campGain(s, k, open),
    partyTime: () => s.time,
    prestige: () => s.prestige,
    setTrip: (t) => setTrip(s, t),
    fight: (f) => takeFight(s, f),
    failDeal: (id, why) => failDeal(s, id, why),
  });

  it('место, погода и польза каждого вида — числами тех же дверей, что шаг отряда', async () => {
    for (const [at, now, t] of [
      [SHORE.at, DRY, SUMMER_DAY],
      [PLAIN.at, RAIN, WINTER_DAY],
    ] as const) {
      const s = camped(at, null, t, now);
      const w = new RoamWorld({ seed: 20261029, storage: null, now: () => now, home: SICILY[0] }, port(s));
      const v = await w.roamCampView();
      expect(typeof v).not.toBe('string');
      if (typeof v === 'string') return;
      const open = openSky(s.roam!.way!, now, s.time);
      expect(open).not.toBeNull();
      expect(v.place).toBe(siteWords(siteAt(at)));
      const { forage, morale, weather: wx, heal, ration } = campGain(s, null, open);
      expect({ forage: v.field.forage, morale: v.field.morale, weather: v.field.weather, heal: v.field.heal, ration: v.field.ration }).toEqual({ forage, morale, weather: wx, heal, ration });
      for (const row of v.rows) {
        const g = campGain(s, row.kind, open);
        expect({ forage: row.forage, morale: row.morale, weather: row.weather, heal: row.heal, ration: row.ration }, row.kind).toEqual(g);
        expect(row.faces).toBe(campFaces(campGround(at, row.kind)));
        expect(row.fire).toBe(fireLit(row.kind, open!.sky));
      }
      // Стоит лагерем — шаг ест из обоза по фуражу открытого лагеря этого окна.
      const open0 = v.rows.find((r) => r.kind === 'open');
      expect(open0?.block).toBeNull();
    }
  });
});
