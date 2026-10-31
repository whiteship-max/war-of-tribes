/**
 * Книга отряда бродяги (ПН-6, docs/gdd/path_of_sword.md, 3.4 и 6.1.3; решение владельца ВП4; docs/trust-boundary.md, 5б): люди отряда
 * по видам — строй и раненые вместе, — которых сервер подтверждает сам. Слово клиента о людях больше не правда: видимость (ПН-4у) и
 * строка `men` реестра считают людей по книге (`bookMen`).
 *
 * **Приход — только подтверждённый сервером:**
 *  — старт: отряд Воина (`game/roamstart.WARRIOR`) — книга новой строки;
 *  — просящиеся (`join`): номер прихода — на сетке почты (`game/mailgrid.awayArrival`) от сида партии из описи; приход уже наступил и
 *    не старше двух сроков вести (ответ мог ждать связи); номера — только по возрастанию, каждый один раз; людей — не больше потолка прихода (`askrules.askCap` — та же доля хешем
 *    сида, высшая ступень и самые щедрые условия: ступень, лагерь и мораль — слово клиента);
 *  — найм (`hire`): отряд стоит у точки найма (вольный город общий — `world/roampoints.townAt`; село — своё по сиду мира, его сервер
 *    не знает: слово клиента) и не быстрее учений казарм первого уровня (`askrules.drillMs`): учения идут подряд, и очередь не длиннее
 *    `DRILL_AHEAD_MS`. Золото найма — слово клиента: кошеля сервер не ведёт (встречи с НПС, где кошель растёт, считает клиент, ПН-5);
 *  — пленные (`captives`): не больше двух боёв на ход (засада и удар, `FIGHTS_PER_MOVE`), за бой — не больше доли самого сильного
 *    отряда НПС (`askrules.captiveCap`);
 *  — указ админа: бойцы указов (`AdminGrant.troops`) ложатся в книгу по номеру, один раз.
 * **Перемены состава** — повышение и разжалование по дереву снаряжения (`game/promoterules.canPromote`), роспуск — убыль.
 * **Расход** — бой, уход, голод, роспуск: отметка отряда (`seat`) называет людей по видам; меньше книги — книга опускается (убыль
 * игрок не подделывает себе на пользу: назвавший меньше теряет людей и у сервера). **Больше книги — флаг** «внимание:», книга не растёт.
 *
 * **Договоры НПС** (ПН-7, ГДД 3.8): взятие (`take`) — отряд стоит у заказчика (клетка или соседняя — та же мерка, что найм), не больше
 * `CONTRACTS_MAX` открытых разом и не больше, чем доска одной клетки даёт за привоз (`boardSize` города и два вида кастеляна); сдача
 * (`deal`) — только взятого, плата и престиж — не выше строки таблицы наград дел тира (`data/deedgain.DEED_TABLE.deal`, вывод
 * `scripts/deeds` из `game/contractrules`): сверх — срезано и флаг; срыв (`drop`) — закрывает взятый. Что сдано — подтверждённые
 * плата и престиж договоров (`RoamDealBook`). Кошеля и престижа отряда сервер по-прежнему не ведёт (граница доверия, 9): книга держит,
 * сколько договоры **могли** дать.
 *
 * **Обоз** (БЕЗ-1, граница доверия 5в): сколько каждого товара рынка сервер подтверждает в обозе (`RoamBookRow.cargo`) — потолок, как у
 * людей. Растёт только тем, что сервер решает или ограничивает сам: покупка у вольного города (`trade`), указ админа, груз договора
 * «довезти» (`take` с `goods`, не больше груза тира), хлеб села (`bread`, не больше запаса дня села по клетке), снаряжение
 * разжалованных и распущенных (дерево снаряжения), добыча и дань вольного замка (запись войн, `bookHauls`). Убывает продажей, сдачей
 * груза договора и отметкой обоза (`cargoClaim`: еда, бой, сброс, найм — у клиента; меньше книги — книга опускается, больше — флаг).
 * **Продажа сверх книги — отказ и флаг.**
 *
 * Повтор приказа с тем же ключом — прежний итог без второго прихода (`keys`). Чистая логика; хранилище — строка отряда реестра
 * (`BandRow.book`), пишет её `roster.bandOrder`.
 */
