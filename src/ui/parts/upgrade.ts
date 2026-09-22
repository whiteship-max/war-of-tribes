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
  heroMen,
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
  warningSeconds,
} from '@/game/derived';
import { popGrowth } from '@/game/sim/population';
import { surveyInfo } from '@/game/sim/survey';
import { militiaArchers } from '@/world/bridge';
import { plural } from './plural';
import { asGame, realSeconds } from '@/game/pace';
import { realPlain, waitDays, waitSpan } from './wait';

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
export const NOTHING_GAINED = 'Этот уровень ничего не прибавит.';

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

/** «+24 к защите»: разница в единицах самой величины. */
const more =
  (label: string) =>
  (before: number, after: number): Said => {
    const d = shown(after - before);
    return d === 0 ? null : { text: `${sign(d)}${Math.abs(d)} ${label}`, numbers: [Math.abs(d)] };
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
  { id: 'recruit', read: (s) => recruitRate(s, FOOT), say: grow('к скорости учений') },
  {
    // Конница отдельно от пехоты: у неё свой множитель поверх казарм. Меряется
    // отношением, поэтому уровень казарм, ускоряющий всех одинаково, его не двигает.
    id: 'cavalry',
    read: (s) => recruitRate(s, MOUNTED) / Math.max(1e-9, recruitRate(s, FOOT)),
    say: grow('к скорости учений конницы'),
  },
  { id: 'stalls', read: stalls, say: more('стойл для конницы') },
  { id: 'defense', read: defense, say: more('к защите') },
  { id: 'archers', read: militiaArchers, say: more('стрелков ополчения на стене') },
  { id: 'seats', read: towerSeats, say: more('мест лучников на башне') },
  {
    // Бойцы строя — мерка боя, а не головы: латник в строю весит нескольких дубинщиков (`TroopDef.power` на `BATTLE_MAN`).
    id: 'hero',
    read: heroMen,
    say: (b, a) => {
      const d = a - b;
      return d <= 0 ? null : { text: `+${d} ${plural(d, 'боец', 'бойца', 'бойцов')} строя за героем`, numbers: [d] };
    },
  },
  {
    // Терпение — игровые дни, по доле дня за уровень (`perLevel.loyalty` Статуи): число мелкое, и главное в нём —
    // сколько станет, как у тайника.
    id: 'loyalty',
    read: payGraceDays,
    say: (b, a) => {
      const d = a - b;
      return d <= 0 ? null : { text: `+${d} игр. дн. терпения войска к неуплате и голоду (станет ${a})`, numbers: [d, a] };
    },
  },
  {
    // Доля, у которой главное — сколько станет: 35 % вместо 32 %.
    id: 'heal',
    read: healShare,
    say: (b, a) => {
      const pa = Math.round(a * 100);
      const pb = Math.round(b * 100);
      return pa === pb ? null : { text: `${pa}% павших ляжет ранеными вместо ${pb}%`, numbers: [pa, pb] };
    },
  },
  {
    // Места лазарета: сколько раненых он держит разом, главное — сколько станет.
    id: 'beds',
    read: infirmaryBeds,
    say: (b, a) => (a <= b ? null : { text: `+${a - b} ${plural(a - b, 'место', 'места', 'мест')} в лазарете (станет ${a})`, numbers: [a - b, a] }),
  },
  {
    // Прибавка Дозора — игровые секунды, а игрок ждёт набега своими часами: срок называет модуль сроков.
    id: 'warning',
    read: warningSeconds,
    say: (b, a) => {
      const d = shown(a - b);
      if (d === 0) return null;
      const span = waitSpan(asGame(Math.abs(d)));
      return { text: `набег виден ${d > 0 ? 'дольше' : 'меньше'} на ${span}`, numbers: (span.match(/\d+(?:\.\d+)?/g) ?? []).map(Number) };
    },
  },
  {
    // Уровень Дозора — потолок ступени изучения, а не её источник.
    id: 'survey',
    read: (s) => Math.min(SURVEY_MAX, surveyInfo(s).level),
    say: (b, a) => (a <= b ? null : { text: `изучение округи до ${a} ступени`, numbers: [a] }),
  },
  { id: 'intel', read: intelKeen, say: grow('к стойкости разведданных') },
  {
    id: 'stash',
    read: hiddenStash,
    say: (b, a) => (a <= b ? null : { text: `+${a - b} к спрятанному от набега (станет ${a})`, numbers: [a - b, a] }),
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
      return { text: `перерыв между пирами ${d > 0 ? 'короче' : 'длиннее'} на ${span}`, numbers: (span.match(/\d+(?:\.\d+)?/g) ?? []).map(Number) };
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
  { id: 'stock', read: (s) => marketStock(s, GOOD_BY_ID.food), say: more('еды в дневном запасе рынка') },
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
  { id: 'output', read: (s) => jobMultiplier(s, 'woodcutter', STILL), say: grow('к выработке всех профессий') },
  { id: 'learning', read: (s) => surveyInfo(s).learning, say: grow('к скорости изучения округи') },
  { id: 'growth', read: (s) => popGrowth(s).faith, say: grow('к приросту населения') },
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
          ? `${places} — на них ещё ${flat.map(({ g, i }) => `${sign(g)}${Math.abs(g)} ${WORK_LABELS[i]}`).join(' и ')}`
          : places,
        numbers: [added, ...flat.map(({ g }) => Math.abs(g))],
      });
    } else {
      out.push({
        id: 'idleSlots',
        before: slotsNow,
        after: slotsNext,
        text: 'новые рабочие места ничего не прибавят',
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
