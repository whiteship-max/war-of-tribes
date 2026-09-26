// Режиссура ролика о бое: журнал → раскадровка. Проигрыватель журнала, а не
// второй симулятор.
//
// Бой уже посчитан детерминированно и оставил журнал именованных событий по
// фазам и секторам. Отсюда берётся всё: когда камера едет, к какому сектору она
// подаётся, сколько фигур стоит и сколько уже лежит. Кубиков здесь нет, вызова
// симуляции нет, `Math.random` нет — и это держит тест, читающий исходник.
//
// Причина не архитектурная, а игровая: если картинка считает сама, она рано или
// поздно разойдётся с отчётом, и игрок увидит, как его конница смяла фланг, а
// в отчёте прочитает обратное. Это тот же принцип, что «карточка вида и фигура
// выводятся из одного снаряжения».
//
// Модуль живёт в `battle/` и, как весь этот каталог, не зависит ни от чего
// снаружи: сервер соберёт ту же раскадровку у себя, а клиент покажет её по
// журналу, приехавшему с сервера. Готовая раскадровка (`Cast`) самодостаточна:
// проигрывателю итог боя больше не нужен, ему хватает её одной.
import { describeEvent } from './log';
import {
  FRONT,
  REAR,
  SECTORS,
  UNIT_KINDS,
  type BattleEvent,
  type BattleResult,
  type EventId,
  type Lane,
  type PhaseId,
  type Sector,
  type Side,
  type Stack,
  type UnitKind,
} from './types';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
/** Плавный вход и выход: скорость на стыке ключей — ноль, поэтому склейки не видно. */
const ease = (u: number): number => u * u * (3 - 2 * u);
const other = (side: Side): Side => (side === 'attacker' ? 'defender' : 'attacker');
const SIDES2: readonly Side[] = ['attacker', 'defender'];

// ---------- Сколько фигур ----------

/**
 * Потолок фигур на сторону. Сотни бойцов на телефоне не сосчитать, а рисовать
 * их дорого — та же причина, по которой у костра стоит не больше `MAX_VILLAGERS` жителей, а не
 * всё племя.
 */
export const FIGURE_CAP = 44;

/** Меньше этого сторона не показывается, пока в ней есть хоть один боец. */
export const FIGURE_MIN = 3;

/**
 * Сколько фигур ставится за столько бойцов. Корень с потолком: разница между
 * двадцатью и двумя сотнями обязана быть видна, а между пятью сотнями и тысячей
 * — уже нет, там всё равно «толпа до горизонта».
 *
 * Во второй пачке функция станет настоящей (масса, глубина строя, древки);
 * пока она нарочно одна и вынесена сюда, чтобы менять её в одном месте.
 */
export function figureCount(men: number): number {
  if (men <= 0) return 0;
  return Math.min(FIGURE_CAP, Math.max(FIGURE_MIN, Math.round(Math.sqrt(men) * 2)));
}

/** Сколько фигур стоит в кадре близкого плана: горстка с каждой стороны. */
export const MUSTER_FIGURES = 7;

// ---------- Поле ----------

/**
 * Геометрия поля в метрах сцены. Общая и для камеры, и для расстановки фигур:
 * два набора чисел разъехались бы, и камера подавалась бы мимо сектора.
 *
 * Наша сторона всегда на −Z, чужая на +Z, полосы идут по X. Полоса 0 — левый
 * фланг со стороны своей армии, поэтому чужой сектор полосы l стоит там же, где
 * наш сектор полосы 2−l: это и есть `facing` симуляции.
 */
export const FIELD = {
  /** Шаг между полосами. */
  laneW: 3.3,
  /** Расстояние от центра до фронта, пока строи не сошлись. */
  frontZ: 5,
  /** И когда сошлись. */
  contactZ: 1.4,
  /** Тыл за своим фронтом. */
  rowGap: 3.4,
  /** Резерв за тылом. */
  reserveGap: 3.6,
} as const;

// ---------- Строй ----------

/** Интервал в шеренге: плечом к плечу. */
export const FILE_STEP = 0.62;
/** Дистанция между рядами: чуть больше интервала. */
export const RANK_STEP = 0.74;

/**
 * Глубина строя растёт с числом БОЙЦОВ, не фигур. Фигур на сторону всегда не
 * больше `FIGURE_CAP`, и массы по ним не видно; а ряды видно сразу — сотня
 * стоит в два ряда, восемь сотен в четыре.
 *
 * Больше `MAX_RANKS` нельзя: блок вылезет за `FIELD.rowGap` и сядет на тыловой
 * сектор своей же полосы. Это проверяется тестом, а не помнится наизусть.
 */
export const RANK_MEN = 30;
export const MAX_RANKS = 4;

export function ranksFor(men: number, figures: number): number {
  if (figures <= 1) return 1;
  const byMen = Math.min(MAX_RANKS, Math.max(1, Math.floor(Math.log2(Math.max(1, men) / RANK_MEN)) + 1));
  // Глубже, чем позволяет число фигур, строй не ставим: три фигуры в четыре
  // ряда — это колонна по одному, а не строй.
  return Math.max(1, Math.min(byMen, Math.round(Math.sqrt(figures))));
}

/** Насколько блок уходит назад от своей передней шеренги. */
export const blockDepth = (ranks: number): number => Math.max(0, ranks - 1) * RANK_STEP;

// ---------- Масса ----------

/**
 * Одно знамя на столько бойцов. Знамёна можно сосчитать глазами, и это честная
 * единица измерения: три знамени против одного объясняют расклад без цифр.
 * Точное число при этом всё равно стоит цифрой в строке состояния — знамя
 * показывает порядок, а не подменяет счёт.
 */
export const BANNER_MEN = 50;

export const bannersFor = (men: number): number => (men > 0 ? Math.max(1, Math.round(men / BANNER_MEN)) : 0);

/**
 * Древков на фигуру. Их ставится больше, чем людей, — и это не украшение:
 * у реального строя издалека видно именно лес древков, а не лица. Один
 * инстансированный примитив, один вызов отрисовки.
 *
 * Плотность зависит от рода: копейная стена — сплошной частокол, у лучников
 * торчат луки. **У конницы леса нет вовсе, и это ноль, а не малое число.**
 * Всадник виден целиком — конь под ним крупнее любой пехоты, — и древко рядом
 * с ним читается не оружием невидимого бойца, а палкой, которую никто не
 * держит. Ставить его туда нельзя ни на каком плане.
 */
export const SHAFTS_PER_FIGURE: Record<UnitKind, number> = {
  spear: 3.2,
  infantry: 2,
  archer: 1.4,
  cavalry: 0,
  heavy: 0,
};

/**
 * Доля леса древков, показанная на момент `t`.
 *
 * Лес — это оружие бойцов, которых не нарисовали. На близком плане таких бойцов
 * в кадре нет: там видно горстку, и каждый держит своё оружие сам. Древко без
 * носителя посреди пустой травы читается как «копья держит никто» и разваливает
 * весь строй. Поэтому лес включается только с отъездом — там же, где прячется
 * вся остальная смена подробности: в движении камеры.
 */
export function crowdAt(cast: Cast, t: number): number {
  const pull = cast.acts[1];
  if (t <= pull.from) return 0;
  if (t >= pull.to) return 1;
  return ease((t - pull.from) / (pull.to - pull.from));
}

export function shaftsFor(byFace: readonly FaceCount[]): number {
  let n = 0;
  for (const f of byFace) n += f.figures * SHAFTS_PER_FIGURE[f.kind];
  return Math.round(n);
}

/**
 * Рост бойца строя. То же число, что в `render/units.ts`, и это одна величина,
 * а не две: тест сверяет их. Ядру она нужна, чтобы посчитать, насколько крупно
 * боец виден, — от этого зависит, можно ли подменить его древком.
 */