import type { AdminGrant, BandBookOrder, BandCell, RoamBookRow, RoamDealBook, RoamTradeBook, RoamTradeTown, TroopKey } from './contract.js';
import { BAND_LIMITS, TROOP_KEYS } from './contract.js';
import { canPromote, demoteKit } from '../../src/game/promoterules.js';
import { villageLeft, villageTaken } from '../../src/game/townrules.js';
import { cargoGoods } from '../../src/game/contractrules.js';
import { CARGO_GOODS } from '../../src/world/dealboard.js';
import { GOOD_BY_ID, eqGood } from '../../src/game/data/market.js';
import { TROOP_BY_ID } from '../../src/game/data/troops.js';
import { UNIT_BY_ID } from '../../src/world/data/units.js';
import { GAIT_HAUL } from '../../src/world/data/gait.js';
import { DRILL_AHEAD_MS, askCap, captiveCap, drillMs, FIGHTS_PER_MOVE } from '../../src/game/askrules.js';
import { awayArrival } from '../../src/game/mailgrid.js';
import { WARRIOR } from '../../src/game/roamstart.js';
import { LETTER_TTL } from '../../src/world/data/tuning.js';
import { roamStub } from '../../src/game/roamstubs.js';
import { menOfPower } from '../../src/world/garrison.js';
import { realTime } from '../../src/game/pace.js';
import { shiftOf } from '../../src/game/shift.js';
import { CONTRACTS_MAX, FROM_KINDS } from '../../src/game/data/contracts.js';
import { DEED_TABLE } from '../../src/game/data/deedgain.js';
import { caravanLeft, caravanPaid, depthOf, fromPurse, goodOf, lotOf, pressAt, shiftOffer, specGood, supplyOf } from '../../src/game/marketrules.js';
import { townMarketLevel } from '../../src/game/townrules.js';
import { townAt } from '../../src/world/roampoints.js';
import { specMult, townCaravan, townSpecOf } from '../../src/world/townspec.js';
import { roamCell, roamMoving } from '../../src/world/roam.js';
import type { RoamWay } from '../../src/world/roammove.js';
import { FED_CELLS, TRADE_TOWNS } from './bandorder.js';

/** Запаздывание часов: приход, наступивший у клиента на столько раньше сервера, — честный. */
export const BOOK_SLACK_MS = realTime(2 * 60_000);

/** Очередь учений найма не длиннее суток (`askrules.DRILL_AHEAD_MS` — та же граница у окна найма в игре). */
export { DRILL_AHEAD_MS };

type Troops = Partial<Record<TroopKey, number>>;

const total = (t: Troops): number => Object.values(t).reduce((n: number, v) => n + (v ?? 0), 0);

/** Сколько людей отряда подтверждает книга. */
export const bookMen = (b: RoamBookRow): number => total(b.troops);

const clean = (t: Troops): Troops => {
  const out: Troops = {};
  for (const k of TROOP_KEYS) if ((t[k] ?? 0) > 0) out[k] = Math.floor(t[k] as number);
  return out;
};

/** Книга нового отряда: Воин (ГДД 3.1, `roamstart.WARRIOR`). */
export const startBook = (): RoamBookRow => ({ troops: clean({ ...WARRIOR.band }), join: -1, drill: 0, fights: 0, grant: 0, keys: [] });

/**
 * Книга строки до ПН-6 — заводится с первой отметки словами клиента, один раз: путь открыт только админам, и строк до книги — горсть
 * их проб. Дальше — только подтверждённое.
 */
export const firstBook = (claim: Troops): RoamBookRow => ({ ...startBook(), troops: clean(claim) });

/** Итог приказа книги: новая книга, отказ словами и флаг для журнала игрока («внимание:»). */
export interface BookStep {
  book: RoamBookRow;
  error: string | null;
  forged: string | null;
  /**
   * Отказ, после которого книгу всё же записать (ПН-Э2в): сделка у вольного города легла в партию, а сервер её не подтвердил по
   * запаздыванию (отряд у сервера уже в пути) — цепочка нажима и кошеля идёт вместе с партией, иначе следующая честная сделка вышла бы
   * подделкой; в подтверждённое она не идёт.
   */
  keep?: boolean;
}

