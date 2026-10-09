/**
 * «Рыбалка» — правило (docs/minigames.md, раздел 17): берег, заброс, поплавок, поклёвка, подсечка и вываживание.
 *
 * ЗДЕСЬ НЕТ НИ THREE, НИ ЧАСОВ. Время приходит доводом — секунды сцены с «Начать». Всё, что решает игра, — где
 * трава и коряга, какая рыба клюнет на этот заброс и сколько она весит, когда поплавок дрогнет впустую и когда утонет
 * по-настоящему, как рыба рвётся в стороны, — чистая функция от зерна, номера заброса и того, что сделал игрок.
 *
 * ВЫВАЖИВАНИЕ ИДЁТ НЕИЗМЕННЫМ ШАГОМ (`STEP`), А НЕ КАДРОМ — как полёт стрелы «Охоты». Палец лёг, снят, удилище увели в
 * сторону — это вести со своей секундой; правило доходит до неё тиками и с того тика держит новое. Тот же ряд вестей —
 * та же рыба при любой частоте кадров (тест): порвётся леска или нет, не зависит от того, как часто рисует телефон.
 *
 * Своих чисел у сцены нет: где упадёт поплавок, она спрашивает здесь (`castPoint`), натяжение и расстояние до рыбы —
 * тоже (`Fishing.line`). Сцена только рисует и слушает.
 */
import type { Season } from '@/game/types';
import type { Zone } from '@/render/climate';
import { mixSeed } from '@/game/sim/random';
import { seeded } from './rules';

// ---------- Берег ----------

/** У воды: река у города или берег моря. */
export type Shore = 'river' | 'sea';

/** Где ловят: берег, климатический пояс региона (`render/climate.zoneOf`) и сезон города. */
export interface Setting {
  shore: Shore;
  zone: Zone;
  season: Season;
}

/** Линия воды у своего берега, м по Z: игрок стоит в нуле лицом к −Z, вода — с этой черты (в два шага: кромка — в кадре). */
export const BANK_Z = -2.4;
/** Дальний берег реки — линия воды, м по Z. У моря его нет. */
export const FAR_BANK_Z = -30;
/** Рыба у самого берега — вытащена: столько метров лески от черты воды. */
export const LAND_D = 1.4;

/** Заброс: ближе и дальше не бросить, м; слабее этой доли силы — грузило падает у ног. */
export const CAST_MIN = 3.5;
export const CAST_MAX = 22;
export const CAST_WEAK = 0.12;
/** Куда можно бросить: не дальше этого угла от прямо, рад (рыскание, как у камеры: плюс — влево). */
export const CAST_ARC = 0.75;

/** Сколько летит поплавок: чем дальше, тем дольше. */
export const flightS = (d: number): number => 0.35 + 0.035 * d;

/** Течение реки сносит поплавок вправо (+X), м/с, и не дальше этого. Море поплавок только качает. */
export const DRIFT = 0.22;
export const DRIFT_MAX = 3.2;

/** Куда направлен заброс: единичный вектор по земле для рыскания `yaw` (0 — прямо, к −Z; плюс — влево). */
export const dirOf = (yaw: number): { x: number; z: number } => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

/** Где упадёт поплавок при силе `power` (0..1) и рыскании `yaw`: та же функция у правила и у метки на воде. */
export function castPoint(power: number, yaw: number): { x: number; z: number; d: number } {
  const p = Math.max(0, Math.min(1, power));
  const a = Math.max(-CAST_ARC, Math.min(CAST_ARC, yaw));
  const dir = dirOf(a);
  let d = CAST_MIN + (CAST_MAX - CAST_MIN) * p;
  // У реки дальний берег ближе, чем сильный заброс вбок: поплавок падает в воду у его кромки, а не на траву.
  const room = (BANK_Z - FAR_BANK_Z - 1.2) / Math.max(0.2, -dir.z);
  d = Math.min(d, room);
  return { x: dir.x * d, z: BANK_Z + dir.z * d, d };
}

// ---------- Места на воде ----------

/** Место на воде: трава (камыш у реки, камни в водорослях у моря), коряга (у моря — скала) и омут (глубина). */
export interface Spot {
  x: number;
  z: number;
  /** Ядро: в траву и в корягу заброс цепляется (`hang`); у омута ядра нет — он только глубже. */
  r: number;
}

export interface Field {
  weeds: Spot;
  snag: Spot;
  deep: Spot;
}

/** Край травы и коряги: столько метров вокруг ядра щука и окунь стоят в засаде. */
export const EDGE = 2.6;