export const MAN_HEIGHT = 1.05;

/**
 * Экран, под который посчитан ролик: портрет телефона. Считать по настоящему
 * размеру канвы нельзя — тогда один и тот же журнал давал бы разные кадры на
 * разных устройствах, а это первое правило ролика. Все числа камеры подобраны
 * под этот же экран, так что мерка честная.
 */
export const REF_SCREEN_H = 812;

/**
 * Порог леса по видимому размеру бойца: пока он крупнее `off`, леса нет вовсе;
 * мельче `on` — лес полон.
 *
 * Это и есть та граница, на которой силуэт перестаёт читаться и подмена
 * становится незаметной: у бойца мельче `on` уже не видно, держит он
 * древко или нет, а у бойца крупнее `off` — видно, и лес рядом с ним читается
 * древками без хозяина. Такт камеры такой границей не был: на среднем плане
 * фигуры ещё большие, а лес по такту уже стоял.
 */
export const SHAFT_PX = { off: 90, on: 60 } as const;

/** Сколько пикселей занимает боец, стоящий в `d` метрах от камеры. */
export function manPixels(shot: CameraShot, d: number, screenH: number = REF_SCREEN_H): number {
  const frame = 2 * Math.max(0.1, d) * Math.tan((shot.fov * Math.PI) / 360);
  return (MAN_HEIGHT / frame) * screenH;
}

/** Доля показанного леса при таком видимом размере бойца: 0 у `off`, 1 у `on`. */
export const shaftShare = (px: number): number =>
  ease(clamp01((SHAFT_PX.off - px) / (SHAFT_PX.off - SHAFT_PX.on)));

/**
 * Радиус тёмного пятна под строем. Площадь пропорциональна числу бойцов, а не
 * фигур: масса должна читаться и там, где фигур мало, — двадцать против пятисот
 * это ровно тот случай.
 */
export const DUST_PER_MAN = 0.055;
export const dustRadius = (men: number): number => (men > 0 ? Math.sqrt(men * DUST_PER_MAN) : 0);

// ---------- Земля и свет ----------

/**
 * Где и когда идёт бой. Ядро эти поля не считает и ничем на них не отвечает —
 * оно только несёт их в раскадровке, чтобы показу больше ничего не было нужно.
 * Ровно как `Face.id`: смысл им придаёт тот, кто рисует.
 *
 * Выводит их чистая функция моста (`game/battle/ground.ts`) из записи боя, а не
 * показ из мира. Иначе ролик перестал бы быть самодостаточным ровно тогда,
 * когда журнал приедет с сервера: земля и свет добирались бы из чужой карты.
 */
export interface Ground {
  /** Что под ногами: ровное поле, холмы или берег. */
  land: 'plain' | 'hills' | 'shore';
  /** Через поле идёт река. */
  river: boolean;
  /** На реке брод — отмель, по которой её переходят. */
  ford: boolean;
  /** Гребень: за строем земля обрывается, и войско стоит на фоне неба. */
  ridge: boolean;
  /** Тракт поперёк поля. */
  road: boolean;
  /** Опушка: стена леса по краю расчистки. */
  woods: boolean;
  /** Снег: зимний бой — другое зрелище, а не то же самое посветлее. */
  winter: boolean;
  /**
   * Доля суток для света: 0 — рассвет, 0.25 — полдень, 0.5 — закат. Та же мера,
   * которой живёт деревня (`solarPhase`), поэтому риг у боя и у неё общий.
   */
  solar: number;
  /** Сид травы, деревьев и камней: та же запись боя — то же поле до кустика. */
  seed: number;
}

/**
 * Ровное поле в полдень. Столько и знает запись боя, сделанная до того, как
 * место стали записывать: выдумывать ей брод и закат нельзя — она про них
 * ничего не говорила, — а показать её надо.
 */
export const PLAIN_GROUND: Ground = {
  land: 'plain',
  river: false,
  ford: false,
  ridge: false,
  road: false,
  woods: false,
  winter: false,
  solar: 0.25,
  seed: 0,
};

// ---------- Поле после боя ----------

/**
 * Сколько брошенного оставляет после себя одна павшая фигура: щит из руки,
 * копьё, воткнувшееся в землю, шлем. Больше единицы нарочно — за фигурой стоят
 * люди, которых не нарисовали, и поле после боя обязано выглядеть полем после
 * боя, а не паузой с лежачими.
 */
export const WRECK_PER_FALLEN = 2.6;

export const wreckFor = (fallen: number): number => Math.round(Math.max(0, fallen) * WRECK_PER_FALLEN);

// ---------- Действие ----------

/** Сколько летит залп от выстрела до прилёта, секунд. */
export const VOLLEY_FLIGHT = 2.2;

/**
 * На сколько залпов раскладывается стрельба стороны. Событие `volley` подводит
 * итог всей стрелковой фазы и стоит на тике первого столкновения («выбили N до
 * столкновения»), а стреляли — в стрелковой фазе, туда залпы и кладутся. Рвать
 * их на десяток мелких незачем: три дуги в небе читаются, десять сливаются.
 */
export const VOLLEY_SHOTS = 3;

/** Сколько длится удар конницы: разгон, удар, возврат. */
export const CHARGE_SECONDS = 2.6;
/** Насколько далеко клин выносит вперёд от своего места. */
export const CHARGE_REACH = 0.72;

/** Сколько бегущий сектор уходит с поля и как далеко. */
export const FLEE_SECONDS = 5;
export const FLEE_DIST = 7;

/**
 * Замирание на первом столкновении. Три кадра почти неподвижности дороже
 * любого числа полигонов: вес движения и есть то, что читается как сила удара.
 */
export const CLASH_HOLD = { seconds: 1.1, slow: 0.12 };
/** Сколько держится вспышка удара — по ней рисуется пыль. */
export const IMPACT_SECONDS = 1.4;

/** Летящий залп: откуда, куда, насколько долетел и сколько в нём стрел. */
export interface Volley {
  side: Side;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  /** 0 — только сошёл с тетивы, 1 — прилетел. */
  u: number;
  /** Кого он выбил: по этому числу считается густота пачки. */
  men: number;
}

export type Row = 'front' | 'rear' | 'reserve';

export const rowOf = (s: Sector): Row =>
  s === 'R' ? 'reserve' : FRONT.includes(s as never) ? 'front' : 'rear';

/** Полоса сектора: A/D — 0, B/E — 1, C/F — 2; у резерва полосы нет. */
export const laneOf = (s: Sector): Lane | null =>
  s === 'R' ? null : ((FRONT.indexOf(s as never) + REAR.indexOf(s as never) + 1) as Lane);

/** Насколько фронт выдвинут вперёд при данном сближении. */
export const frontDist = (closing: number): number =>
  FIELD.frontZ + (FIELD.contactZ - FIELD.frontZ) * clamp01(closing);

/**
 * Где на поле стоит сектор. `us` — сторона игрока: она всегда на −Z, чтобы
 * ролик показывал бой глазами того, кто его смотрит.
 */
export function sectorSpot(
  side: Side,
  us: Side,
  sector: Sector,
  closing: number,
): { x: number; z: number } {
  const sign = side === us ? -1 : 1;
  const lane = laneOf(sector);
  const x = lane === null ? 0 : sign === -1 ? (lane - 1) * FIELD.laneW : (1 - lane) * FIELD.laneW;
  const row = rowOf(sector);
  const d =
    frontDist(closing) +
    (row === 'front' ? 0 : row === 'rear' ? FIELD.rowGap : FIELD.rowGap + FIELD.reserveGap);
  return { x, z: sign * d };
}

// ---------- Камера ----------