/** Где отряд и что сервер знает о партии — входы приказа. */
export interface BookAt {
  now: number;
  /** Клетка отряда сейчас и идёт ли он (ход — правда сервера). */
  cell: BandCell;
  moving: boolean;
  /** Сид партии из описи (`WatchCard.seed`); нет — описи ещё не было. */
  seed?: number;
  /** Запись хода отряда (правда сервера): где стоял отряд в минуту сделки у вольного города (ПН-Э2в). Нет — клетка `cell` сейчас. */
  way?: RoamWay;
}

/** Потолок пленных за бой: доля людей самого сильного отряда НПС — высшая ступень таблицы силы, логово, полная спелость. */
export function captivesCapNow(): number {
  const table = roamStub('foeTable');
  const share = Object.values(roamStub('foeShare')).reduce((m, v) => Math.max(m, v), 0);
  const ripe = Math.max(...roamStub('foeRipe'));
  return captiveCap(menOfPower(Math.max(...table) * share * ripe));
}

/** Сколько договоров одна клетка может дать за привоз: доска города (`boardSize`) и виды кастеляна (его замок — клетка города до ПН-10). */
export const dealsPerCell = (): number => roamStub('boardSize') + FROM_KINDS.castellan.length;

const noDeals = (): RoamDealBook => ({ open: [], took: [], n: 0, gold: 0, fame: 0 });

const noTrade = (): RoamTradeBook => ({ towns: [], n: 0, sold: 0, spent: 0 });

// ---------- обоз (БЕЗ-1) ----------

type Goods = Record<string, number>;

/** Товар обоза: ресурс или снаряжение рынка (невольников в обозе нет). */
const cargoGood = (id: string): boolean => {
  const def = GOOD_BY_ID[id as keyof typeof GOOD_BY_ID];
  return Boolean(def) && def.kind !== 'bonded';
};

/** Прибавить к обозу книги `n` товара `id` (минус — убавить, не ниже нуля). Книги обоза нет — без перемен. */
function plusCargo(book: RoamBookRow, id: string, n: number): RoamBookRow {
  if (!book.cargo || !(n !== 0)) return book;
  const cargo: Goods = { ...book.cargo };
  const v = Math.max(0, (cargo[id] ?? 0) + n);
  if (v > 0) cargo[id] = v;
  else delete cargo[id];
  return { ...book, cargo };
}

/** Прибавить набор товаров (снаряжение — номерами предметов, `eqGood`). */
function plusKit(book: RoamBookRow, kit: Partial<Record<string, number>>, equipment: boolean): RoamBookRow {
  let b = book;
  for (const [id, n] of Object.entries(kit)) if ((n ?? 0) > 0) b = plusCargo(b, equipment ? eqGood(id as Parameters<typeof eqGood>[0]) : id, n as number);
  return b;
}

/** Вместимость обоза людей книги в самом грузовом режиме марша — потолок первой отметки обоза. */
const cargoRoom = (t: Troops): number => total(t) * UNIT_BY_ID.warrior.carry * Math.max(...Object.values(GAIT_HAUL));

/**
 * Отметка обоза (БЕЗ-1): что партия называет у себя — товары рынка, целыми вниз. Книга обоза есть: меньше — убыль (еда, бой, сброс,
 * найм — у клиента), книга опускается; больше — флаг, книга не растёт. Книги нет — она заводится этой отметкой, один раз: у нового
 * отряда (`fresh`) — только хлеб старта, у строки до БЕЗ-1 — всё, что названо (путь открыт только админам, строк до книги — горсть их
 * проб); груз сверх вместимости людей книги — флаг, срезано долей.
 */
export function cargoClaim(book: RoamBookRow, claim: Goods, fresh = false): { book: RoamBookRow; forged: string | null } {
  const said: Goods = {};
  for (const [id, n] of Object.entries(claim)) if (cargoGood(id) && n > 0) said[id] = Math.floor(n);
  if (!book.cargo) {
    const over: string[] = [];
    let start: Goods = said;
    if (fresh) {
      start = said.food ? { food: said.food } : {};
      for (const id of Object.keys(said)) if (id !== 'food') over.push(`${id} ${said[id]} в обозе нового отряда`);
    }
    const load = Object.values(start).reduce((t, n) => t + n, 0);
    const room = cargoRoom(book.troops);
    if (load > room) {
      over.push(`груз ${load} при вместимости ${Math.floor(room)}`);
      start = Object.fromEntries(Object.entries(start).map(([id, n]) => [id, Math.floor((n * room) / load)]).filter(([, n]) => (n as number) > 0));
    }
    return { book: { ...book, cargo: start }, forged: over.length ? `Обоз отряда при заведении книги: ${over.join(', ')}.` : null };
  }
  const cargo: Goods = {};
  const over: string[] = [];
  for (const id of new Set([...Object.keys(book.cargo), ...Object.keys(said)])) {
    const b = book.cargo[id] ?? 0;
    const c = said[id] ?? 0;
    if (c > b) over.push(`${id} ${c} при ${b}`);
    const v = Math.min(b, c);
    if (v > 0) cargo[id] = v;
  }
  return { book: { ...book, cargo }, forged: over.length ? `Обоз отряда сверх книги: ${over.join(', ')}.` : null };
}

