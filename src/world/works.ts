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
// Латник весит восьмерых, а пропуск у дозревших рогаток — два-четыре бойца строя:
// режь по головам, и тяжёлые не прошли бы никогда. Доля строя сохраняет отряд тем,
// чем он был, — только меньше.
//
// Сила отряда входит в укрепление через проход, и только через него: рогатки держат
// люди лагеря, поэтому пропуск — это доля от них.
//
// **Проход — поток, а не порция.** Рогатки пропускают столько-то людей в единицу
// времени: прошла часть пропуска — такая же часть прохода занята, и освобождается
// она за ту же часть `CAMP_GATE_CLEAR`. Хранится одна отметка на сторону в окне
// осады — `gateAt` у фронта, `rearGateAt` у тыла; пишет их только бой у лагеря, в
// самом событии, а свободная доля выводится при чтении. Тика нет.
import { stackTotal, UNIT_KINDS, type Stack } from '@/battle';
import { CAMP_GATE_CLEAR, CAMP_WOOD, CAMP_WORKS_PASS, CAMP_WORKS_RIPE } from './data/tuning';

/** Сторона лагеря. Фронт — к городу, тыл — в поле. Не путать с `Side` боя: там нападающий и защитник. */
export type CampSide = 'front' | 'rear';
export const SIDES: readonly CampSide[] = ['front', 'rear'];

/** Сколько сторон лагерь достраивает за `CAMP_WORKS_RIPE` в каждую сторону. */
export interface WoodPlan {
  readonly front: number;
  readonly rear: number;
}

/** Сколько `CAMP_WORKS_RIPE` прошло с постановки лагеря; до неё — ноль. */
const spans = (since: number, at: number): number => Math.max(0, at - since) / CAMP_WORKS_RIPE;

/** Нарубленная древесина, в сторонах: столько сторон можно было бы обнести. */
export const woodCut = (since: number, at: number, plan: WoodPlan = CAMP_WOOD): number =>
  (Math.max(0, plan.front) + Math.max(0, plan.rear)) * spans(since, at);

/**
 * Насколько достроена сторона, 0..1. Своя доля выработки идёт в неё, пока другая
 * сторона не дозрела; дозрела — её доля переходит сюда. Растёт от постановки
 * лагеря и встаёт на единице. При `plan.front = 1` готовность фронта — ровно
 * `(t − встал) / CAMP_WORKS_RIPE`, та же, что до сторон.
 */
export function sideWorks(since: number, at: number, side: CampSide, plan: WoodPlan = CAMP_WOOD): number {
  const x = spans(since, at);
  const own = Math.max(0, side === 'front' ? plan.front : plan.rear);
  const other = Math.max(0, side === 'front' ? plan.rear : plan.front);
  if (other * x < 1) return Math.min(1, own * x);
  return Math.min(1, (own + other) * x - 1);
}

/** Когда сторона дозреет. Бесконечность — никогда: в неё не кладут ничего. */
export function worksRipeAt(since: number, side: CampSide, plan: WoodPlan = CAMP_WOOD): number {
  const own = Math.max(0, side === 'front' ? plan.front : plan.rear);
  const other = Math.max(0, side === 'front' ? plan.rear : plan.front);
  if (own <= 0 && other <= 0) return Infinity;
  const x = own >= other ? 1 / own : 2 / (own + other);
  return since + x * CAMP_WORKS_RIPE;
}

/**
 * Сколько бойцов строя нападающих входит в бой на каждого человека в лагере.
 * Недостроенные рогатки пропускают во столько раз больше, во сколько они не
 * достроены; пока стороны нет — без предела.
 */
export const passPerMan = (works: number): number => (works > 0 ? CAMP_WORKS_PASS / works : Infinity);

/**
 * Пропуск: сколько бойцов строя нападающих войдёт в бой с лагерем из `campMen`
 * бойцов строя. Бесконечность — предела нет. Не меньше одного: пройти к рогаткам
 * всегда может хоть кто-то.
 */
export const campPass = (campMen: number, works: number): number =>
  works > 0 ? Math.max(1, Math.round(Math.max(0, campMen) * passPerMan(works))) : Infinity;

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
 * Через сколько пропустит хоть одного бойца проход стороны лагеря из `campMen`,
 * занятый до `gateAt`. Пропуск со временем сужается (рогатки растут), а свободная
 * доля растёт, поэтому ответ ищется посекундно, а не формулой; искать дальше полного
 * освобождения незачем — тогда свободен весь пропуск, а он не меньше одного.
 */