/**
 * Положение камеры на кадре. Точками, а не углами: между двумя ключами всё
 * интерполируется покомпонентно, и ход выходит непрерывным сам собой.
 *
 * Числа подобраны под телефон в портрете (390 px). У three.js `fov`
 * вертикальный, а узкая сторона в портрете — горизонтальная, поэтому
 * стратегический план стоит дальше, чем кажется нужным по высоте кадра.
 */
export interface CameraShot {
  x: number;
  y: number;
  z: number;
  atX: number;
  atY: number;
  atZ: number;
  fov: number;
}

/**
 * Близкий план: камера у земли, за нашим левым флангом; видно горстку с обеих
 * сторон. Смотрит чуть вниз, а не по горизонту: в портрете кадр высокий, и
 * ровный взгляд отдаёт полэкрана пустому небу.
 *
 * Взгляд поднят настолько, чтобы горизонт стоял в верхней трети, а не под самым
 * краем. Это и есть кадр залпа: стрелы идут по дуге над головами, и увидеть их
 * можно только против неба — над зелёным полем они читаются хворостом. Ниже
 * опускать нельзя, выше — тоже: полэкрана пустого неба стоит ровно столько же,
 * сколько полэкрана пустой травы.
 */
const SHOT_MUSTER: CameraShot = { x: -5.9, y: 2.6, z: -12.4, atX: -3.1, atY: 1.5, atZ: -4.4, fov: 38 };

/** Тот же план чуть позже: камера уже пошла, но ещё внизу. */
const SHOT_MUSTER_END: CameraShot = { x: -5.5, y: 3.9, z: -12.8, atX: -2.8, atY: 1.35, atZ: -3.6, fov: 40 };

/**
 * Стратегический план: видны оба войска и все шесть секторов. Наклон подобран
 * так, чтобы вверху кадра оставалась полоска неба: отвесный взгляд превращает
 * бой в зелёную схему, а горизонт — единственное, что говорит «это поле».
 */
const SHOT_FIELD: CameraShot = { x: 0, y: 9.3, z: -17.5, atX: 0, atY: 0.9, atZ: 1.6, fov: 50 };

/** Спуск в конце — половина пути вниз. */
const SHOT_DOWN: CameraShot = { x: 0.8, y: 6, z: -15.5, atX: 0.3, atY: 0.7, atZ: -1.5, fov: 48 };

/**
 * Финал: камера снова у земли — последнее знамя, бегущие, поле. Стоит она за
 * своим строем и смотрит поверх него на линию соприкосновения: там лежит всё,
 * что осталось от боя, и ради этого кадр и нужен. Ниже и ближе — и вместо поля
 * после боя в кадре стена спин уцелевших.
 */
const SHOT_LAST: CameraShot = { x: 3, y: 2.9, z: -12.4, atX: 0.2, atY: 0.5, atZ: 0.6, fov: 42 };

/** Подача к сектору на стратегическом плане: камера смещается, но плана не меняет. */
function shotAt(spot: { x: number; z: number }): CameraShot {
  return {
    x: spot.x * 0.25,
    y: 8.7,
    z: -16.9,
    atX: spot.x * 0.45,
    atY: 0.9,
    atZ: spot.z * 0.4 + 1.6,
    fov: 48,
  };
}

// ---------- Такты ----------

/**
 * Четыре такта — четыре положения камеры. Один непрерывный ход: близко →
 * отъезд → поле → снова близко. Склейки нет ни одной: она читается как другая
 * сцена, а непрерывность — как «та же битва, шире взгляд».
 */
export type Act = 'muster' | 'pullback' | 'melee' | 'rout';
export const ACTS: readonly Act[] = ['muster', 'pullback', 'melee', 'rout'];

/** Какие фазы боя укладываются в какой такт. */
export const ACT_PHASES: Record<Act, readonly PhaseId[]> = {
  muster: ['ranged'],
  pullback: ['approach'],
  melee: ['clash', 'lines', 'flanking', 'reserve', 'morale'],
  rout: ['retreat', 'pursuit'],
};

const ACT_OF = (() => {
  const map = {} as Record<PhaseId, Act>;
  for (const act of ACTS) for (const p of ACT_PHASES[act]) map[p] = act;
  return map;
})();

/** Близкий план — три-пять секунд: дольше нечего показывать, короче не разглядеть. */
export const MUSTER_SECONDS = 4;
/** Отъезд: на нём и становится видно соотношение сил. */
export const PULLBACK_SECONDS = 6;
/** Спуск к полю в конце. */
export const ROUT_SECONDS = 6;
/**
 * Бой линий. Длину задаёт **спорность боя**, а не число событий в журнале.
 *
 * Раньше её задавали метки — и мера оказалась плохой. Числа этого не скрывали:
 * ровный бой шёл 56 секунд, разгром пятисот двадцатью — 49.6. Шесть секунд
 * разницы никто не назовёт «коротким разгромом», а обещание «короткие бои
 * остаются короткими» держалось на слове. Причина простая: разгром пишет в
 * журнал почти столько же строк, сколько ровный бой, — просто все они об одном.
 *
 * Спорность — то самое, что игрок и хочет пересмотреть подольше: обе стороны
 * платили. Разгром платила одна, смотреть там нечего, и он обрывается намного
 * раньше сам собой (`meleeSeconds`).
 *
 * `perMark` осталось, но перестало быть длиной: теперь это **потолок по
 * содержанию**. Камере в бою линий резать не на что, кроме меток журнала, и
 * ролик не должен идти дольше, чем журналу есть чем его занять. Связывает это
 * только очень бедный журнал: у обычного потолок `min + perMark × метки` уже выше `max`.
 *
 * Пустой журнал при этом от размера боя не зависит — тридцать бойцов на
 * сторону пишут его так же полно, как три тысячи. Он бывает у зеркального
 * состава без стрелков и конницы; условия и что с ними делать при PvP — в
 * `docs/BATTLE_SYSTEM_FOR_CLAUDE.md`, раздел о пустом журнале.
 */
export const MELEE_SECONDS = { min: 14, max: 54, perMark: 4 };

/** Ближе этого камера к новому сектору не подаётся: иначе она мечется. */
export const MARK_HOLD = 2.0;
/** Сколько держится подпись события. */
export const CAPTION_HOLD = 2.6;

// ---------- Раскадровка ----------

export interface Keyframe {
  t: number;
  act: Act;
  shot: CameraShot;
}

/** Событие журнала, положенное на время и на место. */
export interface Mark {
  t: number;
  tick: number;
  phase: PhaseId;
  act: Act;
  id: EventId;
  side: Side;
  sector: Sector | null;
  lane: Lane | null;
  /**
   * Сколько людей стоит за событием: выбитых залпом, вырубленных конницей,
   * вошедших резервом. У события без числа — ноль. По нему показ решает, какой
   * густоты рисовать залп, а не выдумывает её.
   */
  amount: number;
  text: string;
}

/**
 * Кто именно стоит в строю: метка, род боя и сколько людей. **Ядро метку не
 * читает** — оно только делит фигуры в той же пропорции, в какой стоят люди.
 * Что означает `id`, знает тот, кто рисует: у племени это вид бойца или
 * ополчение, у сервера — что он туда положит.
 *
 * Так ядро остаётся ядром: `Face` для него — строка с весом, ровно как `Sector`
 * для него буква. А раскадровка остаётся самодостаточной: всё, что нужно
 * картинке, лежит в ней, и второго входа у показа нет.
 */
export interface Face {
  id: string;
  kind: UnitKind;
  men: number;
}

/** Столько фигур этой метки стоит в секторе. */
export interface FaceCount {
  id: string;
  kind: UnitKind;
  figures: number;
}

