// Видимость отряда бродяги (ПН-4у, docs/gdd/path_of_sword.md, 3.5.4, 3.14 и «Решения ПН-4у») — одна дверь на клиент и на сервер:
//
//   заметность = местность × лагерь × размер × движение (режим марша) × ночь × туман × сезон
//   виден ли   = расстояние ≤ радиус наблюдателя × заметность
//
// Клиент по ней пишет шапку отряда («скрыт / виден») и окно лагеря; сервер по ней решает, кому из игроков показать чужой отряд и
// кто видит наш (`netlify/lib/bandsight.ts`); встречи и засады НПС (ПН-5) будут читать её же. Второй формулы видимости нет нигде —
// тест по исходникам (`sight.test.ts`). Множителей происхождения и кузни здесь нет: их дадут свои пачки (ПН-17, ПН-6).
//
// ЧТО ВИДНО. Заметность — свойство того, кого видят: где он стоит (местность клетки; руины прячут, только если отряд встал в них
// лагерем и помещается — `RUIN_CAP`, иначе укрытие пропадает), как стоит (открытый, скрытый, в руинах; без лагеря — как открытый;
// колонна в пути — режимом марша), сколько людей, ночь и сезон **его** часов (часы партии: ночь, которая прячет, — та, что отряд видит
// у себя над головой). Радиус — свойство того, кто смотрит.
//
// КТО СМОТРИТ — ровно перечисленные в ГДД 3.5.4 (`WATCHER_KINDS`): круг у замка игрока (`lookout.homeSight`), лазутчик-наблюдатель
// (свой радиус — `lookout.liveSight`), стоящий отряд бродяги и дружина в поле (`SIGHT.band`). Следопыт — множитель радиуса отряда,
// заглушкой до соратников (`roamstubs.tracker`, ПН-9). Других наблюдателей нет — тест.
//
// Числа — `world/data/sight.ts` (вывод `roam:report`) и `SEASON_MODIFIERS.camouflage`. Модуль чистый и без `@/`: часов не читает
// (минута и часы партии — доводом), его собирает сервер. Едет своим куском: первая загрузка его не знает — круги лорда живут в
// `world/lookout`.
import type { Coord, Terrain } from './types';
import type { Season } from '../game/types';
import type { Gait } from './data/gait';
import type { CampKind, RoamMove } from './roammove';
import { SIGHT, type SightTable } from './data/sight';
import { SEASON_MODIFIERS } from '../game/data/seasons';
import { dayPartAt, seasonOf } from '../game/derived';
import { gameSecondsOfMs } from '../game/pace';
import { roamStub } from '../game/roamstubs';
import { FIGURE_BY_ID } from './data/figures';
import { terrainAt } from './geography';
import { WAR_GROUND_SEED } from './pvp';
import { ruinAt } from './ruins';
import { placeWeather } from './weather';
import { homeSight } from './lookout';
import { roamCell, roamMoving } from './roam';
import { wayGait } from './roammove';

/** Как стоит отряд: лагерем своего вида, в поле без лагеря или колонной в пути режимом марша. */
export type Stance = { camp: CampKind } | { field: true } | { march: Gait };

/** Всё, от чего зависит заметность отряда в одну минуту. */
export interface Look {
  /** Местность клетки. */
  terrain: Terrain;
  /** Вместимость руин в клетке; руин нет — `null`. */
  ruinCap: number | null;
  stance: Stance;
  /** Людей в строю. */
  men: number;
  /** Ночь по часам отряда. */
  night: boolean;
  /**
   * Туман над клеткой, 0..1 (ПН-12л): погода места — дверь `world/weather` (регион клетки, общие часы, утро по часам отряда). Нет
   * поля — ясно.
   */
  fog?: number;
  /** Время года по часам отряда. */
  season: Season;
}

/** Множитель сезона — поле таблицы сезонов, нет поля — единица. */
export const seasonCamo = (season: Season): number => SEASON_MODIFIERS[season].camouflage ?? 1;

export type SightPartId = 'ground' | 'ruin' | 'stance' | 'gait' | 'size' | 'night' | 'fog' | 'season';

/** Один множитель заметности: что и сколько — для шапки и окна лагеря. */
export interface SightPart {
  id: SightPartId;
  mult: number;
  /** Словами, с маленькой буквы: «лес», «скрытый лагерь», «20 человек», «ночь», «зима». */
  words: string;
}

