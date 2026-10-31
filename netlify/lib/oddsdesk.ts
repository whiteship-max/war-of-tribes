/**
 * Шанс окна вольного замка на сервере (ПН-Э2г, docs/gdd/path_of_sword.md, 23.11; адрес — `routes/odds.ts`). До пачки окно считало шанс
 * в браузере своим потоком с кодом сервера войны (Э2б): на телефоне 26.6 с пустого окна, и 164 КБ кода сервера по сети. Теперь считает
 * сервер — той же дверью окна, что автопилот прибора (`world/freeodds`: голова и хвост — `freeRowsOf`, строки пути — `freePathsSteps`,
 * вместе это ровно `freeNeeds`).
 *
 * **Чему сервер не верит.** Состав отряда — книга отряда реестра (`BandRow.book.troops`, ВП4: то, с чем поход на замок сервер и примет,
 * `war.marchFree`), а не слово клиента; клетка, «в пути ли» и «у стен ли» — ход реестра (`roamCell`, `roamMoving`) в минуту сервера;
 * замок и его ступень — строка пула (`RosterFile.free`); престиж — `BandRow.prestige` (слово описи, как у доступа в `marchFree`). От
 * клиента приходит только ключ замка.
 *
 * **Отдаёт только то, что видит отряд.** Гарнизон — тем же правилом, что видел клиент (`freeLook`): стоящий отряд в круге обзора —
 * точкой по правилу ступени, иначе вилкой вниз. Настоящий гарнизон после чужих осад сервер знает, но в счёт он не идёт и наружу не
 * уходит: иначе окно выдало бы чужие войны.
 *
 * **Кэш** — по ключу «версия состояния замка + состав отряда + что видит отряд»: версия меняется с любым делом, которое трогает гарнизон
 * (строка пула, взятие и пожар, бои и дань войн на этот замок за `BURN_IMMUNE`), состав — с любым сдвигом книги. Сменился ключ у игрока
 * под тем же замком — прежняя запись сбрасывается. Ответ из кэша — сразу.
 *
 * **Нагрузка.** Строки пути — секунды ядра боя: на своём сервере их считает отдельный поток с низким приоритетом (`vps/oddsthread.ts`,
 * подставляет `setOddsCounter`), по одному делу за раз; у игрока не больше одного расчёта сразу; срок расчёта — `ODDS_LIMITS.calcMs`;
 * очередь всех игроков — не длиннее `ODDS_LIMITS.queue`; запросов в минуту — `ODDS_LIMITS.perMinute` (сито `allow` в обработчике). Запрос
 * ждёт расчёта не дольше `holdMs` и отвечает «считаем» — клиент спрашивает снова и встаёт к тому же делу, а не к новому.
 */
import type { RosterFile } from './contract.js';
import type { WarFile } from './war.js';
import { freeAt, freeBar, freeLook, freePathsSteps, freeRowsOf, type FreeNeedIn, type FreeNeedRow, type FreePathIn } from '../../src/world/freeodds.js';
import { roamCell, roamMoving } from '../../src/world/roam.js';
import { partyTimeAt } from '../../src/world/sight.js';
import { BURN_IMMUNE } from '../../src/world/data/tuning.js';
import { SEASON_MODIFIERS } from '../../src/game/data/seasons.js';
import { seasonOf } from '../../src/game/derived.js';

export const ODDS_LIMITS = {
  /** Запросов в минуту на игрока — ведро обработчика; клиент переспрашивает «считаем» раз в две секунды. */
  perMinute: 40,
  /** Сколько запрос ждёт расчёта, прежде чем ответить «считаем» (запрос клиента бросается через 8 с — `net/api`). */
  holdMs: 4000,
  /** Срок одного расчёта: дольше — «шанс не посчитан», а не вечная очередь. */
  calcMs: 30_000,
  /** Дел в очереди всех игроков (считается и идущее): больше — «сервер занят». */
  queue: 16,
  /** Записей в кэше: старейшая уходит первой. */
  cache: 2000,
  /** Сколько помнится несосчитанное в срок: тот же ключ раньше — тот же отказ, а не новый расчёт. */
  failMs: 10 * 60_000,
};