/** Сектор расстановки как объект показа: сколько фигур, каких, когда побежал. */
export interface CastSector {
  side: Side;
  sector: Sector;
  lane: Lane | null;
  row: Row;
  /** Бойцов на старте и к концу боя — из итога, а не из пересчёта. */
  men: number;
  finalMen: number;
  /** Фигуры по видам; сумма — `figures`. */
  byFace: FaceCount[];
  figures: number;
  /** Строй сектора: сколько рядов в глубину и сколько человек в шеренге. */
  ranks: number;
  files: number;
  /** Знамён, древков и радиус пятна массы — на полный сектор. */
  banners: number;
  shafts: number;
  dust: number;
  /** Ранг удалённости от кадра близкого плана: по нему фигуры и проявляются. */
  rank: number;
  /** Когда сектор побежал — из события журнала. null — не бежал. */
  brokenAt: number | null;
}

/** Фаза боя, положенная на время ролика. */
export interface Span {
  phase: PhaseId;
  act: Act;
  from: number;
  to: number;
  t0: number;
  t1: number;
  losses: Record<Side, number>;
  /** Те же потери по секторам, если журнал их знает. */
  bySector?: Record<Side, Partial<Record<Sector, number>>>;
}

export interface ActWindow {
  act: Act;
  from: number;
  to: number;
}

export interface Cast {
  /** Сторона игрока: она всегда на −Z и называется «наши». */
  us: Side;
  seed: number;
  /**
   * Журнал знает потери по секторам на каждую фазу. Тогда фланг, выбитый за одну
   * фазу, и тает за одну фазу. У записей боя, посчитанных до появления
   * `PhaseSpan.bySector`, этого нет, и сектор тает по общему ходу потерь стороны.
   */
  detailed: boolean;
  seconds: number;
  /** Где и когда идёт бой: земля, снег и час. Ядро их не читает, показ — читает. */
  ground: Ground;
  /** Слои музыки по тактам. Звук идёт отсюда, а не решает сам. */
  music: MusicCue[];
  acts: ActWindow[];
  spans: Span[];
  keys: Keyframe[];
  marks: Mark[];
  sectors: CastSector[];
  /** Бойцов и фигур на стороне на старте. */
  men: Record<Side, number>;
  figures: Record<Side, number>;
  /** Кто удержал поле — чтобы финальный кадр знал, чьё знамя стоит. */
  winner: Side | 'draw';
}

// ---------- Музыка ----------

/**
 * Слой музыки. Не три разных куска, а **один и тот же материал в трёх
 * плотностях**: только барабаны, гармония без мелодии, полный трек. Ролик их
 * переключает, а не склеивает встык, — поэтому дорожки обязаны быть одной
 * длины, одного темпа и с общего начала, иначе переход слышен швом.
 */
export type MusicLayer = 'drums' | 'harmony' | 'full' | 'silence';

/**
 * Какой слой на каком такте. Таблица, а не условия по коду: звук правится без
 * правки логики, ровно как баланс правится в `battle/config.ts`.
 *
 * Тишина в конце — не «музыка кончилась», а решение: после боя обрыв, и уже на
 * тишине падает знамя. Громкому финалу верят меньше, чем тихому.
 */
export const MUSIC_BY_ACT: Record<Act, MusicLayer> = {
  muster: 'drums',
  pullback: 'harmony',
  melee: 'full',
  rout: 'silence',
};

/** Смена слоя: с какой секунды ролика и что звучит. */
export interface MusicCue {
  at: number;
  layer: MusicLayer;
}

/**
 * Последовательность слоёв ролика. Тот же журнал — та же последовательность:
 * звук ничего не решает сам, он идёт из раскадровки, как камера и как масса.
 * Подряд идущие одинаковые слои не повторяются — смена есть смена.
 */
export function musicCues(acts: readonly ActWindow[]): MusicCue[] {
  const out: MusicCue[] = [];
  for (const win of acts) {
    const layer = MUSIC_BY_ACT[win.act];
    if (out.length > 0 && out[out.length - 1].layer === layer) continue;
    out.push({ at: win.from, layer });
  }
  return out;
}

/** Что звучит на секунде `t`. */
export function musicAt(cues: readonly MusicCue[], t: number): MusicLayer {
  let layer: MusicLayer = 'silence';
  for (const cue of cues) {
    if (cue.at > t) break;
    layer = cue.layer;
  }
  return layer;
}

// ---------- Управление ----------

/**
 * Кнопки кадра. Управление живёт в раскадровке, а не в разметке: «Пропустить»
 * обязана быть на каждом кадре, и проверить это можно только тогда, когда она
 * есть в данных. В JSX ролика не пишется ни одной кнопки — так же, как в
 * карточке вида не пишется ни одного множителя.
 *
 * Переключателя звука здесь больше нет. Он стоял тут же, рядом с «Пропустить», и
 * был единственным местом, откуда музыку вообще включали, — а теперь она живёт в
 * настройках, в профиле. Два рычага на одну настройку расходятся ровно тогда,
 * когда правят один из них, поэтому старый убран целиком, а не спрятан.
 */
export interface Control {
  id: 'skip';
  label: string;
  /** Куда ведёт. Пока одно место — отчёт цифрами. */
  goes: 'report';
}

export const SKIP: Control = { id: 'skip', label: 'Пропустить', goes: 'report' };
const CONTROLS: readonly Control[] = [SKIP];

// ---------- Кадр ----------

export interface SectorFrame {
  side: Side;
  sector: Sector;
  lane: Lane | null;
  row: Row;
  byFace: FaceCount[];
  /** Строй блока: ряды в глубину и человек в шеренге. Масса ставится по нему же. */
  ranks: number;
  files: number;
  /** Сколько фигур поставлено сейчас: на близком плане — кусок строя, дальше — всё. */
  figures: number;
  /** Сколько из них на ногах; остальные лежат. */
  standing: number;
  /**
   * Сколько брошенного лежит на месте сектора: щиты, воткнутые копья, шлемы.
   * Считается от павших, то есть от потерь журнала, — картинка своего числа
   * убитых не заводит.
   */
  wreck: number;
  /**
   * Насколько крупно виден боец этого сектора, в пикселях эталонного экрана.
   * От него, а не от такта камеры, зависит лес древков: подмена невидимого
   * бойца древком допустима только там, где её не поймать глазом.
   */
  manPx: number;
  /** Масса на этом кадре: она проявляется вместе с фигурами и тает вместе с ними. */
  banners: number;
  shafts: number;
  dust: number;
  /** Сектор уже побежал — по журналу. */
  broken: boolean;
  /**
   * Насколько сектор уже убежал, 0..1. Паника в журнале есть (`sector-broken`,
   * `panic-spread`) — здесь она только изображается: бегут не все разом, а по
   * очереди, как записано, и каждый со своего мгновения.
   */
  flee: number;
  /** Куда блок сейчас смещён: разгон конницы и уход бегущих. */
  dx: number;
  dz: number;
  x: number;
  z: number;
}

export interface SideFrame {
  /** Бойцов ещё живо. */
  men: number;
  figures: number;
  standing: number;
  /** Знамён в кадре: их считают глазами, поэтому число обязано сходиться. */
  banners: number;
}

