// Укрепления лагеря: рогатки, ров, частокол — и сколько нападающих через них проходит.
//
// Модуль чистый, того же рода, что `siege.ts`: ни состояния, ни часов, ни
// `Math.random`. **Укрепление не хранится и не тикает** — это функция от двух
// чисел: когда лагерь встал под стенами (`siegeSince`) и о какой минуте спрашивают.
// Отсюда то же свойство, что у часов голода: тот же сейв и то же время дают то же
// укрепление, в любом порядке вопросов, и офлайн даёт ровно то, что непрерывная игра.
//
// **Что укрепление делает — ровно одно: сужает проход.** В бой у лагеря входит не
// больше `пропуск` бойцов строя нападающих, остальные стоят у рогаток и не дерутся —
// ни убивают, ни гибнут. Людей лагерю оно не прибавляет: разрыв сил у настоящих осад
// ×7…×169, и лагерь из пяти человек пришлось бы записывать в бой тремя сотнями, а
// запись боя — это то, что игрок читает как правду.
//
// **Проход меряется бойцами строя и режет отряд долей по родам, а не головами.**
// Латник весит восьмерых, а пропуск у дозревших рогаток — два-четыре бойца строя:
// режь по головам, и тяжёлые не прошли бы никогда, к рогаткам шли бы одни копейщики,
// а доля побед прыгала бы от того, какие головы влезли. Доля строя сохраняет отряд
// тем, чем он был, — только меньше.
//
// Сила отряда входит в укрепление через проход, и только через него: рогатки держат
// люди лагеря, поэтому пропуск — это доля от них. Время дозревания одно на всех.
//
// Бьёт по лагерю кто угодно — вылазка осаждённого, выручка соседей, полководец из
// поля, — укрепление действует одинаково на всех и на обе стороны: лагерь игрока
// укрепляется так же, как лагерь бота. Ни часов голода, ни самой осады без боя оно
// не касается: `siege.ts` про этот модуль не знает.
//
// **Проход — поток, а не порция.** Рогатки пропускают столько-то людей в единицу
// времени: прошла часть пропуска — такая же часть прохода занята, и освобождается
// она за ту же часть `CAMP_GATE_CLEAR`. Хранится одна отметка на окне осады —
// `gateAt`, до какой минуты занят проход; пишет её только бой у лагеря, в самом
// событии, а свободная доля выводится из неё при чтении. Тика нет: офлайн проход
// освобождается сам, старое окно без отметки читается свободным.
import { stackTotal, UNIT_KINDS, type Stack } from '@/battle';
import { CAMP_GATE_CLEAR, CAMP_WORKS_PASS, CAMP_WORKS_RIPE } from './data/tuning';

/** Насколько укрепления достроены, 0..1. Растёт от постановки лагеря и встаёт на единице. */
export const campWorks = (since: number, at: number): number =>
  Math.min(1, Math.max(0, (at - since) / CAMP_WORKS_RIPE));

/** Когда укрепления дозреют. */
export const worksRipeAt = (since: number): number => since + CAMP_WORKS_RIPE;

/**
 * Сколько бойцов строя нападающих входит в бой на каждого человека в лагере.
 * Недостроенные рогатки пропускают во столько раз больше, во сколько они не
 * достроены; в первую минуту — без предела.
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
 * читается и окно из старого сохранения, и лагерь, по которому ещё не били.
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
 * Через сколько пропустит хоть одного бойца проход лагеря из `campMen`, занятый до
 * `gateAt`. Пропуск со временем сужается (рогатки растут), а свободная доля
 * растёт, поэтому ответ ищется посекундно, а не формулой; искать дальше полного
 * освобождения незачем — тогда свободен весь пропуск, а он не меньше одного.
 */
export function gateWait(campMen: number, since: number, at: number, gateAt: number | undefined): number {
  if (gateAt === undefined || gateAt <= at) return 0;
  for (let ms = 0; ms < gateAt - at; ms += 1000) {
    const t = at + ms;
    if (gateRoom(campPass(campMen, campWorks(since, t)), gateFree(gateAt, t)) >= 1) return ms;
  }
  return Math.ceil(gateAt - at);
}

/** Вылазка через рогатки: одно число на панель до боя и на бой. */
export interface Through {
  /** Насколько достроены укрепления, 0..1. */
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
  /** Отметка прохода после этой вылазки — её пишет бой. */
  gateAt: number | undefined;
  /** Через сколько пропустит хоть одного, мс; ноль — пропускает сейчас. */
  waitMs: number;
}

/**
 * Что будет с отрядом у рогаток лагеря из `campMen` бойцов строя, вставшего в
 * `since`, если выйти в минуту `at`, когда проход занят до `gateAt`. Этой функцией
 * считают и бой (`LocalWorld.campBattle`), и панель вылазки до нажатия — второй
 * арифметики прохода нет, и показанное число не может разойтись с тем, кто дрался.
 */