/** Счёт строк пути: строки или `null` — срок вышел. */
export type OddsCounter = (path: FreePathIn, calcMs: number) => Promise<FreeNeedRow[] | null>;

/** Строки пути шагами двери окна с проверкой срока между репетициями. `clock` — мс (поток и тест). */
export function countPaths(path: FreePathIn, calcMs: number, clock: () => number = () => performance.now()): FreeNeedRow[] | null {
  const end = clock() + calcMs;
  const g = freePathsSteps(path);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
    if (clock() > end) return null;
  }
}

/** Счёт в этом же потоке — тесты и дом без потоков. */
export const inlineCounter: OddsCounter = async (path, calcMs) => countPaths(path, calcMs);

/** Что окно спрашивает: строки целиком (`input`), тяжёлая часть (`path`) и ключ кэша. */
export interface OddsAsk {
  castle: string;
  key: string;
  input: FreeNeedIn;
  path: FreePathIn;
}

/** Состав отряда подписью: виды по имени, только живые. */
export const bandSig = (troops: Readonly<Record<string, number | undefined>>): string =>
  Object.entries(troops)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, n]) => `${k}${n}`)
    .join(',');

/**
 * Версия состояния замка: строка пула (ступень, минута постановки), кто взял или сжёг (`WarFile.free`) и войны на этот замок, ещё
 * трогающие гарнизон (идут или кончились меньше `BURN_IMMUNE` назад, — `war.npcSheet`): их фаза, число боёв и дань.
 */
export function castleVersion(roster: RosterFile, wars: WarFile, id: string, now: number): string | null {
  const row = roster.free?.[id];
  if (!row) return null;
  const hold = wars.free?.[id];
  const fights = wars.wars
    .filter((w) => w.def === id && (w.endAt === undefined || w.endAt + BURN_IMMUNE > now))
    .map((w) => `${w.id}:${w.phase}:${w.battles.length}:${w.tribute?.at ?? '-'}`);
  return `${row.tier}|${row.born}|${hold ? `${hold.war}:${hold.fate}:${hold.burnt ?? '-'}` : '-'}|${fights.join(',')}`;
}

export const NO_BAND = 'Отряда нет в реестре.';
export const NO_CASTLE = 'Этого замка больше нет.';
export const CASTLE_GONE = 'Замок уже взят или сожжён — дела у стен нет.';
export const IN_SIEGE = 'Отряд уже в походе или осаде: шанс считается до приказа.';
export const TOO_LONG = 'Шанс у стен не посчитан: счёт дольше срока.';
export const BUSY = 'Сервер считает другие окна — спросить чуть позже.';

/** Вход окна из записей сервера (реестр и войны) в минуту `now`; отказ — словами. */
export function oddsAsk(roster: RosterFile, wars: WarFile, player: string, id: string, now: number): OddsAsk | string {
  const band = roster.bands?.[player];
  if (!band) return NO_BAND;
  const row = roster.free?.[id];
  const version = castleVersion(roster, wars, id, now);
  if (!row || version === null) return NO_CASTLE;
  const hold = wars.free?.[id];
  if (hold && (hold.burnt === undefined || hold.burnt > now)) return CASTLE_GONE;
  if (wars.wars.some((w) => w.atk === player && (w.phase === 'march' || w.phase === 'camp'))) return IN_SIEGE;
  const moving = roamMoving(band.way, now);
  const at = roamCell(band.way, now);
  const near = !moving && Math.max(Math.abs(at.x - row.x), Math.abs(at.y - row.y)) <= 1;
  const look = freeLook(at, moving, { x: row.x, y: row.y });
  const troops = Object.fromEntries(Object.entries(band.book?.troops ?? {}).filter(([, n]) => (n ?? 0) > 0)) as FreeNeedIn['band'];
  const time = partyTimeAt(band.clock ?? { time: 0, at: band.born }, now);
  const seasonFood = SEASON_MODIFIERS[seasonOf(Math.max(0, time))].food;
  const castle = freeAt(id, row.tier);
  const path: FreePathIn = { at: castle, look, band: troops, seasonFood };
  const input: FreeNeedIn = { ...path, prestige: band.prestige, near, online: true };
  return { castle: id, key: `${id}|${version}|${bandSig(troops)}|${look.spread}|${seasonFood}|${freeBar()}`, input, path };
}