export interface Frame {
  t: number;
  act: Act;
  phase: PhaseId;
  tick: number;
  shot: CameraShot;
  /** 0 — строи врозь, 1 — сошлись. */
  closing: number;
  /** К какому сектору подана камера. */
  focus: { side: Side; sector: Sector; lane: Lane | null } | null;
  caption: string | null;
  sectors: SectorFrame[];
  side: Record<Side, SideFrame>;
  /** Залпы, что сейчас в небе. Пустой список — стрелять некому или уже нечем. */
  volleys: Volley[];
  /**
   * Копья опущены: 0 — древки вверх, 1 — наперевес. Опускаются они разом, и
   * это и есть замах перед ударом.
   */
  couch: number;
  /**
   * Время для поз. Не совпадает с `t`: на первом столкновении ход почти
   * замирает (`CLASH_HOLD`), и удар от этого весит больше, чем от любого
   * числа полигонов. Функция от `t` и потому воспроизводима.
   */
  poseTime: number;
  /** Вспышка удара, 1 → 0: по ней поднимается пыль. */
  impact: number;
  /**
   * Сколько леса древков показано: 0 на близком плане, 1 после отъезда. Древко
   * без видимого носителя появляется только тогда, когда носителей в кадре и
   * так больше, чем нарисовано.
   */
  crowd: number;
  /** Какой слой музыки звучит на этом кадре. */
  music: MusicLayer;
  controls: readonly Control[];
  done: boolean;
}

// ---------- Сборка ----------

const stackTotal = (s: Stack): number => UNIT_KINDS.reduce((n, k) => n + (s[k] ?? 0), 0);

/**
 * Разложить `total` целых единиц по весам `men`. Наибольший остаток: сумма
 * обязана сойтись ровно, иначе фигуры то прибывали бы, то убывали при
 * перекладывании — та же беда, из-за которой округление в `toArmySetup` одно
 * на род. Доля меньше половины фигуры из кадра выпадает: показать тридцать
 * всадников из трёхсот пеших одной фигурой честнее нечем.
 */
function spreadBy(men: number[], total: number): number[] {
  const sum = men.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return men.map(() => 0);
  const exact = men.map((m) => (m / sum) * total);
  const out = exact.map((e) => Math.floor(e));
  let given = out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, frac: e - out[i] })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; given < total; k++, given++) out[order[k % order.length].i] += 1;
  return out;
}

/**
 * Фигуры сектора по видам. Сначала по родам — их знает итог боя по секторам, —
 * потом внутри рода по видам в той пропорции, в какой они стоят во всей армии.
 *
 * Пропорция армейская, а не посекторная, потому что посекторной нет ни у кого:
 * `toArmySetup` складывает виды в роды ещё до боя, и ядро с этого места видит
 * только роды. Врать этим нельзя — можно ошибиться разве что в том, что латники
 * стояли не поровну по флангам.
 *
 * Метки не даны — метка равна роду. Так ядро остаётся работоспособным само по
 * себе; в игре состав есть всегда, и до картинки такая метка не доходит.
 */
function facesFor(stack: Stack, total: number, faces: Face[]): FaceCount[] {
  const kinds = spreadBy(
    UNIT_KINDS.map((k) => stack[k] ?? 0),
    total,
  );
  const out: FaceCount[] = [];
  UNIT_KINDS.forEach((kind, i) => {
    const n = kinds[i];
    if (n <= 0) return;
    const mine = faces.filter((f) => f.kind === kind && f.men > 0);
    if (mine.length === 0) {
      out.push({ id: kind, kind, figures: n });
      return;
    }
    const split = spreadBy(mine.map((f) => f.men), n);
    mine.forEach((f, j) => {
      if (split[j] > 0) out.push({ id: f.id, kind, figures: split[j] });
    });
  });
  return out;
}

/**
 * Насколько бой был спорным: 0 — платила одна сторона, 1 — обе поровну.
 *
 * Мерка — **доля выбитых**, а не число погибших: пятьсот против двадцати
 * выбивают двадцать человек и теряют десяток, и по головам это выглядит почти
 * поровну. По долям — единица против сотой, чем разгром и является.
 */
export function contestOf(result: BattleResult): number {
  const share = (side: Side): number =>
    result.sides[side].total.losses / Math.max(1, result.sides[side].total.initial);
  const a = share('attacker');
  const d = share('defender');
  return Math.min(a, d) / Math.max(a, d, 1e-6);
}

/**
 * Сколько времени занимает бой линий: спорность задаёт длину, журнал
 * ограничивает её сверху. Бою, о котором журналу нечего сказать, длина не
 * достаётся, как бы спорен он ни был, — камере некуда резать.
 */
function meleeSeconds(contest: number, marks: number): number {
  const { min, max, perMark } = MELEE_SECONDS;
  const wanted = min + (max - min) * contest;
  const raw = Math.min(wanted, min + perMark * marks);
  return Math.min(max, Math.max(min, Math.round(raw * 10) / 10));
}

/** Границы тактов. Три из четырёх постоянные: близкий план и отъезд и есть лицо ролика. */
function actWindows(result: BattleResult): ActWindow[] {
  const meleeMarks = result.log.filter((e) => !service(e) && ACT_OF[e.phase] === 'melee').length;
  const lengths: Record<Act, number> = {
    muster: MUSTER_SECONDS,
    pullback: PULLBACK_SECONDS,
    melee: meleeSeconds(contestOf(result), meleeMarks),
    rout: ROUT_SECONDS,
  };
  const out: ActWindow[] = [];
  let t = 0;
  for (const act of ACTS) {
    out.push({ act, from: t, to: t + lengths[act] });
    t += lengths[act];
  }
  return out;
}

/** Фазы внутри такта делят его время по числу тиков: тик — мера содержания. */
function layout(result: BattleResult, acts: ActWindow[]): Span[] {
  const out: Span[] = [];
  for (const win of acts) {
    const inAct = result.phases.filter((p) => ACT_OF[p.phase] === win.act);
    const ticks = inAct.reduce((n, p) => n + (p.to - p.from + 1), 0);
    let t = win.from;
    for (const p of inAct) {
      const dur = ticks > 0 ? ((p.to - p.from + 1) / ticks) * (win.to - win.from) : 0;
      out.push({
        phase: p.phase,
        act: win.act,
        from: p.from,
        to: p.to,
        t0: t,
        t1: t + dur,
        losses: p.losses,
        bySector: p.bySector,
      });
      t += dur;
    }
    // Фазы, которой в итоге нет, быть не должно, но такт без содержания всё
    // равно занимает своё время: камера едет по нему.
    if (inAct.length === 0) {
      const last = result.phases[result.phases.length - 1];
      const tick = last ? last.to : 0;
      out.push({
        phase: ACT_PHASES[win.act][0],
        act: win.act,
        from: tick,
        to: tick,
        t0: win.from,
        t1: win.to,
        losses: { attacker: 0, defender: 0 },
      });
    }
  }
  return out;
}

/**
 * Разложить `total` фигур по секторам пропорционально их численности. Сумма
 * обязана сойтись с `figureCount` стороны ровно: округляй каждый сектор сам по
 * себе — и на отъезде войско недосчитается фигуры без всякой причины. Сектор с
 * бойцами получает хотя бы одну, пока фигуры есть у кого занять: пустое место в
 * строю читается как «там никого нет».
 */
function spread(men: number[], total: number): number[] {
  const out = spreadBy(men, total);
  // Занять фигуру у самого многолюдного сектора для того, кому не досталось.
  for (let i = 0; i < out.length; i++) {
    if (out[i] > 0 || men[i] <= 0) continue;
    let donor = -1;
    for (let j = 0; j < out.length; j++) if (out[j] > 1 && (donor < 0 || out[j] > out[donor])) donor = j;
    if (donor < 0) break;
    out[donor] -= 1;
    out[i] += 1;
  }
  return out;
}

