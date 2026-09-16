// Укрепления лагеря: рогатки, ров, частокол — и сколько нападающих через них проходит.
//
// Модуль чистый, того же рода, что `siege.ts`: ни состояния, ни часов, ни
// `Math.random`. **Укрепление не хранится и не тикает** — это функция от двух
// чисел: когда лагерь встал под стенами (`siegeSince`) и о какой минуте спрашивают.
// Отсюда то же свойство, что у часов голода: тот же сейв и то же время дают то же
// укрепление, в любом порядке вопросов, и офлайн даёт ровно то, что непрерывная игра.
//
// **У лагеря две стороны: фронт (к городу) и тыл (в поле).** Больше не бывает — по
// сторонам света его не делят. Вылазка из города и выручка соседей лезут во фронт,
// полководец из поля бьёт в тыл. У каждой стороны своя готовность и свой проход со
// своей занятостью: кто лезет с одной стороны, другую не занимает и не сужает.
//
// **Готовность стороны — древесина, вложенная в неё.** Лагерь рубит лес сам, от
// времени и своих людей, и рубит столько, сколько людей нужно на то, чтобы обнести
// сторону, — размер отряда сокращается, и остаётся одно число на сторону: сколько
// сторон отряд достраивает за `CAMP_WORKS_RIPE` (`CAMP_WOOD`). Дровосеки остаются в
// лагере: они и в проходе, и в бою, отдельного состояния у них нет. Дозревшая
// сторона свою долю отдаёт другой: запаса нет, и вложенное во фронт плюс вложенное
// в тыл не бывает больше нарубленного.
//
// **Что укрепление делает — ровно одно: сужает проход своей стороны.** В бой у
// лагеря входит не больше `пропуск` бойцов строя нападающих, остальные стоят у
// рогаток и не дерутся — ни убивают, ни гибнут. Людей лагерю оно не прибавляет:
// разрыв сил у настоящих осад ×7…×169, и лагерь из пяти человек пришлось бы
// записывать в бой тремя сотнями, а запись боя — это то, что игрок читает как правду.
//
// **Проход меряется бойцами строя и режет отряд долей по родам, а не головами.**
// Латник весит нескольких бойцов строя (`TroopDef.power` на `BATTLE_MAN`), а пропуск у
// дозревших рогаток — `CAMP_WORKS_PASS` бойца строя на каждого, кто их ставил: режь по
// головам, и тяжёлые не прошли бы никогда. Доля строя сохраняет отряд тем,
// чем он был, — только меньше.
//
// Сила отряда входит в укрепление через проход, и только через него: **рогатки держат те,
// кто их строил**, поэтому пропуск — доля от людей, ставивших лагерь (`SiegeWindow.builders`),
// а не от живых на минуту вопроса. Иначе лагерь, у которого выбили людей, отбивался бы
// лучше целого: проход сужался бы ровно во столько раз, во сколько лагерь слабеет, и на
// пяти-шести людях это лотерея округления (docs/tower.md, раздел 2.2). Бить осаждающего
// должно быть выгодно — любым способом, каким бы по лагерю ни били.
//
// **Проход — поток, а не порция.** Рогатки пропускают столько-то людей в единицу
// времени: прошла часть пропуска — такая же часть прохода занята, и освобождается
// она за ту же часть `CAMP_GATE_CLEAR`. Хранится одна отметка на сторону в окне
// осады — `gateAt` у фронта, `rearGateAt` у тыла; пишет их только бой у лагеря, в
// самом событии, а свободная доля выводится при чтении. Тика нет.
import { stackTotal, UNIT_KINDS, type Stack } from '@/battle';
import { CAMP_GATE_CLEAR, CAMP_WOOD, CAMP_WORKS_PASS, CAMP_WORKS_RIPE, PLAYER_CAMP_WOOD } from './data/tuning';

/** Сторона лагеря. Фронт — к городу, тыл — в поле. Не путать с `Side` боя: там нападающий и защитник. */
export type CampSide = 'front' | 'rear';
export const SIDES: readonly CampSide[] = ['front', 'rear'];

/**
 * Сколько сторон лагерь достраивает за `CAMP_WORKS_RIPE` в каждую сторону — и, если
 * доли меняли посреди осады, с какой минуты они идут и что к ней уже было вложено.
 *
 * Смена долей не переписывает прошлое. Готовность — функция времени, и спроси её
 * новыми долями от постановки лагеря — вложенное во фронт за двадцать минут
 * исчезло бы в ту секунду, когда игрок передвинул долю в тыл. Поэтому смена
 * записывает, что было в её минуту (`base` на `at`), и дальше растёт от этого. Это
 * тот же приём, что у часов голода: одно событие — одно новое окно, тика нет.
 */
