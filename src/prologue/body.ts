/**
 * Человек: сытость, тепло и здоровье. Три полосы — **чистые функции от времени**,
 * по тому же правилу, что костёр.
 *
 * ГРАНИЦА ВРЕМЕНИ ЗДЕСЬ ТА ЖЕ, И ОНА НЕ РАЗМЫТА НИ НА ШАГ. В сохранении лежат
 * числа «сколько было и в какую минуту», а сколько сейчас, выводит формула в
 * момент вопроса. Тика нет, таймера нет, догона нет. Час игры и час без игры
 * стоят человеку одинаково, и неважно, сколько раз за это время открывали аппку.
 *
 * ПОЛОСЫ ТРИ, И УСТРОЕНЫ ОНИ ОДНИМ ПРАВИЛОМ: две нужды и жизнь.
 *
 *   сытость   уходит за `STARVE_H` — всегда, одной прямой;
 *   тепло     уходит за `COLD_H` вдали от огня и у погасшего —
 *             средних по погоде часов (см. `HOUR_OF_COLD`); у горящего огня
 *             возвращается за `WARM_MIN`;
 *   здоровье  пока обе нужды закрыты, стоит — или медленно заживает у огня и
 *             под крышей (`HEAL_H`); **опустела нужда — здоровье уходит
 *             за `HEALTH_H`**, обе сразу — вдвое быстрее. Волк снимает
 *             укус из `WOLF_BITES`, мясо возвращает.
 *
 * Смерть одна — здоровье кончилось. Отсюда «от полной беспечности до смерти»:
 * тепло за `COLD_H`, здоровье за `HEALTH_H` — **их сумма**. И голод тем же
 * путём: `STARVE_H` сытости, потом `HEALTH_H` здоровья.
 *
 * ЭТО ОДНА МОДЕЛЬ ХОЛОДА, А НЕ ДВЕ. Прежняя «без огня человек живёт восемь
 * часов» и её множители (ночь, снег, одежда, крыша) не легли рядом с новой — они
 * стали ею: восемь часов до смерти превратились в полосу тепла (`COLD_H`), а множители
 * остались множителями **к полосе тепла**. Срок здоровья после неё (`HEALTH_H`)
 * погода и одежда не трогают: замёрзшему одежда уже не помогает, а небо над ним
 * не имеет значения. Поэтому `HEALTH_H` — ровно столько при любой погоде.
 *
 * СКОРОСТИ ТЕПЛА РАЗОШЛИСЬ НЕ ДЛЯ БАЛАНСА, а потому что иначе не бывает: заход
 * длится три минуты, отсутствие — сутки, и одной линейной скоростью обслужить
 * оба нельзя. Выбрано так, чтобы видно было то, что игрок делает, — а делает он
 * ровно одно: возвращается к огню.
 *
 * УХОДЯ, ЧЕЛОВЕК ВОЗВРАЩАЕТСЯ К КОСТРУ — И ЭТО ПРАВИЛО, А НЕ ОГОВОРКА. Отметка
 * `warm` («грелся ли он в минуту `at`») на диск ложится всегда поднятой:
 * промежуток между заходами человек проводит на стоянке, а не там, где его застало
 * закрытие вкладки. Иначе игра убивала бы за разряженный у дерева телефон. Делает
 * это `savePrologue`, и делает структурно: закрывает отрезок текущей отметкой и
 * только потом кладёт `warm: true`.
 *
 * СМЕРТЬ — ЧТЕНИЕ, А НЕ СОБЫТИЕ. Поля «мёртв» в сохранении нет и заводить его
 * нельзя: здоровье, дойдя до нуля, там и остаётся, и «жив ли он» — вопрос к
 * формуле, ответ на который один и тот же, сколько раз ни спроси.
 *
 * Модуль чистый: ни DOM, ни three, ни React, ни часов.
 */
import { HEARTH_CAP, LOG_MS, burnRate, spanWords, type Hearth } from './fire';
import { CHILL_MEAN, burnUntil, chillUntil, chilledMs } from './sky';

const H = 3_600_000;

