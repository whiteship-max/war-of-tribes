// Что даст следующий уровень — замером, а не по полю здания.
//
// Кнопка улучшения не пишет чисел от себя. Она прогоняет настоящий расчёт игры
// дважды — на нынешнем уровне здания и на следующем — и называет разницу. Всё,
// что лежит между полем здания и местом, где игра это поле читает, входит в
// замер само: потолок лазарета, множитель веры на обороне, места в храме,
// которым больше нечего дать. А у Статуи и ратуши главное число встаёт на кнопку
// просто потому, что оно изменилось.
//
// Прежде подпись брала разность поля (`buildingStat`, `perLevel`) и врала ровно
// там, где игра читает не поле, а функцию от него: лазарет обещал +4 % сверх
// потолка в 35 %, храм — «+10 % к выработке» служителям, которых уровень не
// усиливает, Дозор — «+1 мин» при настоящих +40 с. Правило теперь одно, и держат
// его тесты (`upgrade.test.ts`): в этом файле нет ни одного чтения поля здания,
// а каждое число подписи совпадает с замером на каждом уровне каждого здания.
//
// Чего в замере нет, и почему. Всё это проходит, а уровень остаётся:
// - сезона и осады: рабочий меряется без них. Ферма, улучшенная в декабре, в мае
//   родит больше, и кнопка не имеет права сказать «ничего не даст» из-за зимы;
// - потолка шкалы морали и набожности: сотня — свойство посёлка, а не здания, и
//   о том, что она уже полна, говорят справка о морали и храм;
// - того, кто сейчас стоит на местах: места и работа на них меряются так, будто
//   их заняли, — иначе у пустого двора уровень «ничего бы не давал».
import type { Building, GameState } from '@/game/types';
import { DAY_LENGTH, RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { GOOD_BY_ID } from '@/game/data/market';
import type { SeasonModifiers } from '@/game/data/seasons';
import { SURVEY_MAX } from '@/game/data/survey';
import { TROOPS } from '@/game/data/troops';
import {
  buildingProduction,
  buildingSlots,
  caravanSeconds,
  crafterBuildRate,
  defense,
  faithTilt,
  feastInfo,
  forgeRate,
  healShare,
  infirmaryBeds,
  hiddenStash,
  housingCapacity,
  intelKeen,
  jobMultiplier,
  marketOffer,
  marketStock,
  moraleBreakdown,
  stalls,
  payGraceDays,
  pietyBreakdown,
  priestMorale,
  priestPiety,
  recruitRate,
  storageCap,
  taxIncomePerDay,
  towerSeats,
  townHallBuildMult,
  tradition,
  warningSeconds,
} from '@/game/derived';
import { popGrowth } from '@/game/sim/population';
import { surveyInfo } from '@/game/sim/survey';
import { militiaArchers } from '@/world/bridge';
import { plural } from './plural';
import { asGame, realSeconds } from '@/game/pace';
import { realPlain, waitDays, waitSpan } from './wait';
import { num } from '@/game/num';

/** Одна прибавка: что меряли, сколько было и станет, и как это сказано. */
export interface UpgradeGain {
  /** Какая величина. */
  id: string;
  /** Величина на нынешнем уровне и на следующем — прочитанная у игры. */
  before: number;
  after: number;
  /** Слова на кнопке. */
  text: string;
  /**
   * Числа, стоящие в словах, по порядку. Отдельным полем, чтобы тест сверял их
   * с замером, а не разбирал русскую фразу обратно.
   */
  numbers: number[];
}

/** Уровень, который не меняет ни одной величины, говорит это прямо — до оплаты. */
export const NOTHING_GAINED = 'Уровень ничего не даст';

/** Что сказать о разнице. null — на подписи её не видно. */
type Said = { text: string; numbers: number[] } | null;

interface Gauge {
  id: string;
  /** Прочесть величину у игры: функцией симуляции над всем посёлком, и только. */
  read: (s: GameState) => number;
  say: (before: number, after: number) => Said;
}

/** Число для подписи: от десятка — целое, до десятка — с десятыми. */
export const shown = (x: number): number => (Math.abs(x) >= 10 ? Math.round(x) : Math.round(x * 10) / 10);

const sign = (x: number): string => (x < 0 ? '−' : '+');

/** Число на кнопке: дробь — запятой («2,5»), как во всём тексте игры (docs/ui_audit.md, 4.5). */
const frac = (x: number): string => num(x, 3);

/** Числа, стоящие в словах срока, по порядку: «1 ч 30 мин» → [1, 30]. */
const numbersOf = (text: string): number[] => (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(',', '.')));