const TERRAIN_WORDS: Readonly<Record<Terrain, string>> = {
  forest: 'лес',
  hills: 'холмы',
  mountains: 'горы',
  plain: 'поле',
  steppe: 'степь',
  desert: 'пустыня',
  water: 'вода',
};
const CAMP_WORDS: Readonly<Record<CampKind, string>> = { open: 'открытый лагерь', hidden: 'скрытый лагерь', ruin: 'лагерь в руинах' };
const GAIT_WORDS: Readonly<Record<Gait, string>> = { light: 'налегке', normal: 'обычным маршем', train: 'с обозом' };
const SEASON_WORDS: Readonly<Record<Season, string>> = { spring: 'весна', summer: 'лето', autumn: 'осень', winter: 'зима' };

/** Множитель размера: `(люди / per) ^ pow`, не ниже `floor` — один человек почти невидим, сотня видна издалека. */
export const sizeMult = (men: number, t: SightTable = SIGHT): number => Math.max(t.size.floor, Math.pow(Math.max(0, men) / t.size.per, t.size.pow));

/** Сколько людей в отряде «единичного» размера — заметность размера у него единица (`size.per`): мерка большого лагеря (ПН-12л). */
export const sizeUnit = (t: SightTable = SIGHT): number => t.size.per;

/** Прячут ли руины: отряд встал в них лагерем и помещается. Сверх вместимости укрытие пропадает — отряд прячется, как скрытый лагерь. */
const inRuins = (l: Look): boolean => 'camp' in l.stance && l.stance.camp === 'ruin' && l.ruinCap !== null && l.men <= l.ruinCap;

/**
 * Множители заметности по одному, со словами — единственное место, где они складываются. `t` и `camo` — таблица и сезон для вывода
 * чисел (`roam:report`); игра и сервер зовут без них.
 */
export function sightParts(l: Look, t: SightTable = SIGHT, camo: (s: Season) => number = seasonCamo): SightPart[] {
  const out: SightPart[] = [];
  if (inRuins(l)) out.push({ id: 'ruin', mult: t.camp.ruin, words: CAMP_WORDS.ruin });
  else {
    out.push({ id: 'ground', mult: t.ground[l.terrain], words: TERRAIN_WORDS[l.terrain] });
    const s = l.stance;
    if ('march' in s) {
      out.push({ id: 'stance', mult: t.march, words: 'в пути' });
      out.push({ id: 'gait', mult: t.gait[s.march], words: GAIT_WORDS[s.march] });
    } else if ('camp' in s) {
      // Лагерь в руинах, переросший их или без руин под ногами, прячется, как может, — без огня.
      const kind: CampKind = s.camp === 'ruin' ? 'hidden' : s.camp;
      out.push({ id: 'stance', mult: t.camp[kind], words: s.camp === 'ruin' ? 'руины не вмещают — без огня' : CAMP_WORDS[kind] });
    } else out.push({ id: 'stance', mult: t.camp.open, words: 'стоит в поле без лагеря' });
  }
  out.push({ id: 'size', mult: sizeMult(l.men, t), words: `${Math.max(0, Math.floor(l.men))} чел.` });
  if (l.night) out.push({ id: 'night', mult: t.night, words: 'ночь' });
  // Туман (ПН-12л) прячет, как ночь, — долей своей густоты; своего числа у него нет.
  const fog = Math.max(0, Math.min(1, l.fog ?? 0));
  if (fog > 0) out.push({ id: 'fog', mult: fogMult(fog, t), words: 'туман' });
  const c = camo(l.season);
  if (c !== 1) out.push({ id: 'season', mult: c, words: SEASON_WORDS[l.season] });
  return out;
}

/** Туман густоты `fog` (0..1) — множитель заметности: прячет, как ночь (`SightTable.night`), долей густоты. */
export const fogMult = (fog: number, t: SightTable = SIGHT): number => 1 + (t.night - 1) * Math.max(0, Math.min(1, fog));

/** Заметность отряда: произведение множителей (`sightParts`). */
export const conspicuity = (l: Look, t: SightTable = SIGHT, camo: (s: Season) => number = seasonCamo): number =>
  sightParts(l, t, camo).reduce((p, x) => p * x.mult, 1);

