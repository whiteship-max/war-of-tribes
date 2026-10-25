/**
 * Наблюдение за игроком (docs/admin.md): когда пришёл, сколько заходов и времени в игре, последняя опись партии,
 * журнал действий города, который видит сервер, и флаги подозрительного. Хранилище `tribe-watch`, ключ `tg-<id>`.
 *
 * **Сервер партию не разбирает.** Числа — из описи наблюдения (`WatchCard`), которую клиент кладёт рядом с партией.
 * Флаг — сравнение двух соседних описей по правилам игры: рост сверх выработки и обучения, промыслы сверх энергии,
 * добыча сверх потолка, время партии быстрее настоящего, часы устройства не те, записи чаще, чем игра пишет. Флаг —
 * подсказка админу с пояснением «что и насколько», а не приговор: партию он не трогает.
 *
 * Записывают сюда сохранение (заход, запись, отказ «слишком часто»), война (поход), отчёт об ошибке и команды админа
 * (указ, заморозка). Запись наблюдения — попутная: не легла — партия всё равно сохранена, а ответ игроку тот же.
 */
import { CLOCK_SKEW_SECONDS } from './initdata.js';
import { SAVE_HURRY_MS, SAVE_PUSH_MS, STOCK_KEYS, readWatch, type AdminGrant, type Counts, type WarSheet, type WatchAdvisor, type WatchCard, type WatchCrownEntry } from './contract.js';
import { DAY_LENGTH, gameDaysOfMs, gameDaysPerHour, realMs } from '../../src/game/pace.js';
import { ENERGY_MAX, ENERGY_REFILL, MINIGAME_COST } from '../../src/game/data/minigames.js';
import { BUILD_QUEUE_MAX, MAX_BUILDING_LEVEL, RESOURCE_IDS, RESOURCE_META } from '../../src/game/constants.js';
import { BUILDING_BY_ID } from '../../src/game/data/buildings.js';
import { has, own } from '../../src/game/guard.js';
import { cancelRefund, upgradeCost } from '../../src/game/labour.js';
import { prodCeil, storageOf } from '../../src/game/build.js';
import { GONE_NAME, MERGED_INTO, MERGED_SAVE, foldTown } from '../../src/game/yardmerge.js';
import { STAB_BAND, STAB_MAX, STAB_MIN, STAB_PRICE_MIN, STAB_SELF_MAX, stabEventRiseCeil, stabPointsCeil, stabSelfRiseCeil } from '../../src/game/stabrules.js';
import { ESTATES, LOYAL, PRIV_MAX, estateCeil, influenceOf, isEstate, loyaltyCeil, privFromRow, type EstateCeil } from '../../src/game/estaterules.js';
import { CROWN_GAIN_MAX, CROWN_RULES, CROWN_STAB_MAX, crownAnswersCeil, crownEvery, crownGain, crownStab, isCrown } from '../../src/game/crownrules.js';
import {
  ADVISOR_POSTS,
  MAX_ADVISOR_LEVEL,
  advisorWage,
  councilTier,
  giftOf,
  hirePrice,
  isPost,
  isTrait,
  postOfCandidate,
  windowOf,
  windowOfCandidate,
} from '../../src/game/councilrules.js';
import { DESERT_SHARE } from '../../src/game/data/upkeep.js';
import { statAt } from '../../src/game/train.js';
import { powerOfCounts } from '../../src/profile/power.js';
import type { BuildingTypeId, EstateId, ResourceId } from '../../src/game/types.js';
import { rewrite } from './admin.js';
import { bookAfter, readBook, seedBook, type ArmyBook } from './book.js';
import { builtForged, buildStep, keyOf, eatFloorOf, peopleStep, readTown, seedTown, type PaidLevel, type TownBook } from './town.js';
import { goodsStep, readGoods, sheetShort, type GoodsBook } from './goods.js';
import { marketFaults } from './market.js';
import { BOOST_MAX } from '../../src/game/marketrules.js';
import { troopPower } from '../../src/game/battle/price.js';
import type { TroopStack } from '../../src/game/battle/kinds.js';
import type { WarFile } from './war.js';
import { STORES, type Stores } from './kv.js';

/**
 * Перерыв дольше этого — новый заход: игра пишет раз в `SAVE_PUSH_MS`, и три пропущенные записи подряд значат, что
 * игрок ушёл. Время в игре — сумма промежутков между запросами внутри захода.
 */
export const SESSION_GAP_MS = 3 * SAVE_PUSH_MS;

/** Сколько строк журнала и флагов помнит запись игрока. */
export const JOURNAL_KEEP = 150;
export const FLAGS_KEEP = 50;

/** Час — окно отказов «слишком часто» и отчётов об ошибках. */
const HOUR = 3600_000;

/**
 * Отказов «слишком часто» за час, с которых это флаг. Игра пишет не чаще раза в `SAVE_HURRY_MS`, а сервер
 * отказывает чаще раза в 4 с; честный клиент упирается в отказ только перезапуском сразу после записи — изредка.
 */
export const OFTEN_PER_HOUR = 3;

/**
 * Во сколько раз рост может обогнать выработку и обучение, прежде чем это флаг. Выработка меняется между двумя
 * описями (мораль, сезон, достроенное здание), а опись видит её только на концах промежутка: двойной запас
 * покрывает это изменение, а правка сохранения обгоняет его на порядки.
 */
export const GROWTH_SLACK = 2;

/**
 * Точность часов описи, игровые дни: `WatchCard.time` — целые игровые секунды (дробь отбрасывают и `snapshot.watchOf`,
 * и `contract.readWatch`). Истинный промежуток между описями поэтому короче разности их часов плюс одна игровая секунда,
 * и выработку сверяют за этот верхний край. Без него две записи внутри одной игровой секунды (при шкале ×30 — полминуты
 * настоящего времени: быстрая запись после смены раскладки, перезапуск) показывали ноль времени, и честная выработка
 * этой секунды — 1/60 дневной — читалась ростом без разовых дел (16.10.2026: «Древесина +29 за 21 с … не больше 1»,
 * docs/security.md, раздел 8).
 */
export const CARD_TICK_DAYS = 1 / DAY_LENGTH;

/** Тот же флаг второй раз за этот срок не дописывается, а считается в прежний: запись идёт раз в минуту. */
const FLAG_QUIET = HOUR;

export type FlagKind =
  | 'cheat'
  | 'haste'
  | 'clock'
  | 'cap'
  | 'time'
  | 'stock'
  | 'army'
  | 'games'
  | 'haul'
  | 'often'
  | 'rollback'
  | 'forged'
  | 'built'
  | 'people'
  | 'unpaid'
  | 'hidden'
  | 'eat'
  | 'walk'
  | 'queue'
  | 'refund'
  | 'stab'
  | 'crown'
  | 'prod'
  | 'gone'
  | 'council'
  | 'estates'
  | 'market'
  | 'starve';

export const FLAG_WORD: Record<FlagKind, string> = {
  cheat: 'коды проверки',
  haste: 'скорость проверки',
  clock: 'часы устройства',
  cap: 'сверх склада',
  time: 'время партии',
  stock: 'рост склада',
  army: 'рост войска',
  games: 'частые промыслы',
  haul: 'добыча промыслов',
  often: 'частые записи',
  rollback: 'откат партии',
  forged: 'войско сверх подтверждённого',
  built: 'стройка сверх подтверждённой',
  people: 'жители сверх подтверждённых',
  unpaid: 'стройка без платы',
  hidden: 'склад меньше подтверждённого',
  eat: 'расход хлеба ниже правил',
  walk: 'срок пути',
  queue: 'очередь стройки',
  refund: 'возврат сверх положенного',
  stab: 'стабильность',
  crown: 'вести державы',
  prod: 'выработка сверх мест',
  gone: 'постройки до объединения',
  estates: 'сословия',
  council: 'совет Ратуши',
  market: 'сделки рынка',
  starve: 'сдача голодом при хлебе',
};

/** Начало строки журнала о невозможном: админ ищет его глазами в `/player` (docs/security.md). */
export const WARN = 'внимание:';

/** Одно правило города: что сервер проверяет, какой общей с игрой формулой, каким флагом и что делает с невозможным. */
export interface CityRule {
  id: 'level' | 'pace' | 'paid' | 'stock' | 'troops' | 'people' | 'goods' | 'eat' | 'queue' | 'refund' | 'stab' | 'crown' | 'prod' | 'merge' | 'council' | 'estates' | 'market' | 'starve';
  rule: string;
  /** Общая с игрой формула — одна дверь без `@/`, своей копии чисел у сервера нет. */
  formula: string;
  flag: FlagKind;
  /** «не подтверждает» — книга не засчитывает заявленное; «флаг» — только строка админу. */
  act: string;
}

/**
 * Таблица правил города (docs/security.md, ЗЩ-1): что сервер проверяет в каждой принятой записи партии (`booked`,
 * `flagsBetween`). Партия сохраняется всегда — сервер её не разбирает, и честный не теряет ничего; невозможное книги не
 * засчитывают, и в войну, рейтинг, реестр замков и цену ускорения идёт только подтверждённое (`confirmedOf`). Каждое
 * правило держит тест подделанного клиента (`security.test.ts`).
 */