/** «+24 к обороне»: разница в единицах самой величины. */
const more =
  (label: string) =>
  (before: number, after: number): Said => {
    const d = shown(after - before);
    return d === 0 ? null : { text: `${sign(d)}${frac(Math.abs(d))} ${label}`, numbers: [Math.abs(d)] };
  };

/**
 * «+8% к скорости стройки»: насколько величина станет больше, чем сейчас, а не
 * шаг от базы. Ратуша прибавляет каждым уровнем один и тот же шаг от базы
 * (`TOWN_HALL_BUILD_STEP`), но против нынешней скорости этот шаг с каждым уровнем
 * весит меньше, — и на кнопке должно стоять то, что игрок получит.
 */
const grow =
  (label: string) =>
  (before: number, after: number): Said => {
    if (before <= 0) return null;
    const p = Math.round((after / before - 1) * 100);
    return p === 0 ? null : { text: `${sign(p)}${Math.abs(p)}% ${label}`, numbers: [Math.abs(p)] };
  };

/** Пеший и конный вид: учения меряются по тем, кого учат, — скорости «казарм вообще» у игры нет. */
const FOOT = TROOPS.find((t) => !t.mounted)!.id;
const MOUNTED = TROOPS.find((t) => t.mounted)!.id;

/** Сезон без поправок: улучшение переживает сезон, и рабочий меряется без него. */
const STILL: SeasonModifiers = { jobs: {}, build: 1, morale: 0, food: 1, heating: 0 };

/**
 * Всё, что уровень здания может сдвинуть в посёлке, — по одной двери в симуляцию
 * на величину. Порядок — порядок слов на кнопке. Какое здание что двигает, здесь не
 * записано нигде: это выясняет замер.
 */