/**
 * Сколько часов уходит сытость — от полной до пустой.
 *
 * Сорок восемь — ровно столько же, сколько горит полный очаг в погожее время, и
 * это то, что игрок должен запомнить с одного раза: **двое суток на полном очаге
 * и полном животе.** Пустой живот ещё не смерть: дальше тает здоровье.
 */
export const STARVE_H = 48;
export const STARVE_MS = STARVE_H * H;

/**
 * Сколько часов уходит тепло вдали от огня — от полного до пустого.
 *
 * Сутки. Это прежние «восемь часов до смерти», сведённые с полосой здоровья в
 * одно: тепло больше не убивает само, оно кончается, и дальше тает здоровье.
 * Часы — средние по погоде (`HOUR_OF_COLD`).
 */
export const COLD_H = 24;
export const COLD_MS = COLD_H * H;

/**
 * За сколько часов опустевшая нужда съедает всё здоровье.
 *
 * Полсуток, ровно и в любую погоду: у голода нет неба, а замёрзшему небо уже не
 * страшнее, чем есть. Опустели обе нужды — здоровье тает вдвое быстрее: каждая
 * берёт своё.
 */
export const HEALTH_H = 12;
export const HEALTH_MS = HEALTH_H * H;

/**
 * За сколько часов здоровье возвращается само — от нуля до полного.
 *
 * ОЧЕНЬ МЕДЛЕННО, И ТОЛЬКО В ПОКОЕ: у горящего огня или под крышей достроенного
 * дома, и только пока обе нужды закрыты. Без этого человек, у которого нет мяса,
 * лечился бы одной смертью: пустая кладовая после смерти ему не потеря, а полное
 * здоровье — награда. Двое суток — мера режима (как полный очаг `BURN_FULL_MS` и
 * живот `STARVE_H`): укус заживает за `HEAL_H / WOLF_BITES`, то есть за ночь без
 * игры, а в заходе заживление не
 * видно вовсе — быстро здоровье возвращает только мясо.
 */
export const HEAL_H = 48;
export const HEAL_MS = HEAL_H * H;

/** За сколько минут у горящего костра возвращается всё тепло. */
export const WARM_MIN = 20;
export const WARM_MS = WARM_MIN * 60_000;

/**
 * Сколько укусов волка снимают всё здоровье.
 *
 * Шесть — укус снимает шестую часть. Считается здоровье **в укусах**, а не в
 * долях, и это не вкус, а арифметика: шесть шестых в числах с плавающей точкой
 * дают 0.9999999999999999, и шестой укус не убивал бы. Целые укусы складываются
 * ровно (эта же ловушка однажды уже была поймана тестом с тремя ранами).
 */
export const WOLF_BITES = 6;

/**
 * Во сколько раз медленнее уходит тепло у одетого.
 *
 * Шесть десятых — множитель к **скорости**, а не к сроку: полосу тепла (`COLD_H`)
 * одетый тратит за `COLD_H / COAT_CHILL`. Здоровья одежда не держит, отогрева не ускоряет.
 */
export const COAT_CHILL = 0.6;

/**
 * С каким холодом человек приходит к огню — на новую поляну и в новое утро.
 *
 * ЗИМА С ПЕРВОГО КАДРА. Человек пришёл через зимний лес, и шесть десятых тепла
 * он там оставил: полоса тепла встаёт на экран неполной и тает дальше, пока он не
 * постоит у огня (`ARRIVAL_COLD × WARM_MIN` на то, что потеряно). Это не опасность —
 * до пустой полосы остаётся `(1 − ARRIVAL_COLD) × COLD_H`, — а то, что холод давит
 * сразу и это видно.
 */
export const ARRIVAL_COLD = 0.6;

/**
 * Час холода — средний по погоде час.
 *
 * Небо студит неровно: ночь сильнее ясного дня (`sky.NIGHT_CHILL`), снег — тоже
 * (`sky.SNOW_CHILL`), и кольцо погод даёт среднюю ставку `CHILL_MEAN`. Сроки тепла
 * в этом файле названы в **средних** часах: ясный день студит на `HOUR_OF_COLD`
 * часа за час, ночь и снег — во столько же раз сильнее, во сколько и были. Отсюда
 * «сутки» полосы тепла — настоящие сутки в среднем, а с какой минуты кольца ни
 * начни, разница мала: за сутки кольцо (`sky.RING_MS`) проходит много раз.
 */