export const CITY_RULES: readonly CityRule[] = [
  { id: 'level', rule: 'уровень постройки не выше книги стройки и потолка постройки', formula: 'town.buildStep, data/buildings.maxLevel', flag: 'built', act: 'не подтверждает' },
  { id: 'pace', rule: 'улучшение не раньше срока: труд уровня против потолка скорости стройки за серверное время', formula: 'labour.upgradeWork, build.buildCeil', flag: 'built', act: 'не подтверждает' },
  { id: 'paid', rule: 'цена списана: начатая стройка уносит со склада цену уровня', formula: 'labour.upgradeCost', flag: 'unpaid', act: 'флаг' },
  {
    id: 'queue',
    rule: 'очередь стройки: не длиннее предела, одна стройка на постройку, следующий уровень, первая — идущая, начатая не сдвигается',
    formula: 'town.queueFaults, constants.BUILD_QUEUE_MAX',
    flag: 'queue',
    act: 'не подтверждает место; ускорение ждущего — отказ',
  },
  {
    id: 'refund',
    rule: 'возврат отменённой стройки не больше положенного: начатая — половина цены, ждущая — вся',
    formula: 'labour.cancelRefund',
    flag: 'refund',
    act: 'флаг',
  },
  { id: 'stock', rule: 'запасы не выше вместимости склада подтверждённых построек', formula: 'build.storageOf', flag: 'cap', act: 'в войну — не больше вместимости; флаг' },
  { id: 'troops', rule: 'войска не больше нанятых: обучение казарм и конюшни, указы, потери войны', formula: 'train.trainRateAt, book.bookAfter', flag: 'forged', act: 'не подтверждает; приказ войны — отказ' },
  { id: 'people', rule: 'жители не больше прироста, жилья, вестей и вернувшихся из войска', formula: 'build.popGrowthCeil, build.housingOf', flag: 'people', act: 'не подтверждает' },
  {
    id: 'goods',
    rule: 'склад, казна и невольники защитника — из описи, а не из слепка обороны; между описями без дел и трат убывают только расходом',
    formula: 'goods.drainCeil: build.headsFoodPerDay, build.heatingWood, battle/price.baseWage',
    flag: 'hidden',
    act: 'в войну — книга запасов, не меньше; флаг',
  },
  { id: 'eat', rule: 'расход хлеба в осаде не ниже пайка жителей, невольников и бойца при самом скудном рационе', formula: 'build.eatFloorPerDay', flag: 'eat', act: 'в войну — не ниже пола; флаг' },
  {
    id: 'starve',
    rule: 'сдача голодом — только когда склад не оплатил прокорм в шаге осады: баланс шага ниже нуля; ровно ноль, дробный остаток и хлеб, пришедший в тот же шаг, — не голод',
    formula: 'siegefood.starves, sim/siege.siegeHunger',
    flag: 'starve',
    act: 'флаг',
  },
  {
    id: 'stab',
    rule: 'стабильность: ступень в −3…+3; очков на ступени не больше, чем дал бы лучший правитель, и не меньше цены купленных; подъём — не выше купленного и того, что ровная жизнь даёт сама до «Лада»; подавлено мятежей не больше выигранных боёв',
    formula: 'stabrules.stabPointsCeil, stabPrice, stabSelfRiseCeil, STAB_SELF_MAX',
    flag: 'stab',
    act: 'флаг',
  },
  {
    id: 'crown',
    rule: 'вести державы: вид и ответ — из таблицы правил, весть не чаще своего срока, ответов не больше сетки почты; подъём стабильности и очки — с тем, что дали вести',
    formula: 'crownrules.CROWN_RULES, crownEvery, crownAnswersCeil, crownStab, crownGain',
    flag: 'crown',
    act: 'флаг',
  },
  {
    id: 'prod',
    rule: 'выработка не выше мест дел подтверждённых построек — у двора с двумя делами у каждого свои — работником в лучших множителях; вольный сбор — все жители вполсилы',
    formula: 'build.prodCeil, data/yards, data/buildings.slotsAt',
    flag: 'prod',
    act: 'в рост склада — не больше потолка; флаг',
  },
  {
    id: 'merge',
    rule: 'опись сохранения 24 и новее не называет построек, ушедших в дворы (ЗД-1); опись и книга до перехода сводятся его правилом: уровень двора — больший из двух, стройка обеих частей на один уровень — одной стройкой',
    formula: 'yardmerge.foldTown, foldLevels, foldSites',
    flag: 'gone',
    act: 'сводит правилом перехода; флаг',
  },
  {
    id: 'council',
    rule: 'совет Ратуши: должность и черта — из таблицы, нанятый — не выше ступени ратуши в минуту найма и из окна своего найма; наймов и платы за найм — не меньше новых мест, жалованье — по ведомости совета сверх терпения; польза — только подтверждённых советников',
    formula: 'councilrules.councilTier, candidateId, hirePrice, advisorWage, giftOf',
    flag: 'council',
    act: 'в потолки стройки, выработки и стойкости — только подтверждённые; флаг',
  },
  {
    id: 'estates',
    rule: 'сословия: привилегий у каждого не больше двух; влияние — по уровням описи и привилегиям; указ сословия — при лояльности, которая могла дойти до порога; привилегий прибавилось не больше дарований, убыло не больше отнятий; польза — по подтверждённым уровням и привилегиям, лояльность сверху',
    formula: 'estaterules.influenceOf, loyaltyCeil, estateCeil, PRIV_MAX, LOYAL',
    flag: 'estates',
    act: 'в потолки стройки, выработки, прироста, расхода и стойкости — по подтверждённым; флаг',
  },
  {
    id: 'market',
    rule: 'сделки рынка: цена каждой — по правилу привоза (уровень закреплён на привоз, не выше рынка описей) с нажимом от прежней описи (покупка не дешевле, продажа не дороже при подтверждённых Казначее и купечестве); куплено не больше привоза, продано не больше кошеля купцов и того, что было; номер сделки не убывает, одна сделка под одним номером',
    formula: 'marketrules.lotOf, pressAt, supplyOf, purseOf, shiftOffer; market.marketFaults',
    flag: 'market',
    act: 'флаг',
  },
];

/** Ступень сохранения описи — из строки версии игры (`snapshot.buildId`: «сохр. 24 · …»); не названа — 0. */
export const saveOf = (build: string): number => Number(/сохр\. (\d+)/.exec(build)?.[1] ?? 0);

/**
 * Опись после перехода ЗД-1 (`yardmerge.foldTown`): уровни, очередь и идущая стройка — без построек, ушедших в дворы.
 * Старая опись — лежащая в записи наблюдения или присланная устройством, ещё не открывшим новую сборку, — сводится
 * молча: это не подделка, а прежний формат. Опись без ушедших построек проходит тем же объектом.
 */
export function foldCard(card: WatchCard): WatchCard {
  const t = foldTown({ levels: card.buildings, queue: card.queue, site: card.site });
  if (t.levels === card.buildings) return card;
  const out: WatchCard = { ...card, buildings: t.levels as Counts };
  if (card.queue) out.queue = t.queue ? [...t.queue] : [];
  if (t.site) out.site = t.site;
  else delete out.site;
  return out;
}

/**
 * Выработка описи для сверки роста — не выше потолка её же уровней и жителей (правило «prod», `build.prodCeil`): заявленная
 * сверх мест и множителей выработка не объясняет рост склада. Золото — налог и вера — как заявлено.
 */
export function prodOf(card: WatchCard): Counts {
  const ceil = prodCeil(card.buildings, card.pop, yardMult(card, card.buildings));
  const out: Counts = { ...card.prod };
  for (const r of RESOURCE_IDS) if (out[r] !== undefined) out[r] = Math.min(out[r] ?? 0, ceil[r] + 1);
  return out;
}

export interface WatchFlag {
  at: number;
  kind: FlagKind;
  text: string;
  /** Сколько раз повторился за `FLAG_QUIET`. */
  n: number;
}

export type EntryKind = 'visit' | 'save' | 'deed' | 'game' | 'war' | 'report' | 'grant' | 'freeze' | 'flag';

export interface WatchEntry {
  at: number;
  kind: EntryKind;
  text: string;
}

export interface WatchRecord {
  v: 1;
  /** Когда сервер впервые увидел игрока. */
  first: number;
  /** Последний запрос сохранения. */
  last: number;
  visits: number;
  /** Время в игре, мс. */
  played: number;
  /** Принятых записей партии. */
  writes: number;
  /** Имя пользователя Telegram — из подписи. */
  user: string;
  /** Вождь, мощь и игровой день — из описи партии (`SaveCard`). */
  name: string;
  power: number;
  day: number;
  /** Последняя опись наблюдения и когда она пришла. */
  card?: WatchCard;
  cardAt: number;
  /** Походов на игроков. */
  wars: number;
  /** Отказов «слишком часто» за последний час — их минуты. */
  fast: number[];
  /** Отчётов об ошибках за последний час — их минуты. */
  reports: number[];
  flags: WatchFlag[];
  journal: WatchEntry[];
  /** Книга войска (`book.ts`, docs/pvp.md, раздел 6): сколько бойцов сервер подтверждает. Нет — запись до книги. */
  book?: ArmyBook;
  /** Книга стройки и жителей (`town.ts`, docs/pvp.md, раздел 7): уровни и жители, которые сервер подтверждает. */
  town?: TownBook;
  /** Книга запасов (`goods.ts`, docs/security.md, ЗЩ-2): склад, казна и невольники, которые сервер подтверждает для войны. */
  goods?: GoodsBook;
  /**
   * Кто привёл: ключ игрока, по чьей ссылке был первый заход (`invitedBy`, docs/feed.md, раздел 3). Только статистика
   * админа, наград за это нет. Нет — пришёл сам или запись старше поля.
   */
  ref?: string;
}