const GAUGES: Gauge[] = [
  { id: 'build', read: townHallBuildMult, say: grow('к скорости стройки') },
  { id: 'housing', read: housingCapacity, say: more('к жилью') },
  { id: 'storage', read: storageCap, say: more('к вместимости склада') },
  { id: 'recruit', read: (s) => recruitRate(s, FOOT), say: grow('к скорости найма') },
  {
    // Конницу учит конюшня своей очередью и своим уровнем (`derived.recruitRate`): меряется её скорость как есть.
    // Прежде здесь стояло отношение к скорости казарм — с тех пор, как конница училась в казармах, — и улучшение
    // казарм обещало «−55% к скорости найма конницы», которую оно не трогает.
    id: 'cavalry',
    read: (s) => recruitRate(s, MOUNTED),
    say: grow('к скорости найма конницы'),
  },
  { id: 'stalls', read: stalls, say: more('к стойлам') },
  { id: 'defense', read: defense, say: more('к обороне') },
  { id: 'archers', read: militiaArchers, say: more('к стрелкам ополчения') },
  { id: 'seats', read: towerSeats, say: more('к местам лучников') },
  {
    // Терпение — игровые дни, по доле дня за уровень (`perLevel.loyalty` Статуи). Игрок ждёт его своими часами:
    // прибавка — настоящим временем из модуля сроков; сколько терпит дружина сейчас, стоит в разделе Статуи.
    id: 'loyalty',
    read: payGraceDays,
    say: (b, a) => {
      const d = a - b;
      if (d <= 0) return null;
      const span = waitDays(d);
      return { text: `+${span} к терпению дружины`, numbers: numbersOf(span) };
    },
  },
  {
    // Воинская традиция — кружки полководца от Статуи (`derived.tradition`, П4): растёт через уровень. Отметки из
    // кружков раскладывает склонность человека — это карточка полководца, а не кнопка.
    id: 'tradition',
    read: tradition,
    say: (b, a) => (a <= b ? null : { text: `+${a - b} к навыкам полководца`, numbers: [a - b] }),
  },
  {
    // Доля, у которой главное — сколько станет: 35 % вместо 32 %.
    id: 'heal',
    read: healShare,
    say: (b, a) => {
      const pa = Math.round(a * 100);
      const pb = Math.round(b * 100);
      return pa === pb ? null : { text: `${pa}% раненых вместо ${pb}%`, numbers: [pa, pb] };
    },
  },
  {
    // Места лазарета: сколько раненых он держит разом, главное — сколько станет.
    id: 'beds',
    read: infirmaryBeds,
    say: (b, a) => (a <= b ? null : { text: `+${a - b} ${plural(a - b, 'место', 'места', 'мест')} в лазарете · станет ${a}`, numbers: [a - b, a] }),
  },
  {
    // Прибавка Дозора — игровые секунды, а игрок ждёт набега своими часами: срок называет модуль сроков.
    id: 'warning',
    read: warningSeconds,
    say: (b, a) => {
      const d = shown(a - b);
      if (d === 0) return null;
      const span = waitSpan(asGame(Math.abs(d)));
      return { text: `набег виден ${d > 0 ? 'дольше' : 'меньше'} на ${span}`, numbers: numbersOf(span) };
    },
  },
  {
    // Уровень Дозора — потолок ступени изучения, а не её источник.
    id: 'survey',
    read: (s) => Math.min(SURVEY_MAX, surveyInfo(s).level),
    say: (b, a) => (a <= b ? null : { text: `разведка округи до ур. ${a}`, numbers: [a] }),
  },
  { id: 'intel', read: intelKeen, say: grow('к свежести сведений') },
  {
    id: 'stash',
    read: hiddenStash,
    say: (b, a) => (a <= b ? null : { text: `+${a - b} к тайнику · станет ${a}`, numbers: [a - b, a] }),
  },
  { id: 'feast', read: (s) => feastInfo(s).bonus, say: more('к морали от пира') },
  {
    id: 'feastWait',
    read: (s) => feastInfo(s).wait,
    say: (b, a) => {
      const d = shown((b - a) / DAY_LENGTH);
      if (d === 0) return null;
      // Перерыва игрок ждёт — настоящим временем, словами модуля сроков.
      const span = waitDays(Math.abs(d));
      return { text: `между пирами на ${span} ${d > 0 ? 'меньше' : 'больше'}`, numbers: numbersOf(span) };
    },
  },
  {
    id: 'goods',
    read: (s) => marketOffer(s).length,
    say: (b, a) => {
      const d = a - b;
      return d <= 0 ? null : { text: `+${d} ${plural(d, 'товар', 'товара', 'товаров')} на прилавке`, numbers: [d] };
    },
  },
  { id: 'stock', read: (s) => marketStock(s, GOOD_BY_ID.food), say: more('еды на рынке в день') },
  {
    id: 'caravan',
    read: caravanSeconds,
    say: (b, a) => {
      const d = shown(realSeconds(b - a));
      if (d === 0) return null;
      return { text: `дорога каравана ${d > 0 ? 'короче' : 'длиннее'} на ${realPlain(Math.abs(d))}`, numbers: [Math.abs(d)] };
    },
  },
  // Мораль и набожность — до потолка шкалы (см. шапку). Сюда же ложится и то, что
  // уровень двигает не сам: наклон веры у храма, теснота у жилья.
  { id: 'morale', read: (s) => moraleBreakdown(s).raw, say: more('к морали') },
  { id: 'piety', read: (s) => pietyBreakdown(s).raw, say: more('к набожности') },
  // Наклон веры. Храм растит его целиком, вместе с ценой, и цена обязана стоять
  // на кнопке так же, как дар: закят уводит золото, пост — выработку.
  { id: 'gold', read: taxIncomePerDay, say: more('золота в день') },
  // С сезоном без поправок множитель у всех профессий один — берётся любая.
  { id: 'output', read: (s) => jobMultiplier(s, 'woodcutter', STILL), say: grow('к выработке всех рабочих') },
  { id: 'learning', read: (s) => surveyInfo(s).learning, say: grow('к скорости разведки округи') },
  { id: 'growth', read: (s) => popGrowth(s).faith, say: grow('к приросту жителей') },
  { id: 'fervour', read: (s) => faithTilt(s).fervour, say: more('к стойкости дружины в обряд') },
];