export function throughWorks(
  campMen: number,
  since: number,
  at: number,
  going: Stack,
  gateAt?: number,
): Through {
  const works = campWorks(since, at);
  const pass = campPass(campMen, works);
  const free = gateFree(gateAt, at);
  const room = gateRoom(pass, free);
  const kinds = passKinds(going, room);
  const passed = stackTotal(kinds);
  return {
    works,
    pass,
    free,
    room,
    kinds,
    went: stackTotal(passKinds(going, Infinity)),
    passed,
    gateAt: gateAfter(gateAt, at, passed, pass),
    waitMs: room >= 1 ? 0 : gateWait(campMen, since, at, gateAt),
  };
}

/** Вышли, а пробиться некому: отказ до боя, а не бой с нулём дравшихся. */
export const refusedAtGate = (t: Pick<Through, 'went' | 'passed'>): boolean => t.went > 0 && t.passed === 0;

/** Слова отказа — одни на вылазку, удар полководца и панель. */
export const gateBusyText = (waitMs: number): string =>
  `К рогаткам сейчас не пробиться — люди ещё в проходе, свободно через ${Math.max(1, Math.ceil(waitMs / 60_000))} мин.`;

/**
 * Строка отчёта после боя: сколько пробились. Пусто, когда прошли все — укрепления
 * тогда ни на что не повлияли, и говорить о них нечего. Начинается с пробела: её
 * дописывают к исходу.
 */
export const throughText = (t: Pick<Through, 'went' | 'passed'>): string =>
  t.passed < t.went
    ? ` К рогаткам пробились ${t.passed} бойцов строя из ${t.went}, остальные в бою не были.`
    : '';

/** Что панель вылазки говорит до нажатия. */
export interface SortieForecast {
  /** Выйди сейчас — вот что будет у рогаток. */
  now: Through;
  /** Когда дозреют и какой тогда будет пропуск. */
  ripeAt: number;
  ripePass: number;
  /** Когда проход освободится целиком и сколько он тогда пропустит. */
  clearAt: number;
  clearPass: number;
}

/**
 * Прогноз прохода для панели вылазки: из того, что мир отдаёт наружу об осаде
 * (`since`, `campMen`, `gateAt`), и выбранного состава в родах боя. Исхода боя он
 * не предсказывает — только то, сколько дойдёт до рогаток, а это видно со стены.
 * Считает он той же `throughWorks`, что и бой; своей арифметики у панели нет.
 */
export function sortieForecast(
  siege: { since: number; campMen: number; gateAt?: number },
  going: Stack,
  at: number,
): SortieForecast {
  const clearAt = Math.max(at, siege.gateAt ?? at);
  return {
    now: throughWorks(siege.campMen, siege.since, at, going, siege.gateAt),
    ripeAt: worksRipeAt(siege.since),
    ripePass: campPass(siege.campMen, 1),
    clearAt,
    clearPass: campPass(siege.campMen, campWorks(siege.since, clearAt)),
  };
}

/** Занятость прохода словами — хвост к строкам ниже; пусто, когда проход свободен. */
function gateTail(gateAt: number | undefined, at: number): string {
  if (gateFree(gateAt, at) >= 1 || gateAt === undefined) return '';
  return ` Проход занят: освободится через ${Math.max(1, Math.ceil((gateAt - at) / 60_000))} мин.`;
}

/** Коротко, для тесной панели осады в углу деревни. */
export function worksShort(since: number, at: number, gateAt?: number): string {
  const works = campWorks(since, at);
  const busy = gateFree(gateAt, at) < 1 && gateAt !== undefined
    ? `, проход свободен через ${Math.max(1, Math.ceil((gateAt - at) / 60_000))} мин`
    : '';
  if (works <= 0) return 'Рогаток ещё нет: пройдут все';
  if (works >= 1) return `Рогатки дозрели: к бою почти не пробиться${busy}`;
  return `Рогатки ${Math.floor(works * 100)}%, дозреют через ${Math.ceil((worksRipeAt(since) - at) / 60_000)} мин${busy}`;
}

/**
 * Укрепления лагеря одной строкой для тех, кто смотрит на лагерь снаружи и не
 * знает, сколько в нём людей: карточка на карте, меню полководца. Проход поэтому
 * назван долей — сколько нападающих на каждого в лагере.
 */
export function worksWords(since: number, at: number, gateAt?: number): string {
  const works = campWorks(since, at);
  if (works <= 0) return 'Лагерь только встал: рогаток ещё нет, к бою пройдут все.';
  const num = (v: number): string => (v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace('.', ','));
  const share = `к бою пройдут не больше ${num(passPerMan(works))} бойцов строя на каждого в лагере`;
  if (works >= 1) return `Рогатки дозрели: ${share}.${gateTail(gateAt, at)}`;
  const left = Math.ceil((worksRipeAt(since) - at) / 60_000);
  return `Рогатки достроены на ${Math.floor(works * 100)}%: ${share}. Дозреют через ${left} мин — тогда ${num(CAMP_WORKS_PASS)}.${gateTail(gateAt, at)}`;
}
