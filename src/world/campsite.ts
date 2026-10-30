// Место лагеря бродяги (ПН-12л, docs/gdd/path_of_sword.md, 3.5.3, 5.2 и «Решения ПН-12л») — одна дверь на сцену лагеря, карту, окно
// «Встать лагерем» и пользу места в шаге отряда: что за земля под лагерем, какая над ним погода, как он выглядит и что даёт.
//
//   место   — клетка общей земли: местность, берег (вода или река рядом), руины, укрытие;
//   погода  — дверь `world/weather` (регион клетки, общие часы, часы партии), плюс зной пустыни и снег на земле;
//   вид     — земля сцены, ступень по людям (малый и большой), огонь и дым, погода сцены;
//   польза  — числа, которые читают прежние двери: фураж (`roamrules.forageShare`), дух (строки «Лагерь» и «Непогода», `sim/spirit`),
//             раненые (`sim/bandwounds.hastenBandWounds`), паёк (`roamrules.bandRationPerDay`), место боя у лагеря (`place.groundAt`).
//             Заметность — дверь `world/sight` (туман там же).
//
// Своих чисел у пользы одно — делитель фуража места (`data/campsite.WILD_MEAN`, вывод `roam:report`, раздел «Лагерь по месту и
// погоде»); остальное — из прежних таблиц: промыслы дворов (`data/yards`), рыбалка — дело сбора (`data/minigames`), огонь лагеря
// (`campMorale`), холод без огня (`coldCamp`), отдых у костра (`healOpen`), зимний паёк и дрова (`SEASON_MODIFIERS`), грань холмов
// (`place.GROUND_LAND`). Модуль чистый и без `@/`: часов не читает, минута и часы партии — доводом.
import type { Coord, Terrain } from './types';
import type { Season } from '../game/types';
import type { GroundPenalty } from '../battle/types';
import type { CampKind, RoamMove, RoamWay } from './roammove';
import { terrainAt } from './geography';
import { WAR_GROUND_SEED } from './pvp';
import { hasRiver, isWaterAt } from './land';
import { ruinAt } from './ruins';
import { GROUND_LAND, groundAt } from './place';
import { lyingSnow, placeWeather, regionAt, skyWords, type Weather } from './weather';
import { roamCell, roamMoving } from './roam';
import { townAt } from './roampoints';
import { sizeUnit } from './sight';
import { WILD_MEAN } from './data/campsite';
import { SEASONS, SEASON_MODIFIERS } from '../game/data/seasons';
import { YARD_BY_JOB } from '../game/data/yards';
import { MINIGAME_BY_ID } from '../game/data/minigames';
import { seasonOf } from '../game/derived';
import { roamStub } from '../game/roamstubs';

const clamp01 = (x: number): number => (x <= 0 || !Number.isFinite(x) ? 0 : x >= 1 ? 1 : x);

// ---------- Место ----------

/** Место лагеря: клетка общей земли и то, что на ней есть. */
export interface Site {
  at: Coord;
  terrain: Terrain;
  /** У воды: в восьми соседних клетках — море, озеро или река. */
  shore: boolean;
  /** Руины в клетке (`world/ruins`). */
  ruin: boolean;
}

const AROUND: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Есть ли вода рядом с клеткой: море, озеро или река в одной из восьми соседних. */
export const shoreAt = (x: number, y: number): boolean => AROUND.some(([dx, dy]) => isWaterAt(x + dx, y + dy) || hasRiver(x + dx, y + dy));

/** Место клетки `at`. */
export function siteAt(at: Coord): Site {
  const x = Math.round(at.x);
  const y = Math.round(at.y);
  return { at: { x, y }, terrain: terrainAt(WAR_GROUND_SEED, x, y), shore: shoreAt(x, y), ruin: ruinAt(x, y) !== null };
}

// ---------- Погода над лагерем ----------