export interface WoodPlan {
  readonly front: number;
  readonly rear: number;
  /** С какой минуты идут эти доли. Нет поля — с постановки лагеря. */
  readonly at?: number;
  /** Готовность сторон в минуту `at`. */
  readonly base?: { readonly front: number; readonly rear: number };
}

/** Откуда растёт готовность и что в ней уже лежит. */
function start(since: number, side: CampSide, plan: WoodPlan) {
  const from = Math.max(since, plan.at ?? since);
  const clamp = (v: number | undefined): number => Math.min(1, Math.max(0, v ?? 0));
  return {
    from,
    ownBase: clamp(plan.base?.[side]),
    otherBase: clamp(plan.base?.[side === 'front' ? 'rear' : 'front']),
    own: Math.max(0, side === 'front' ? plan.front : plan.rear),
    other: Math.max(0, side === 'front' ? plan.rear : plan.front),
  };
}

/**
 * Сколько `CAMP_WORKS_RIPE` прошло с минуты, от которой растёт готовность. Раньше неё
 * спрашивать не у кого: прежние доли не хранятся, и отвечает база.
 */
const spans = (from: number, at: number): number => Math.max(0, at - from) / CAMP_WORKS_RIPE;

/** Нарубленная древесина, в сторонах: столько сторон можно было бы обнести. */
export const woodCut = (since: number, at: number, plan: WoodPlan = CAMP_WOOD): number => {
  const s = start(since, 'front', plan);
  return s.ownBase + s.otherBase + (s.own + s.other) * spans(s.from, at);
};

/**
 * Насколько достроена сторона, 0..1. Своя доля выработки идёт в неё, пока другая
 * сторона не дозрела; дозрела — её доля переходит сюда. Растёт от постановки
 * лагеря (или от последней смены долей, со вложенного к ней) и встаёт на единице.
 * При `plan.front = 1` готовность фронта — ровно `(t − встал) / CAMP_WORKS_RIPE`,
 * та же, что до сторон.
 */
export function sideWorks(since: number, at: number, side: CampSide, plan: WoodPlan = CAMP_WOOD): number {
  const s = start(since, side, plan);
  const x = spans(s.from, at);
  // Когда дозреет другая сторона: её остаток на её долю; дозрела уже — с самого начала.
  const otherRipe = s.otherBase >= 1 ? 0 : s.other > 0 ? (1 - s.otherBase) / s.other : Infinity;
  if (x <= otherRipe) return Math.min(1, s.ownBase + s.own * x);
  return Math.min(1, s.ownBase + s.own * x + s.other * (x - otherRipe));
}

/** Когда сторона дозреет. Бесконечность — никогда: в неё не кладут ничего. */
export function worksRipeAt(since: number, side: CampSide, plan: WoodPlan = CAMP_WOOD): number {
  const s = start(since, side, plan);
  if (s.ownBase >= 1) return s.from;
  const otherRipe = s.otherBase >= 1 ? 0 : s.other > 0 ? (1 - s.otherBase) / s.other : Infinity;
  const alone = s.own > 0 ? (1 - s.ownBase) / s.own : Infinity;
  if (alone <= otherRipe) return s.from + alone * CAMP_WORKS_RIPE;
  if (s.own + s.other <= 0) return Infinity;
  return s.from + ((1 - s.ownBase + s.other * otherRipe) / (s.own + s.other)) * CAMP_WORKS_RIPE;
}

/**
 * Доли, которые игрок может отдать фронту, по порядку: всё во фронт, три четверти,
 * поровну, четверть, всё в тыл. Шагом, а не ползунком: на 375 px пять кнопок читаются,
 * а ползунок на дольку процента — нет.
 */
export const WOOD_SHARES: readonly number[] = [1, 0.75, 0.5, 0.25, 0];

/** Доли лагеря игрока, если фронту отдана доля `share`. */
export const playerWood = (share: number): WoodPlan => {
  const f = Math.min(1, Math.max(0, share));
  return { front: f * PLAYER_CAMP_WOOD, rear: (1 - f) * PLAYER_CAMP_WOOD };
};