const n0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const s0 = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '');
const times = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number').slice(-50) : []);

export const blankWatch = (): WatchRecord => ({
  v: 1,
  first: 0,
  last: 0,
  visits: 0,
  played: 0,
  writes: 0,
  user: '',
  name: '',
  power: 0,
  day: 0,
  cardAt: 0,
  wars: 0,
  fast: [],
  reports: [],
  flags: [],
  journal: [],
});

const FLAG_KINDS = Object.keys(FLAG_WORD) as FlagKind[];
const ENTRY_KINDS: readonly EntryKind[] = ['visit', 'save', 'deed', 'game', 'war', 'report', 'grant', 'freeze', 'flag'];

export function readWatchRecord(v: unknown): WatchRecord {
  const out = blankWatch();
  if (!v || typeof v !== 'object') return out;
  const r = v as Record<string, unknown>;
  out.first = n0(r.first);
  out.last = n0(r.last);
  out.visits = n0(r.visits);
  out.played = n0(r.played);
  out.writes = n0(r.writes);
  out.user = s0(r.user, 32);
  out.name = s0(r.name, 64);
  out.power = n0(r.power);
  out.day = n0(r.day);
  const card = readWatch(r.card);
  if (card) out.card = foldCard(card);
  out.cardAt = n0(r.cardAt);
  out.wars = n0(r.wars);
  out.fast = times(r.fast);
  out.reports = times(r.reports);
  if (Array.isArray(r.flags)) {
    for (const f of r.flags as Record<string, unknown>[]) {
      if (f && FLAG_KINDS.includes(f.kind as FlagKind)) out.flags.push({ at: n0(f.at), kind: f.kind as FlagKind, text: s0(f.text, 400), n: Math.max(1, n0(f.n)) });
    }
    out.flags = out.flags.slice(-FLAGS_KEEP);
  }
  if (typeof r.ref === 'string' && /^tg-\d{1,20}$/.test(r.ref)) out.ref = r.ref;
  const book = readBook(r.book);
  if (book) out.book = book;
  const town = readTown(r.town);
  if (town) out.town = town;
  const goods = readGoods(r.goods);
  if (goods) out.goods = goods;
  if (Array.isArray(r.journal)) {
    for (const e of r.journal as Record<string, unknown>[]) {
      if (e && ENTRY_KINDS.includes(e.kind as EntryKind)) out.journal.push({ at: n0(e.at), kind: e.kind as EntryKind, text: s0(e.text, 400) });
    }
    out.journal = out.journal.slice(-JOURNAL_KEEP);
  }
  return out;
}

// ------------------------------------------------ слова ---

/** Число с пробелами между разрядами: 12 345. */
export const big = (n: number): string => {
  const sign = n < 0 ? '−' : '';
  return sign + String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};

/** Со знаком: +12 345 или −40. */
export const signed = (n: number): string => (n > 0 ? `+${big(n)}` : big(n));