/**
 * Посёлок, где у здания другой уровень и на его местах стоят `hands` вольных, —
 * и больше ничего не отличается. `hands` не задан — люди остаются, как стояли.
 * Уровень ставится так же, как его ставит конец стройки: число и пустые леса.
 */
function variant(s: GameState, b: Building, level: number, hands?: number): { s: GameState; b: Building } {
  const building: Building = { ...b, level, work: 0, workRequired: 0 };
  const buildings = s.buildings.map((x) => (x.id === b.id ? building : x));
  if (hands === undefined) return { s: { ...s, buildings }, b: building };
  return {
    s: { ...s, buildings, workers: { ...s.workers, [b.id]: hands }, bondedWork: { ...s.bondedWork, [b.id]: 0 } },
    b: building,
  };
}

/**
 * Где игра читает труд тех, кто стоит на местах. Не таблица профессий, а двери в
 * симуляцию: выработка двора по ресурсам, труд мастерской, работа горна и
 * служители — те же функции, из которых разборы морали и набожности берут свои
 * строки. Осады в замере нет — как и сезона.
 */
const WORK_LABELS: string[] = [
  ...RESOURCE_IDS.map((r) => `${RESOURCE_META[r].icon} в день`),
  'к скорости стройки',
  'к ковке',
  'к морали',
  'к набожности',
];

function workOf(s: GameState, b: Building): number[] {
  const calm: GameState = { ...s, siege: null };
  const made = buildingProduction(calm, b, STILL);
  return [
    ...RESOURCE_IDS.map((r) => made[r]),
    crafterBuildRate(calm, STILL),
    forgeRate(calm, STILL),
    priestMorale(calm),
    priestPiety(calm),
  ];
}

/** Что дают `hands` человек на местах здания этого уровня: разница с пустыми местами. */
function handsWork(s: GameState, b: Building, level: number, hands: number): number[] {
  const on = variant(s, b, level, hands);
  const off = variant(s, b, level, 0);
  const a = workOf(on.s, on.b);
  const z = workOf(off.s, off.b);
  return a.map((v, i) => v - z[i]);
}

const EPS = 1e-9;

/**
 * Растит ли уровень работу одного рабочего этого здания. У двора, мастерской и
 * кузницы — растит; служителя храма уровень не усиливает: он держит мораль и
 * набожность головой. Меряется так же, как кнопка, — трудом одного на двух уровнях.
 */
export function levelLiftsHand(s: GameState, b: Building): boolean {
  if (buildingSlots(b) <= 0) return false;
  const low = handsWork(s, b, 1, 1);
  const high = handsWork(s, b, 2, 1);
  return low.some((v, i) => v > EPS && Math.abs(high[i] - v) > EPS);
}

/**
 * Дадут ли что-нибудь свободные места здания, если их занять. У двора — всегда;
 * у храма, где служители уже упёрлись в потолок, — нет, и панель не должна звать
 * туда людей. Меряется тем же трудом, что кнопка.
 */
export function spareSlotsHelp(s: GameState, b: Building, hands: number): boolean {
  const slots = buildingSlots(b);
  if (hands >= slots) return false;
  const full = handsWork(s, b, b.level, slots);
  const now = handsWork(s, b, b.level, hands);
  return full.some((v, i) => v - now[i] > EPS);
}

/**
 * Места и работа на них. Места меряются занятыми: сколько новых и дают ли они
 * хоть что-нибудь, если их занять. Работник меряется одним: насколько больше он
 * сделает на новом уровне.
 */