export type OddsAnswer = { rows: FreeNeedRow[] } | { wait: true } | { error: string };

interface Entry {
  rows: FreeNeedRow[] | null;
  at: number;
}

/** Стол расчётов: кэш, дело игрока, очередь. Один на экземпляр сервера (`desk`); тест заводит свой. */
export class OddsDesk {
  private readonly cache = new Map<string, Entry>();
  /** Последний ключ игрока под замком: сменился — прежняя запись кэша сброшена. */
  private readonly last = new Map<string, string>();
  /** Дело игрока, которое считается сейчас или ждёт потока. */
  private readonly mine = new Map<string, { key: string; done: Promise<void> }>();
  private queued = 0;
  /** Сколько расчётов начато (тест: ответ из кэша расчёта не начинает). */
  started = 0;

  constructor(
    private count: OddsCounter = inlineCounter,
    private readonly limits: typeof ODDS_LIMITS = ODDS_LIMITS,
  ) {}

  setCounter(c: OddsCounter): void {
    this.count = c;
  }

  /** Забыть кэш (тест: стол экземпляра — общий у всех игроков, как на сервере). */
  clear(): void {
    this.cache.clear();
    this.last.clear();
  }

  /** Сколько дел ждёт или считается. */
  get busy(): number {
    return this.queued;
  }

  private ready(a: OddsAsk, now: number): OddsAnswer | null {
    const hit = this.cache.get(a.key);
    if (!hit) return null;
    if (hit.rows) return { rows: freeRowsOf(a.input, hit.rows) };
    if (now - hit.at < this.limits.failMs) return { error: TOO_LONG };
    this.cache.delete(a.key);
    return null;
  }

  private put(key: string, e: Entry): void {
    this.cache.delete(key);
    this.cache.set(key, e);
    while (this.cache.size > this.limits.cache) this.cache.delete(this.cache.keys().next().value as string);
  }

  private async hold(done: Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([done, new Promise<void>((ok) => (timer = setTimeout(ok, this.limits.holdMs)))]);
    clearTimeout(timer);
  }

  /** Ответ окну игрока `player`: строки из кэша сразу, иначе — расчёт (не больше одного у игрока) и ожидание не дольше `holdMs`. */
  async ask(player: string, a: OddsAsk, now: number): Promise<OddsAnswer> {
    const pointer = `${player}|${a.castle}`;
    const prev = this.last.get(pointer);
    if (prev !== undefined && prev !== a.key) this.cache.delete(prev);
    this.last.set(pointer, a.key);
    if (this.last.size > this.limits.cache) this.last.delete(this.last.keys().next().value as string);

    const hit = this.ready(a, now);
    if (hit) return hit;
    const job = this.mine.get(player);
    if (job) {
      // Своё дело уже идёт: тот же ключ — ждать его; другой — ждать, пока кончится прежнее (одно у игрока).
      if (job.key !== a.key) return { wait: true };
      await this.hold(job.done);
      return this.ready(a, now) ?? { wait: true };
    }
    if (this.queued >= this.limits.queue) return { error: BUSY };
    this.queued++;
    this.started++;
    const done = this.count(a.path, this.limits.calcMs)
      .then(
        (rows) => this.put(a.key, { rows, at: now }),
        () => this.put(a.key, { rows: null, at: now }),
      )
      .finally(() => {
        this.queued--;
        this.mine.delete(player);
      });
    this.mine.set(player, { key: a.key, done });
    await this.hold(done);
    return this.ready(a, now) ?? { wait: true };
  }
}

/** Стол экземпляра сервера. */
export const desk = new OddsDesk();

/** Свой сервер подставляет поток с низким приоритетом (`vps/oddsthread.ts`). */
export const setOddsCounter = (c: OddsCounter): void => desk.setCounter(c);