/** Сектора обеих сторон как объекты показа. */
function castSectors(result: BattleResult, us: Side, faces: Record<Side, Face[]>): CastSector[] {
  const out: CastSector[] = [];
  for (const side of SIDES2) {
    const res = result.sides[side];
    const total = figureCount(res.total.initial);
    const live = SECTORS.filter((sector) => stackTotal(res.sectors[sector].initial) > 0);
    const figures = spread(
      live.map((sector) => stackTotal(res.sectors[sector].initial)),
      total,
    );
    // Знамёна раскладываются на сторону целиком, а не считаются по секторам:
    // округление в каждом секторе врозь дало бы то шесть знамён, то девять при
    // одной и той же армии, а их считают глазами.
    const banners = spread(
      live.map((sector) => stackTotal(res.sectors[sector].initial)),
      bannersFor(res.total.initial),
    );
    live.forEach((sector, i) => {
      const cell = res.sectors[sector];
      const men = stackTotal(cell.initial);
      const byFace = facesFor(cell.initial, figures[i], faces[side]);
      const ranks = ranksFor(men, figures[i]);
      out.push({
        side,
        sector,
        lane: laneOf(sector),
        row: rowOf(sector),
        men,
        finalMen: stackTotal(cell.final),
        byFace,
        figures: figures[i],
        ranks,
        files: Math.max(1, Math.ceil(figures[i] / ranks)),
        banners: banners[i],
        shafts: shaftsFor(byFace),
        dust: dustRadius(men),
        rank: 0,
        brokenAt: null,
      });
    });
  }
  // Ранг удалённости от близкого плана: он смотрит на наш левый фланг, и фигуры
  // проявляются оттуда наружу — тогда отъезд читается как «видно шире», а не
  // как «всё выскочило разом».
  const near = sectorSpot(us, us, 'A', 0);
  const dist = (c: CastSector): number => {
    const p = sectorSpot(c.side, us, c.sector, 0);
    return (p.x - near.x) ** 2 + (p.z - near.z) ** 2;
  };
  [...out]
    .sort((a, b) => dist(a) - dist(b) || (a.side < b.side ? -1 : 1) || a.sector.localeCompare(b.sector))
    .forEach((c, i) => {
      c.rank = i;
    });
  return out;
}

/** Место события: у одних оно записано сектором, у других — целью удара. */
function sectorOf(e: BattleEvent): Sector | null {
  if ('sector' in e && e.sector) return e.sector;
  if ('target' in e && e.target) return e.target;
  if ('to' in e && e.to) return e.to;
  return null;
}

/** Число, стоящее за событием: у разных событий оно называется по-разному. */
function amountOf(e: BattleEvent): number {
  if ('losses' in e && typeof e.losses === 'number') return e.losses;
  if ('archersLost' in e) return e.archersLost;
  if ('men' in e) return e.men;
  if ('cavalryLost' in e) return e.cavalryLost;
  return 0;
}

/**
 * Служебные события журнала: начало фазы, итог и кость. Кость — не событие на поле: у неё нет ни
 * места, ни числа выбитых, и камера к ней не подаётся; зрелищем её делают потери, которые она
 * множит.
 */
const service = (e: BattleEvent): boolean => e.id === 'phase-start' || e.id === 'result' || e.id === 'dice';

/** События журнала на времени и на месте. Служебные (`service`) меткой не становятся. */
function markLog(result: BattleResult, spans: Span[], us: Side): Mark[] {
  const at = (tick: number, phase: PhaseId): { t: number; act: Act } => {
    const span = spans.find((s) => s.phase === phase) ?? spans[0];
    const len = Math.max(1, span.to - span.from + 1);
    const u = clamp01((tick - span.from) / len);
    return { t: span.t0 + (span.t1 - span.t0) * u, act: span.act };
  };
  const out: Mark[] = [];
  for (const e of result.log) {
    if (service(e)) continue;
    const { t, act } = at(e.tick, e.phase);
    const sector = sectorOf(e);
    out.push({
      t,
      tick: e.tick,
      phase: e.phase,
      act,
      id: e.id,
      side: 'side' in e ? e.side : us,
      sector,
      lane: sector ? laneOf(sector) : null,
      amount: amountOf(e),
      text: describeEvent(e, us),
    });
  }
  return out.sort((a, b) => a.t - b.t || a.tick - b.tick);
}

/**
 * Ход камеры. Один непрерывный: близкий план → отъезд → поле с подачей к
 * событиям → спуск к полю. Между соседними ключами всё интерполируется, поэтому
 * склейки нет по построению.
 */
function keyframes(us: Side, acts: ActWindow[], marks: Mark[]): Keyframe[] {
  const win = (a: Act): ActWindow => acts.find((w) => w.act === a)!;
  const keys: Keyframe[] = [
    { t: 0, act: 'muster', shot: SHOT_MUSTER },
    { t: win('muster').to, act: 'muster', shot: SHOT_MUSTER_END },
    { t: win('pullback').to, act: 'pullback', shot: SHOT_FIELD },
  ];

  // Бой линий: камера подаётся к сектору, где по журналу сейчас событие. Ключи
  // не чаще MARK_HOLD — иначе камера мечется и разглядеть не успеваешь ничего.
  const melee = win('melee');
  let last = melee.from - MARK_HOLD;
  for (const m of marks) {
    if (m.act !== 'melee' || !m.sector) continue;
    if (m.t - last < MARK_HOLD) continue;
    if (m.t > melee.to - 1) break;
    last = m.t;
    keys.push({ t: m.t, act: 'melee', shot: shotAt(sectorSpot(m.side, us, m.sector, 1)) });
  }
  keys.push({ t: melee.to, act: 'melee', shot: SHOT_FIELD });

  // Спуск: камера снова опускается к земле. Начали близко — закончили близко.
  const rout = win('rout');
  keys.push({ t: rout.from + (rout.to - rout.from) * 0.45, act: 'rout', shot: SHOT_DOWN });
  keys.push({ t: rout.to, act: 'rout', shot: SHOT_LAST });
  return keys.sort((a, b) => a.t - b.t);
}

/** Пустой состав: ядро обходится без меток, метка тогда равна роду. */
const NO_FACES: Record<Side, Face[]> = { attacker: [], defender: [] };

/**
 * Раскадровка боя. Один и тот же журнал даёт одну и ту же раскадровку.
 *
 * `faces` — кто именно стоял в строю с каждой стороны. Ядро эти метки не читает,
 * оно только делит по ним фигуры; без них метка равна роду боя. Игра передаёт
 * состав всегда — иначе близкий план не выполняет своего обещания.
 *
 * `ground` — где и когда. Ядро не читает и его: оно кладёт землю и час в
 * раскадровку, чтобы показу хватило её одной. Не дали — ровное поле в полдень,
 * но со своим сидом: у каждого боя всё равно своя трава.
 */
export function buildCast(
  result: BattleResult,
  us: Side,
  faces: Record<Side, Face[]> = NO_FACES,
  ground: Ground = { ...PLAIN_GROUND, seed: result.seed },
): Cast {
  const acts = actWindows(result);
  const spans = layout(result, acts);
  const marks = markLog(result, spans, us);
  const sectors = castSectors(result, us, faces);
  for (const c of sectors) {
    const broke = marks.find((m) => m.id === 'sector-broken' && m.side === c.side && m.sector === c.sector);
    c.brokenAt = broke ? broke.t : null;
  }
  return {
    us,
    seed: result.seed,
    detailed: result.phases.every((p) => p.bySector !== undefined),
    seconds: acts[acts.length - 1].to,
    ground,
    music: musicCues(acts),
    acts,
    spans,
    keys: keyframes(us, acts, marks),
    marks,
    sectors,
    men: {
      attacker: result.sides.attacker.total.initial,
      defender: result.sides.defender.total.initial,
    },
    figures: {
      attacker: figureCount(result.sides.attacker.total.initial),
      defender: figureCount(result.sides.defender.total.initial),
    },
    winner: result.winner,
  };
}

// ---------- Кадр в момент t ----------

const shotBetween = (a: CameraShot, b: CameraShot, u: number): CameraShot => ({
  x: lerp(a.x, b.x, u),
  y: lerp(a.y, b.y, u),
  z: lerp(a.z, b.z, u),
  atX: lerp(a.atX, b.atX, u),
  atY: lerp(a.atY, b.atY, u),
  atZ: lerp(a.atZ, b.atZ, u),
  fov: lerp(a.fov, b.fov, u),
});