function workGains(s: GameState, b: Building, to: number): UpgradeGain[] {
  const slotsNow = buildingSlots(b);
  const slotsNext = buildingSlots({ ...b, level: to });
  if (slotsNext <= 0) return [];
  const out: UpgradeGain[] = [];

  // Один работник на двух уровнях. Главная величина — та, что сдвинулась сильнее.
  const one = handsWork(s, b, b.level, 1);
  const oneNext = handsWork(s, b, to, 1);
  let lift = 0;
  let main = -1;
  one.forEach((v, i) => {
    if (v <= EPS) return;
    const p = Math.round((oneNext[i] / v - 1) * 100);
    if (main < 0 || Math.abs(p) > Math.abs(lift)) {
      lift = p;
      main = i;
    }
  });

  const added = slotsNext - slotsNow;
  if (added > 0) {
    const full = handsWork(s, b, to, slotsNext);
    const old = handsWork(s, b, to, slotsNow);
    const gain = full.map((v, i) => v - old[i]);
    if (gain.some((g) => g > EPS)) {
      // Что места дают сверх «каждый рабочий +N %»: у служителей уровень не
      // множит труд, и их прибавка названа числом — вместе с потолком, в который
      // она упирается.
      const flat = gain
        .map((g, i) => ({ g: shown(g), i }))
        .filter(({ g, i }) => g !== 0 && !(one[i] > EPS && Math.round((oneNext[i] / one[i] - 1) * 100) !== 0));
      const places = `+${added} ${plural(added, 'рабочее место', 'рабочих места', 'рабочих мест')}`;
      out.push({
        id: 'slots',
        before: slotsNow,
        after: slotsNext,
        text: flat.length > 0
          ? `${places} · на них ещё ${flat.map(({ g, i }) => `${sign(g)}${frac(Math.abs(g))} ${WORK_LABELS[i]}`).join(' и ')}`
          : places,
        numbers: [added, ...flat.map(({ g }) => Math.abs(g))],
      });
    } else {
      out.push({
        id: 'idleSlots',
        before: slotsNow,
        after: slotsNext,
        text: 'новые места ничего не дадут',
        numbers: [],
      });
    }
  }

  if (main >= 0 && lift !== 0) {
    out.push({
      id: 'hand',
      before: one[main],
      after: oneNext[main],
      text: `каждый рабочий ${sign(lift)}${Math.abs(lift)}%`,
      numbers: [Math.abs(lift)],
    });
  }
  return out;
}

/** Показания посёлка по всем величинам замера, в порядке `GAUGES`. */
export type Readings = number[];

/**
 * Показания посёлка как он есть. У всех строк списка построек они общие — леса на
 * здании не двигают ни одной величины, — поэтому список считает их один раз на
 * отрисовку и отдаёт каждой строке: разборы морали и набожности — самое дорогое,
 * что есть в замере.
 */
export const readVillage = (s: GameState): Readings => GAUGES.map((g) => g.read(s));

/**
 * Все прибавки уровня `to` против нынешнего — замером. Пусто — уровень ничего не
 * даёт. `now` — показания этого же посёлка (`readVillage(s)`), если они уже есть.
 */
export function upgradeGains(s: GameState, b: Building, to: number, now: Readings = readVillage(s)): UpgradeGain[] {
  const next = variant(s, b, to).s;
  const out: UpgradeGain[] = [];
  GAUGES.forEach((g, i) => {
    const before = now[i];
    const after = g.read(next);
    const said = g.say(before, after);
    if (said) out.push({ id: g.id, before, after, ...said });
  });
  return [...out, ...workGains(s, b, to)];
}

/** Прибавки одной строкой на кнопку. Нет ни одной — так и сказано. */
export const gainText = (gains: UpgradeGain[]): string =>
  gains.length > 0 ? gains.map((g) => g.text).join(', ') : NOTHING_GAINED;

/** Что даст уровень — одной строкой на кнопку. */
export const upgradeGain = (s: GameState, b: Building, to: number): string => gainText(upgradeGains(s, b, to));