/** Места от зерна: трава у своего берега сбоку, коряга посередине с другой стороны, омут вдали. */
export function layField(seed: number): Field {
  const rnd = seeded(mixSeed(seed, 0x0f15));
  const side = rnd() < 0.5 ? -1 : 1;
  const at = (yaw: number, d: number, r: number): Spot => {
    const dir = dirOf(yaw);
    return { x: dir.x * d, z: BANK_Z + dir.z * d, r };
  };
  return {
    weeds: at(side * (0.42 + 0.16 * rnd()), 5.5 + 2.5 * rnd(), 2.4),
    snag: at(-side * (0.12 + 0.3 * rnd()), 10.5 + 3.5 * rnd(), 1.3),
    deep: at((rnd() - 0.5) * 0.6, 16.5 + 3 * rnd(), 4.5),
  };
}

/** Что за место у точки на воде: ближняя вода, край травы или коряги, омут; в ядре травы и коряги — зацеп. */
export interface SpotTags {
  near: boolean;
  weeds: boolean;
  snag: boolean;
  deep: boolean;
  hang: boolean;
}

export function spotAt(f: Field, x: number, z: number): SpotTags {
  const d = Math.hypot(x, z - BANK_Z);
  const to = (s: Spot): number => Math.hypot(x - s.x, z - s.z);
  return {
    near: d < 7,
    weeds: to(f.weeds) < f.weeds.r + EDGE,
    snag: to(f.snag) < f.snag.r + EDGE,
    deep: to(f.deep) < f.deep.r,
    hang: to(f.weeds) < f.weeds.r || to(f.snag) < f.snag.r,
  };
}

// ---------- Рыбы ----------

/** Как рыба берёт: топит поплавок, кладёт его (лещ поднимает насадку со дна) или уводит в сторону (хищник). */
export type BiteKind = 'dip' | 'lift' | 'run';

export type FishId =
  | 'roach'
  | 'perch'
  | 'bream'
  | 'pike'
  | 'burbot'
  | 'trout'
  | 'carp'
  | 'mullet'
  | 'sargo'
  | 'bass'
  | 'mackerel'
  | 'dentex'
  | 'herring'
  | 'cod'
  | 'flounder'
  | 'pollock';

export interface FishDef {
  id: FishId;
  /** Имя в отклике и в итоге. */
  name: string;
  shore: Shore;
  /** В каких поясах водится и насколько часто, доля; нет пояса — не водится. */
  zones: Partial<Record<Zone, number>>;
  /** Сезон: множитель частоты; нет — как обычно, ноль — не клюёт. */
  seasons?: Partial<Record<Season, number>>;
  /** Вес, кг: обычный улов — от и до; трофей — выше верхнего. */
  min: number;
  max: number;
  /** Сила рывка в долях прочности лески — у рыбы среднего веса, на свежих силах. */
  pull: number;
  /** Выносливость: за сколько секунд выматывается при среднем натяжении. */
  tire: number;
  /** Ложных поклёвок до настоящей: от и до. */
  nibble: [number, number];
  /** Сколько секунд ждать поклёвки: от и до. */
  wait: [number, number];
  /** Окно подсечки, с: столько поплавок под водой, прежде чем рыба выплюнет насадку. */
  window: number;
  bite: BiteKind;
  /** Выпрыгивает из воды на рывке. */
  jumps?: boolean;
  /** Где держится: множитель частоты у ближней воды, у травы, у коряги, в омуте. */
  likes: Partial<Record<'near' | 'weeds' | 'snag' | 'deep', number>>;
}

/**
 * Рыбы позднего средневековья — что ловили с берега удочкой. Река: плотва, окунь, лещ и щука везде; налим — в холод;
 * форель — в холодных и океанских реках севера; карп — в тёплых (его разводили в монастырских прудах). Море: тёплое
 * (Средиземное) — кефаль, ласкирь, лаврак, скумбрия и зубан; холодное (Балтика и Северное) — сельдь, треска, камбала
 * и сайда. Числа — дизайна, строкой довода в docs/minigames.md, 17.2.
 */