/** Положение камеры на момент `t`. Непрерывно по построению: ключи и сглаживание. */
export function shotAtTime(cast: Cast, t: number): CameraShot {
  const keys = cast.keys;
  if (t <= keys[0].t) return keys[0].shot;
  const lastKey = keys[keys.length - 1];
  if (t >= lastKey.t) return lastKey.shot;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const u = b.t === a.t ? 1 : ease((t - a.t) / (b.t - a.t));
  return shotBetween(a.shot, b.shot, u);
}

/**
 * Сколько фигур стороне поставлено на момент `t`. На близком плане — горстка:
 * это кадрированный фрагмент строя, больше на такой дистанции и не видно. На
 * отъезде число РАСТЁТ до полного войска: армия не должна выглядеть тающей.
 */
export function placedAt(cast: Cast, side: Side, t: number): number {
  const total = cast.figures[side];
  // Тот же ход, что у леса древков: подробность меняется один раз и вся сразу,
  // под движение камеры, а не двумя разными способами в разные моменты.
  return Math.round(lerp(Math.min(MUSTER_FIGURES, total), total, crowdAt(cast, t)));
}

/** Доля потерь стороны, уже случившихся к моменту `t`: из фазовых потерь итога. */
function lossProgress(spans: Span[], side: Side, t: number): number {
  const total = spans.reduce((n, s) => n + s.losses[side], 0);
  if (total <= 0) return 0;
  let done = 0;
  for (const s of spans) {
    if (t >= s.t1) {
      done += s.losses[side];
      continue;
    }
    if (t > s.t0) done += s.losses[side] * ((t - s.t0) / Math.max(1e-6, s.t1 - s.t0));
    break;
  }
  return clamp01(done / total);
}

/**
 * Сколько сектор потерял к моменту `t` — по фазам, как записано в журнале. Внутри
 * фазы потери размазаны ровно: точнее журнал и не знает, а между фазами разница
 * уже видна. Это и есть смысл поля: фланг, выбитый за одну фазу, тает за одну
 * фазу, а не плавно вместе со всей армией.
 */
function sectorLost(spans: Span[], side: Side, sector: Sector, t: number): number {
  let lost = 0;
  for (const s of spans) {
    const n = s.bySector?.[side]?.[sector] ?? 0;
    if (t >= s.t1) {
      lost += n;
      continue;
    }
    if (t > s.t0) lost += n * ((t - s.t0) / Math.max(1e-6, s.t1 - s.t0));
    break;
  }
  return lost;
}

/**
 * Залпы в небе на момент `t`. Событие `volley` говорит, кто стрелял и скольких
 * выбил, но не говорит, откуда и куда, — это выводится из журнала же: стреляют
 * сектора, где стоят лучники, а прилетает туда, где сторона потеряла людей в
 * стрелковой фазе (`PhaseSpan.bySector`). Ни одного числа из симуляции.
 */
function volleysAt(cast: Cast, t: number, closing: number): Volley[] {
  const ranged = cast.spans.find((sp) => sp.phase === 'ranged');
  const approach = cast.spans.find((sp) => sp.phase === 'approach');
  if (!ranged || !approach) return [];
  const out: Volley[] = [];
  for (const m of cast.marks) {
    if (m.id !== 'volley' || m.amount <= 0) continue;
    const from = archerSpot(cast, m.side, closing);
    const to = hitSpot(cast, foeOf(m.side), closing);
    if (!from || !to) continue;
    // «До столкновения» — это стрелковая фаза И сближение: лучники бьют, пока
    // линии идут навстречу. Залпы ложатся на обе так, чтобы последний успел
    // долететь: стрелы не должны висеть в небе, когда линии уже сошлись.
    const span = Math.max(0.1, approach.t1 - ranged.t0 - VOLLEY_FLIGHT);
    for (let i = 0; i < VOLLEY_SHOTS; i++) {
      const at = ranged.t0 + (span * i) / VOLLEY_SHOTS;
      const u = (t - at) / VOLLEY_FLIGHT;
      if (u < 0 || u > 1) continue;
      out.push({
        side: m.side,
        fromX: from.x,
        fromZ: from.z,
        toX: to.x,
        toZ: to.z,
        u,
        men: m.amount / VOLLEY_SHOTS,
      });
    }
  }
  return out;
}

/** Откуда бьёт залп: середина секторов этой стороны, где стоят лучники. */
function archerSpot(cast: Cast, side: Side, closing: number): { x: number; z: number } | null {
  let x = 0;
  let z = 0;
  let n = 0;
  for (const c of cast.sectors) {
    if (c.side !== side) continue;
    const bows = c.byFace.reduce((k, f) => k + (f.kind === 'archer' ? f.figures : 0), 0);
    if (bows <= 0) continue;
    const p = sectorSpot(side, cast.us, c.sector, closing);
    x += p.x * bows;
    z += p.z * bows;
    n += bows;
  }
  return n > 0 ? { x: x / n, z: z / n } : null;
}

/** Куда он прилетает: середина секторов, потерявших людей в стрелковой фазе. */
function hitSpot(cast: Cast, side: Side, closing: number): { x: number; z: number } | null {
  const ranged = cast.spans.find((sp) => sp.phase === 'ranged');
  const lost = ranged?.bySector?.[side];
  let x = 0;
  let z = 0;
  let n = 0;
  for (const c of cast.sectors) {
    if (c.side !== side) continue;
    // Журнал знает потери по секторам — берём их. Не знает (старая запись) —
    // целимся во фронт: залп бьёт по тем, кто идёт навстречу.
    const w = lost ? (lost[c.sector] ?? 0) : c.row === 'front' ? c.men : 0;
    if (w <= 0) continue;
    const p = sectorSpot(side, cast.us, c.sector, closing);
    x += p.x * w;
    z += p.z * w;
    n += w;
  }
  return n > 0 ? { x: x / n, z: z / n } : null;
}

/**
 * Смещение сектора: конница в разгоне и бегущие, уходящие с поля. Оба движения
 * записаны в журнале — `cavalry-broke-archers`, `flank-turned`, `spears-held`
 * говорят, кто и куда ударил, `sector-broken` — кто и когда побежал.
 */
function moveOf(
  cast: Cast,
  c: CastSector,
  t: number,
  flee: number,
): { dx: number; dz: number } {
  const back = c.side === cast.us ? -1 : 1;
  // Бегство сильнее разгона: сектор, который уже сломался, никуда не атакует.
  if (flee > 0) return { dx: 0, dz: back * FLEE_DIST * flee };
  const ride = chargeAt(cast, c, t);
  if (!ride) return { dx: 0, dz: 0 };
  const here = sectorSpot(c.side, cast.us, c.sector, 1);
  return { dx: (ride.x - here.x) * ride.u, dz: (ride.z - here.z) * ride.u };
}

/** Конный удар этого сектора: куда и насколько он сейчас вынесен. */
function chargeAt(cast: Cast, c: CastSector, t: number): { x: number; z: number; u: number } | null {
  const horse = c.byFace.some((f) => f.kind === 'cavalry' && f.figures > 0);
  if (!horse) return null;
  for (const m of cast.marks) {
    if (m.side !== c.side || !m.sector) continue;
    if (m.id !== 'cavalry-broke-archers' && m.id !== 'flank-turned' && m.id !== 'cavalry-intercepted') continue;
    const u = (t - m.t) / CHARGE_SECONDS;
    if (u < 0 || u > 1) continue;
    // Цель у обхода — сектор чужой стороны; у своего сломанного фланга — свой.
    const foe = m.id === 'flank-turned' ? foeOf(m.side) : foeOf(c.side);
    const target = sectorSpot(foe, cast.us, m.sector, 1);
    // Разгон и возврат: клин выносит вперёд и откатывается, а не телепортируется.
    const swing = Math.sin(Math.PI * u) * CHARGE_REACH;
    return { x: target.x, z: target.z, u: swing };
  }
  return null;
}