/** Добыча или дань вольного замка из записи войн: номер (`fall:война`, `paid:война`) и товары. */
export interface BookHaul {
  id: string;
  goods: Partial<Record<string, number>>;
}

/**
 * Добыча и дань вольных замков (ПН-10), ещё не легшие в обоз книги: каждая один раз. Решает их сервер войны (падение, откуп), и книга
 * берёт их из записи войн, а не со слов клиента. Золото — кошель, его сервер не ведёт; в обоз — только товары рынка.
 */
export function bookHauls(book: RoamBookRow, hauls: readonly BookHaul[]): RoamBookRow {
  const done = new Set(book.hauls ?? []);
  const fresh = hauls.filter((h) => !done.has(h.id));
  if (fresh.length === 0) return book;
  let b = book;
  for (const h of fresh) for (const [id, n] of Object.entries(h.goods)) if (cargoGood(id) && (n ?? 0) > 0) b = plusCargo(b, id, Math.floor(n as number));
  return { ...b, hauls: [...(book.hauls ?? []), ...fresh.map((h) => h.id)].slice(-BAND_LIMITS.keys) };
}

/**
 * Хлеб у села (БЕЗ-1, ГДД 3.3.4): отряд стоит у клетки села; штук — не больше запаса дня села той же формулой, что у партии
 * (`townrules.villageLeft` — запас дня отходит за игровой день), по записи этой клетки. Само село — слово клиента (сёла свои по сиду
 * мира), как у найма. Сверх запаса — отказ и флаг; в пути — отказ без флага.
 */
function breadOrder(book: RoamBookRow, o: Extract<BandBookOrder, { op: 'bread' }>, at: BookAt): BookStep {
  const no = (error: string, forged: string | null = null): BookStep => ({ book, error, forged });
  if (at.moving) return no('Отряд в пути: хлеб покупают стоя.', null);
  if (Math.max(Math.abs(at.cell.x - o.at.x), Math.abs(at.cell.y - o.at.y)) > 1)
    return no('Отряд не у этого села.', `Хлеб у ${o.at.x}|${o.at.y}, а отряд стоит в ${at.cell.x}|${at.cell.y}.`);
  const cell = `${o.at.x}:${o.at.y}`;
  const was = (book.fed ?? []).find((f) => f.at === cell);
  // Часы клиента могут чуть обгонять сервер: запас — на минуту запаздывания вперёд.
  const left = was ? villageLeft(was.took, was.t, at.now + BOOK_SLACK_MS) : villageLeft(0, at.now, at.now);
  if (o.n > Math.floor(left)) return no(`У села только ${Math.floor(left)}.`, `Хлеб у ${o.at.x}|${o.at.y}: ${o.n}, а запас дня села ${Math.floor(left)}.`);
  const took = (was ? villageTaken(was.took, was.t, at.now) : 0) + o.n;
  const fed = [...(book.fed ?? []).filter((f) => f.at !== cell), { at: cell, took, t: at.now }].slice(-FED_CELLS);
  return { book: { ...plusCargo(book, 'food', o.n), fed, keys: [...book.keys, o.key].slice(-BAND_LIMITS.keys) }, error: null, forged: null };
}

/** Где стоял отряд в минуту `t`: до выхода последнего хода — в его начале; дальше — по ходу. Хода нет — клетка приказа. */
function standAt(at: BookAt, t: number): { cell: BandCell; moving: boolean } {
  const way = at.way;
  if (!way) return { cell: at.cell, moving: at.moving };
  if (t < way.at) return { cell: { x: way.from.x, y: way.from.y }, moving: false };
  return { cell: roamCell(way, t), moving: roamMoving(way, t) };
}