export const FISH: readonly FishDef[] = [
  // Река.
  { id: 'roach', name: 'Плотва', shore: 'river', zones: { med: 1, dry: 1, ocean: 1, land: 1, north: 1 }, min: 0.08, max: 0.32, pull: 0.25, tire: 3.5, nibble: [1, 3], wait: [2.2, 6], window: 0.6, bite: 'dip', likes: { near: 1.6, weeds: 1.3, deep: 0.6 } },
  { id: 'perch', name: 'Окунь', shore: 'river', zones: { med: 0.6, dry: 0.5, ocean: 0.8, land: 0.8, north: 0.9 }, min: 0.12, max: 0.6, pull: 0.42, tire: 4.5, nibble: [0, 1], wait: [2, 5.5], window: 0.7, bite: 'dip', likes: { snag: 3, weeds: 1.6, near: 0.8 } },
  { id: 'bream', name: 'Лещ', shore: 'river', zones: { med: 0.4, dry: 0.3, ocean: 0.5, land: 0.6, north: 0.4 }, seasons: { winter: 0.4 }, min: 0.6, max: 2.4, pull: 0.62, tire: 7, nibble: [1, 2], wait: [3.5, 9], window: 1.1, bite: 'lift', likes: { deep: 3.5, near: 0.25 } },
  { id: 'pike', name: 'Щука', shore: 'river', zones: { med: 0.15, dry: 0.12, ocean: 0.25, land: 0.3, north: 0.35 }, seasons: { spring: 1.4, autumn: 1.5 }, min: 1.4, max: 5.5, pull: 0.88, tire: 8, nibble: [0, 1], wait: [3, 8], window: 0.85, bite: 'run', jumps: true, likes: { weeds: 4, snag: 1.5, near: 0.6, deep: 0.6 } },
  { id: 'burbot', name: 'Налим', shore: 'river', zones: { ocean: 0.3, land: 0.4, north: 0.6 }, seasons: { winter: 2.4, autumn: 0.6, spring: 0.2, summer: 0 }, min: 0.6, max: 2.2, pull: 0.55, tire: 6, nibble: [0, 1], wait: [3.5, 9], window: 0.9, bite: 'dip', likes: { deep: 2.5, snag: 1.8 } },
  { id: 'trout', name: 'Форель', shore: 'river', zones: { ocean: 0.45, north: 0.55, land: 0.15 }, seasons: { winter: 0.5 }, min: 0.3, max: 1.6, pull: 0.65, tire: 5, nibble: [0, 2], wait: [2.5, 7], window: 0.6, bite: 'dip', jumps: true, likes: { snag: 1.6, deep: 1.2, near: 0.7 } },
  { id: 'carp', name: 'Карп', shore: 'river', zones: { med: 0.4, dry: 0.45, land: 0.3 }, seasons: { winter: 0.2, summer: 1.3 }, min: 1, max: 4.5, pull: 0.85, tire: 9, nibble: [1, 3], wait: [4.5, 10], window: 1.0, bite: 'lift', likes: { weeds: 2, deep: 1.6, near: 0.4 } },
  // Тёплое море.
  { id: 'mullet', name: 'Кефаль', shore: 'sea', zones: { med: 1, dry: 1 }, min: 0.3, max: 1.5, pull: 0.6, tire: 5, nibble: [2, 3], wait: [2.5, 7], window: 0.6, bite: 'dip', jumps: true, likes: { near: 1.4, weeds: 1.3 } },
  { id: 'sargo', name: 'Ласкирь', shore: 'sea', zones: { med: 1.1, dry: 1 }, min: 0.1, max: 0.42, pull: 0.3, tire: 3.5, nibble: [1, 3], wait: [2, 5.5], window: 0.5, bite: 'dip', likes: { weeds: 2, snag: 1.6 } },
  { id: 'bass', name: 'Лаврак', shore: 'sea', zones: { med: 0.35, dry: 0.3, ocean: 0.25 }, min: 0.8, max: 4, pull: 0.85, tire: 8, nibble: [0, 1], wait: [3, 8], window: 0.75, bite: 'run', jumps: true, likes: { snag: 3, weeds: 1.5, deep: 1.2 } },
  { id: 'mackerel', name: 'Скумбрия', shore: 'sea', zones: { med: 0.6, dry: 0.5, ocean: 0.6 }, seasons: { winter: 0.2, summer: 1.4 }, min: 0.2, max: 0.6, pull: 0.48, tire: 3.5, nibble: [0, 1], wait: [2, 5], window: 0.5, bite: 'run', likes: { deep: 2, near: 0.5 } },
  { id: 'dentex', name: 'Зубан', shore: 'sea', zones: { med: 0.1, dry: 0.08 }, min: 1.5, max: 6, pull: 0.95, tire: 9, nibble: [0, 1], wait: [4, 9], window: 0.8, bite: 'run', likes: { deep: 3, snag: 2, near: 0.2 } },
  // Холодное море.
  { id: 'herring', name: 'Сельдь', shore: 'sea', zones: { ocean: 1, land: 1, north: 1 }, min: 0.1, max: 0.35, pull: 0.26, tire: 3, nibble: [0, 2], wait: [2, 5.5], window: 0.5, bite: 'dip', likes: { deep: 1.5, near: 1 } },
  { id: 'cod', name: 'Треска', shore: 'sea', zones: { ocean: 0.5, land: 0.4, north: 0.6 }, seasons: { winter: 1.3, summer: 0.7 }, min: 1, max: 5, pull: 0.78, tire: 8, nibble: [0, 1], wait: [3.5, 9], window: 0.9, bite: 'dip', likes: { deep: 3, snag: 1.5, near: 0.3 } },
  { id: 'flounder', name: 'Камбала', shore: 'sea', zones: { ocean: 0.6, land: 0.7, north: 0.5 }, min: 0.3, max: 1.4, pull: 0.48, tire: 5, nibble: [1, 2], wait: [3, 8], window: 1.0, bite: 'lift', likes: { near: 1.6, deep: 0.8 } },
  { id: 'pollock', name: 'Сайда', shore: 'sea', zones: { ocean: 0.4, north: 0.5, land: 0.2 }, min: 0.5, max: 3, pull: 0.72, tire: 6.5, nibble: [0, 1], wait: [2.5, 7], window: 0.7, bite: 'run', jumps: false, likes: { snag: 2.4, weeds: 1.4 } },
];