/** Какую долю фронту отдаёт этот план; null — план не из шагов игрока (лагерь бота, старое окно). */
export const woodShare = (plan: WoodPlan | undefined): number | null => {
  if (!plan) return null;
  for (const share of WOOD_SHARES) {
    const p = playerWood(share);
    if (Math.abs(p.front - plan.front) < 1e-9 && Math.abs(p.rear - plan.rear) < 1e-9) return share;
  }
  return null;
};

/**
 * Сменить доли в минуту `at`: вложенное к ней становится базой, новые доли идут от
 * неё. Готовность ни одной стороны в эту минуту не меняется — меняется только то, как
 * она растёт дальше.
 */
export function rebaseWood(since: number, at: number, from: WoodPlan | undefined, share: number): WoodPlan {
  const was = from ?? CAMP_WOOD;
  return {
    ...playerWood(share),
    at: Math.max(since, at),
    base: { front: sideWorks(since, at, 'front', was), rear: sideWorks(since, at, 'rear', was) },
  };
}

/**
 * Сколько бойцов строя нападающих входит в бой на каждого, кто строил рогатки.
 * Недостроенные рогатки пропускают во столько раз больше, во сколько они не
 * достроены; пока стороны нет — без предела.
 */
export const passPerMan = (works: number): number => (works > 0 ? CAMP_WORKS_PASS / works : Infinity);

/**
 * Пропуск: сколько бойцов строя нападающих войдёт в бой с лагерем, рогатки которого
 * ставили `builders` бойцов строя. Бесконечность — предела нет. Не меньше одного:
 * пройти к рогаткам всегда может хоть кто-то.
 */
export const campPass = (builders: number, works: number): number =>
  works > 0 ? Math.max(1, Math.round(Math.max(0, builders) * passPerMan(works))) : Infinity;

/**
 * Кто из отряда проходит через рогатки: одна и та же доля от каждого рода, пока в
 * строю не больше пропуска. Доля одинаковая, чтобы проход не выбирал за игрока, —
 * состав выбирает он сам, выпуская тех, кого выпускает. Остаток от округления
 * добирается по одному тому роду, которому доля недодала больше всех. Пропуск
 * меньше одного бойца не пропускает никого.
 */
export function passKinds(kinds: Stack, pass: number): Stack {
  const all: Stack = { spear: 0, infantry: 0, archer: 0, cavalry: 0 };
  for (const k of UNIT_KINDS) all[k] = Math.max(0, Math.floor(kinds[k] ?? 0));
  const total = stackTotal(all);
  if (!(pass < Infinity) || total <= pass) return all;
  const out: Stack = { spear: 0, infantry: 0, archer: 0, cavalry: 0 };
  const room = Math.floor(Math.max(0, pass));
  if (room < 1) return out;
  const ratio = room / total;
  for (const k of UNIT_KINDS) out[k] = Math.floor(all[k] * ratio);
  while (stackTotal(out) < room) {
    let best: (typeof UNIT_KINDS)[number] | null = null;
    for (const k of UNIT_KINDS) {
      if (out[k] >= all[k]) continue;
      if (best === null || all[k] * ratio - out[k] > all[best] * ratio - out[best]) best = k;
    }
    if (best === null) break;
    out[best]++;
  }
  return out;
}

/**
 * Свободная доля прохода в минуту `at`, 0..1. Отметки нет — проход свободен: так
 * читается и окно из старого сохранения, и сторона, по которой ещё не били.
 * Освобождается проход ровно по времени, без чьего-либо участия: офлайн даёт то
 * же, что непрерывная игра.
 */
export const gateFree = (gateAt: number | undefined, at: number): number =>
  gateAt === undefined ? 1 : Math.min(1, Math.max(0, 1 - (gateAt - at) / CAMP_GATE_CLEAR));

/** Сколько бойцов строя пропустит проход сейчас: пропуск на свободную долю. */
export const gateRoom = (pass: number, free: number): number =>
  pass < Infinity ? Math.floor(pass * free + 1e-9) : Infinity;

/**
 * Отметка прохода после того, как через него прошли `passed` бойцов строя из
 * пропуска `pass`: занята та же доля, и освобождается она за ту же долю
 * `CAMP_GATE_CLEAR`. Прошло не больше свободного — значит отметка никогда не уходит
 * дальше `at + CAMP_GATE_CLEAR`. Без рогаток (пропуск без предела) и без прошедших
 * проход не занимается.
 */