const HOUR_OF_COLD = 1 / CHILL_MEAN;

/**
 * Что человек помнит о себе между заходами.
 *
 * Четыре числа и три отметки. «Сколько осталось», «через сколько умрёт»,
 * «заживает ли» — всё это считается отсюда при чтении.
 */
export interface Body {
  /** Голод в минуту `at`: 0 — сыт, 1 — живот пуст. */
  hunger: number;
  /** Холод в минуту `at`: 0 — тепло, 1 — тепла не осталось. */
  cold: number;
  /** Урон в минуту `at`, в укусах: 0 — цел, `WOLF_BITES` — здоровья нет. */
  harm: number;
  /** Одет ли в шкуру. Хранится как есть: одежда — вещь, а не место. */
  coat: boolean;
  /** Когда это было, по `serverNow()`. */
  at: number;
  /**
   * Грелся ли он у огня в минуту `at`. На диск ложится всегда поднятым (шапка
   * файла), а в памяти его ведёт сцена — по кругу у костра, а не по кадрам.
   */
  warm: boolean;
  /**
   * Под крышей ли он в минуту `at`. На диск ложится тем, что даёт стоянка, —
   * ночует ли человек в достроенном доме (`camp`), — а в памяти её ведёт сцена.
   */
  roof: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Свежий человек: сыт, цел, раздет, у огня и не под крышей. Холод — какой скажут. */
export const newBody = (now: number, cold = 0): Body => ({
  hunger: 0,
  cold: clamp(cold, 0, 1),
  harm: 0,
  coat: false,
  at: now,
  warm: true,
  roof: false,
});

/**
 * Когда погаснет костёр.
 *
 * Единственный перелом, который случается с теплом сам собой, без действия
 * игрока, — и потому его надо уметь назвать числом, а не ловить тиком. Мера
 * прогорания та же, что у полосы (`fire.burnRate`): бережёт очаг хозяйка — гаснет
 * он позже, и тепло узнаёт об этом из того же числа.
 */
export const fireOutAt = (h: Hearth): number =>
  h.fuel > 0 ? burnUntil(h.at, (Math.min(h.fuel, HEARTH_CAP) * LOG_MS) / burnRate(h)) : -Infinity;

/**
 * Сколько холода набирается за промежуток вдали от огня, в долях полосы.
 *
 * Крыша снимает небо — время идёт ставкой ясного дня; одежда снимает долю. Одна
 * функция на тепло сейчас и на срок пустой полосы, и другой быть не должно:
 * разойдись они — полоса называла бы один срок, а пустела бы в другой.
 */
const chillGain = (b: Body, from: number, to: number): number =>
  ((b.roof ? Math.max(0, to - from) : chilledMs(from, to)) * HOUR_OF_COLD * (b.coat ? COAT_CHILL : 1)) / COLD_MS;

/** В какую минуту от `from` наберётся `gain` холода — обратная к `chillGain`. */
const chillReach = (b: Body, from: number, gain: number): number => {
  const need = (gain * COLD_MS) / HOUR_OF_COLD / (b.coat ? COAT_CHILL : 1);
  return b.roof ? from + need : chillUntil(from, need);
};

/** Отчего человек умер. `null` — жив. */
export type Death = 'hunger' | 'cold' | 'wolf' | null;

/**
 * Причина — по тому, что было пусто в минуту смерти: тепло, потом живот, и если
 * обе нужды закрыты — зубы.
 *
 * Правило одно на смерть посреди отрезка и на смерть, уже лежащую в записи, и
 * иначе нельзя: запись хранит только полосы, а не то, чем кончилось. Отсюда
 * следствие, и оно решение, а не недосмотр: замёрзшего, которого добил волк, игра
 * называет замёрзшим. К зубам его привёл холод, и совет на экране смерти — про
 * огонь — ровно тот, что ему нужен.
 */
const causeOf = (cold: boolean, starving: boolean): Death => (cold ? 'cold' : starving ? 'hunger' : 'wolf');

/** Скорость, с которой опустевшие нужды съедают здоровье, укусов в миллисекунду. */
const drainRate = (cold: boolean, starving: boolean): number =>
  ((cold ? 1 : 0) + (starving ? 1 : 0)) * (WOLF_BITES / HEALTH_MS);

/** Что стало с человеком к минуте: три полосы и, если случилось, смерть. */
interface Trace {
  hunger: number;
  cold: number;
  harm: number;
  /** Минута смерти, если она случилась к концу отрезка; иначе `Infinity`. */
  dead: number;
  cause: Death;
  /** Минута, в которую тепло опустело на этом пути. `Infinity` — не опустело. */
  coldOut: number;
}

/**
 * Пройти промежуток от отметки до минуты `until` и сказать, что стало.
 *
 * ПЕРЕЛОМОВ У ПРОМЕЖУТКА НЕ БОЛЬШЕ ЧЕТЫРЁХ, и все они называются числом, а не
 * ловятся: гаснет костёр (`fireOutAt`), пустеет живот (прямая), пустеет тепло
 * (обратная к интегралу погоды) и — если дошло — кончается здоровье. Внутри
 * каждого куска все скорости постоянны или идут по интегралу кольца, поэтому
 * кусок считается за шаг. Обход — это четыре куска, а не часы и не спеллы: от
 * длины отсутствия работа не зависит.
 *
 * Разбиение точное: пройди тот же промежуток по частям — получишь то же, что
 * целиком. На этом стоит право закрывать отрезок в любую минуту (`anchor`), а на
 * нём вся запись на диск.
 *
 * `until` бывает `Infinity` — так спрашивают минуту смерти: после последнего
 * перелома костёр погас и живот пуст, тепло опустеет за конечный срок, и дальше
 * здоровье тает с постоянной скоростью.
 */
function trace(b: Body, h: Hearth, until: number): Trace {
  const t0 = b.at;
  const end = Math.max(t0, until);
  const hunger0 = clamp(b.hunger, 0, 1);
  let cold = clamp(b.cold, 0, 1);
  let harm = clamp(b.harm, 0, WOLF_BITES);
  // Мёртвый на отметке: полосы стоят там, где их застала смерть (`anchor`).
  if (harm >= WOLF_BITES) {
    return { hunger: hunger0, cold, harm: WOLF_BITES, dead: t0, cause: causeOf(cold >= 1, hunger0 >= 1), coldOut: cold >= 1 ? t0 : Infinity };
  }
  const out = fireOutAt(h);
  const starveAt = t0 + (1 - hunger0) * STARVE_MS;
  const hungerTo = (t: number): number => clamp(hunger0 + (t - t0) / STARVE_MS, 0, 1);
  const marks = [t0];
  if (out > t0 && out < end) marks.push(out);
  if (starveAt > t0 && starveAt < end) marks.push(starveAt);
  marks.sort((x, y) => x - y);
  marks.push(end);
  let coldOut = cold >= 1 ? t0 : Infinity;

  /**
   * Кусок, внутри которого нужды не меняются: здоровье тает, заживает или стоит.
   * Возвращает минуту смерти внутри куска или `Infinity`.
   */
  const piece = (from: number, to: number, coldEmpty: boolean, starving: boolean, rest: boolean): number => {
    const rate = drainRate(coldEmpty, starving);
    if (rate > 0) {
      const dead = from + (WOLF_BITES - harm) / rate;
      if (dead <= to) return dead;
      harm += (to - from) * rate;
    } else if (rest) {
      harm = Math.max(0, harm - ((to - from) * WOLF_BITES) / HEAL_MS);
    }
    return Infinity;
  };

  /**
   * Смерть внутри куска. Полосы встают на то, какими их застала смерть, а причина
   * читается из них тем же правилом, что у записанного на диск (`causeOf`), —
   * поэтому причина не меняется оттого, закрыли отрезок на смерти или нет.
   */
  const done = (dead: number, coldThen: number): Trace => {
    const hunger = hungerTo(dead);
    return { hunger, cold: coldThen, harm: WOLF_BITES, dead, cause: causeOf(coldThen >= 1, hunger >= 1), coldOut };
  };

  for (let i = 0; i + 1 < marks.length; i++) {
    const from = marks[i];
    const to = marks[i + 1];
    if (!(to > from)) continue;
    // Отрезок целиком до гашения — значит, огонь на нём горел.
    const lit = to <= out;
    const starving = from >= starveAt;
    if (b.warm && lit) {
      // У огня тепло возвращается — по настоящим часам и одной скоростью в любую
      // погоду: греет огонь, а не небо. Пустой полосы у огня не бывает.
      const was = cold;
      const dead = piece(from, to, false, starving, true);
      if (dead < Infinity) return done(dead, Math.max(0, was - (dead - from) / WARM_MS));
      cold = Math.max(0, was - (to - from) / WARM_MS);
      continue;
    }
    const tc = cold >= 1 ? from : chillReach(b, from, 1 - cold);
    const mid = Math.min(tc, to);
    if (mid > from) {
      const was = cold;
      const dead = piece(from, mid, false, starving, b.roof);
      if (dead < Infinity) return done(dead, dead >= tc ? 1 : Math.min(1, was + chillGain(b, from, dead)));
      // Делением, а не умножением на обратное: сутки обязаны дать ровно единицу,
      // иначе полоса и срок разойдутся на границе на наносекунду.
      cold = mid === tc ? 1 : Math.min(1, was + chillGain(b, from, mid));
    }
    if (tc < to) {
      cold = 1;
      coldOut = Math.min(coldOut, Math.max(from, tc));
      const dead = piece(Math.max(from, tc), to, true, starving, false);
      if (dead < Infinity) return done(dead, 1);
    }
  }
  return { hunger: hungerTo(end), cold, harm, dead: Infinity, cause: null, coldOut };
}

/** Сколько голода сейчас. Растёт всегда; у мёртвого стоит там, где застала смерть. */
export function hungerAt(b: Body, now: number): number {
  if (b.harm >= WOLF_BITES) return clamp(b.hunger, 0, 1);
  return clamp(b.hunger + Math.max(0, now - b.at) / STARVE_MS, 0, 1);
}

/** Сколько холода сейчас: 0 — тепло, 1 — тепла не осталось. */
export const coldAt = (b: Body, h: Hearth, now: number): number => trace(b, h, now).cold;

/** Сколько урона сейчас, в укусах: 0 — цел, `WOLF_BITES` — мёртв. */
export const harmAt = (b: Body, h: Hearth, now: number): number => trace(b, h, now).harm;

/** Греется ли человек прямо сейчас: у огня и огонь горит. */
export const warming = (b: Body, h: Hearth, now: number): boolean => b.warm && fireOutAt(h) > Math.max(b.at, now);

/**
 * Тает ли здоровье прямо сейчас: какая-то нужда пуста, а человек ещё жив.
 * Надстройка красит по этому полосу здоровья тревогой.
 */
export function draining(b: Body, h: Hearth, now: number): boolean {
  const s = trace(b, h, now);
  return s.dead === Infinity && (s.cold >= 1 || s.hunger >= 1);
}

/** Заживает ли здоровье прямо сейчас: ранен, в покое, и обе нужды закрыты. */
export function healing(b: Body, h: Hearth, now: number): boolean {
  const s = trace(b, h, now);
  if (s.dead < Infinity || s.harm <= 0 || s.cold >= 1 || s.hunger >= 1) return false;
  return warming(b, h, now) || b.roof;
}

/** В какую минуту опустеет живот, если не поесть. */
export const hungerEmptyAt = (b: Body): number => b.at + (1 - clamp(b.hunger, 0, 1)) * STARVE_MS;

/** В какую минуту опустеет тепло, если ничего не изменится. `Infinity` — раньше умрёт от голода. */
export const coldEmptyAt = (b: Body, h: Hearth): number => trace(b, h, Infinity).coldOut;

/**
 * В какую минуту человек умрёт, если ничего не изменится.
 *
 * `Infinity` не бывает: костёр когда-нибудь гаснет, живот когда-нибудь пустеет.
 * Считать это надо, а не прикидывать: полоса здоровья называет срок теми же
 * словами, что полоса костра, и ошибка тут — обещание, которое не сбудется.
 */
export const deadAt = (b: Body, h: Hearth): number => trace(b, h, Infinity).dead;

/** Сколько осталось жить, если ничего не изменится, миллисекунды. */
export const lifeLeftMs = (b: Body, h: Hearth, now: number): number => Math.max(0, deadAt(b, h) - now);

/**
 * Жив ли человек, и если нет — отчего умер.
 *
 * Причина — по тому, что было пусто в минуту смерти (`causeOf`): смерть тут
 * одна, здоровье кончилось, а называется то, что его доело.
 */
export function causeOfDeath(b: Body, h: Hearth, now: number): Death {
  const s = trace(b, h, now);
  return s.dead < Infinity ? s.cause : null;
}

/** Отчего умер — словами, для экрана. */
export const deathWords = (d: Death): string =>
  d === 'cold' ? 'Замёрз' : d === 'hunger' ? 'Умер от голода' : d === 'wolf' ? 'Загрызли волки' : '';

/**
 * Закрыть отрезок: посчитать полосы на минуту `now` и записать её отметкой.
 *
 * Действие само по себе ничего не меняет — числа после него те же, что дала бы
 * формула, — и потому им можно пользоваться свободно: перед едой, перед записью
 * на диск, при выходе из круга у костра.
 *
 * СМЕРТЬ ЗАКРЫВАЕТ ОТРЕЗОК НА СЕБЕ, а не на `now`. Мёртвого у огня тепло
 * возвращалось бы, и причина, которую назвала запись, поменялась бы у
 * записанного на диск трупа сама. Поэтому отметка встаёт на минуту смерти, а
 * полосы — на то, какими их застала смерть.
 */
export function anchor(b: Body, h: Hearth, now: number): Body {
  const s = trace(b, h, now);
  if (s.dead < Infinity) return { ...b, hunger: s.hunger, cold: s.cold, harm: WOLF_BITES, at: s.dead };
  return {
    hunger: s.hunger,
    cold: s.cold,
    harm: s.harm,
    // Часы, переведённые назад, отметку не двигают: запись из будущего должна
    // остаться записью из будущего, а не подарить человеку прожитое заново.
    at: Math.max(b.at, now),
    warm: b.warm,
    coat: b.coat,
    roof: b.roof,
  };
}

/**
 * Волк дотянулся.
 *
 * ЭТО МЕСТО, ГДЕ КАДР КАСАЕТСЯ ЗАПИСИ, И ОНО СОБЫТИЕ, А НЕ ВЕЛИЧИНА. Отрезок
 * закрывается формулой, отметка переезжает на текущую минуту, урон растёт ровно
 * на укус — и дальше опять считает формула. В кадрах не копится ничего.
 *
 * Заживания между укусами нет по устройству, а не по счастью: заживают только у
 * горящего огня и под крышей, а туда волк не входит и оттуда не кусает
 * (`wolves.wolfCanBite`). Значит `WOLF_BITES` укусов подряд — это ровно столько же целых.
 */
export const bite = (b: Body, h: Hearth, now: number, much = 1): Body => {
  const a = anchor(b, h, now);
  if (a.harm >= WOLF_BITES) return a;
  return { ...a, harm: Math.min(WOLF_BITES, a.harm + Math.max(0, much)) };
};

/** Человек вошёл в круг у костра или вышел из него. */
export const setWarm = (b: Body, h: Hearth, now: number, warm: boolean): Body =>
  warm === b.warm ? b : { ...anchor(b, h, now), warm };

/**
 * Человек вошёл под крышу дома или вышел из-под неё.
 *
 * Событие того же рода, что круг у огня: отрезок закрывается прежней скоростью,
 * дальше считает новая.
 */
export const setRoof = (b: Body, h: Hearth, now: number, roof: boolean): Body =>
  roof === b.roof ? b : { ...anchor(b, h, now), roof };

/** Надеть сшитую одежду. До минуты `now` стыл раздетым, дальше — одетым. */
export const wearCoat = (b: Body, h: Hearth, now: number): Body => ({ ...anchor(b, h, now), coat: true });

/**
 * Отметка «человек на стоянке» — та, что уезжает на диск.
 *
 * Пройденное вдали от огня закрывается честно (`anchor`), а всё, что случится
 * дальше, считается по стоянке: огонь и, если дом достроен, крыша над головой.
 * `roof` передаёт тот, кто знает про дом (`save.ts`), — телу про стройку знать
 * незачем.
 */
export const camp = (b: Body, h: Hearth, now: number, roof = false): Body => {
  const a = anchor(b, h, now);
  return a.harm >= WOLF_BITES ? a : { ...a, warm: true, roof };
};

/** Сколько часов сытости даёт кусок жареного мяса. */
export const MEAT_FED_H = 8;

/**
 * Во сколько раз сырое мясо хуже жареного — и в сытости, и в здоровье.
 *
 * Есть сырое **можно**, и это решение: запрет был бы погасшей кнопкой там, где у
 * игрока есть выбор. Цена сырого не в болезни, а в том, что туша не бесконечна:
 * съеденное сырьём — две трети оленя, выброшенные в никуда. Правило одно на обе
 * пользы: сырой кусок — треть жареного во всём.
 */
export const RAW_SHARE = 1 / 3;

/**
 * Сколько здоровья возвращает кусок жареного мяса, в укусах.
 *
 * Один: кусок — укус обратно, олень — всё здоровье. Мясо — единственный быстрый
 * путь к здоровью; само оно возвращается за `HEAL_H` покоя.
 */
export const MEAT_HEAL = 1;

/** Сколько часов сытости даёт кусок: жареный или сырой. */
export const mealHours = (raw: boolean): number => (raw ? MEAT_FED_H * RAW_SHARE : MEAT_FED_H);

/** Сколько укусов здоровья возвращает кусок: жареный или сырой. */
export const mealHeal = (raw: boolean): number => (raw ? MEAT_HEAL * RAW_SHARE : MEAT_HEAL);

/**
 * Поесть: сытость и здоровье разом, одной отметкой.
 *
 * Сверх полного не набирается ни то, ни другое: лишнее пропадает, и есть на
 * полный живот при полном здоровье `act.ts` не даёт.
 */
export function eat(b: Body, h: Hearth, now: number, raw: boolean): Body {
  const a = anchor(b, h, now);
  if (a.harm >= WOLF_BITES) return a;
  return {
    ...a,
    hunger: clamp(a.hunger - (mealHours(raw) * H) / STARVE_MS, 0, 1),
    harm: clamp(a.harm - mealHeal(raw), 0, WOLF_BITES),
  };
}

/** Сытость полосой: 1 — сыт, 0 — живот пуст. */
export const fedFill = (b: Body, now: number): number => 1 - hungerAt(b, now);

/** Тепло полосой: 1 — тепло, 0 — тепла не осталось. */
export const warmthFill = (b: Body, h: Hearth, now: number): number => 1 - coldAt(b, h, now);

/** Здоровье полосой: 1 — цел, 0 — мёртв. */
export const healthFill = (b: Body, h: Hearth, now: number): number => 1 - harmAt(b, h, now) / WOLF_BITES;

/** Сколько ещё сытости — словами. Пустой живот называется своим словом. */
export const fedWords = (b: Body, now: number): string =>
  hungerAt(b, now) >= 1 ? 'голод' : spanWords(hungerEmptyAt(b) - now);

/** Что с теплом — словами. */
export function warmthWords(b: Body, h: Hearth, now: number): string {
  const cold = coldAt(b, h, now);
  if (cold >= 1) return 'мёрзнет';
  if (warming(b, h, now)) return cold > 0 ? 'греется' : 'тепло';
  const out = coldEmptyAt(b, h);
  return out < Infinity ? spanWords(out - now) : '';
}

/**
 * Что со здоровьем — словами.
 *
 * Тает — срок до смерти: это единственная полоса, которая этот срок называет, и
 * называть его надо прямо. Заживает — «заживает», без срока: срок зависел бы от
 * того, сколько ещё прогорит очаг, а обещать то, что игрок сам может сорвать,
 * полоса не должна. Цела или просто стоит — ничего.
 */
export function healthWords(b: Body, h: Hearth, now: number): string {
  if (causeOfDeath(b, h, now)) return '';
  if (draining(b, h, now)) return spanWords(lifeLeftMs(b, h, now));
  return healing(b, h, now) ? 'заживает' : '';
}