export const FISH_BY_ID = Object.fromEntries(FISH.map((f) => [f.id, f])) as Record<FishId, FishDef>;

/** Трофей: редко — раз на двадцать рыб; весит больше верхнего обычного, до двух с лишним раз. */
export const TROPHY_P = 0.05;
export const TROPHY_FROM = 1.15;
export const TROPHY_SPAN = 0.6;

/** Как часто рыба клюёт здесь вообще — без места: пояс и сезон. */
export function baseRate(f: FishDef, s: Setting): number {
  if (f.shore !== s.shore) return 0;
  return (f.zones[s.zone] ?? 0) * (f.seasons?.[s.season] ?? 1);
}

/** Как часто клюёт на этом месте: пояс, сезон и что любит рыба. */
export function rateAt(f: FishDef, s: Setting, tags: SpotTags): number {
  let k = baseRate(f, s);
  for (const key of ['near', 'weeds', 'snag', 'deep'] as const) if (tags[key]) k *= f.likes[key] ?? 1;
  return k;
}

/** Рыбы этого берега и пояса в этот сезон — их и рисует, и ловит сцена. */
export const poolOf = (s: Setting): FishDef[] => FISH.filter((f) => baseRate(f, s) > 0);

/** Средний вес рыбы с учётом трофеев: обычный улов чаще мелкий (`u^1.6`), трофей — в полтора верхних. */
export function meanWeight(f: FishDef): number {
  const usual = f.min + (f.max - f.min) / 2.6;
  const trophy = f.max * (TROPHY_FROM + TROPHY_SPAN / 2);
  return (1 - TROPHY_P) * usual + TROPHY_P * trophy;
}

/**
 * Цель — столько граммов, сколько весят в среднем четыре рыбы этого берега, пояса и сезона. Выведена из таблицы рыб и их
 * частот, а не подобрана: где рыба тяжелее (треска холодного моря, лещ и карп реки), там и цель тяжелее, и ни один берег не
 * выгоднее другого «вообще».
 */
export const GOAL_FISH = 4;

export function goalGrams(s: Setting): number {
  const pool = poolOf(s);
  const total = pool.reduce((n, f) => n + baseRate(f, s), 0);
  const mean = pool.reduce((n, f) => n + (baseRate(f, s) / total) * meanWeight(f), 0);
  return Math.max(100, Math.round((GOAL_FISH * mean * 1000) / 100) * 100);
}

// ---------- Вываживание ----------

