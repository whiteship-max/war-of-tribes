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
 * Повтор приказа с тем же ключом — прежний итог без второго прихода (`keys`). Чистая логика; хранилище — строка отряда реестра
 * (`BandRow.book`), пишет её `roster.bandOrder`.
 */
import type { AdminGrant, BandBookOrder, BandCell, RoamBookRow, RoamDealBook, TroopKey } from './contract.js';
import { BAND_LIMITS, TROOP_KEYS } from './contract.js';
import { canPromote } from '../../src/game/promoterules.js';
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
}

/** Где отряд и что сервер знает о партии — входы приказа. */
export interface BookAt {
  now: number;
  /** Клетка отряда сейчас и идёт ли он (ход — правда сервера). */
  cell: BandCell;
  moving: boolean;
  /** Сид партии из описи (`WatchCard.seed`); нет — описи ещё не было. */
  seed?: number;
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

/** Применить приказ книги. Повтор ключа — прежняя книга без отказа. */
export function bookOrder(book: RoamBookRow, o: BandBookOrder, at: BookAt): BookStep {
  if (book.keys.includes(o.key)) return { book, error: null, forged: null };
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
  } else if (o.op === 'dismiss') {
    if (have(o.kind) < o.n) return no('Столько бойцов этого вида нет.', null);
    put(o.kind, -o.n);
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
    // Счёт взятых — за этот привоз и прошлый: старше доска сменилась.
    const took = [...deals.took.filter((x) => x.w >= w - 1 && !(x.at === cell && x.w === w)), { at: cell, w, n: was + 1 }].slice(-BAND_LIMITS.keys);
    next = { deals: { ...deals, open: [...deals.open, { key: o.key, tier: o.tier, at: { ...o.at }, w }], took } };
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
      const book2 = {
        ...book,
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
export function bookGrants(book: RoamBookRow, grants: readonly Pick<AdminGrant, 'n' | 'troops'>[]): RoamBookRow {
  const fresh = grants.filter((g) => g.n > book.grant).sort((a, b) => a.n - b.n);
  if (fresh.length === 0) return book;
  const t = { ...book.troops };
  for (const g of fresh) for (const k of TROOP_KEYS) if (g.troops[k]) t[k] = Math.max(0, (t[k] ?? 0) + (g.troops[k] as number));
  return { ...book, troops: clean(t), grant: fresh[fresh.length - 1].n };
}