export function gateWait(side: CampSide, campMen: number, since: number, at: number, gateAt: number | undefined): number {
  if (gateAt === undefined || gateAt <= at) return 0;
  for (let ms = 0; ms < gateAt - at; ms += 1000) {
    const t = at + ms;
    if (gateRoom(campPass(campMen, sideWorks(since, t, side)), gateFree(gateAt, t)) >= 1) return ms;
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
 * Что будет с отрядом у рогаток стороны `side` лагеря из `campMen` бойцов строя,
 * вставшего в `since`, если подойти в минуту `at`, когда проход этой стороны занят
 * до `gateAt`. Этой функцией считают и бой (`LocalWorld.campBattle`), и панели до
 * нажатия — второй арифметики прохода нет, и показанное число не может разойтись
 * с тем, кто дрался.
 */
export function throughWorks(
  side: CampSide,
  campMen: number,
  since: number,
  at: number,
  going: Stack,
  gateAt?: number,
): Through {
  const works = sideWorks(since, at, side);
  const pass = campPass(campMen, works);
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
    waitMs: room >= 1 ? 0 : gateWait(side, campMen, since, at, gateAt),
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

/** То, что мир отдаёт наружу об осаде: из этого считают панели. */
export interface CampSight {
  since: number;
  campMen: number;
  gateAt?: number;
  rearGateAt?: number;
}

/**
 * Прогноз прохода для панели вылазки: вылазка лезет во фронт. Исхода боя он не
 * предсказывает — только то, сколько дойдёт до рогаток, а это видно со стены.
 * Считает он той же `throughWorks`, что и бой; своей арифметики у панели нет.
 */
export function sortieForecast(siege: CampSight, going: Stack, at: number): SortieForecast {
  const clearAt = Math.max(at, siege.gateAt ?? at);
  return {
    now: throughWorks('front', siege.campMen, siege.since, at, going, siege.gateAt),
    ripeAt: worksRipeAt(siege.since, 'front'),
    ripePass: campPass(siege.campMen, 1),
    clearAt,
    clearPass: campPass(siege.campMen, sideWorks(siege.since, clearAt, 'front')),
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
  return {
    rear: throughWorks('rear', siege.campMen, siege.since, at, rear, siege.rearGateAt),
    front: front ? throughWorks('front', siege.campMen, siege.since, at, front, siege.gateAt) : null,
  };
}

/** Минуты словами: «через N мин», не меньше одной. */
const mins = (ms: number): number => Math.max(1, Math.ceil(ms / 60_000));

/** Как сторона называется в строке панели. */
const NAME: Record<CampSide, string> = { front: 'Со стороны города', rear: 'С тыла' };

/** Одна сторона коротко: готовность, срок дозревания, занятость прохода. */
function sideShort(side: CampSide, since: number, at: number, gateAt: number | undefined): string {
  const works = sideWorks(since, at, side);
  const busy = gateFree(gateAt, at) < 1 && gateAt !== undefined ? `, проход свободен через ${mins(gateAt - at)} мин` : '';
  if (works <= 0) return `${NAME[side]}: рогаток нет${busy}`;
  if (works >= 1) return `${NAME[side]}: рогатки дозрели${busy}`;
  return `${NAME[side]}: ${Math.floor(works * 100)}%, дозреют через ${mins(worksRipeAt(since, side) - at)} мин${busy}`;
}

/**
 * Что из этого следует для обороняющегося — только когда стороны разные. Одинаково
 * крепкие стороны подсказки не дают, и выдумывать её нельзя.
 */
export function weakSide(since: number, at: number): CampSide | null {
  const f = sideWorks(since, at, 'front');
  const r = sideWorks(since, at, 'rear');
  if (Math.abs(f - r) < 0.05) return null;
  return f < r ? 'front' : 'rear';
}

const HINT: Record<CampSide, string> = {
  front: 'Со стороны города слабее: бить вылазкой сейчас.',
  rear: 'Тыл слабее: его бьёт полководец из поля.',
};

/** Коротко, для тесной панели осады в углу деревни: по строке на сторону и подсказка. */
export function worksShort(siege: CampSight, at: number): string[] {
  const out = [
    sideShort('front', siege.since, at, siege.gateAt),
    sideShort('rear', siege.since, at, siege.rearGateAt),
  ];
  const weak = weakSide(siege.since, at);
  if (weak) out.push(HINT[weak]);
  return out;
}

/** Проход словами — хвост к строкам ниже; пусто, когда проход свободен. */
function gateTail(gateAt: number | undefined, at: number): string {
  if (gateFree(gateAt, at) >= 1 || gateAt === undefined) return '';
  return ` Проход занят: освободится через ${mins(gateAt - at)} мин.`;
}

/**
 * Одна сторона одной строкой для тех, кто смотрит на лагерь снаружи и не знает,
 * сколько в нём людей: карточка на карте, меню полководца. Проход поэтому назван
 * долей — сколько нападающих на каждого в лагере.
 */
function sideWords(side: CampSide, since: number, at: number, gateAt: number | undefined): string {
  const works = sideWorks(since, at, side);
  if (works <= 0) return `${NAME[side]} рогаток ещё нет: к бою пройдут все.${gateTail(gateAt, at)}`;
  const num = (v: number): string => (v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace('.', ','));
  const share = `к бою пройдут не больше ${num(passPerMan(works))} бойцов строя на каждого в лагере`;
  if (works >= 1) return `${NAME[side]} рогатки дозрели: ${share}.${gateTail(gateAt, at)}`;
  const left = mins(worksRipeAt(since, side) - at);
  return `${NAME[side]} рогатки достроены на ${Math.floor(works * 100)}%: ${share}. Дозреют через ${left} мин — тогда ${num(CAMP_WORKS_PASS)}.${gateTail(gateAt, at)}`;
}

/** Обе стороны лагеря словами. */
export function worksWords(siege: Omit<CampSight, 'campMen'>, at: number): string {
  return `${sideWords('front', siege.since, at, siege.gateAt)} ${sideWords('rear', siege.since, at, siege.rearGateAt)}`;
}