/** Шаг правила, с: вываживание считается им, а не кадром. */
export const STEP = 1 / 120;
/** Натяжение тянется к своей цели с этой постоянной, с: леска не рвётся от одного кадра. */
export const TAU = 0.2;
/** Подтягиваешь — к рывку рыбы прибавляется своя сила катушки. */
export const REEL_LOAD = 0.28;
/** Отпустил — катушка трещит и отдаёт леску: натяжение — эта доля рывка. */
export const DRAG_K = 0.55;
/** Катушка выбирает леску, м/с, когда рыба не тянет; рыба забирает её, м/с, на полном рывке. */
export const REEL_V = 2.6;
export const RUN_V = 3.4;
/** Рыба, тянущая сильнее этого, не даёт выбрать ни сантиметра: катушка крутится вхолостую, натяжение растёт. */
export const REEL_HOLD = 0.6;
/** Рывок слабее этого лески не забирает: рыба стоит. */
export const RUN_FLOOR = 0.15;
/** Удилище против рывка гасит натяжение на эту долю, по рывку — добавляет. */
export const ROD_K = 0.3;
/** Леска выдерживает натяжение 1 не дольше, с; слабина ниже `SLACK_T` дольше `SLACK_S` — крючок выпадает. */
export const SNAP_S = 0.4;
export const SLACK_T = 0.1;
export const SLACK_S = 1.8;
/** Длина лески на катушке, м: ушла вся — рвётся. */
export const LINE_MAX = 40;
/** Как быстро рыба уходит вбок на рывке, рад/с, и докуда. */
export const SIDE_W = 0.32;
export const SIDE_MAX = 0.85;
/** Насколько натяжение выматывает рыбу: множитель к доле «натяжение / выносливость». */
export const TIRE_K = 1.6;

/** Сколько длится вытащенная рыба в руке, заброс назад после промаха и зацеп. */
export const SHOW_S = 1.7;
export const BACK_S = 0.7;
export const HANG_S = 1.4;

/** Рыба на крючке: что за рыба, сколько весит, трофей ли. */
export interface Hooked {
  def: FishDef;
  /** Граммы. */
  grams: number;
  trophy: boolean;
  /** Сила рывка в долях прочности лески — у этой рыбы, на свежих силах. */
  pull: number;
  /** Выносливость этой рыбы, с. */
  tire: number;
}

/** Отрезок поведения на крючке: рывок в сторону (`side`: −1 влево по экрану, 1 вправо, 0 — прочь) или передышка. */
export interface Surge {
  t0: number;
  t1: number;
  /** Сила — доля `pull` рыбы. */
  k: number;
  side: -1 | 0 | 1;
  /** Выпрыгнет в начале рывка. */
  jump: boolean;
}

/** План одного заброса: какая рыба подойдёт, когда дрогнет впустую, когда возьмёт и сколько держит. */
export interface BitePlan {
  fish: Hooked;
  /** Секунды от падения поплавка: ложные поклёвки — начала. */
  nibbles: number[];
  bite: number;
  window: number;
}

/** Вес рыбы, её сила и выносливость — от жребия. Средний вес рыбы — сила `pull`; тяжелее — сильнее. */
export function hookedOf(def: FishDef, u: number, trophyRoll: number): Hooked {
  const trophy = trophyRoll < TROPHY_P;
  const kg = trophy ? def.max * (TROPHY_FROM + TROPHY_SPAN * u) : def.min + (def.max - def.min) * u ** 1.6;
  const mid = (def.min + def.max) / 2;
  const pull = Math.max(0.12, Math.min(1.2, def.pull * (kg / mid) ** 0.35));
  const tire = def.tire * (kg / mid) ** 0.3;
  return { def, grams: Math.round(kg * 1000), trophy, pull, tire };
}

/** Сколько рыба стоит, засечённая, прежде чем броситься: столько у игрока, чтобы увидеть рывок и отпустить. */
export const HOOK_PAUSE = 0.35;

/**
 * Поведение на крючке — от зерна рыбы: миг замешательства (`HOOK_PAUSE`), рывок прочь, дальше передышки и рывки
 * вперемешку.
 */
export function surgesOf(seed: number, fish: Hooked, from: number): Surge[] {
  const rnd = seeded(seed);
  const out: Surge[] = [{ t0: from, t1: from + HOOK_PAUSE, k: 0.3, side: 0, jump: false }];
  let t = from + HOOK_PAUSE;
  let rest = false;
  let lastSide: -1 | 0 | 1 = 0;
  for (let i = 0; i < 80; i++) {
    if (rest) {
      const dur = 0.8 + 1.0 * rnd();
      out.push({ t0: t, t1: t + dur, k: 0.18 + 0.1 * rnd(), side: 0, jump: false });
      t += dur;
    } else {
      const dur = 1.0 + 1.4 * rnd();
      // Вбок чаще, чем прочь, и чаще в другую сторону, чем в прошлый раз: рыба мечется.
      const r = rnd();
      const side: -1 | 0 | 1 = i === 0 ? 0 : r < 0.18 ? 0 : lastSide !== 0 && r < 0.72 ? ((-lastSide) as -1 | 1) : r < 0.86 ? -1 : 1;
      if (side !== 0) lastSide = side;
      const jump = !!fish.def.jumps && i > 0 && rnd() < 0.35;
      out.push({ t0: t, t1: t + dur, k: 0.85 + 0.25 * rnd(), side, jump });
      t += dur;
    }
    rest = !rest;
  }
  return out;
}