/** Погода над лагерем: погода места (`world/weather`) плюс то, что из неё и земли следует для лагеря. */
export interface CampSky extends Weather {
  season: Season;
  /** Зной, 0..1: пустыня под ясным небом не в стужу. */
  heat: number;
  /** Снег на земле, 0..1 — только вид (как у города, `ui/parts/weather.coverNow`). */
  snowGround: number;
}

/** Самая лютая стужа таблицы сезонов — дрова под открытым небом (`heating`); функцией, а не числом при загрузке модуля. */
const heatingPeak = (): number => Math.max(...SEASONS.map((x) => SEASON_MODIFIERS[x].heating));

/** Тепло сезона, 0..1: доля, на которую стужа сезона не дотягивает до самой лютой (лето, весна, осень — 1; зима — 0). */
const warmthOf = (season: Season): number => {
  const peak = heatingPeak();
  return peak > 0 ? clamp01(1 - SEASON_MODIFIERS[season].heating / peak) : 1;
};

/**
 * Погода над клеткой `at` в минуту мира `ms` при часах партии `partyTime`: погода места — дверь `world/weather`; зной — пустыня под
 * ясным небом в тёплый сезон (тепло — та же таблица дров, что холод лагеря); снег на земле — как у города, только вид.
 */
export function campSky(at: Coord, ms: number, partyTime: number, terrain: Terrain = terrainAt(WAR_GROUND_SEED, Math.round(at.x), Math.round(at.y))): CampSky {
  const w = placeWeather(at, ms, partyTime);
  const season = seasonOf(Math.max(0, partyTime));
  const heat = terrain === 'desert' ? clamp01(1 - w.cloud) * warmthOf(season) : 0;
  const snowGround = season === 'winter' ? lyingSnow(regionAt(at), ms, null) : 0;
  return { ...w, season, heat, snowGround };
}

// ---------- Польза ----------

/** Вольный промысел еды: охота и сбор — дела дворов, которые идут и без двора (`YardDef.freeRange`). */
export type WildTrade = 'hunter' | 'gatherer';

/**
 * Какие вольные промыслы держит земля: охота — где зверь (лес, горы), сбор — где растёт (вся суша, кроме пустыни). Рыбалка у воды —
 * дело сбора (`MINIGAME_BY_ID.fish.deed`): берег прибавляет ещё один сбор.
 */
export const WILD_TRADES: Readonly<Record<Terrain, readonly WildTrade[]>> = {
  forest: ['hunter', 'gatherer'],
  mountains: ['hunter'],
  hills: ['gatherer'],
  plain: ['gatherer'],
  steppe: ['gatherer'],
  desert: [],
  water: [],
};

const tradeFood = (j: WildTrade | string): number => YARD_BY_JOB.get(j as WildTrade)?.yield.food ?? 0;

/** Вольный корм места: еды на работника в игровой день — сумма промыслов земли и рыбалка у воды (базы дворов, без сезона). */
export const wildFood = (terrain: Terrain, shore: boolean): number =>
  WILD_TRADES[terrain].reduce((n, j) => n + tradeFood(j), 0) + (shore ? tradeFood(MINIGAME_BY_ID.fish.deed) : 0);

/** Средний вольный корм выборки мест — так его выводит прибор (`WILD_MEAN`). */
export const wildMeanOf = (sites: readonly Pick<Site, 'terrain' | 'shore'>[]): number =>
  sites.length ? sites.reduce((n, s) => n + wildFood(s.terrain, s.shore), 0) / sites.length : 0;

/** Фураж места — множитель к фуражу сезона: вольный корм места против среднего по земле (`WILD_MEAN`). Лес и берег — больше, поле — меньше. */
export const placeForage = (s: Pick<Site, 'terrain' | 'shore'>, mean: number = WILD_MEAN): number => (mean > 0 ? wildFood(s.terrain, s.shore) / mean : 1);

/** Доля огня: дождь заливает костры — при ливне огня нет. */
export const fireShare = (sky: Pick<Weather, 'rain'>): number => clamp01(1 - sky.rain);

/** Горят ли костры (вид сцены, карты и слова окна): открытый лагерь, и дождь не залил больше половины огня. */
export const fireLit = (kind: CampKind | null, sky: Pick<Weather, 'rain'>): boolean => kind === 'open' && fireShare(sky) > 0.5;