/**
 * Сделка у вольного города (ПН-Э2в, ГДД 3.7.1; граница доверия, 5в): сервер ведёт цепочку сделок отряда у каждого города — привоз, счёт
 * купленного и проданного, нажим и караванный кошель — и выводит цену той же формулой, что игра (`marketrules`: основа со
 * специализацией `world/townspec`, глубина и запас уровня города, нажим `pressAt`, партия `lotOf`). Подделка — отказ и флаг: города нет,
 * товара нет, минута впереди часов или раньше прежней, куплено дешевле правила или сверх привоза, продано дороже правила или сверх
 * караванного кошеля, отряд стоял не у города. Отряд в пути (запаздывание) — отказ без флага, цепочка идёт с партией (`keep`).
 * Подтверждённое — счёт сделок, выручки и трат (`RoamTradeBook`).
 */
function tradeOrder(book: RoamBookRow, o: Extract<BandBookOrder, { op: 'trade' }>, at: BookAt): BookStep {
  const no = (error: string, forged: string | null = null): BookStep => ({ book, error, forged });
  const where = `${o.at.x}|${o.at.y}`;
  const NOT_RULE = 'Сделка не по правилам рынка — сервер её не принял.';
  if (o.t > at.now + BOOK_SLACK_MS) return no(NOT_RULE, `Сделка у ${where}: минута на ${Math.round((o.t - at.now) / 1000)} с впереди часов сервера.`);
  const town = townAt(o.at.x, o.at.y);
  if (!town || town.tier <= 0) return no('Здесь нет вольного города.', `Сделка у ${where}: вольного города там нет.`);
  const def = goodOf(o.good);
  if (!def || !fromPurse(def.id)) return no('Такого товара на рынке города нет.', `Сделка у ${where}: товара «${o.good}» у вольного города нет.`);
  const trade = book.trade ?? noTrade();
  const cellKey = `${o.at.x}:${o.at.y}`;
  const was = trade.towns.find((x) => x.at === cellKey);
  if (was && o.t < was.last) return no(NOT_RULE, `Сделка у ${where}: минута раньше прежней сделки у этого города.`);
  const w = shiftOf(o.t);
  const level = townMarketLevel(town.tier as 1 | 2 | 3);
  const base: RoamTradeTown =
    was && was.w === w ? was : { at: cellKey, w, bought: {}, sold: {}, press: was?.press ?? {}, ...(was?.cv ? { cv: was.cv } : {}), last: was?.last ?? 0 };
  const p = base.press[def.id];
  const q0 = p ? pressAt(p[0], p[1], o.t) : 0;
  const lot = lotOf(specGood(def, specMult(townSpecOf(town.x, town.y), def.id)), w, depthOf(def, level), q0, o.n, 1);
  const k = Math.abs(o.n);
  const name = def.name.toLowerCase();
  const caravan = townCaravan(town.x, town.y, level);
  if (o.n > 0) {
    const supply = shiftOffer(w, level).includes(def.id) ? supplyOf(def, level, w, 0) : 0;
    const sold = base.sold[def.id] ?? 0;
    const bought = (base.bought[def.id] ?? 0) + k;
    if (bought > supply + sold) return no(NOT_RULE, `Сделка у ${where}: куплено ${bought} (${name}) за привоз — привезли ${supply}, продано городу ${sold}.`);
    if (o.gold < lot.gold) return no(NOT_RULE, `Сделка у ${where}: ${name} ${k} куплено за ${o.gold} — по правилу не меньше ${lot.gold}.`);
  } else {
    // Обоз книги (БЕЗ-1): продают только то, что в обозе есть, — товар из ничего не продаётся.
    if (book.cargo && k > (book.cargo[def.id] ?? 0))
      return no('Столько этого товара в обозе нет.', `Сделка у ${where}: продано ${k} (${name}), а в обозе книги ${book.cargo[def.id] ?? 0}.`);
    if (o.gold > lot.gold) return no(NOT_RULE, `Сделка у ${where}: ${name} ${k} продано за ${o.gold} — по правилу не больше ${lot.gold}.`);
    const left = caravanLeft(caravan.cap, caravan.refillMs, base.cv, o.t);
    if (o.gold > left) return no(NOT_RULE, `Сделка у ${where}: выручка ${o.gold}, а в караванном кошеле города ${Math.floor(left)}.`);
  }
  const st = standAt(at, o.t);
  const away = Math.max(Math.abs(st.cell.x - o.at.x), Math.abs(st.cell.y - o.at.y)) > 1;
  if (!st.moving && away) return no('Отряд не у этого города.', `Сделка у ${where}, а отряд стоял в ${st.cell.x}|${st.cell.y}.`);
  const add = (rec: Record<string, number>): Record<string, number> => ({ ...rec, [def.id]: (rec[def.id] ?? 0) + k });
  const town2: RoamTradeTown = {
    ...base,
    ...(o.n > 0 ? { bought: add(base.bought) } : { sold: add(base.sold), cv: caravanPaid(caravan.cap, caravan.refillMs, base.cv, o.t, o.gold) }),
    press: { ...base.press, [def.id]: [q0 + o.n, o.t] },
    last: o.t,
  };
  const towns = [...trade.towns.filter((x) => x.at !== cellKey), town2].slice(-TRADE_TOWNS);
  const keys = [...book.keys, o.key].slice(-BAND_LIMITS.keys);
  // Обоз книги идёт с партией и в запаздывании: товар у клиента лёг или ушёл, и следующая честная сделка не должна выйти подделкой.
  const carried = plusCargo(book, def.id, o.n);
  // В пути у сервера (запаздывание: сделка шла дольше хода) — цепочка с партией, подтверждения нет.
  if (st.moving) return { book: { ...carried, trade: { ...trade, towns }, keys }, error: 'Отряд уже в пути: сделка не подтверждена.', forged: null, keep: true };
  const confirmed: RoamTradeBook =
    o.n > 0 ? { towns, n: trade.n + 1, sold: trade.sold, spent: trade.spent + o.gold } : { towns, n: trade.n + 1, sold: trade.sold + o.gold, spent: trade.spent };
  return { book: { ...carried, trade: confirmed, keys }, error: null, forged: null };
}