/** Срок словами: «40 с», «12 мин», «3 ч 20 мин», «2 дн. 4 ч» (настоящее время). */
export function span(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec} с`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 48) return min % 60 ? `${h} ч ${min % 60} мин` : `${h} ч`;
  return `${Math.floor(h / 24)} дн. ${h % 24} ч`;
}

/** Игровые дни словами: «0,3 игр. дн.». */
const gameDays = (d: number): string => `${(Math.round(d * 10) / 10).toString().replace('.', ',')} игр. дн.`;

/** Имя вида склада для админа — именем игры (`RESOURCE_META`); золота там нет — оно в казне. */
export const stockWord = (k: string): string => (RESOURCE_META as Record<string, { name: string } | undefined>)[k]?.name.toLowerCase() ?? 'золото';

const total = (c: Counts): number => Object.values(c).reduce((t, x) => t + x, 0);

const upper = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

// ------------------------------------------------ флаги ---

/** Флаги одной описи: то, что видно и без соседней. */
export function flagsOf(card: WatchCard, at: number): { kind: FlagKind; text: string }[] {
  const out: { kind: FlagKind; text: string }[] = [];
  if (card.cheated) out.push({ kind: 'cheat', text: 'Партия помечена кодами проверки: ими пользовались хотя бы раз.' });
  if (card.lead > 0) out.push({ kind: 'haste', text: `Партию ускоряли скоростью проверки: её часы впереди настоящих на ${span(card.lead)}.` });
  // Сверх вместимости склада игра не кладёт ничего: ни выработка, ни добыча, ни возврат цены, ни указ (`sim/pay`).
  for (const k of STOCK_KEYS) {
    if (!(k in RESOURCE_META)) continue;
    const have = card.stock[k] ?? 0;
    if (card.cap > 0 && have > card.cap + 1) {
      out.push({ kind: 'cap', text: `${upper(stockWord(k))} ${big(have)} при вместимости склада ${big(card.cap)} — сверх склада игра не кладёт ничего (или склад потерял уровень).` });
    }
  }
  // Постройки, ушедшие в дворы (правило «merge», ЗД-1), опись новой сборки не называет: их нет ни в игре, ни в её описи.
  const gone = Object.keys(card.buildings).filter((t) => has(MERGED_INTO, t));
  if (gone.length > 0 && saveOf(card.build) >= MERGED_SAVE) {
    const list = gone.map((t) => `${GONE_NAME[t] ?? t} ${big(card.buildings[t] ?? 0)}`).join(', ');
    out.push({
      kind: 'gone',
      text: `Опись сохранения ${saveOf(card.build)} называет постройки, которых с объединения дворов нет: ${list}. Сервер сводит их правилом перехода и подтверждает не больше книги стройки.`,
    });
  }
  // Совет Ратуши (правило «council», РТ-1): должность и черта — из таблицы, уровень — в лестнице, одна должность — одно место.
  for (const t of councilFaults(card)) out.push({ kind: 'council', text: t });
  // Сословия (правило «estates», РТ-2): привилегии в лестнице, влияние — по уровням описи, указ — открыт лояльностью.
  for (const t of estateFaults(card)) out.push({ kind: 'estates', text: t });
  // Ступень стабильности — в шкале −3…+3 у каждой описи, и у первой тоже (правило «stab», docs/stability.md, 2.7).
  if (card.stab && (card.stab.level < STAB_MIN || card.stab.level > STAB_MAX)) {
    out.push({ kind: 'stab', text: `Стабильность ${signed(card.stab.level)} — вне шкалы ${STAB_MIN}…+${STAB_MAX}.` });
  }
  const skew = card.clock > 0 ? card.clock - at : 0;
  if (Math.abs(skew) > CLOCK_SKEW_SECONDS * 1000) {
    out.push({ kind: 'clock', text: `Часы устройства ${skew > 0 ? 'спешат' : 'отстают'} на ${span(Math.abs(skew))} (терпим до ${span(CLOCK_SKEW_SECONDS * 1000)}).` });
  }
  return out;
}

/**
 * Флаги промежутка между двумя описями: что выросло сильнее, чем позволяют правила игры за прошедшее время.
 *
 * Рост склада и войска сверяется, только если между описями не было ни одного разового дела (событие, бой, логово,
 * набег, покупка, ежедневка, промысел, указ админа), никто не ушёл и не вернулся из похода и не пришёл караван: дело
 * может разом принести добро, и тогда рост объяснён. Без дел склад растёт только выработкой, а войско — обучением в
 * казармах и конюшне.
 */
export function flagsBetween(a: WatchCard, aAt: number, b: WatchCard, bAt: number): { kind: FlagKind; text: string }[] {
  const out: { kind: FlagKind; text: string }[] = [];
  const realMs = Math.max(0, bAt - aAt);
  const leadMs = Math.max(0, b.lead - a.lead);
  // Сколько игровых дней могло пройти: настоящее время, опережение под скоростью проверки и допуск на часы.
  const canDays = gameDaysOfMs(realMs + leadMs + CLOCK_SKEW_SECONDS * 1000);
  const wentDays = (b.time - a.time) / DAY_LENGTH;
  if (wentDays > canDays) {
    out.push({ kind: 'time', text: `Время партии ушло на ${gameDays(wentDays)} за ${span(realMs)} настоящего — могло не больше ${gameDays(canDays)}.` });
  }
  if (b.deeds < a.deeds) {
    out.push({ kind: 'rollback', text: `Партия откатилась назад: разовых дел было ${big(a.deeds)}, стало ${big(b.deeds)} (другое устройство, восстановленная копия или правка сохранения).` });
  }
  // Сдача голодом (правило «starve», ОС-1): голодом сдаёт только склад, не оплативший прокорм в шаге осады. Город сдан, а склад
  // кормил — ложная сдача (судья осады — мир или сервер войны — разошёлся со складом), и это не может быть честной игрой.
  const fed = (b.starve ?? 0) - (a.starve ?? 0);
  if (fed > 0) {
    out.push({ kind: 'starve', text: `Город сдан голодом ${big(fed)} раз за ${span(realMs)}, а склад в эти минуты прокорм оплачивал: хлеб был не ниже нуля. Голодом сдаёт только неоплаченный прокорм шага осады.` });
  }
  // Рост сверяют за верхний край истинного промежутка: часы описи — целые игровые секунды (`CARD_TICK_DAYS`).
  const days = Math.max(0, Math.min(wentDays + CARD_TICK_DAYS, canDays));
  const quiet = a.deeds === b.deeds && a.seen === b.seen && a.games === b.games && a.away === b.away && a.caravans === b.caravans;
  if (quiet) {
    // Возврат отменённой стройки (правило «refund», СТ-1): разовым делом он не считается — положенное сервер выводит сам из
    // очередей двух описей (`cancelledRefund`), и рост склада сверх выработки и положенного возврата — флаг.
    const back = cancelledRefund(a, b);
    // Выработка обеих описей — не выше потолка их мест (правило «prod»): заявленное сверх него рост не объясняет.
    const pa = prodOf(a);
    const pb = prodOf(b);
    for (const k of STOCK_KEYS) {
      const grew = (b.stock[k] ?? 0) - (a.stock[k] ?? 0);
      const could = Math.max(pa[k] ?? 0, pb[k] ?? 0) * days * GROWTH_SLACK + 1;
      const due = back.refund[k as ResourceId] ?? 0;
      if (grew > could + due) {
        out.push(
          back.count > 0
            ? {
                kind: 'refund',
                text: `${upper(stockWord(k))} ${signed(grew)} за ${span(realMs)}: отменено стройки ${big(back.count)}, возврат положен не больше ${big(due)}, выработка — ${big(could)}.`,
              }
            : { kind: 'stock', text: `${upper(stockWord(k))} ${signed(grew)} за ${span(realMs)} без разовых дел; выработка позволяла не больше ${big(could)}.` },
        );
      }
    }
    const grew = total(b.troops) + b.wounded - (total(a.troops) + a.wounded);
    const could = Math.max(a.train, b.train) * days * GROWTH_SLACK + 1;
    if (grew > could) {
      out.push({ kind: 'army', text: `Войско ${signed(grew)} за ${span(realMs)} без разовых дел; казармы и конюшня выучили бы не больше ${big(could)}.` });
    }
    // Цена списана (правило «paid», `CITY_RULES`): стройка, начатая между описями, унесла со склада цену уровня — ею платит
    // `sim/actions.startUpgrade`, и другой двери, заводящей стройку, у игры нет. «Начатая» — только если на первой описи
    // стройки не было вовсе: иначе в очереди могли стоять оплаченные раньше, а опись видит одну первую (`derived.currentSite`).
    // С очередью в обеих описях оплаченное известно точно (СТ-1): места первой описи уже оплачены, остальное — нет.
    const started = a.site && !(a.queue && b.queue) ? null : startedCost(a, b);
    if (started) {
      for (const k of RESOURCE_IDS) {
        const need = started.cost[k] ?? 0;
        if (need <= 0) continue;
        const grew = (b.stock[k] ?? 0) - (a.stock[k] ?? 0);
        const could = Math.max(pa[k] ?? 0, pb[k] ?? 0) * days * GROWTH_SLACK + 1 + (back.refund[k] ?? 0);
        // Рост сверх выработки уже сказан флагом «рост склада» — второй раз о том же не говорим.
        if (grew > could || grew + need <= could) continue;
        out.push({
          kind: 'unpaid',
          text: `Заложено ${big(started.levels)} ур. стройки: ${stockWord(k)} на ${big(need)}, а ${stockWord(k)} ${signed(grew)} за ${span(realMs)} без разовых дел — выработка позволяла не больше ${big(could)}, цена со склада не ушла.`,
        });
      }
    }
  }
  out.push(...stabFlags(a, b, days, realMs));
  out.push(...crownFlags(a, b, realMs));
  out.push(...councilFlags(a, b, days, realMs));
  out.push(...estateFlags(a, b, realMs));
  // Сделки рынка (правило «market», РН-1): цена каждой новой — по правилу привоза, счёт и кошель — по сделкам.
  for (const text of marketFaults(a, aAt, b, bAt, { boost: Math.max(marketBoost(a), marketBoost(b)), prod: maxCounts(prodOf(a), prodOf(b)), slack: GROWTH_SLACK })) {
    out.push({ kind: 'market', text });
  }
  const played = b.games - a.games;
  if (played > 0) {
    // Энергия: полный запас и приток за прошедшее время партии; игра стоит `MINIGAME_COST`.
    const can = Math.floor((ENERGY_MAX + ((realMs + leadMs) / ENERGY_REFILL) * ENERGY_MAX) / MINIGAME_COST);
    if (played > can) out.push({ kind: 'games', text: `Промыслов ${signed(played)} за ${span(realMs)}; энергии хватало не больше чем на ${big(can)}.` });
    const cap = Math.max(a.haulCap, b.haulCap);
    const got = b.haul - a.haul;
    if (got > cap * played + played) {
      out.push({ kind: 'haul', text: `Добыча промыслов ${signed(got)} за ${big(played)} игр; потолок — ${big(cap)} за игру.` });
    }
  }
  return out;
}

// ------------------------------------------------ совет Ратуши ---

/** Уровень постройки в описи или книге; нет — 0. */
const levelIn = (c: Counts, t: string): number => Math.max(0, Math.floor(c[t] ?? 0));

/** Почему советник описи не по правилам самого себя: должность, черта, уровень и номер просителя. `null` — по правилам. */
function advisorFault(a: WatchAdvisor): string | null {
  if (!isPost(a.post)) return `должности «${a.post}» нет`;
  if (!isTrait(a.trait)) return `черты «${a.trait}» нет`;
  if (!Number.isInteger(a.level) || a.level < 1 || a.level > MAX_ADVISOR_LEVEL) return `уровень ${a.level} вне 1…${MAX_ADVISOR_LEVEL}`;
  if (postOfCandidate(a.n) !== a.post) return `проситель №${a.n} просился не на эту должность`;
  if (windowOfCandidate(a.n) !== windowOf(a.at)) return `проситель №${a.n} не из окна своего найма`;
  return null;
}

/** Нарушения совета одной описи: советник против правил и вторая место на одной должности. */
export function councilFaults(card: WatchCard): string[] {
  const c = card.council;
  if (!c) return [];
  const out: string[] = [];
  const posts = new Set<string>();
  for (const a of c.seats) {
    const why = advisorFault(a);
    if (why) out.push(`Совет: ${why}.`);
    if (posts.has(a.post)) out.push(`Совет: на должности «${a.post}» двое.`);
    posts.add(a.post);
  }
  return out;
}

/**
 * Подтверждённый советник должности: по правилам самого себя и не выше ступени ратуши `hall`. Его польза идёт в потолки
 * стройки и выработки (Староста) и стойкости (Воевода); неподтверждённого нет. Нет — `null`.
 */
function confirmedSeat(card: WatchCard, post: string, hall: number): WatchAdvisor | null {
  const seats = (card.council?.seats ?? []).filter((a) => a.post === post);
  if (seats.length !== 1) return null;
  const a = seats[0];
  return advisorFault(a) === null && a.level <= councilTier(hall) ? a : null;
}

/** Множитель пользы подтверждённого советника (Староста, Казначей): 1 + польза; нет — единица. */
export function councilMult(card: WatchCard, post: 'steward' | 'treasurer', hall: number): number {
  const a = confirmedSeat(card, post, hall);
  return a ? 1 + giftOf(post, a.level, a.trait as Parameters<typeof giftOf>[2]) : 1;
}

/** Стойкость подтверждённого Воеводы — сверх обряда (`book.ruleResolve`); нет — ноль. */
export function councilResolve(card: WatchCard | undefined, hall: number): number {
  const a = card ? confirmedSeat(card, 'marshal', hall) : null;
  return a ? giftOf('marshal', a.level, a.trait as Parameters<typeof giftOf>[2]) : 0;
}

/** Жалованье подтверждённого совета за игровой день — расход казны в книге запасов (`goods.drainCeil`). */
export function councilWage(card: WatchCard, hall: number): number {
  let n = 0;
  for (const post of ADVISOR_POSTS) {
    const a = confirmedSeat(card, post, hall);
    if (a) n += advisorWage(a.level, a.trait as Parameters<typeof advisorWage>[1]);
  }
  return n;
}

/**
 * Стойкость сверх обряда для слепка войны: Воевода подтверждённого совета при ратуше книги стройки (`war.SheetAt.marshal`) и
 * рыцарство в силе по подтверждённым уровням и привилегиям (`SheetAt.knights`, РТ-2); нет — пусто.
 */
export function marshalOf(rec: WatchRecord, at: number): { marshal?: number; knights?: number } {
  const levels = townOf(rec, at).levels;
  const marshal = councilResolve(rec.card, levelIn(levels, 'town_hall'));
  const knights = rec.card ? estateCeilOf(rec.card, levels).resolve : 0;
  return { ...(marshal > 0 ? { marshal } : {}), ...(knights > 0 ? { knights } : {}) };
}

/**
 * Потолок валовой добычи хлеба в час мира для слепка войны (ОС-1, `war.SheetAt.yieldCap`): правило «prod» — места дел
 * подтверждённых построек при подтверждённых жителях, работником в лучших множителях, с подтверждённым Старостой и
 * крестьянством (`build.prodCeil`, `yardMult`), тем же переводом в час, что у моста. Описи нет — пусто.
 */
export function yieldCapOf(rec: WatchRecord, at: number): { yieldCap?: number } {
  if (!rec.card) return {};
  const book = townOf(rec, at);
  const ceil = prodCeil(book.levels, book.pop, yardMult(rec.card, book.levels));
  return { yieldCap: ceil.food * gameDaysPerHour() };
}

// ------------------------------------------------ сословия ---

/** Указ сословия описи: сословие, чей он; указ короны или чужая строка — `null`. */
const decreeEstate = (card: WatchCard): EstateId | null => (isEstate(card.estates?.decree) ? (card.estates?.decree as EstateId) : null);

/**
 * Потолки сословий описи по уровням `levels` (подтверждённым): привилегии — в пределах лестницы, указ — если сословие его могло
 * открыть; лояльность — сверху. Описи без сословий — ровные единицы.
 */
export function estateCeilOf(card: WatchCard, levels: Counts): EstateCeil {
  const priv = privFromRow(card.estates?.priv);
  const dec = decreeEstate(card);
  const infl = influenceOf(levels, priv);
  const open = dec !== null && loyaltyCeil(dec, priv, infl[dec]) >= LOYAL ? dec : null;
  return estateCeil(levels, priv, open);
}

/**
 * Прибавка к выручке рынка сверху (правило «market»): подтверждённый Казначей и купечество в силе по уровням описи — те же
 * двери, что у игры (`derived.marketBoost`), не выше `marketrules.BOOST_MAX`.
 */
export function marketBoost(card: WatchCard): number {
  return Math.min(BOOST_MAX, councilMult(card, 'treasurer', levelIn(card.buildings, 'town_hall')) * estateCeilOf(card, card.buildings).trade);
}

const maxCounts = (x: Counts, y: Counts): Counts => {
  const out: Counts = { ...x };
  for (const [k, v] of Object.entries(y)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
};

/** Множитель стройки сверху: Староста подтверждённого совета и цехи в силе. */
export function buildMult(card: WatchCard, levels: Counts): number {
  return councilMult(card, 'steward', levelIn(levels, 'town_hall')) * estateCeilOf(card, levels).build;
}

/** Множитель добычи дворов сверху: Староста и крестьяне в силе. */
export function yardMult(card: WatchCard, levels: Counts): number {
  return councilMult(card, 'steward', levelIn(levels, 'town_hall')) * estateCeilOf(card, levels).yard;
}

/** Допуск влияния описи против счёта сервера, процентов: опись везёт его с одним знаком после запятой. */
const INFL_SLACK = 0.11;

/**
 * Нарушения сословий одной описи (правило «estates», РТ-2): ряд привилегий — пять чисел в лестнице 0…`PRIV_MAX`; указ —
 * сословия, чья лояльность при этих привилегиях и влиянии могла дойти до `LOYAL` с любыми дарами и вестями; влияние — то, что
 * дают уровни описи и привилегии.
 */
export function estateFaults(card: WatchCard): string[] {
  const x = card.estates;
  if (!x) return [];
  const out: string[] = [];
  if (x.priv.length !== ESTATES.length) out.push(`Сословия: ряд привилегий из ${x.priv.length} чисел, а сословий ${ESTATES.length}.`);
  x.priv.forEach((n, i) => {
    if (!Number.isInteger(n) || n < 0 || n > PRIV_MAX) out.push(`Сословия: у «${ESTATES[i] ?? i}» привилегий ${n} — лестница 0…${PRIV_MAX}.`);
  });
  const priv = privFromRow(x.priv);
  const infl = influenceOf(card.buildings, priv);
  if (x.decree !== undefined && !isEstate(x.decree)) out.push(`Сословия: указ сословия «${x.decree}», а такого сословия нет.`);
  const dec = decreeEstate(card);
  if (dec) {
    const ceil = loyaltyCeil(dec, priv, infl[dec]);
    if (ceil < LOYAL) out.push(`Сословия: указ «${dec}» при лояльности не выше ${Math.floor(ceil)} — открывает его ${LOYAL}.`);
  }
  if (x.infl.length > 0 && ESTATES.some((e, i) => Math.abs((x.infl[i] ?? 0) - infl[e]) > INFL_SLACK)) {
    const said = x.infl.map((n) => n.toFixed(1)).join(' / ');
    const real = ESTATES.map((e) => infl[e].toFixed(1)).join(' / ');
    out.push(`Сословия: влияние ${said}, а уровни и привилегии описи дают ${real}.`);
  }
  return out;
}

/** Книга сословий между описями: привилегий прибавилось не больше дарований, убыло не больше отнятий; счёт не убывает. */
export function estateFlags(a: WatchCard, b: WatchCard, realMs: number): { kind: FlagKind; text: string }[] {
  const out: { kind: FlagKind; text: string }[] = [];
  const x = b.estates;
  if (!x) return out;
  const y = a.estates ?? { priv: [], infl: [], grants: 0, revokes: 0, gifts: 0 };
  if (x.grants < y.grants || x.revokes < y.revokes || x.gifts < y.gifts) {
    out.push({ kind: 'estates', text: `Счёт сословий убыл: дарований ${big(y.grants)} → ${big(x.grants)}, отнятий ${big(y.revokes)} → ${big(x.revokes)}, даров ${big(y.gifts)} → ${big(x.gifts)}.` });
  }
  const pa = privFromRow(y.priv);
  const pb = privFromRow(x.priv);
  let up = 0;
  let down = 0;
  for (const e of ESTATES) {
    const d = (pb[e] ?? 0) - (pa[e] ?? 0);
    if (d > 0) up += d;
    else down -= d;
  }
  // Привилегию дарует и ответ на весть сословия (РТ-2, «Даровать привилегию»): она тоже в счёте дарований.
  if (up > x.grants - y.grants) out.push({ kind: 'estates', text: `Сословия: привилегий прибавилось ${big(up)} за ${span(realMs)}, а дарований в счёте ${big(x.grants - y.grants)}.` });
  if (down > x.revokes - y.revokes) out.push({ kind: 'estates', text: `Сословия: привилегий убыло ${big(down)} за ${span(realMs)}, а отнятий в счёте ${big(x.revokes - y.revokes)}.` });
  return out;
}

/**
 * Сколько игровых дней совет терпит неуплату, прежде чем уйти весь: самое долгое терпение Статуи и срок, за который уходят
 * все при полной неуплате (`DESERT_SHARE`). Жалованье сверх этого срока уплачено — иначе советники ушли бы.
 */
const COUNCIL_GRACE_DAYS = statAt('statue', 'loyalty', MAX_BUILDING_LEVEL) + 1 / DESERT_SHARE;

/**
 * Книга совета (правило «council», РТ-1): наймы между описями — не выше ступени ратуши в минуту найма, счёт наймов и платы
 * за найм — не меньше новых мест; жалованье сидевших весь промежуток — уплачено по ведомости совета сверх терпения; счёт не
 * убывает. Сервер партию не разбирает: места и счёт приходят описью, невозможное — флаг и «внимание:».
 */
export function councilFlags(a: WatchCard, b: WatchCard, days: number, realMs: number): { kind: FlagKind; text: string }[] {
  const out: { kind: FlagKind; text: string }[] = [];
  const x = b.council;
  if (!x) return out;
  const y = a.council ?? { seats: [], hired: 0, fees: 0, paid: 0 };
  if (x.hired < y.hired || x.fees < y.fees || x.paid < y.paid) {
    out.push({ kind: 'council', text: `Счёт совета убыл: наймов ${big(y.hired)} → ${big(x.hired)}, платы за найм ${big(y.fees)} → ${big(x.fees)}, жалованья ${big(y.paid)} → ${big(x.paid)}.` });
  }
  const before = new Set(y.seats.map((s) => s.n));
  const fresh = x.seats.filter((s) => !before.has(s.n));
  const hall = Math.max(levelIn(a.buildings, 'town_hall'), levelIn(b.buildings, 'town_hall'));
  for (const s of fresh) {
    if (advisorFault(s) === null && s.level > councilTier(hall)) {
      out.push({ kind: 'council', text: `Совет: нанят уровень ${s.level} при ратуше ${hall} — она даёт не выше ${councilTier(hall)}.` });
    }
  }
  if (fresh.length > x.hired - y.hired) {
    out.push({ kind: 'council', text: `Совет: новых мест ${big(fresh.length)} за ${span(realMs)}, а наймов в счёте ${big(x.hired - y.hired)}.` });
  }
  const fees = fresh.reduce((t, s) => (isTrait(s.trait) ? t + hirePrice(s.level, s.trait) : t), 0);
  if (x.fees - y.fees < fees) {
    out.push({ kind: 'council', text: `Совет: плата за найм ${big(x.fees - y.fees)} за ${span(realMs)}, а новые места стоят ${big(fees)}.` });
  }
  const sat = x.seats.filter((s) => before.has(s.n) && isTrait(s.trait));
  const wage = sat.reduce((t, s) => t + advisorWage(s.level, s.trait as Parameters<typeof advisorWage>[1]), 0);
  const owed = wage * Math.max(0, days - COUNCIL_GRACE_DAYS);
  if (owed > 0 && (x.paid - y.paid) * GROWTH_SLACK + 1 < owed) {
    out.push({ kind: 'council', text: `Совет: жалованья уплачено ${big(x.paid - y.paid)} за ${span(realMs)}, а ведомость совета сверх терпения — ${big(owed)}.` });
  }
  return out;
}

/**
 * Книга стабильности (правило «stab», docs/stability.md, 2.7): что опись говорит о стабильности между `a` и `b`, сверенное с
 * правилами игры — теми же формулами (`game/stabrules`). Сервер партию не разбирает: ступень и счёт приходят описью, а
 * невозможное — флаг и строка «внимание:» в журнале города. Описи без стабильности — как прежде, без проверки.
 */
export function stabFlags(a: WatchCard, b: WatchCard, days: number, realMs: number): { kind: FlagKind; text: string }[] {
  const out: { kind: FlagKind; text: string }[] = [];
  const x = b.stab;
  const y = a.stab;
  // Шкалу каждой описи сверяет `flagsOf`; здесь — промежуток.
  if (!x || !y) return out;
  const bought = Math.max(0, x.bought - y.bought);
  const spent = x.spent - y.spent;
  // Вести державы (СБ-2) двигают сдвиг и дают очки: их доля — из таблицы правил по ответам книги вестей.
  const credit = crownCredit(a, b);
  const ceil = Math.floor(stabPointsCeil(days) + credit.gain);
  if (spent > ceil) {
    out.push({ kind: 'stab', text: `На стабильность ушло ${big(spent)} очков каждого вида за ${span(realMs)} — правитель дал бы не больше ${big(ceil)}.` });
  }
  if (bought > 0 && spent < bought * STAB_PRICE_MIN) {
    out.push({ kind: 'stab', text: `Куплено ступеней стабильности ${big(bought)}, а очков ушло ${big(spent)} — ступень стоит не меньше ${big(STAB_PRICE_MIN)}.` });
  }
  // Подъём: мятежи сначала опускают, ровная жизнь поднимает сама не выше «Лада», покупки — сверху. Выше этого — не могла.
  const revolts = Math.max(0, x.revolts - y.revolts);
  const won = Math.max(0, b.won - a.won);
  const low = Math.max(STAB_MIN, y.level - revolts);
  const self = Math.max(low, Math.min(STAB_SELF_MAX, low + stabSelfRiseCeil(days, won, STAB_BAND)));
  // Вести державы поднимают и выше «Лада» (СБ-2): их сдвиг — поверх.
  const top = Math.min(STAB_MAX, self + bought + stabEventRiseCeil(credit.rise));
  if (x.level > top) {
    out.push({
      kind: 'stab',
      text: `Стабильность ${signed(y.level)} → ${signed(x.level)} за ${span(realMs)}: куплено ступеней ${big(bought)}, мятежей ${big(revolts)} — подняться выше ${signed(top)} она не могла.`,
    });
  }
  const held = Math.max(0, x.held - y.held);
  if (held > won || held > revolts + 1) {
    out.push({ kind: 'stab', text: `Подавлено мятежей ${big(held)} за ${span(realMs)}, а боёв выиграно ${big(won)}, мятежей поднялось ${big(revolts)}.` });
  }
  return out;
}

/** Ответы на вести державы между описями: строки книги второй описи с номером выше счёта первой и сколько из них не видно. */
export function crownNew(a: WatchCard, b: WatchCard): { seen: WatchCrownEntry[]; unseen: number } {
  const from = a.crown?.n ?? 0;
  const x = b.crown;
  if (!x || x.n <= from) return { seen: [], unseen: 0 };
  const seen = x.last.filter((e) => e.n > from && e.n <= x.n);
  return { seen, unseen: Math.max(0, x.n - from - seen.length) };
}

/**
 * Что вести державы между описями могли дать: подъём стабильности, % ступени, и приток очков — по таблице правил
 * (`crownrules`), а ответы, которых опись не довезла, — самой щедрой вестью. Сверху, а не точно: подделку ловит сверка
 * книги (`crownFlags`), а здесь честный не должен получить флаг стабильности за ступень, которую ему дала весть.
 */
export function crownCredit(a: WatchCard, b: WatchCard): { rise: number; gain: number } {
  const { seen, unseen } = crownNew(a, b);
  let rise = unseen * CROWN_STAB_MAX;
  let gain = unseen * CROWN_GAIN_MAX;
  for (const e of seen) {
    if (!isCrown(e.id)) continue;
    rise += Math.max(0, crownStab(e.id, e.opt));
    gain += crownGain(e.id, e.opt);
  }
  return { rise, gain };
}

/**
 * Книга вестей державы (правило «crown», docs/stability.md, «СБ-2»): вид и ответ каждой новой строки — из таблицы правил,
 * весть не чаще своего срока повтора (минуты прихода — игровое время партии), ответов не больше, чем сетка почты могла
 * принести за настоящее время. Невозможное — флаг и строка «внимание:». Описи без книги — без проверки.
 */
export function crownFlags(a: WatchCard, b: WatchCard, realMs: number): { kind: FlagKind; text: string }[] {
  const out: { kind: FlagKind; text: string }[] = [];
  const x = b.crown;
  if (!x) return out;
  const { seen } = crownNew(a, b);
  for (const e of seen) {
    const rule = own(CROWN_RULES, e.id);
    if (!rule) out.push({ kind: 'crown', text: `Ответ на весть «${e.id}», которой в игре нет.` });
    else if (e.opt >= rule.opts.length) {
      out.push({ kind: 'crown', text: `Весть «${e.id}»: ответа №${e.opt + 1} нет — у неё ${rule.opts.length}.` });
    }
  }
  // Повтор: та же весть дважды ближе срока — среди новых строк и прежних, что помнит первая опись.
  const book = new Map<number, WatchCrownEntry>();
  for (const e of [...(a.crown?.last ?? []), ...x.last]) book.set(e.n, e);
  for (const e of seen) {
    const rule = own(CROWN_RULES, e.id);
    if (!rule || rule.kind === 'chain') continue;
    const every = crownEvery(e.id);
    const twin = [...book.values()].find((o) => o.id === e.id && o.n !== e.n && Math.abs(o.at - e.at) < every);
    if (twin) {
      out.push({
        kind: 'crown',
        text: `Весть «${e.id}» пришла дважды за ${gameDays(Math.abs(twin.at - e.at) / DAY_LENGTH)} — не чаще раза в ${Number.isFinite(every) ? gameDays(every / DAY_LENGTH) : 'партию'}.`,
      });
    }
  }
  const count = x.n - (a.crown?.n ?? 0);
  const ceil = crownAnswersCeil(realMs);
  if (count > ceil) out.push({ kind: 'crown', text: `Ответов на вести державы ${big(count)} за ${span(realMs)} — почта принесла бы не больше ${big(ceil)}.` });
  return out;
}

/**
 * Цена стройки, начатой между описями `a` и `b`: уровни выше первой описи — построенные ко второй и идущая на ней стройка.
 * Тип, которого первая опись не называла, не считается: откуда он начинал, неизвестно. Уровни — не выше потолка постройки,
 * чтобы подделанное число не гоняло цикл.
 */
export function startedCost(a: WatchCard, b: WatchCard): { cost: Partial<Record<ResourceId, number>>; levels: number } {
  const cost: Partial<Record<ResourceId, number>> = {};
  let levels = 0;
  // Очередь (СТ-1): заложенное, но ждущее, тоже оплачено при постановке; места первой описи оплачены до неё.
  const paidBefore = new Set((a.queue ?? []).map((e) => keyOf(e.type, e.level)));
  for (const type of Object.keys(BUILDING_BY_ID) as BuildingTypeId[]) {
    if (!(type in a.buildings)) continue;
    const def = BUILDING_BY_ID[type];
    const top = Math.min(def.maxLevel ?? MAX_BUILDING_LEVEL, MAX_BUILDING_LEVEL);
    const site = Math.max(b.site?.type === type ? b.site.level : 0, ...(b.queue ?? []).filter((e) => e.type === type).map((e) => e.level));
    const to = Math.min(top, Math.max(b.buildings[type] ?? 0, site));
    for (let l = Math.max(2, (a.buildings[type] ?? 0) + 1); l <= to; l++) {
      if (paidBefore.has(keyOf(type, l))) continue;
      for (const [r, v] of Object.entries(upgradeCost(def, l)) as [ResourceId, number][]) cost[r] = (cost[r] ?? 0) + v;
      levels++;
    }
  }
  return { cost, levels };
}

/**
 * Положенный возврат отменённой стройки между описями (правило «refund», СТ-1): места очереди первой описи, которых нет во
 * второй и которые не достроены, — отменены. Начатое на первой описи (её идущая стройка с работой) возвращает половину
 * цены, остальное — всю (`labour.cancelRefund`): работа ложится только на первое место, и снять её нельзя. Нет очереди в
 * одной из описей — отмен не видно, и возврат объясняет разовое дело, как до очереди.
 */
export function cancelledRefund(a: WatchCard, b: WatchCard): { refund: Partial<Record<ResourceId, number>>; count: number } {
  const refund: Partial<Record<ResourceId, number>> = {};
  if (!a.queue || !b.queue) return { refund, count: 0 };
  const still = new Set(b.queue.map((e) => keyOf(e.type, e.level)));
  let count = 0;
  for (const e of a.queue.slice(0, BUILD_QUEUE_MAX)) {
    if (!has(BUILDING_BY_ID, e.type) || still.has(keyOf(e.type, e.level))) continue;
    if ((b.buildings[e.type] ?? 0) >= e.level) continue;
    const started = a.site?.type === e.type && a.site.level === e.level && a.site.done > 0;
    for (const [r, v] of Object.entries(cancelRefund(BUILDING_BY_ID[e.type as BuildingTypeId], e.level, started)) as [ResourceId, number][]) refund[r] = (refund[r] ?? 0) + v;
    count++;
  }
  return { refund, count };
}

/**
 * Строка журнала города о невозможном — с началом `WARN`, одна на флаги и отказ цены ускорения. Платёж Telegram говорит
 * то же начало админу в чат (`tgpay.ts`): хранилищ вебхук не трогает.
 */
export const warned = (rec: WatchRecord, at: number, text: string): WatchRecord => noted(rec, at, 'flag', `${WARN} ${text}`);

/** Положить флаги в запись: тот же вид за последний час не дописывается, а считается в прежний. */
export function addFlags(rec: WatchRecord, at: number, found: { kind: FlagKind; text: string }[]): WatchRecord {
  const flags = [...rec.flags];
  let next: WatchRecord = rec;
  for (const f of found) {
    const prev = [...flags].reverse().find((x) => x.kind === f.kind);
    if (prev && at - prev.at < FLAG_QUIET) {
      flags[flags.indexOf(prev)] = { ...prev, at, text: f.text, n: prev.n + 1 };
      continue;
    }
    flags.push({ at, kind: f.kind, text: f.text, n: 1 });
    next = warned(next, at, `${FLAG_WORD[f.kind]} — ${f.text}`);
  }
  return { ...next, flags: flags.slice(-FLAGS_KEEP) };
}

// ------------------------------------------------ события ---

/** Запрос сохранения с подписью: заход, время в игре, имя пользователя. */
/** Ключ игрока из кода приглашения (`data/social.refCode`: «r» и номер Telegram в base36). Свой код — не приглашение. */
export function invitedBy(start: string | undefined, self: string): string | null {
  const m = start ? /^r([0-9a-z]{1,11})$/.exec(start) : null;
  if (!m) return null;
  const id = parseInt(m[1], 36);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const key = `tg-${id}`;
  return key === self ? null : key;
}

/** Заход: первый — с меткой пригласившего, если игрок пришёл по ссылке (`invitedBy`); у старого игрока метка не меняется. */
export function touched(rec: WatchRecord, at: number, user?: string, ref?: string | null): WatchRecord {
  const next = { ...rec, journal: [...rec.journal] };
  if (!next.first) {
    next.first = at;
    if (ref) next.ref = ref;
  }
  const gap = rec.last ? at - rec.last : Infinity;
  if (gap > SESSION_GAP_MS) {
    next.visits += 1;
    next.journal.push({ at, kind: 'visit', text: rec.last ? `Заход (перерыв ${span(gap)}).` : 'Первый заход.' });
  } else if (gap > 0) {
    next.played += gap;
  }
  next.last = Math.max(rec.last, at);
  if (user) next.user = user;
  next.journal = next.journal.slice(-JOURNAL_KEEP);
  return next;
}

/** Строка журнала. */
export const noted = (rec: WatchRecord, at: number, kind: EntryKind, text: string): WatchRecord => ({
  ...rec,
  journal: [...rec.journal, { at, kind, text }].slice(-JOURNAL_KEEP),
});

/** Что прибавилось из разовых дел между двумя описями — строкой журнала, или пусто. */
function deedsText(a: WatchCard, b: WatchCard): string {
  const parts: string[] = [];
  const add = (word: string, d: number): void => {
    if (d > 0) parts.push(`${word} +${big(d)}`);
  };
  add('побед', b.won - a.won);
  add('поражений', b.lost - a.lost);
  add('логов сожжено', b.lairs - a.lairs);
  add('набегов', b.raids - a.raids);
  const other = b.deeds - a.deeds - (b.won - a.won) - (b.lost - a.lost) - (b.lairs - a.lairs) - (b.raids - a.raids) - (b.games - a.games) - (b.seen - a.seen);
  add('других дел', other);
  return parts.join(', ');
}

/**
 * Принятая запись партии: опись, флаги и журнал. Журнал не пишет строку на каждую запись — их сотни за вечер:
 * записи одного захода сводятся в одну строку, отдельно — разовые дела и промыслы.
 */
export function wrote(rec: WatchRecord, at: number, card: { name: string; power: number; day: number }, raw: WatchCard | undefined, rev: number): WatchRecord {
  let next: WatchRecord = { ...rec, writes: rec.writes + 1, name: card.name, power: card.power, day: card.day };
  if (raw) {
    // Флаги одной описи — по присланной как есть (правило «merge» смотрит, что назвала сборка); сверка двух описей и запись —
    // по сведённой переходом ЗД-1 (`foldCard`).
    const found = flagsOf(raw, at);
    const watch = foldCard(raw);
    const prev = rec.card;
    if (prev) {
      found.push(...flagsBetween(prev, rec.cardAt, watch, at));
      const deeds = deedsText(prev, watch);
      if (deeds) next = noted(next, at, 'deed', `Дела: ${deeds}.`);
      if (watch.games > prev.games) next = noted(next, at, 'game', `Промыслы: ${signed(watch.games - prev.games)}, добыча ${signed(watch.haul - prev.haul)}.`);
    }
    next = { ...next, card: watch, cardAt: at };
    // Флаги одной описи не повторяются в журнале каждую минуту: `addFlags` считает их в прежний.
    next = addFlags(next, at, found);
  }
  const last = next.journal[next.journal.length - 1];
  const line = `Записи партии: последняя №${rev}, игровой день ${card.day}.`;
  if (last && last.kind === 'save' && at - last.at <= SESSION_GAP_MS) {
    const journal = [...next.journal];
    journal[journal.length - 1] = { at, kind: 'save', text: line };
    return { ...next, journal };
  }
  return noted(next, at, 'save', line);
}

/** Книга войска игрока: лежащая или заведённая с первой встречи — пустое войско с минуты, когда сервер его впервые увидел. */
export const bookOf = (rec: WatchRecord, at: number): ArmyBook => rec.book ?? seedBook(rec.first > 0 ? rec.first : at);

/** Книга стройки игрока: лежащая или заведённая с первой встречи — посёлок новой партии с минуты, когда сервер его увидел. */
export const townOf = (rec: WatchRecord, at: number): TownBook => rec.town ?? seedTown(rec.first > 0 ? rec.first : at);

const sumOf = (c: Counts): number => Object.values(c).reduce((t, x) => t + Math.max(0, x), 0);

/**
 * Записать книги по принятой записи партии (docs/pvp.md, разделы 6 и 7): опись заявляет, книги подтверждают не больше,
 * чем объясняют правила за прошедшее серверное время. Порядок: стройка (`town.buildStep`; ускоренные за алмазы уровни —
 * `gems`, записи книги алмазов) → войско (`book.bookAfter`, казармы и конюшня — подтверждённых уровней) → жители
 * (`town.peopleStep`; ушедшие из войска не на войне могут вернуться домой). Заявлено больше — флаги «войско сверх
 * подтверждённого», «стройка сверх подтверждённой», «жители сверх подтверждённых».
 * Нет описи — книги не трогаются: их минута остаётся прежней, и всё объяснимое за это время подтвердится со следующей.
 */
export function booked(
  rec: WatchRecord,
  at: number,
  raw: WatchCard | undefined,
  seen: readonly string[] | undefined,
  grants: readonly Pick<AdminGrant, 'n' | 'troops'>[],
  wars: WarFile | null,
  key: string,
  gems: readonly PaidLevel[] = [],
  prior: Prior = { at: 0 },
): WatchRecord {
  if (!raw) return rec;
  // Опись устройства, ещё не открывшего новую сборку, — прежним форматом: книги считают по сведённой переходом ЗД-1.
  const watch = foldCard(raw);
  const town0 = townOf(rec, at);
  // Староста подтверждённого совета (РТ-1) — при ратуше книги стройки: его стройка быстрее, и потолок растёт той же долей; цехи
  // в силе (РТ-2) — так же, по подтверждённым уровням. Крестьяне в силе прибавляют прироста — потолок жителей растёт той же долей.
  const steward = buildMult(watch, town0.levels);
  const growth = estateCeilOf(watch, town0.levels).growth;
  const claim = { buildings: watch.buildings, pop: watch.pop, bonded: watch.bonded, queued: watch.queued, site: watch.site, queue: watch.queue, steward, growth };
  const built = buildStep(town0, at, claim, gems, prior.card?.site);
  const book0 = bookOf(rec, at);
  const step = bookAfter(book0, at, { troops: watch.troops, hurt: watch.hurt, buildings: watch.buildings }, grants, wars, key, seen ?? [], built.book.levels);
  const army = {
    before: sumOf(book0.bodies),
    after: sumOf(step.book.bodies),
    dead: sumOf(step.dead),
    power: troopPower(step.book.bodies as TroopStack),
    deadPower: troopPower(step.dead as TroopStack),
  };
  const people = peopleStep(built.book, town0.at, claim, army, wars, key);
  // Книга запасов (docs/security.md, ЗЩ-2): склад и казна — из описи, «не меньше» объяснимой убыли; бойцы — тела книги
  // войска и ученики книги жителей.
  const goods = goodsStep(rec.goods ?? null, prior.card, prior.at, watch, at, {
    levels: people.book.levels,
    pop: people.book.pop,
    soldiers: army.after + people.book.queued,
    council: councilWage(watch, levelIn(people.book.levels, 'town_hall')),
    estates: estateCeilOf(watch, people.book.levels),
  });
  const next = { ...rec, book: step.book, town: people.book, goods: goods.book };
  const found: { kind: FlagKind; text: string }[] = [];
  if (goods.hidden.length) {
    const parts = goods.hidden.map((h) => `${stockWord(h.kind)} −${big(h.drop)} (расход позволял ${big(h.could)})`);
    found.push({
      kind: 'hidden',
      text: `Склад убыл без разовых дел и трат за ${span(Math.max(0, at - prior.at))}: ${parts.join(', ')}. В войну идёт не меньше того, что объясняет расход.`,
    });
  }
  const sheet = prior.sheet;
  if (sheet) {
    const short = sheetShort(sheet, goods.book, watch.prod);
    if (short.length) {
      const parts = short.map((x) => `${x.kind === 'bonded' ? 'невольники' : stockWord(x.kind)} ${big(x.sheet)} против ${big(x.book)}`);
      found.push({ kind: 'hidden', text: `Слепок обороны называет меньше, чем опись той же записи: ${parts.join(', ')}. В войну идёт опись.` });
    }
    const eat = eatFloorOf(Math.min(sheet.pop, people.book.pop), sheet.bonded);
    const low = (said: number, floor: number): boolean => said < floor * (1 - 1e-9) - 1e-9;
    if (low(sheet.townPerHour, eat.townPerHour) || low(sheet.perManPerHour, eat.perManPerHour)) {
      found.push({
        kind: 'eat',
        text: `Расход хлеба в слепке обороны: город ${sheet.townPerHour.toFixed(2)} и боец ${sheet.perManPerHour.toFixed(3)} в час, а при самом скудном пайке — не меньше ${eat.townPerHour.toFixed(2)} и ${eat.perManPerHour.toFixed(3)}. В осаду идёт не меньше пола.`,
      });
    }
  }
  if (step.forged > 0) {
    found.push({
      kind: 'forged',
      text: `Войско с ранеными: заявлено ${big(step.claimed)}, сервер подтверждает ${big(step.confirmed)} — сверх обучения в казармах и конюшне, указов и потерь войны за прошедшее время на ${big(step.forged)}. В войну идёт только подтверждённое.`,
    });
  }
  if (built.faults.length) {
    const parts = built.faults.map((f) => `${f.key} — ${f.why}`);
    found.push({ kind: 'queue', text: `Очередь стройки против правил: ${parts.join('; ')}. Эти места сервер не признаёт, ускорение ждущего — отказ.` });
  }
  if (builtForged(built)) {
    found.push({ kind: 'built', text: `Уровни построек выше, чем позволяет труд стройки: не хватает ${big(built.short)} работы — это ${span(realMs(built.short / Math.max(1e-9, built.rate)))} потолка стройки. В войну идут подтверждённые уровни.` });
  }
  if (people.forged > 0) {
    found.push({ kind: 'people', text: `Жителей заявлено ${big(watch.pop)}, сервер подтверждает ${big(people.book.pop)} — сверх прироста, жилья, вестей и вернувшихся из войска на ${big(people.forged)}.` });
  }
  // Выработка не выше мест дел подтверждённых построек (правило «prod», `build.prodCeil`): у двора с двумя делами у каждого
  // дела свои места — как у прежнего здания того же уровня (ЗД-1).
  const ceil = prodCeil(people.book.levels, people.book.pop, yardMult(watch, people.book.levels));
  const over = RESOURCE_IDS.filter((r) => (watch.prod[r] ?? 0) > ceil[r] * (1 + 1e-9) + 1);
  if (over.length > 0) {
    const parts = over.map((r) => `${stockWord(r)} ${big(watch.prod[r] ?? 0)} при потолке ${big(ceil[r])}`);
    found.push({ kind: 'prod', text: `Выработка выше мест дел подтверждённых построек: ${parts.join(', ')} в день. В рост склада идёт потолок.` });
  }
  // Запасы не выше предела (правило «stock», `CITY_RULES`): вместимость — подтверждённых уровней (`build.storageOf`, ею же
  // считает игра, `derived.storageCap`). Опись, назвавшая вместимость не больше подтверждённой, уже сверена в `flagsOf`.
  const cap = storageOf(people.book.levels);
  if (watch.cap > cap) {
    for (const k of RESOURCE_IDS) {
      const have = watch.stock[k] ?? 0;
      if (have > cap + 1) {
        found.push({ kind: 'cap', text: `${upper(stockWord(k))} ${big(have)} при вместимости подтверждённых построек ${big(cap)} (опись называет ${big(watch.cap)}). В войну идёт не больше вместимости.` });
        break;
      }
    }
  }
  return found.length ? addFlags(next, at, found) : next;
}

/** Что было до записи: прежняя опись и её минута (книга запасов сверяет убыль между ними) и слепок обороны той же записи. */
export interface Prior {
  card?: WatchCard;
  at: number;
  sheet?: WarSheet;
}

/** По видам — меньшее из заявленного и подтверждённого. */
function least(claim: Counts, book: Counts): Counts {
  const out: Counts = {};
  for (const [k, v] of Object.entries(claim)) {
    const n = Math.min(v, book[k] ?? 0);
    if (n > 0) out[k] = n;
  }
  return out;
}

/**
 * Что сервер подтверждает у игрока по книгам (docs/security.md): уровни — не выше книги стройки, войско — не больше книги
 * войска, жители — не больше книги жителей, и всё — не больше заявленного описью. Книги ещё нет — посёлок новой партии
 * и пустое войско (`seedTown`, `seedBook`). Описи нет — `null`: подтверждать нечего. Читают рейтинг, реестр замков и `/player`.
 */
export function confirmedOf(rec: WatchRecord): { levels: Counts; troops: Counts; pop: number } | null {
  const c = rec.card;
  if (!c) return null;
  const town = rec.town ?? seedTown(rec.first > 0 ? rec.first : 1);
  return { levels: least(c.buildings, town.levels), troops: least(c.troops, rec.book?.bodies ?? {}), pop: Math.min(c.pop, town.pop) };
}

/** Мощь по подтверждённому (`profile/power.powerOfCounts` — формула игры). Описи нет — ноль. */
export const confirmedPower = (rec: WatchRecord): number => {
  const c = confirmedOf(rec);
  return c ? powerOfCounts(c.levels, c.troops) : 0;
};

/** Отказ «слишком часто»: минута в окно часа; с `OFTEN_PER_HOUR` в окне — флаг. */
export function tooFast(rec: WatchRecord, at: number): WatchRecord {
  const fast = [...rec.fast.filter((t) => at - t < HOUR), at];
  const next = { ...rec, fast };
  if (fast.length < OFTEN_PER_HOUR) return next;
  return addFlags(next, at, [
    { kind: 'often', text: `Записи чаще, чем пишет игра: ${fast.length} отказов «слишком часто» за час; игра пишет не чаще раза в ${span(SAVE_HURRY_MS)}.` },
  ]);
}

/** Отчётов об ошибках за последний час. */
export const reportsInHour = (rec: WatchRecord, at: number): number => rec.reports.filter((t) => at - t < HOUR).length;

export const reported = (rec: WatchRecord, at: number, id: string, text: string): WatchRecord =>
  noted({ ...rec, reports: [...rec.reports.filter((t) => at - t < HOUR), at] }, at, 'report', `Отчёт об ошибке ${id}: ${text.slice(0, 80)}`);

/**
 * Поправить запись наблюдения игрока; `null` из `change` — не писать. Попутно: не легла или хранилище ответило
 * ошибкой — молчим, потому что наблюдение не имеет права уронить запрос игрока, ради которого он пришёл.
 */
export async function observe(stores: Stores, player: string, change: (cur: WatchRecord) => WatchRecord | null): Promise<void> {
  try {
    await rewrite(stores(STORES.watch, 'strong'), player, readWatchRecord, change);
  } catch {
    /* наблюдение попутное */
  }
}