// ---------- Ход игры ----------

export type Phase = 'idle' | 'charge' | 'flight' | 'wait' | 'hang' | 'back' | 'fight' | 'show';

/** Что случилось: сцене — звук, брызги и подпись. Забирается один раз (`takeEvents`). */
export type FishEvent =
  | { kind: 'cast'; t: number; power: number }
  | { kind: 'weak'; t: number }
  | { kind: 'land'; t: number; x: number; z: number }
  | { kind: 'hang'; t: number; x: number; z: number }
  | { kind: 'nibble'; t: number; x: number; z: number }
  | { kind: 'bite'; t: number; x: number; z: number }
  | { kind: 'early'; t: number }
  | { kind: 'missed'; t: number }
  | { kind: 'hooked'; t: number; x: number; z: number }
  | { kind: 'surge'; t: number; side: -1 | 0 | 1; jump: boolean }
  | { kind: 'snap'; t: number }
  | { kind: 'slack'; t: number }
  | { kind: 'caught'; t: number; fish: Hooked };

/** Леска на вываживании: что видно и что решает. */
export interface Line {
  /** Метров лески от черты воды до рыбы. */
  dist: number;
  /** Натяжение, 0..1; единица — предел лески. */
  tension: number;
  /** Силы рыбы, 0..1. */
  stamina: number;
  /** Куда ушла рыба: рыскание от прямо, рад. */
  bearing: number;
  /** Держат ли катушку. */
  reeling: boolean;
  /** Удилище вбок: −1 влево, 1 вправо. */
  rod: number;
  /** Отрезок поведения сейчас. */
  surge: Surge | null;
}

/** Рыба в садке. */
export interface Catch {
  def: FishDef;
  grams: number;
  trophy: boolean;
}

export class Fishing {
  readonly field: Field;
  readonly setting: Setting;
  readonly goal: number;
  private seed: number;
  phase: Phase = 'idle';
  /** Секунда, с которой идёт нынешняя фаза. */
  since = 0;
  /** До какой секунды правило дошло тиками. */
  private now = 0;
  private events: FishEvent[] = [];
  /** Сколько раз забрасывали: зерно заброса — от зерна игры и его номера. */
  casts = 0;
  /** Нынешний заброс: куда упал и что там ждёт. */
  land: { x: number; z: number; d: number } | null = null;
  plan: BitePlan | null = null;
  /** Последняя показанная ложная поклёвка заброса. */
  private nibbleSeen = -1;
  private surges: Surge[] = [];
  private surgeAt = 0;
  line: Line | null = null;
  private over = 0;
  private slack = 0;
  /** Рыба, что сейчас на крючке или в руке. */
  fish: Hooked | null = null;
  readonly catches: Catch[] = [];

  constructor(seed: number, setting: Setting) {
    this.seed = seed >>> 0;
    this.setting = setting;
    this.field = layField(this.seed);
    this.goal = goalGrams(setting);
  }

  // ---------- Вести игрока ----------

  /** Палец лёг (или пробел): у готовой удочки — замах, на ожидании — подсечка, на вываживании — подтягивать. */
  press(t: number): void {
    this.advance(t);
    if (this.phase === 'idle') this.enter('charge', this.now);
    else if (this.phase === 'wait') this.strike();
    else if (this.phase === 'fight' && this.line) this.line.reeling = true;
  }

  /**
   * Палец снят: из замаха — заброс с силой `power` в сторону `yaw`; на вываживании — отдать леску. `cast: false` —
   * жест отобрали: замах снимается без заброса.
   */
  release(t: number, power: number, yaw: number, cast = true): void {
    this.advance(t);
    if (this.phase === 'charge') {
      if (!cast) {
        this.enter('idle', this.now);
        return;
      }
      if (!(power >= CAST_WEAK)) {
        this.events.push({ kind: 'weak', t: this.now });
        this.enter('idle', this.now);
        return;
      }
      this.land = castPoint(power, yaw);
      this.casts += 1;
      this.events.push({ kind: 'cast', t: this.now, power });
      this.enter('flight', this.now);
    } else if (this.phase === 'fight' && this.line) this.line.reeling = false;
  }