/** Применить приказ книги. Повтор ключа — прежняя книга без отказа. */
export function bookOrder(book: RoamBookRow, o: BandBookOrder, at: BookAt): BookStep {
  if (book.keys.includes(o.key)) return { book, error: null, forged: null };
  if (o.op === 'trade') return tradeOrder(book, o, at);
  if (o.op === 'bread') return breadOrder(book, o, at);
  const no = (error: string, forged: string | null = null): BookStep => ({ book, error, forged });
  const t = { ...book.troops };
  const have = (k: TroopKey): number => t[k] ?? 0;
  const put = (k: TroopKey, d: number): void => {
    t[k] = have(k) + d;
  };
  let next: Partial<RoamBookRow> = {};
  if (o.op === 'join') {
    if (at.seed === undefined) return no('Сервер ещё не видел партии — повтори позже.');
    if (o.k <= book.join) return no('Эти люди уже приняты.', `Просящиеся прихода ${o.k} — второй раз (книга: последний ${book.join}).`);
    const came = awayArrival(at.seed, o.k);
    if (came > at.now + BOOK_SLACK_MS) return no('Этих людей у лагеря нет.', `Просящиеся прихода ${o.k}: по сетке почты приход ещё не наступил.`);
    // Ответ мог прийти позже срока вести: связь пропала, приказ ждал в очереди. Старше двух сроков — отказ без флага: людей не ждут.
    if (at.now - came > 2 * LETTER_TTL) return no('Эти люди ушли — ответ опоздал.');
    const cap = askCap(at.seed, o.k);
    if (o.n > cap) return no(`Пришло не больше ${cap}.`, `Просящиеся прихода ${o.k}: игра назвала ${o.n}, потолок прихода ${cap}.`);
    put('clubman', o.n);
    next = { join: o.k };
  } else if (o.op === 'hire') {
    if (at.moving) return no('Отряд в пути: нанимают стоя.', null);
    if (Math.max(Math.abs(at.cell.x - o.at.x), Math.abs(at.cell.y - o.at.y)) > 1)
      return no('Отряд не у этой точки.', `Найм у ${o.at.x}|${o.at.y}, а отряд стоит в ${at.cell.x}|${at.cell.y}.`);
    const start = Math.max(book.drill, at.now);
    const until = start + drillMs(o.kind, o.n);
    if (until - at.now > DRILL_AHEAD_MS + BOOK_SLACK_MS) return no('Казармы заняты: учений больше чем на сутки.', `Найм ${o.n} (${o.kind}): учений на ${Math.round((until - at.now) / 60_000)} мин вперёд.`);
    put(o.kind, o.n);
    next = { drill: until };
  } else if (o.op === 'captives') {
    if (book.fights <= 0) return no('Пленных брать не с кого.', `Пленные ${o.n} без боя хода.`);
    const cap = captivesCapNow();
    if (o.n > cap) return no(`Пленных не больше ${cap}.`, `Пленные: игра назвала ${o.n}, потолок боя ${cap}.`);
    put('clubman', o.n);
    next = { fights: book.fights - 1 };
  } else if (o.op === 'promote' || o.op === 'demote') {
    const ok = o.op === 'promote' ? canPromote(o.from, o.to) : canPromote(o.to, o.from);
    if (!ok) return no('Так не повышают.', `${o.op === 'promote' ? 'Повышение' : 'Разжалование'} ${o.from} → ${o.to} вне дерева снаряжения.`);
    if (have(o.from) < o.n) return no('Столько бойцов этого вида нет.', `${o.op === 'promote' ? 'Повышение' : 'Разжалование'} ${o.n} (${o.from}), а в книге ${have(o.from)}.`);
    put(o.from, -o.n);
    put(o.to, o.n);
    // Снятое с разжалованных снаряжение — в обоз книги (дерево снаряжения, та же `demoteKit`, что у партии).
    if (o.op === 'demote' && book.cargo) next = { cargo: plusKit(book, demoteKit(o.from, o.to, o.n) ?? {}, true).cargo };
  } else if (o.op === 'dismiss') {
    if (have(o.kind) < o.n) return no('Столько бойцов этого вида нет.', null);
    put(o.kind, -o.n);
    // Снаряжение распущенных — в обоз книги (ГДД 3.3.2).
    const kit = Object.fromEntries(Object.entries(TROOP_BY_ID[o.kind].gear).map(([e, k]) => [e, (k ?? 0) * o.n]));
    if (book.cargo) next = { cargo: plusKit(book, kit, true).cargo };
  } else if (o.op === 'take') {
    const deals = book.deals ?? noDeals();
    if (at.moving) return no('Отряд в пути: договор берут стоя.', null);
    if (Math.max(Math.abs(at.cell.x - o.at.x), Math.abs(at.cell.y - o.at.y)) > 1)
      return no('Отряд не у заказчика.', `Договор у ${o.at.x}|${o.at.y}, а отряд стоит в ${at.cell.x}|${at.cell.y}.`);
    if (o.tier < 1 || o.tier > 3) return no('Такого тира нет.', `Договор тира ${o.tier}.`);
    if (deals.open.length >= CONTRACTS_MAX) return no(`Договоров уже ${CONTRACTS_MAX}.`, `Взят ${deals.open.length + 1}-й договор разом (правило — ${CONTRACTS_MAX}).`);
    const w = shiftOf(at.now);
    const cell = `${o.at.x}:${o.at.y}`;
    const was = deals.took.find((x) => x.at === cell && x.w === w)?.n ?? 0;
    const cap = dealsPerCell();
    if (was >= cap) return no('Доска заказчика пуста.', `Договоров у ${o.at.x}|${o.at.y} за привоз — ${was + 1}, доска даёт не больше ${cap}.`);
    // Груз «довезти» (БЕЗ-1): товар — из груза договоров, штук — не больше груза тира; сверх — отказ и флаг.
    if (o.goods) {
      const most = cargoGoods(o.tier as 1 | 2 | 3);
      if (!(CARGO_GOODS as readonly string[]).includes(o.goods.id) || o.goods.n > most)
        return no('Такого груза у договора нет.', `Договор тира ${o.tier}: груз ${o.goods.id} ${o.goods.n}, а договор даёт до ${most} (${CARGO_GOODS.join(', ')}).`);
    }
    // Счёт взятых — за этот привоз и прошлый: старше доска сменилась.
    const took = [...deals.took.filter((x) => x.w >= w - 1 && !(x.at === cell && x.w === w)), { at: cell, w, n: was + 1 }].slice(-BAND_LIMITS.keys);
    const goods = o.goods ? { goods: { ...o.goods } } : {};
    next = { deals: { ...deals, open: [...deals.open, { key: o.key, tier: o.tier, at: { ...o.at }, w, ...goods }], took }, ...(o.goods && book.cargo ? { cargo: plusCargo(book, o.goods.id, o.goods.n).cargo } : {}) };
  } else if (o.op === 'deal' || o.op === 'drop') {
    const deals = book.deals ?? noDeals();
    const take = deals.open.find((x) => x.key === o.take);
    if (!take) {
      if (o.op === 'drop') return { book: { ...book, keys: [...book.keys, o.key].slice(-BAND_LIMITS.keys) }, error: null, forged: null };
      return no('Такого договора нет.', `Сдача договора ${o.take} без взятия.`);
    }
    const open = deals.open.filter((x) => x !== take);
    if (o.op === 'drop') next = { deals: { ...deals, open } };
    else {
      // Плата и престиж — не выше строки таблицы наград дел тира: сверх — срезано, флаг.
      const goldCap = DEED_TABLE.deal.gold[take.tier - 1] ?? 0;
      const fameCap = DEED_TABLE.deal.fame[take.tier - 1] ?? 0;
      const over = o.gold > goldCap || o.fame > fameCap;
      // Груз договора сдан заказчику — с обоза книги (БЕЗ-1).
      const left = take.goods ? plusCargo(book, take.goods.id, -take.goods.n) : book;
      const book2 = {
        ...left,
        deals: { ...deals, open, n: deals.n + 1, gold: deals.gold + Math.min(o.gold, goldCap), fame: deals.fame + Math.min(o.fame, fameCap) },
        keys: [...book.keys, o.key].slice(-BAND_LIMITS.keys),
      };
      return {
        book: book2,
        error: null,
        forged: over ? `Договор тира ${take.tier}: плата ${o.gold} при потолке ${goldCap}, престиж ${o.fame} при потолке ${fameCap}.` : null,
      };
    }
  }
  return { book: { ...book, ...next, troops: clean(t), keys: [...book.keys, o.key].slice(-BAND_LIMITS.keys) }, error: null, forged: null };
}