/** Погода в фураже: в дождь сбор и охота стоят той долей, какой льёт. */
export const weatherForage = (sky: Pick<Weather, 'rain'>): number => clamp01(1 - sky.rain);

/** Укрытие от непогоды и чужих глаз для раненых: лес над головой или стены руин, в которых встали лагерем. */
export const coverOf = (kind: CampKind | null, site: Pick<Site, 'terrain' | 'ruin'>): boolean => site.terrain === 'forest' || (kind === 'ruin' && site.ruin);

/**
 * Отдых: во сколько раз быстрее встают раненые в лагере. Удобств три — огонь (открытый лагерь, доля огня под дождём), вода рядом и
 * укрытие, — и каждое весит, как костёр открытого лагеря ПН-3 (`healOpen`): второго числа нет. Без лагеря — как в поле.
 */
export function campRest(kind: CampKind | null, site: Pick<Site, 'terrain' | 'ruin' | 'shore'>, sky: Pick<Weather, 'rain'>): number {
  if (!kind) return 1;
  const fire = kind === 'open' ? fireShare(sky) : 0;
  const comforts = fire + (site.shore ? 1 : 0) + (coverOf(kind, site) ? 1 : 0);
  return 1 + (roamStub('healOpen') - 1) * comforts;
}

/**
 * Место боя у лагеря (ГДД 3.5.1: «оборона лагеря — грань кости нападающему, как холмы»): штраф кости нападающему на клетке лагеря —
 * земля клетки (`place.groundAt`: холмы и лес — грань, горы — две), а лагерь в руинах — не меньше холмов. Рогатки — своим полем
 * (`world/roam.campThrough`).
 */
export function campGround(at: Coord, kind: CampKind | null, from?: Coord): GroundPenalty {
  const cell = { x: Math.round(at.x), y: Math.round(at.y) };
  const g = groundAt(WAR_GROUND_SEED, cell, from);
  if (kind !== 'ruin' || !ruinAt(cell.x, cell.y)) return g;
  return { ...g, land: Math.max(g.land ?? 0, GROUND_LAND.hills) };
}

/** Граней кости нападающему у лагеря — числом для окна. */
export const campFaces = (g: GroundPenalty): number => (g.land ?? 0) + (g.crossing ?? 0);

/**
 * Непогода в духе, очков морали (строка «Непогода»): дождь мочит, зной сушит — бьют, как холод лагеря без огня в самую лютую стужу
 * (`coldCamp`), сильнейшее из двух. Под крышей постоя её нет.
 */
export const weatherMorale = (sky: Pick<CampSky, 'rain' | 'heat'>): number => -roamStub('coldCamp') * Math.max(clamp01(sky.rain), clamp01(sky.heat));

/** Самый дорогой паёк таблицы сезонов (зима); функцией, а не числом при загрузке модуля. */
const foodPeak = (): number => Math.max(...SEASONS.map((x) => SEASON_MODIFIERS[x].food));

/** Паёк под снегопадом: ещё одна зима долей снега — множитель самого дорогого пайка таблицы сезонов (`SEASON_MODIFIERS.food`). */
export const rationWeather = (sky: Pick<Weather, 'snow'>): number => 1 + (foodPeak() - 1) * clamp01(sky.snow);

// ---------- Отряд в минуту ----------

/** Где стоит отряд и что над ним: место клетки, погода, идёт ли. */
export interface BandPlace {
  site: Site;
  sky: CampSky;
  moving: boolean;
}

/** Место и погода отряда с записью хода `m` в минуту мира `now` при часах партии `partyTime`. */
export function bandPlace(m: Pick<RoamMove, 'way'>, now: number, partyTime: number): BandPlace {
  const site = siteAt(roamCell(m.way, now));
  return { site, sky: campSky(site.at, now, partyTime, site.terrain), moving: roamMoving(m.way, now) };
}