  /** Удилище вбок: −1 влево по экрану, 1 вправо. */
  steer(t: number, rod: number): void {
    this.advance(t);
    if (this.line) this.line.rod = Math.max(-1, Math.min(1, rod));
  }

  takeEvents(): FishEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ---------- Тики ----------

  /** Дойти до секунды `t` тиками. Кадр зовёт каждый раз; вести — перед тем как сменить ввод. */
  advance(t: number): void {
    while (this.now + STEP <= t + 1e-9) {
      this.now += STEP;
      this.tick(this.now);
    }
  }

  private enter(phase: Phase, t: number): void {
    this.phase = phase;
    this.since = t;
  }

  private tick(t: number): void {
    const age = t - this.since;
    switch (this.phase) {
      case 'flight':
        if (this.land && age >= flightS(this.land.d)) this.splash(t);
        break;
      case 'wait':
        this.waitTick(t, age);
        break;
      case 'hang':
        if (age >= HANG_S) this.enter('back', t);
        break;
      case 'back':
        if (age >= BACK_S) this.reset(t);
        break;
      case 'fight':
        this.fightTick(t);
        break;
      case 'show':
        if (age >= SHOW_S) this.reset(t);
        break;
      default:
        break;
    }
  }

  private reset(t: number): void {
    this.land = null;
    this.plan = null;
    this.line = null;
    this.fish = null;
    this.enter('idle', t);
  }

  /** Поплавок упал: в траву или корягу — зацеп; в воду — план поклёвок этого заброса. */
  private splash(t: number): void {
    const land = this.land!;
    const tags = spotAt(this.field, land.x, land.z);
    if (tags.hang) {
      this.events.push({ kind: 'hang', t, x: land.x, z: land.z });
      this.enter('hang', t);
      return;
    }
    this.events.push({ kind: 'land', t, x: land.x, z: land.z });
    this.plan = this.planAt(tags);
    this.nibbleSeen = -1;
    this.enter('wait', t);
  }

  /** Какая рыба подойдёт и когда: жребий заброса — от зерна игры и номера заброса. */
  planAt(tags: SpotTags): BitePlan {
    const rnd = seeded(mixSeed(this.seed, 0x5eed + this.casts));
    const pool = FISH.map((f) => ({ f, w: rateAt(f, this.setting, tags) })).filter((x) => x.w > 0);
    const total = pool.reduce((n, x) => n + x.w, 0);
    let pick = rnd() * total;
    let def = pool[pool.length - 1].f;
    for (const x of pool) {
      pick -= x.w;
      if (pick < 0) {
        def = x.f;
        break;
      }
    }
    const fish = hookedOf(def, rnd(), rnd());
    // Ждать дольше зимой и в омуте: в холод рыба вялая, в глубине — осторожная.
    const slow = (this.setting.season === 'winter' ? 1.35 : 1) * (tags.deep ? 1.12 : 1);
    const bite = (def.wait[0] + (def.wait[1] - def.wait[0]) * rnd()) * slow;
    const n = def.nibble[0] + Math.floor(rnd() * (def.nibble[1] - def.nibble[0] + 1));
    const nibbles: number[] = [];
    for (let i = 0; i < n; i++) {
      // Ложные — между падением и поклёвкой, не вплотную к ней: подсёкший на дрожь подсёк впустую.
      const at = 0.9 + (bite - 1.6) * ((i + 0.3 + 0.5 * rnd()) / n);
      if (at > 0.6 && at < bite - 0.7) nibbles.push(at);
    }
    return { fish, nibbles, bite, window: def.window };
  }

  private waitTick(t: number, age: number): void {
    const plan = this.plan!;
    const at = this.floatAt(t);
    for (let i = this.nibbleSeen + 1; i < plan.nibbles.length; i++) {
      if (age >= plan.nibbles[i]) {
        this.nibbleSeen = i;
        this.events.push({ kind: 'nibble', t, x: at.x, z: at.z });
      }
    }
    if (age >= plan.bite && age - STEP < plan.bite) this.events.push({ kind: 'bite', t, x: at.x, z: at.z });
    if (age >= plan.bite + plan.window) {
      this.events.push({ kind: 'missed', t });
      this.enter('back', t);
    }
  }