/** Новый ход принят: засада на дороге и удар по цели — до двух боёв, после которых можно взять пленных. */
export const bookMoved = (book: RoamBookRow): RoamBookRow => ({ ...book, fights: FIGHTS_PER_MOVE });

/**
 * Отметка отряда — что партия называет у себя (строй, раненые и люди на учениях). Меньше книги — убыль: книга опускается до слов
 * клиента. Больше — флаг, книга не растёт. Возвращает книгу и строку флага.
 */
export function bookClaim(book: RoamBookRow, claim: Troops): { book: RoamBookRow; forged: string | null } {
  const t: Troops = {};
  const over: string[] = [];
  for (const k of TROOP_KEYS) {
    const b = book.troops[k] ?? 0;
    const c = Math.max(0, Math.floor(claim[k] ?? 0));
    if (c > b) over.push(`${k} ${c} при ${b}`);
    t[k] = Math.min(b, c);
  }
  return { book: { ...book, troops: clean(t) }, forged: over.length ? `Люди отряда сверх книги: ${over.join(', ')}.` : null };
}

/** Бойцы указов админа, ещё не легшие в книгу: по номеру, один раз; убавка не ниже нуля. */
export function bookGrants(book: RoamBookRow, grants: readonly (Pick<AdminGrant, 'n' | 'troops'> & { stock?: AdminGrant['stock'] })[]): RoamBookRow {
  const fresh = grants.filter((g) => g.n > book.grant).sort((a, b) => a.n - b.n);
  if (fresh.length === 0) return book;
  const t = { ...book.troops };
  let b = book;
  for (const g of fresh) {
    for (const k of TROOP_KEYS) if (g.troops[k]) t[k] = Math.max(0, (t[k] ?? 0) + (g.troops[k] as number));
    // Припасы указа — в обоз книги (БЕЗ-1, `sim/bandgrant.toBand`): прибавка и убавка; золото — кошель, его сервер не ведёт.
    for (const [k, n] of Object.entries(g.stock ?? {})) if (k !== 'gold' && n) b = plusCargo(b, k, n);
  }
  return { ...b, troops: clean(t), grant: fresh[fresh.length - 1].n };
}