/**
 * Место и погода отряда под открытым небом (ходом `way` в минуту мира `now`): стоит лагерем или в поле — место клетки и погода над
 * ней; идёт (дорога — по разной земле, окно хода считает провиант к приходу средней землёй) или стоит на постое в вольном городе (под
 * крышей) — `null`. Его читают фураж, паёк, отдых и дух в шаге отряда (`sim/roam`) и окно «Встать лагерем» — одним ответом.
 */
export function openSky(way: RoamWay, now: number, partyTime: number): BandPlace | null {
  const p = bandPlace({ way }, now, partyTime);
  if (p.moving || townAt(p.site.at.x, p.site.at.y)) return null;
  return p;
}

// ---------- Вид ----------

/** Земля сцены лагеря. Снег — поверх любой (`snow`). */
export type CampGround = 'forest' | 'field' | 'hills' | 'shore' | 'ruin' | 'desert';
/** Ступень лагеря по людям: малый — костёр и две палатки; большой — шатёр героя, обоз, коновязь, знамя с гербом. */
export type CampTier = 'small' | 'large';

export interface CampLook {
  ground: CampGround;
  tier: CampTier;
  /** Вид лагеря; стоит без лагеря или идёт — `null`. */
  kind: CampKind | null;
  /** Огонь и дым: открытый лагерь, не залитый дождём. Скрытый — без огня и дыма. */
  fire: boolean;
  /** Снег на земле, 0..1. */
  snow: number;
  /** Погода сцены. */
  sky: Weather;
  heat: number;
  /** Время года по часам партии — краски земли и листвы. */
  season: Season;
}

/** С какого числа людей лагерь большой: размер отряда, при котором его заметность — единица (`sight.sizeUnit`). */
export const largeMen = (): number => sizeUnit();

export const tierOf = (men: number): CampTier => (men >= largeMen() ? 'large' : 'small');

/** Земля сцены: лагерь в руинах — руины; пустыня; у воды — берег; лес; холмы и горы — склон; поле и степь — поле. */
export function groundOf(site: Pick<Site, 'terrain' | 'shore' | 'ruin'>, kind: CampKind | null): CampGround {
  if (kind === 'ruin' && site.ruin) return 'ruin';
  if (site.terrain === 'desert') return 'desert';
  if (site.shore) return 'shore';
  if (site.terrain === 'forest') return 'forest';
  if (site.terrain === 'hills' || site.terrain === 'mountains') return 'hills';
  return 'field';
}

/** Вид лагеря: земля по клетке, ступень по людям, огонь по виду лагеря и дождю, погода сцены. */
export function campLook(site: Site, sky: CampSky, kind: CampKind | null, men: number): CampLook {
  return {
    ground: groundOf(site, kind),
    tier: tierOf(men),
    kind,
    fire: fireLit(kind, sky),
    snow: clamp01(sky.snowGround),
    sky: { cloud: sky.cloud, rain: sky.rain, snow: sky.snow, storm: sky.storm, fog: sky.fog, wind: sky.wind, from: sky.from },
    heat: sky.heat,
    season: sky.season,
  };
}

// ---------- Слова ----------

const GROUND_WORDS: Readonly<Record<Terrain, string>> = {
  forest: 'лес',
  hills: 'холмы',
  mountains: 'горы',
  plain: 'голое поле',
  steppe: 'степь',
  desert: 'пустыня',
  water: 'вода',
};

/** Место словами: «лес у воды, руины». */
export function siteWords(site: Site): string {
  const parts = [GROUND_WORDS[site.terrain] + (site.shore ? ' у воды' : '')];
  if (site.ruin) parts.push('руины');
  return parts.join(', ');
}

/** Погода над лагерем словами: «Дождь, ветер с запада; зной». */
export function skyLine(sky: CampSky, night = false): string {
  const extra: string[] = [];
  if (sky.heat > 0.5) extra.push('зной');
  if (sky.snowGround > 0.5) extra.push('снег лежит');
  return `${skyWords(sky, night)}${extra.length ? ` · ${extra.join(', ')}` : ''}`;
}