  /** Подсечка: в окне — рыба на крючке; раньше — впустую, насадка уходит из-под носа. */
  private strike(): void {
    const t = this.now;
    const plan = this.plan!;
    const age = t - this.since;
    if (age < plan.bite) {
      this.events.push({ kind: 'early', t });
      this.enter('back', t);
      return;
    }
    const at = this.floatAt(t);
    this.fish = plan.fish;
    this.surges = surgesOf(mixSeed(this.seed, 0xf1540 + this.casts), plan.fish, t);
    this.surgeAt = 0;
    const d = Math.hypot(at.x, at.z - BANK_Z);
    this.line = {
      dist: d,
      tension: 0.35,
      stamina: 1,
      bearing: Math.atan2(-at.x, -(at.z - BANK_Z)),
      reeling: true,
      rod: 0,
      surge: null,
    };
    this.over = 0;
    this.slack = 0;
    this.events.push({ kind: 'hooked', t, x: at.x, z: at.z });
    this.enter('fight', t);
  }

  private surgeOf(t: number): Surge {
    while (this.surgeAt < this.surges.length - 1 && this.surges[this.surgeAt].t1 <= t) this.surgeAt++;
    return this.surges[this.surgeAt];
  }

  private fightTick(t: number): void {
    const L = this.line!;
    const fish = this.fish!;
    const sg = this.surgeOf(t);
    if (sg !== L.surge) {
      L.surge = sg;
      if (sg.side !== 0 || sg.k > 0.5) this.events.push({ kind: 'surge', t, side: sg.side, jump: sg.jump });
    }
    const pull = fish.pull * sg.k * (0.3 + 0.7 * L.stamina);
    // Удилище против рывка гасит натяжение, по рывку — добавляет: рыбу водят, а не тянут.
    const opp = -L.rod * sg.side;
    const load = pull * (1 - ROD_K * opp);
    const target = L.reeling ? load + REEL_LOAD : load * DRAG_K;
    L.tension += (target - L.tension) * (1 - Math.exp(-STEP / TAU));
    if (L.reeling) L.dist -= REEL_V * STEP * Math.max(0, 1 - load / REEL_HOLD);
    else L.dist += RUN_V * STEP * Math.max(0, load - RUN_FLOOR);
    // Вбок: рывок уводит рыбу в свою сторону; на передышке она тянется обратно к прямо.
    L.bearing += -sg.side * SIDE_W * STEP * (pull / fish.pull);
    if (sg.side === 0) L.bearing *= 1 - 0.08 * STEP;
    L.bearing = Math.max(-SIDE_MAX, Math.min(SIDE_MAX, L.bearing));
    // Устаёт рыба от натяжения: держишь крепко — выматываешь быстрее, удилище против рывка — ещё быстрее.
    const drain = (0.02 + TIRE_K * L.tension * (opp > 0 ? 1.5 : 1) * (L.reeling ? 1 : 0.6)) / fish.tire;
    L.stamina = Math.max(0, L.stamina - drain * STEP);
    if (L.tension >= 1) this.over += STEP;
    else this.over = 0;
    if (L.tension < SLACK_T) this.slack += STEP;
    else this.slack = 0;
    if (this.over >= SNAP_S || L.dist >= LINE_MAX) {
      this.events.push({ kind: 'snap', t });
      this.lose(t);
    } else if (this.slack >= SLACK_S) {
      this.events.push({ kind: 'slack', t });
      this.lose(t);
    } else if (L.dist <= LAND_D) {
      this.catches.push({ def: fish.def, grams: fish.grams, trophy: fish.trophy });
      this.events.push({ kind: 'caught', t, fish });
      this.enter('show', t);
    }
  }

  private lose(t: number): void {
    this.line = null;
    this.fish = null;
    this.enter('back', t);
  }

  // ---------- Что видно ----------

  /** Где поплавок в секунду `t` после падения: река сносит его вправо, у моря он стоит. */
  floatAt(t: number): { x: number; z: number } {
    const land = this.land;
    if (!land) return { x: 0, z: BANK_Z };
    const age = Math.max(0, t - this.since);
    const drift = this.setting.shore === 'river' && this.phase === 'wait' ? Math.min(DRIFT_MAX, DRIFT * age) : 0;
    return { x: land.x + drift, z: land.z };
  }

  /** Где рыба на вываживании — по лучу от черты воды. */
  fishAt(): { x: number; z: number } | null {
    const L = this.line;
    if (!L) return null;
    const dir = dirOf(L.bearing);
    return { x: dir.x * L.dist, z: BANK_Z + dir.z * L.dist };
  }

  /** Сколько граммов в садке. */
  get grams(): number {
    return this.catches.reduce((n, c) => n + c.grams, 0);
  }

  /** Счёт: граммы в садке до цели — доля, что уйдёт в начисление, не выше единицы. */
  tally(): { got: number; total: number } {
    return { got: Math.min(this.grams, this.goal), total: this.goal };
  }
}