/**
 * Время для поз. На первом столкновении ход почти замирает: три кадра
 * неподвижности — и удар весит больше, чем от любого числа полигонов.
 */
function poseClock(cast: Cast, t: number): { poseTime: number; impact: number } {
  const clash = cast.spans.find((sp) => sp.phase === 'clash');
  if (!clash) return { poseTime: t, impact: 0 };
  const hold = Math.min(CLASH_HOLD.seconds, Math.max(0, clash.t1 - clash.t0));
  const into = t - clash.t0;
  if (into <= 0) return { poseTime: t, impact: 0 };
  const slowed = Math.min(into, hold) * CLASH_HOLD.slow;
  const after = Math.max(0, into - hold);
  const since = t - (clash.t0 + hold);
  return {
    poseTime: clash.t0 + slowed + after,
    impact: since >= 0 && since < IMPACT_SECONDS ? 1 - since / IMPACT_SECONDS : 0,
  };
}

/**
 * Копья опускаются разом перед ударом и остаются наперевес до конца боя.
 * Вверх они возвращаются только у тех, кто уже бежит, — но это решает не здесь,
 * а сектор своим бегством.
 */
function couchAt(cast: Cast, t: number): number {
  const approach = cast.spans.find((sp) => sp.phase === 'approach');
  const clash = cast.spans.find((sp) => sp.phase === 'clash');
  if (!approach || !clash) return 0;
  // Замах начинается на второй половине сближения и кончается в момент удара.
  const from = approach.t0 + (approach.t1 - approach.t0) * 0.45;
  if (t <= from) return 0;
  if (t >= clash.t0) return 1;
  return ease((t - from) / Math.max(1e-6, clash.t0 - from));
}

/** Событие, о котором ролик говорит сейчас: последнее случившееся. */
function activeMark(cast: Cast, t: number): Mark | null {
  let out: Mark | null = null;
  for (const m of cast.marks) {
    if (m.t > t) break;
    out = m;
  }
  return out;
}

/**
 * Кадр ролика. Всё, что в нём есть, выведено из раскадровки: ни одного броска
 * кубика, ни одного вызова симуляции, ни одного обращения к итогу боя.
 */
export function frameAt(cast: Cast, t: number): Frame {
  const time = Math.max(0, Math.min(cast.seconds, t));
  const span = cast.spans.find((s) => time < s.t1) ?? cast.spans[cast.spans.length - 1];
  const act = span.act;
  const pull = cast.acts[1];
  const closing =
    act === 'muster'
      ? 0
      : act === 'pullback'
        ? ease(clamp01((time - pull.from) / Math.max(1e-6, pull.to - pull.from)))
        : 1;
  const tick = Math.round(
    lerp(span.from, span.to, clamp01((time - span.t0) / Math.max(1e-6, span.t1 - span.t0))),
  );

  const mark = activeMark(cast, time);
  const focus = mark && mark.sector ? { side: mark.side, sector: mark.sector, lane: mark.lane } : null;
  const crowd = crowdAt(cast, time);
  const shot = shotAtTime(cast, time);

  const sectors: SectorFrame[] = [];
  const sideFrame = {} as Record<Side, SideFrame>;
  for (const side of SIDES2) {
    const progress = lossProgress(cast.spans, side, time);
    let left = placedAt(cast, side, time);
    let figures = 0;
    let standing = 0;
    let men = 0;
    let banners = 0;
    for (const c of cast.sectors.filter((x) => x.side === side).sort((a, b) => a.rank - b.rank)) {
      const shown = Math.max(0, Math.min(c.figures, left));
      left -= shown;
      // Сколько в секторе осталось людей. Журнал знает потери сектора по фазам —
      // берём их. Не знает (старая запись боя) — идём от начального к конечному
      // по общему ходу потерь стороны: итог знает оба конца, но не темп.
      const now = cast.detailed
        ? Math.max(0, c.men - sectorLost(cast.spans, side, c.sector, time))
        : c.men + (c.finalMen - c.men) * progress;
      men += now;
      const alive = c.men > 0 ? clamp01(now / c.men) : 0;
      const up = shown === 0 ? 0 : Math.min(shown, Math.max(now > 0.5 ? 1 : 0, Math.round(shown * alive)));
      figures += shown;
      standing += up;
      const spot = sectorSpot(side, cast.us, c.sector, closing);
      // Бегство идёт от мгновения слома этого сектора, а не всей армии: паника
      // в журнале перекидывается по одному, и так же она и показывается.
      const flee = c.brokenAt === null ? 0 : clamp01((time - c.brokenAt) / FLEE_SECONDS);
      const move = moveOf(cast, c, time, flee);
      // Насколько крупно виден боец именно этого сектора: дальний строй мельче
      // ближнего, и лес встаёт в нём раньше — там его и не поймать.
      const manPx = manPixels(
        shot,
        Math.hypot(shot.x - (spot.x + move.dx), shot.y - MAN_HEIGHT / 2, shot.z - (spot.z + move.dz)),
      );
      // Масса проявляется вместе с фигурами и убывает вместе с живыми: иначе на
      // близком плане над горсткой людей стояло бы всё войско знамён.
      const part = c.figures > 0 ? shown / c.figures : 0;
      const flags = shown > 0 ? Math.max(1, Math.round(c.banners * part * alive)) : 0;
      sectors.push({
        side,
        sector: c.sector,
        lane: c.lane,
        row: c.row,
        byFace: c.byFace,
        ranks: c.ranks,
        files: c.files,
        figures: shown,
        standing: up,
        // Брошенное — от павших, то есть от потерь журнала. Своего числа убитых
        // картинка не заводит: она их только раскладывает по земле.
        wreck: wreckFor(shown - up),
        banners: Math.min(c.banners, flags),
        // Лес — по видимому размеру бойца, а не по такту камеры: древко стоит
        // вместо человека, которого не нарисовали, и подменять им можно только
        // того, кого всё равно не разглядеть.
        shafts: Math.round(c.shafts * part * alive * shaftShare(manPx)),
        // Пятно проявляется вместе с фигурами и убывает вместе с живыми: площадь
        // ему задаёт число людей, а не радиус, поэтому под корнем произведение.
        dust: c.dust * Math.sqrt(Math.max(0, part * alive)),
        manPx,
        broken: c.brokenAt !== null && time >= c.brokenAt,
        flee,
        dx: move.dx,
        dz: move.dz,
        x: spot.x,
        z: spot.z,
      });
      banners += Math.min(c.banners, flags);
    }
    sideFrame[side] = { men: Math.round(men), figures, standing, banners };
  }

  const clock = poseClock(cast, time);
  return {
    t: time,
    act,
    phase: span.phase,
    tick,
    shot,
    closing,
    focus,
    caption: mark && time - mark.t <= CAPTION_HOLD ? mark.text : null,
    sectors,
    side: sideFrame,
    // Дуга считается по нынешнему сближению, а не по контакту: стреляют, пока
    // линии ещё идут навстречу, и стрелы должны падать туда, где противник сейчас.
    volleys: volleysAt(cast, time, closing),
    couch: couchAt(cast, time),
    poseTime: clock.poseTime,
    impact: clock.impact,
    crowd,
    music: musicAt(cast.music, time),
    controls: CONTROLS,
    done: t >= cast.seconds,
  };
}

/** Чужая сторона для стороны `side`. */
export const foeOf = other;