export function gateAfter(gateAt: number | undefined, at: number, passed: number, pass: number): number | undefined {
  if (!(pass < Infinity) || passed <= 0) return gateAt;
  return Math.max(gateAt ?? at, at) + (passed / pass) * CAMP_GATE_CLEAR;
}

/**
 * Через сколько пропустит хоть одного бойца проход стороны лагеря, построенной
 * `builders` бойцами строя и занятый до `gateAt`. Пропуск со временем сужается (рогатки растут), а свободная
 * доля растёт, поэтому ответ ищется посекундно, а не формулой; искать дальше полного
 * освобождения незачем — тогда свободен весь пропуск, а он не меньше одного.
 */
export function gateWait(
  side: CampSide,
  builders: number,
  since: number,
  at: number,
  gateAt: number | undefined,
  plan: WoodPlan = CAMP_WOOD,
): number {
  if (gateAt === undefined || gateAt <= at) return 0;
  for (let ms = 0; ms < gateAt - at; ms += 1000) {
    const t = at + ms;
    if (gateRoom(campPass(builders, sideWorks(since, t, side, plan)), gateFree(gateAt, t)) >= 1) return ms;
  }
  return Math.ceil(gateAt - at);
}

/** Отряд через рогатки одной стороны: одно число на панель до боя и на бой. */
export interface Through {
  /** Какая сторона. */
  side: CampSide;
  /** Насколько достроена эта сторона, 0..1. */
  works: number;
  /** Пропуск в бойцах строя при свободном проходе; бесконечность — без предела. */
  pass: number;
  /** Свободная доля прохода, 0..1. */
  free: number;
  /** Сколько бойцов строя пропустит проход сейчас. */
  room: number;
  /** Кто дерётся, в родах боя. */
  kinds: Stack;
  /** Сколько бойцов строя вышло. */
  went: number;
  /** Сколько из них пробились к рогаткам. */
  passed: number;
  /** Отметка прохода этой стороны после захода — её пишет бой. */
  gateAt: number | undefined;
  /** Через сколько пропустит хоть одного, мс; ноль — пропускает сейчас. */
  waitMs: number;
}

/**
 * Что будет с отрядом у рогаток стороны `side` лагеря, который ставили `builders`
 * бойцов строя, вставшего в `since` и рубящего по `plan`, если подойти в минуту `at`, когда проход
 * этой стороны занят до `gateAt`. Этой функцией считают и бой (`LocalWorld.campBattle`),
 * и окна до нажатия — второй арифметики прохода нет, и показанное число не может
 * разойтись с тем, кто дрался.
 */
export function throughWorks(
  side: CampSide,
  builders: number,
  since: number,
  at: number,
  going: Stack,
  gateAt?: number,
  plan: WoodPlan = CAMP_WOOD,
): Through {
  const works = sideWorks(since, at, side, plan);
  const pass = campPass(builders, works);
  const free = gateFree(gateAt, at);
  const room = gateRoom(pass, free);
  const kinds = passKinds(going, room);
  const passed = stackTotal(kinds);
  return {
    side,
    works,
    pass,
    free,
    room,
    kinds,
    went: stackTotal(passKinds(going, Infinity)),
    passed,
    gateAt: gateAfter(gateAt, at, passed, pass),
    waitMs: room >= 1 ? 0 : gateWait(side, builders, since, at, gateAt, plan),
  };
}

/** Вышли, а пробиться некому ни с одной стороны: отказ до боя, а не бой с нулём дравшихся. */
export const refusedAtGate = (...ts: (Pick<Through, 'went' | 'passed'> | null | undefined)[]): boolean => {
  let went = 0;
  let passed = 0;
  for (const t of ts) {
    if (!t) continue;
    went += t.went;
    passed += t.passed;
  }
  return went > 0 && passed === 0;
};

/** Слова отказа — одни на вылазку, удар полководца и панели. */
export const gateBusyText = (waitMs: number): string =>
  `К рогаткам сейчас не пробиться — люди ещё в проходе, свободно через ${Math.max(1, Math.ceil(waitMs / 60_000))} мин.`;

/** Как сторона называется в строке «пробились с тыла, со стороны города». */
const FROM: Record<CampSide, string> = { front: 'со стороны города', rear: 'с тыла' };

/**
 * Строка отчёта после боя: сколько пробились с каждой стороны. Пусто, когда прошли
 * все — укрепления тогда ни на что не повлияли, и говорить о них нечего. Начинается
 * с пробела: её дописывают к исходу.
 */