// ---------- Кто смотрит ----------

/** Наблюдатели — ровно перечисленные в ГДД 3.5.4: круг у замка, лазутчик-наблюдатель, стоящий отряд бродяги, дружина в поле. */
export type WatcherKind = 'castle' | 'spy' | 'band' | 'army';
export const WATCHER_KINDS: readonly WatcherKind[] = ['castle', 'spy', 'band', 'army'];

export interface Watcher {
  kind: WatcherKind;
  /** Где стоит: замок — его клетка, лазутчик и отряд — клетка стоянки. */
  at: Coord;
  /** У отряда есть следопыт (соратник, ПН-9): радиус больше. До соратников его не бывает. */
  tracker?: boolean;
}

/**
 * Радиус обнаружения наблюдателя, клеток, — при заметности 1. Круг у замка — тот же, что живой обзор города (`lookout.homeSight`:
 * на месте острова — шире); лазутчик — свой обзор (`FIGURE_BY_ID.spy.sight`, тот, что даёт `lookout.liveSight` стоящему
 * наблюдателем); стоящий отряд и дружина в поле — `SIGHT.band`, со следопытом — больше (заглушка до соратников).
 */
export function watchRadius(w: Watcher, t: SightTable = SIGHT): number {
  switch (w.kind) {
    case 'castle':
      return homeSight({ x: Math.round(w.at.x), y: Math.round(w.at.y) });
    case 'spy':
      return FIGURE_BY_ID.spy.sight;
    case 'band':
    case 'army':
      return t.band * (w.tracker ? roamStub('tracker') : 1);
  }
}

/**
 * Круг замка в обычной игре (не место острова) — мерка «на сколько клеток видно отряд», которой говорят шапка отряда, окно лагеря и
 * цели обнаружения прибора (ГДД 3.5.4).
 */
export const CASTLE_EYE: Watcher = { kind: 'castle', at: { x: 0, y: 0 } };

/** На каком расстоянии наблюдатель видит отряд заметности `c`, клеток. */
export const detectRange = (w: Watcher, c: number, t: SightTable = SIGHT): number => watchRadius(w, t) * Math.max(0, c);

/** Видит ли наблюдатель отряд заметности `c`, стоящий в `at`. */
export const sees = (w: Watcher, at: Coord, c: number, t: SightTable = SIGHT): boolean =>
  Math.hypot(at.x - w.at.x, at.y - w.at.y) <= detectRange(w, c, t);

// ---------- Отряд в минуту ----------

/** Часы партии отряда в минуту мира `now` по отметке «какие были часы и когда» (сервер ставит её по событию). */
export const partyTimeAt = (clock: { time: number; at: number }, now: number): number => clock.time + gameSecondsOfMs(Math.max(0, now - clock.at));

/**
 * Как отряд выглядит в минуту мира `now`: клетка и местность — из записи хода (`roam.roamCell`), стоит ли он и как (лагерь, в поле,
 * в пути режимом марша), руины под ногами, люди строя, ночь и сезон — по часам партии отряда `partyTime` (игровые секунды), туман —
 * погодой места (`world/weather.placeWeather`, ПН-12л).
 */
export function bandLook(m: RoamMove, men: number, partyTime: number, now: number): Look {
  const at = roamCell(m.way, now);
  const moving = roamMoving(m.way, now);
  const ruin = ruinAt(at.x, at.y);
  const stance: Stance = moving ? { march: wayGait(m.way) } : m.camp ? { camp: m.camp.kind } : { field: true };
  const t = Math.max(0, partyTime);
  const fog = placeWeather(at, now, t).fog;
  return {
    terrain: terrainAt(WAR_GROUND_SEED, at.x, at.y),
    ruinCap: ruin ? ruin.cap : null,
    stance,
    men: Math.max(0, Math.floor(men)),
    night: dayPartAt(t) === 'night',
    season: seasonOf(t),
    ...(fog > 0 ? { fog } : {}),
  };
}

/** Кто из наблюдателей видит отряд с этим видом, стоящий в `at`. */
export const seenBy = <W extends Watcher>(watchers: readonly W[], at: Coord, look: Look): W[] => {
  const c = conspicuity(look);
  return watchers.filter((w) => sees(w, at, c));
};