export function throughText(...ts: (Pick<Through, 'side' | 'went' | 'passed'> | null | undefined)[]): string {
  const parts = ts.filter((t): t is Pick<Through, 'side' | 'went' | 'passed'> => Boolean(t) && (t as Through).went > 0);
  if (parts.every((t) => t.passed >= t.went)) return '';
  const said = parts.map((t) => `${FROM[t.side]} ${t.passed} из ${t.went}`).join(', ');
  return ` К рогаткам пробились бойцов строя: ${said}; остальные в бою не были.`;
}

/**
 * Потери нападающих, пробившихся с двух сторон, делятся между сторонами по родам —
 * пропорционально тому, сколько каждого рода прошло с каждой. Ни одна сторона не
 * теряет больше, чем у неё прошло, и сумма двух долей равна потерям до бойца, пока
 * потерь не больше прошедших: ни один боец не считается дважды.
 */
export function splitLosses(lost: Stack, front: Stack, rear: Stack): { front: Stack; rear: Stack } {
  const f: Stack = { spear: 0, infantry: 0, archer: 0, cavalry: 0 };
  const r: Stack = { spear: 0, infantry: 0, archer: 0, cavalry: 0 };
  for (const k of UNIT_KINDS) {
    const a = Math.max(0, front[k] ?? 0);
    const b = Math.max(0, rear[k] ?? 0);
    const l = Math.min(Math.max(0, Math.round(lost[k] ?? 0)), a + b);
    if (l === 0 || a + b === 0) continue;
    f[k] = Math.min(a, Math.max(l - b, Math.round((l * a) / (a + b))));
    r[k] = l - f[k];
  }
  return { front: f, rear: r };
}

/** Что панель вылазки говорит до нажатия. */
export interface SortieForecast {
  /** Выйди сейчас — вот что будет у рогаток со стороны города. */
  now: Through;
  /** Когда фронт дозреет и какой тогда будет пропуск. */
  ripeAt: number;
  ripePass: number;
  /** Когда проход фронта освободится целиком и сколько он тогда пропустит. */
  clearAt: number;
  clearPass: number;
}

/** То, что мир отдаёт наружу об осаде: из этого считают окна. */
export interface CampSight {
  since: number;
  /**
   * Сколько бойцов строя ставили рогатки: люди лагеря в минуту, когда он встал. От них
   * считается пропуск (`campPass`), и убыль лагеря после этого его не сужает.
   */
  builders: number;
  gateAt?: number;
  rearGateAt?: number;
  /** Доли древесины; нет поля — правило бота (`CAMP_WOOD`). */
  wood?: WoodPlan;
}

/** Отметка прохода стороны в окне осады. */
const gateOf = (siege: Pick<CampSight, 'gateAt' | 'rearGateAt'>, side: CampSide): number | undefined =>
  side === 'front' ? siege.gateAt : siege.rearGateAt;

/**
 * Прогноз прохода для панели вылазки: вылазка лезет во фронт. Исхода боя он не
 * предсказывает — только то, сколько дойдёт до рогаток, а это видно со стены.
 * Считает он той же `throughWorks`, что и бой; своей арифметики у панели нет.
 */
export function sortieForecast(siege: CampSight, going: Stack, at: number): SortieForecast {
  const clearAt = Math.max(at, siege.gateAt ?? at);
  const plan = siege.wood ?? CAMP_WOOD;
  return {
    now: throughWorks('front', siege.builders, siege.since, at, going, siege.gateAt, plan),
    ripeAt: worksRipeAt(siege.since, 'front', plan),
    ripePass: campPass(siege.builders, 1),
    clearAt,
    clearPass: campPass(siege.builders, sideWorks(siege.since, clearAt, 'front', plan)),
  };
}

/**
 * Удар полководца: дружина — в тыл, гарнизон, если его зовут, — во фронт, в минуту
 * прихода `at`. Проходы сторон читаются каждый своей отметкой: занятость одной на
 * другую не влияет. Той же `throughWorks`, что и бой.
 */
export function strikeForecast(
  siege: CampSight,
  at: number,
  rear: Stack,
  front: Stack | null,
): { rear: Through; front: Through | null } {
  const plan = siege.wood ?? CAMP_WOOD;
  return {
    rear: throughWorks('rear', siege.builders, siege.since, at, rear, siege.rearGateAt, plan),
    front: front ? throughWorks('front', siege.builders, siege.since, at, front, siege.gateAt, plan) : null,
  };
}

/** Одна сторона лагеря для окна осады — что с ней сейчас. */
export interface SideSight {
  side: CampSide;
  /** Готовность, 0..1. */
  works: number;
  /** Когда дозреет; бесконечность — в неё не кладут ничего. */
  ripeAt: number;
  /** Пропуск при свободном проходе, бойцов строя. */
  pass: number;
  /** Сколько пропустит прямо сейчас. */
  room: number;
  /** Через сколько пропустит хоть одного, мс. */
  waitMs: number;
}

/**
 * Обе стороны лагеря для окон осады — осаждающего и обороняющегося. Строится той же
 * `throughWorks`, которой считает бой, только без отряда: окну нужна сама сторона —
 * готовность, срок и проход, — а кто полезет, решает приказ.
 */
export function campSides(siege: CampSight, at: number): Record<CampSide, SideSight> {
  const plan = siege.wood ?? CAMP_WOOD;
  const one = (side: CampSide): SideSight => {
    const t = throughWorks(side, siege.builders, siege.since, at, { spear: 0, infantry: 0, archer: 0, cavalry: 0 }, gateOf(siege, side), plan);
    return {
      side,
      works: t.works,
      ripeAt: worksRipeAt(siege.since, side, plan),
      pass: t.pass,
      room: t.room,
      waitMs: t.waitMs,
    };
  };
  return { front: one('front'), rear: one('rear') };
}

/** Минуты словами: «через N мин», не меньше одной. */
const mins = (ms: number): number => Math.max(1, Math.ceil(ms / 60_000));

/** Как сторона называется в строке панели. */
export const SIDE_NAME: Record<CampSide, string> = { front: 'Со стороны города', rear: 'С тыла' };

/**
 * Что из этого следует для обороняющегося — только когда стороны разные. Одинаково
 * крепкие стороны подсказки не дают, и выдумывать её нельзя.
 */
export function weakSide(since: number, at: number, plan: WoodPlan = CAMP_WOOD): CampSide | null {
  const f = sideWorks(since, at, 'front', plan);
  const r = sideWorks(since, at, 'rear', plan);
  if (Math.abs(f - r) < 0.05) return null;
  return f < r ? 'front' : 'rear';
}

/** Подсказка обороняющемуся по слабой стороне — одни слова на окно и на карту. */
export const WEAK_HINT: Record<CampSide, string> = {
  front: 'Со стороны города слабее: бей вылазкой сейчас.',
  rear: 'Тыл слабее: зови полководца — он бьёт с тыла из поля.',
};

/** Проход словами — хвост к строкам ниже; пусто, когда проход свободен. */
function gateTail(gateAt: number | undefined, at: number): string {
  if (gateFree(gateAt, at) >= 1 || gateAt === undefined) return '';
  return ` Проход занят: освободится через ${mins(gateAt - at)} мин.`;
}

/**
 * Одна сторона одной строкой для тех, кто смотрит на лагерь снаружи и не знает,
 * сколько в нём людей: карточка на карте, меню полководца. Проход поэтому назван
 * долей — сколько нападающих на каждого, кто ставил лагерь.
 */
function sideWords(side: CampSide, since: number, at: number, gateAt: number | undefined, plan: WoodPlan): string {
  const works = sideWorks(since, at, side, plan);
  if (works <= 0) return `${SIDE_NAME[side]} рогаток ещё нет: к бою пройдут все.${gateTail(gateAt, at)}`;
  const num = (v: number): string => (v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace('.', ','));
  const share = `к бою пройдут не больше ${num(passPerMan(works))} бойцов строя на каждого, кто ставил лагерь`;
  if (works >= 1) return `${SIDE_NAME[side]} рогатки дозрели: ${share}.${gateTail(gateAt, at)}`;
  const ripe = worksRipeAt(since, side, plan);
  const when = ripe < Infinity ? ` Дозреют через ${mins(ripe - at)} мин — тогда ${num(CAMP_WORKS_PASS)}.` : ' Дальше не растут: сюда не рубят.';
  return `${SIDE_NAME[side]} рогатки достроены на ${Math.floor(works * 100)}%: ${share}.${when}${gateTail(gateAt, at)}`;
}

/** Обе стороны лагеря словами. */
export function worksWords(siege: Omit<CampSight, 'builders'>, at: number): string {
  const plan = siege.wood ?? CAMP_WOOD;
  return `${sideWords('front', siege.since, at, siege.gateAt, plan)} ${sideWords('rear', siege.since, at, siege.rearGateAt, plan)}`;
}
