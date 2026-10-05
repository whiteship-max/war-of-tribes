/**
 * Правила войны между игроками — отдельно от разговора по сети (docs/pvp.md). Обработчик
 * (`routes/war.ts`) читает записи и пишет итог; всё, что можно проверить без хранилища, — здесь.
 *
 * **Бой считает сервер, и только он.** Тем же ядром и той же дверью, что мир на клиенте
 * (`src/world/fights.ts`: сторона обороны у ворот, бой у лагеря; `world/battle.resolveField`), в минуту
 * прихода войска, по слепкам обороны обоих игроков (`WarSheet` из их записей партии). В приказах поля
 * исхода нет вовсе (`contract.readWarOrder` собирает новый объект), поэтому прислать свой исход нечем.
 *
 * **Тика нет**, как у осады логова: всё назначено временем — приходом, ударом, часом голода, возвратом, —
 * и разбирается при первом обращении любой из сторон после этой минуты (`advance`). Тот же вход и то же
 * прошедшее время дают то же состояние, кто бы и когда ни спросил.
 *
 * **Добыча переходит, а не начисляется.** Участь взятого города считает одна дверь `spoils.fate`: что
 * увёз победитель, взято из того, что потерял город, — и это тест (`war.test.ts`). Алмазов здесь нет
 * ни в каком виде.
 */
import { castleIdOf } from './roster.js';
import {
  cityName,
  plainName,
  RESULT_KEEP,
  type NoticeItem,
  readSheet,
  warFallId,
  type Counts,
  type RosterFile,
  type WarArmy,
  type WarBattle,
  type WarCamp,
  type WarEnd,
  type WarFall,
  type WarOrder,
  type WarSheet,
  type WarView,
} from './contract.js';
import { stackTotal, type Pips, type Stack } from '../../src/battle/index.js';
import { troopTotal, type TroopStack } from '../../src/game/battle/kinds.js';
import { kindsOf, troopLosses, troopPower } from '../../src/game/battle/price.js';
import { resolveField } from '../../src/world/battle.js';
import { campFight, defenceKinds, homeLosses } from '../../src/world/fights.js';
import { foodLeft, warAt, warWalkMs } from '../../src/world/pvp.js';
import { openSiege, siegeSince, siegeWear, starvesAt, type SiegeWindow } from '../../src/world/siege.js';
import { burnImmuneUntil, fate, fateBlock, fallSeed, homeLoss, winnerGain } from '../../src/world/spoils.js';
import { restAfter, restAt } from '../../src/world/rest.js';
import { energyAt, energyBlock, priceOf, spend } from '../../src/world/energy.js';
import { weakCity } from '../../src/world/lairs.js';
import { inHomeTheatre } from '../../src/world/theatre/theatre.js';
import { gateBusyText, playerWood } from '../../src/world/works.js';
import { stackCarry, stackEscort } from '../../src/world/data/units.js';
import { SIEGE_IMMUNE, SIEGE_ROUT } from '../../src/world/data/tuning.js';

/** Война в хранилище: вид для игроков плюс ключи сторон. Ключи наружу не уходят никогда (`viewOf`). */
export interface WarRow extends Omit<WarView, 'role'> {
  atk: string;
  def: string;
}

/** Все войны одной записью — как реестр: читают целиком и целиком переписывают с условием по ETag. */
export interface WarFile {
  v: 1;
  seq: number;
  wars: WarRow[];
}

/** Ключ записи войн в хранилище мира — рядом с реестром (`roster`). */
export const WARS_KEY = 'wars';

/** Сколько кончившаяся война лежит, чтобы обе стороны успели прочесть итог, и потолок записи. */
export const WAR_KEEP_MS = 7 * 24 * 3600_000;
export const WAR_MAX = 400;

export const emptyWars = (): WarFile => ({ v: 1, seq: 0, wars: [] });

/** Записи из хранилища. Испорченное читается пустым: войны начинаются заново, партии целы. */
export function readWars(raw: unknown): WarFile {
  if (!raw || typeof raw !== 'object') return emptyWars();
  const r = raw as Partial<WarFile>;
  if (r.v !== 1 || !Array.isArray(r.wars)) return emptyWars();
  const wars = r.wars.filter(
    (w): w is WarRow =>
      Boolean(w) && typeof w.id === 'string' && typeof w.atk === 'string' && typeof w.def === 'string' && typeof w.phase === 'string',
  );
  return { v: 1, seq: Math.max(0, Math.floor(Number(r.seq) || 0)), wars };
}

/**
 * Слепок обороны из лежащей записи партии (`SaveRecord.war`) с отметкой, когда запись легла. Нет записи
 * или слепка — `null`. Больше из чужой партии не читается ничего: сама партия остаётся непрозрачной.
 */
export function readStoredSheet(raw: unknown): SheetAt | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { war?: unknown; updatedAt?: unknown };
  const sheet = readSheet(r.war);
  return sheet ? { sheet, at: typeof r.updatedAt === 'number' ? r.updatedAt : 0 } : null;
}

/** Война глазами одной из сторон: без ключей. */
export function viewOf(row: WarRow, key: string): WarView {
  const { atk, def, ...rest } = row;
  return { ...rest, role: atk === key ? 'atk' : 'def' };
}

/** Свои войны — свежие сверху. */
export const warsOf = (file: WarFile, key: string): WarView[] =>
  file.wars.filter((w) => w.atk === key || w.def === key).map((w) => viewOf(w, key)).reverse();

const active = (w: WarRow): boolean => w.phase !== 'done';

/** Слепок с отметкой: когда он лёг на сервер. */
export interface SheetAt {
  sheet: WarSheet;
  at: number;
}

// ------------------------------------------------ счёт по видам ---

const asTroops = (c: Counts): TroopStack => c as TroopStack;

function minus(a: Counts, b: Counts): Counts {
  const out: Counts = {};
  for (const [k, v] of Object.entries(a)) {
    const left = Math.max(0, (v ?? 0) - Math.max(0, b[k] ?? 0));
    if (left > 0) out[k] = left;
  }
  return out;
}

function plus(a: Counts, b: Counts): Counts {
  const out: Counts = { ...a };
  for (const [k, v] of Object.entries(b)) if ((v ?? 0) > 0) out[k] = (out[k] ?? 0) + (v ?? 0);
  return out;
}

const fits = (want: Counts, have: Counts): boolean => Object.entries(want).every(([k, v]) => (v ?? 0) <= (have[k] ?? 0));

/** Сид боя войны: номер войны и номер боя — одна и та же война даёт один и тот же бой у кого угодно. */
export function warSeed(id: string, n: number): number {
  let h = 0x811c9dc5 ^ n;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

/** Отметка падения города в списке принятого (`WarSheet.seen`). */
export const fallId = warFallId;

/**
 * Оборона города в минуту `at`: слепок минус то, что война отняла у него, а клиент ещё не принял на себя
 * (`WarSheet.seen`). Защитник мог не заходить с боя, и второй бой не должен драться с гарнизоном, уже
 * павшим в первом.
 *
 * И свой поход (docs/retinue.md): отряд полководца стоит в гарнизоне, пока полководец дома, уходит с ним и с ним
 * возвращается. Слепок лёг до выхода — ушедшие в нём ещё дома, и сервер их вычитает (не больше отряда, что слепок
 * назвал стоящим дома, `WarSheet.retinue`); лёг, пока войско в походе (`WarSheet.out`), — вернувшихся в нём нет, и
 * сервер их прибавляет. Игрок мог не заходить ни с выхода, ни с возврата, а бой у его стен идёт без него. Отметки
 * полководца у ворот (`pips`) ходят с отрядом так же.
 */
export function liveSheet(file: WarFile, key: string, s: SheetAt, at = Infinity): WarSheet {
  const seen = new Set(s.sheet.seen);
  let home = s.sheet.home;
  let stock = s.sheet.stock;
  let gold = s.sheet.gold;
  let bonded = s.sheet.bonded;
  let pop = s.sheet.pop;
  const levels = { ...s.sheet.levels };
  for (const w of file.wars) {
    if (w.def !== key) continue;
    for (const b of w.battles) if (!seen.has(b.id)) home = minus(home, b.homeLost);
    const f = w.fall;
    if (f && !seen.has(fallId(w.id))) {
      home = minus(home, f.routed);
      const { gold: g, ...goods } = f.lost;
      stock = minus(stock, goods);
      gold = Math.max(0, gold - (g ?? 0));
      bonded = Math.max(0, bonded - f.bondedLost);
      pop = Math.max(1, pop - f.popLost);
      for (const x of f.fallen) if (levels[x.id] !== undefined) levels[x.id] = Math.min(levels[x.id], x.to);
    }
  }
  let pips = s.sheet.pips;
  const out = new Set(s.sheet.out ?? []);
  for (const w of file.wars) {
    if (w.atk !== key || w.sentAt > at) continue;
    const back = (w.phase === 'back' || w.phase === 'done') && (w.backAt ?? w.endAt ?? Infinity) <= at;
    if (out.has(w.id)) {
      if (!back) continue;
      home = plus(home, w.army.troops);
      pips = w.army.pips;
    } else if (s.at < w.sentAt) {
      const went = w.went ?? w.army.troops;
      home = minus(home, s.sheet.retinue ? atMost(went, s.sheet.retinue) : went);
      pips = back ? w.army.pips : {};
      if (back) home = plus(home, w.army.troops);
    }
  }
  return { ...s.sheet, home, stock, gold, bonded, pop, levels, pips };
}

/** По видам — не больше, чем в `cap`. */
function atMost(a: Counts, cap: Counts): Counts {
  const out: Counts = {};
  for (const [k, v] of Object.entries(a)) {
    const n = Math.min(Math.max(0, v ?? 0), Math.max(0, cap[k] ?? 0));
    if (n > 0) out[k] = n;
  }
  return out;
}

// ------------------------------------------------ бои ---

const men = (t: Counts): number => stackTotal(kindsOf(asTroops(t)));

/** Мораль войска похода в минуту `at` (`world/rest`). */
const armyRest = (a: WarArmy, at: number): number => restAt(a.rest, at, men(a.troops));

/** Войско после боя: минус павшие, мораль — с какой вышли; энергия полководца — та же. */
function wear(a: WarArmy, lost: Counts, share: number, at: number): WarArmy {
  const troops = minus(a.troops, lost);
  const rest = restAfter(share, at, men(troops));
  return { troops, resolve: a.resolve, pips: a.pips, ...(rest ? { rest } : {}), ...(a.energy ? { energy: a.energy } : {}) };
}

/**
 * Энергия полководца в войне (docs/agent_energy.md, решение 3): поход списывает цену при выходе, и пока идёт война,
 * энергия стоит — путь между замками сервер по часам не жжёт. Дома, с минуты возврата, копится. Дверь одна с миром на
 * клиенте — `world/energy`.
 */
function homeward(w: WarRow, at: number, backAt: number): void {
  w.army = { ...w.army, energy: { value: energyAt(w.army.energy, at), at, mode: 'hold', homeAt: backAt } };
}

/** Мораль гарнизона города в минуту `at`: слепок, и осада, если лагерь стоит, — день за днём (`siege.siegeWear`). */
const garrisonRest = (w: WarRow, sheet: WarSheet, at: number): number =>
  sheet.rest * (w.camp ? siegeWear(siegeSince(w.camp as SiegeWindow), at) : 1);

/** Штурм города войском похода в минуту `at`. Возвращает бой и победил ли поход. */
function storm(w: WarRow, at: number, sheet: WarSheet): { battle: WarBattle; won: boolean } {
  const n = w.battles.length;
  const input = {
    seed: warSeed(w.id, n),
    attacker: { kinds: kindsOf(asTroops(w.army.troops)), resolve: w.army.resolve, pips: w.army.pips as Pips, rest: armyRest(w.army, at) },
    defender: {
      kinds: defenceKinds(kindsOf(asTroops(sheet.home)), sheet.militia, sheet.archers),
      resolve: sheet.resolve,
      pips: sheet.pips as Pips,
      rest: garrisonRest(w, sheet, at),
    },
  };
  const field = resolveField(input);
  const atkLost = field.result ? (troopLosses(asTroops(w.army.troops), field.result.sides.attacker.losses) as Counts) : {};
  const homeLost = homeLosses(asTroops(sheet.home), field) as Counts;
  const battle: WarBattle = {
    id: `${w.id}.${n}`,
    at,
    site: 'wall',
    by: 'atk',
    input: input as WarBattle['input'],
    won: field.won,
    atkTroops: { ...w.army.troops },
    atkLost,
    homeTroops: { ...sheet.home },
    homeLost,
    militia: { men: Math.max(0, Math.round(sheet.militia)), archers: Math.min(Math.round(sheet.militia), Math.round(sheet.archers)) },
  };
  w.battles.push(battle);
  w.army = wear(w.army, atkLost, field.rest.attacker, at);
  return { battle, won: field.won };
}

/** Участь взятого города — одна дверь `spoils.fate`, у обеих сторон одними числами. */
function fall(w: WarRow, at: number, sheet: WarSheet, by: WarFall['by']): void {
  // Обоз и конвой — уцелевшие похода, той же меркой, что у полководца против логова (`LocalWorld.haul`).
  const survivors = troopTotal(asTroops(w.army.troops));
  const r = fate({
    fate: w.fate,
    stock: sheet.stock,
    gold: sheet.gold,
    stash: sheet.stash,
    pop: sheet.pop,
    bonded: sheet.bonded,
    carry: stackCarry({ warrior: survivors }),
    escort: stackEscort({ warrior: survivors }),
    levels: sheet.levels,
    seed: fallSeed(warSeed(w.id, 0xfa11), at),
  });
  const loss = homeLoss(r);
  const gain = winnerGain(r);
  const routed: Counts = {};
  if (by === 'hunger') {
    for (const [k, v] of Object.entries(sheet.home)) {
      const gone = Math.floor(Math.max(0, v ?? 0) * SIEGE_ROUT);
      if (gone > 0) routed[k] = gone;
    }
  }
  const lost: Counts = {};
  for (const [k, v] of Object.entries(r.lost)) if ((v ?? 0) > 0) lost[k] = v as number;
  const taken: Counts = {};
  for (const [k, v] of Object.entries(gain.resources)) if ((v ?? 0) > 0) taken[k] = v as number;
  w.fall = {
    at,
    fate: w.fate,
    by,
    taken,
    led: gain.bonded ?? 0,
    lost,
    bondedLost: Math.max(0, -(loss.bonded ?? 0)),
    popLost: loss.popLost ?? 0,
    fallen: loss.fallen ?? [],
    burned: loss.burned ?? false,
    hidden: r.hiddenTotal,
    routed,
  };
}

/** Темп войны (`http.warPace`): во сколько раз быстрее походы и голод. Ставит его обработчик на запрос. */
let pace = 1;

/** Поставить темп войны на этот запрос. Вне обработчика — 1, обычная игра. */
export const setWarPace = (n: number): void => {
  pace = Number.isFinite(n) && n >= 1 ? n : 1;
};

/** Путь войска между двумя клетками с темпом войны. */
const walk = (from: { x: number; y: number }, to: { x: number; y: number }): number => Math.round(warWalkMs(from, to) / pace);

/** Войско уходит домой от минуты `at` с места `from`. Некому уходить — война кончена на месте. */
function turnBack(w: WarRow, at: number, from: { x: number; y: number }, end: WarEnd): void {
  delete w.camp;
  delete w.starvesAt;
  delete w.strike;
  w.end = end;
  w.endAt = at;
  if (troopTotal(asTroops(w.army.troops)) <= 0) {
    w.phase = 'done';
    return;
  }
  w.phase = 'back';
  w.backFrom = from;
  w.backAt = at + walk(from, w.from);
  homeward(w, at, w.backAt);
}

/** Окно осады из слепка обороны: те же часы голода, что у осады логова (`siege.openSiege`). */
function campWindow(w: WarRow, at: number, sheet: WarSheet, prev: WarCamp | null): WarCamp {
  const win = openSiege({
    byId: w.atkCastle,
    campId: w.id,
    now: at,
    // Темп войны ускоряет и голод: хлеба в окне во столько же раз меньше.
    food: prev ? foodLeft(prev as SiegeWindow, at) : sheet.food / pace,
    garrison: troopTotal(asTroops(sheet.home)),
    townPerHour: sheet.townPerHour,
    perManPerHour: sheet.perManPerHour,
    since: prev ? siegeSince(prev as SiegeWindow) : at,
    gateAt: prev?.gateAt,
    rearGateAt: prev?.rearGateAt,
    fate: w.fate,
    // Древесина — как у лагеря игрока под логовом: всё во фронт (`works.playerWood`).
    wood: prev?.wood ?? playerWood(1),
    // Рогатки держат те, кто их строил: у нового лагеря — войско в минуту постановки.
    builders: prev?.builders ?? men(w.army.troops),
  });
  return win as WarCamp;
}

function setCamp(w: WarRow, camp: WarCamp): void {
  w.camp = camp;
  w.starvesAt = Math.round(starvesAt(camp as SiegeWindow));
}

/** Лагерь в родах боя — кто в нём стоит. */
const campSide = (w: WarRow, at: number) => ({
  kinds: kindsOf(asTroops(w.army.troops)),
  resolve: w.army.resolve,
  pips: w.army.pips as Pips,
  rest: armyRest(w.army, at),
});

const sightOf = (c: WarCamp) => ({
  since: siegeSince(c as SiegeWindow),
  builders: c.builders ?? 0,
  gateAt: c.gateAt,
  rearGateAt: c.rearGateAt,
  wood: c.wood,
});

/**
 * Удар по лагерю из города — вылазка (`front`), полководец с тыла (`rear`) или оба сразу (совместный удар).
 * Бой один, дверь та же, что у мира (`fights.campFight`). Победа города снимает осаду, иначе часы голода
 * пересчитываются от нового гарнизона — один раз, в самом событии.
 */
function hitCamp(
  w: WarRow,
  at: number,
  sheet: WarSheet,
  hit: { front?: Counts; rear?: WarArmy; site: WarBattle['site'] },
): string | null {
  const camp = w.camp;
  if (!camp) return 'Лагеря уже нет.';
  const n = w.battles.length;
  const fight = campFight({
    seed: warSeed(w.id, n),
    at,
    sight: sightOf(camp),
    camp: campSide(w, at),
    front: hit.front ? { kinds: kindsOf(asTroops(hit.front)), rest: garrisonRest(w, sheet, at) } : undefined,
    rear: hit.rear ? { kinds: kindsOf(asTroops(hit.rear.troops)), rest: armyRest(hit.rear, at) } : undefined,
    // Ведёт полководец, если он бьёт с тыла; вылазку — он же, если стоит у ворот (слепок).
    resolve: hit.rear ? hit.rear.resolve : sheet.resolve,
    pips: (hit.rear ? hit.rear.pips : sheet.pips) as Pips,
  });
  if (fight.refused) {
    const waits = [fight.front, fight.rear].filter((t) => t && t.went > 0).map((t) => t?.waitMs ?? 0);
    return gateBusyText(Math.min(...waits));
  }
  const { field, front, rear, lost } = fight;
  const homeLost = hit.front ? (troopLosses(asTroops(hit.front), lost.front) as Counts) : {};
  const genLost = hit.rear ? (troopLosses(asTroops(hit.rear.troops), lost.rear) as Counts) : undefined;
  const atkLost = field.result ? (troopLosses(asTroops(w.army.troops), field.result.sides.defender.losses) as Counts) : {};
  const battle: WarBattle = {
    id: `${w.id}.${n}`,
    at,
    site: hit.site,
    by: 'def',
    input: fight.input as WarBattle['input'],
    won: field.won,
    atkTroops: { ...w.army.troops },
    atkLost,
    homeTroops: { ...(hit.front ?? {}) },
    homeLost,
    ...(hit.rear ? { genTroops: { ...hit.rear.troops }, genLost } : {}),
    ...(front ? { through: { went: front.went, passed: front.passed } } : {}),
    ...(rear ? { rearThrough: { went: rear.went, passed: rear.passed } } : {}),
  };
  w.battles.push(battle);
  w.army = wear(w.army, atkLost, field.rest.defender, at);
  // Проходы сторон заняты прошедшими — отметки в окне осады, как у лагеря логова.
  if (front) camp.gateAt = front.gateAt;
  if (rear) camp.rearGateAt = rear.gateAt;
  if (field.won || troopTotal(asTroops(w.army.troops)) <= 0) {
    turnBack(w, at, w.to, 'lifted');
    return null;
  }
  // Гарнизон убавился — часы голода заново, от остатка хлеба.
  setCamp(w, campWindow(w, at, { ...sheet, home: minus(sheet.home, homeLost) }, camp));
  return null;
}

// ------------------------------------------------ ход времени ---

/** Ключи защитников, чьи слепки нужны, чтобы разобрать всё назначенное к минуте `now`. */
export function dueKeys(file: WarFile, now: number): string[] {
  const keys = new Set<string>();
  for (const w of file.wars) {
    if (w.phase === 'march' && w.arriveAt <= now) keys.add(w.def);
    if (w.phase === 'camp' && ((w.starvesAt ?? Infinity) <= now || (w.strike && w.strike.at <= now))) keys.add(w.def);
  }
  return [...keys];
}

/**
 * Разобрать всё, что назначено к минуте `now`, в том порядке, в каком оно случилось бы. Слепки — те, что
 * лежали к этой минуте (`sheets`); нет слепка у защитника — его замок ушёл из игры, и войско идёт домой.
 * Возвращает, изменилось ли что-нибудь.
 */
export function advance(file: WarFile, now: number, sheets: ReadonlyMap<string, SheetAt | null>): boolean {
  let changed = false;
  const sheetOf = (w: WarRow, at: number): WarSheet | null => {
    const s = sheets.get(w.def);
    return s ? liveSheet(file, w.def, s, at) : null;
  };
  for (const w of file.wars) {
    for (let guard = 0; guard < 8; guard++) {
      if (w.phase === 'march' && w.arriveAt <= now) {
        changed = true;
        const sheet = sheetOf(w, w.arriveAt);
        if (!sheet) {
          turnBack(w, w.arriveAt, w.to, 'gone');
          continue;
        }
        if (w.mode === 'storm') {
          const { won } = storm(w, w.arriveAt, sheet);
          if (won) fall(w, w.arriveAt, sheet, 'storm');
          turnBack(w, w.arriveAt, w.to, won ? 'taken' : 'beaten');
        } else {
          w.phase = 'camp';
          setCamp(w, campWindow(w, w.arriveAt, sheet, null));
        }
        continue;
      }
      if (w.phase === 'camp') {
        const hungerAt = w.starvesAt ?? Infinity;
        const strikeAt = w.strike?.at ?? Infinity;
        if (Math.min(hungerAt, strikeAt) > now) break;
        changed = true;
        const sheet = sheetOf(w, Math.min(hungerAt, strikeAt));
        if (!sheet) {
          turnBack(w, Math.min(hungerAt, strikeAt), w.to, 'gone');
          continue;
        }
        if (strikeAt <= hungerAt && w.strike) {
          const s = w.strike;
          delete w.strike;
          hitCamp(w, s.at, sheet, { rear: s.army, front: s.joint ? sheet.home : undefined, site: s.joint ? 'joint' : 'camp' });
          continue;
        }
        fall(w, hungerAt, sheet, 'hunger');
        turnBack(w, hungerAt, w.to, 'taken');
        continue;
      }
      if (w.phase === 'back' && (w.backAt ?? 0) <= now) {
        changed = true;
        w.phase = 'done';
        continue;
      }
      break;
    }
  }
  return changed;
}

/** Убрать давно кончившиеся и лишние сверх потолка — самые старые первыми. */
export function pruneWars(file: WarFile, now: number): void {
  file.wars = file.wars.filter((w) => active(w) || now - (w.endAt ?? w.sentAt) <= WAR_KEEP_MS);
  if (file.wars.length > WAR_MAX) {
    const keep = file.wars.filter(active);
    const done = file.wars.filter((w) => !active(w)).slice(-(Math.max(0, WAR_MAX - keep.length)));
    file.wars = file.wars.filter((w) => keep.includes(w) || done.includes(w));
  }
}

// ------------------------------------------------ приказы ---

/** Что нужно приказу кроме записи войн: реестр и слепки сторон. */
export interface OrderCtx {
  roster: RosterFile;
  /** Слепок по ключу игрока; нет — `null`. */
  sheet: (key: string) => SheetAt | null;
}

const theirs = (file: WarFile, id: string, key: string, role: 'atk' | 'def'): WarRow | null =>
  file.wars.find((w) => w.id === id && (role === 'atk' ? w.atk === key : w.def === key)) ?? null;

/**
 * Приказ стороны. Возвращает отказ словами или `null`. Исхода в приказе нет: всё, что в нём есть, —
 * кого и куда вести; бой считается здесь же или в минуту прихода.
 */
export function applyOrder(file: WarFile, key: string, order: WarOrder, now: number, ctx: OrderCtx): string | null {
  switch (order.op) {
    case 'march':
      return march(file, key, order, now, ctx);
    case 'recall': {
      const w = theirs(file, order.id, key, 'atk');
      if (!w || w.phase !== 'march') return 'Войско уже не в пути.';
      // Обратный путь — по уже пройденному: развернулись там, где шли.
      const at = warAt(w.from, w.to, w.sentAt, w.arriveAt, now);
      w.end = 'recalled';
      w.endAt = now;
      w.phase = 'back';
      w.backFrom = at;
      w.backAt = now + Math.max(0, now - w.sentAt);
      homeward(w, now, w.backAt);
      return null;
    }
    case 'retreat': {
      const w = theirs(file, order.id, key, 'atk');
      if (!w || w.phase !== 'camp') return 'Лагеря уже нет.';
      turnBack(w, now, w.to, 'retreat');
      return null;
    }
    case 'storm': {
      const w = theirs(file, order.id, key, 'atk');
      if (!w || w.phase !== 'camp') return 'Лагеря уже нет.';
      const s = ctx.sheet(w.def);
      if (!s) {
        turnBack(w, now, w.to, 'gone');
        return 'Города больше нет в игре. Войско идёт домой.';
      }
      // Штурм — бой: цена в энергии полководца, той же дверью, что у штурма логова (`world/energy`).
      const tired = energyBlock(energyAt(w.army.energy, now), priceOf('storm'));
      if (tired) return tired;
      w.army = { ...w.army, energy: spend(w.army.energy, now, priceOf('storm')) };
      // Штурм снимает осаду до боя (`siege.STORM_LIFTS`): отобьют — лагеря не станет.
      const sheet = liveSheet(file, w.def, s, now);
      const { won } = storm(w, now, sheet);
      if (won) fall(w, now, sheet, 'storm');
      turnBack(w, now, w.to, won ? 'taken' : 'beaten');
      return null;
    }
    case 'sortie': {
      const w = theirs(file, order.id, key, 'def');
      if (!w || w.phase !== 'camp') return 'Лагеря под стенами уже нет.';
      const s = ctx.sheet(key);
      if (!s) return 'Город ещё не записан на сервер. Подожди минуту.';
      const sheet = liveSheet(file, key, s, now);
      if (troopTotal(asTroops(order.troops)) <= 0) return 'Некого вывести на вылазку.';
      if (!fits(order.troops, sheet.home)) return 'Столько бойцов в гарнизоне нет.';
      return hitCamp(w, now, sheet, { front: order.troops, site: 'sortie' });
    }
    case 'strike': {
      const w = theirs(file, order.id, key, 'def');
      if (!w || w.phase !== 'camp') return 'Лагеря под стенами уже нет.';
      if (w.strike) return 'Полководец уже идёт на лагерь.';
      const s = ctx.sheet(key);
      if (!s) return 'Город ещё не записан на сервер. Подожди минуту.';
      if (troopTotal(asTroops(order.army.troops)) <= 0) return 'У полководца нет войска.';
      if (!fits(order.army.troops, s.sheet.army)) return 'Столько бойцов в войске нет.';
      // Удар — бой: энергии на него должно хватить к минуте прихода, с дорогой по карте (`world/energy`).
      const tired = energyBlock(energyAt(order.army.energy, now), priceOf('strike'), order.walkMs);
      if (tired) return tired;
      w.strike = { at: now + Math.round(order.walkMs / pace), army: order.army, joint: order.joint };
      return null;
    }
  }
}

function march(file: WarFile, key: string, order: Extract<WarOrder, { op: 'march' }>, now: number, ctx: OrderCtx): string | null {
  const own = ctx.roster.rows[key];
  if (!own) return 'Твой замок ещё не стоит на карте.';
  const entry = Object.entries(ctx.roster.rows).find(([k]) => castleIdOf(k) === order.target);
  if (!entry) return 'Этого города больше нет в игре.';
  const [def, row] = entry;
  if (def === key) return 'Это твой город.';
  // Регион игрока — правило мира (`theatre.inHomeTheatre`): походы за край не уходят.
  if (!inHomeTheatre(own, row)) return 'Город за пределами твоего края. Походы туда не ходят.';
  if (file.wars.some((w) => w.atk === key && active(w))) return 'Полководец уже в походе.';
  if (file.wars.some((w) => w.def === key && active(w) && w.phase === 'camp')) return 'Твой город в осаде. Выйти можно только вылазкой.';
  if (file.wars.some((w) => w.def === def && active(w))) return 'На этот город уже идёт другое войско.';
  // Павший город неприкосновенен, как и у логова (`siege.SIEGE_IMMUNE`): цепочки падений нет.
  const fell = file.wars.filter((w) => w.def === def && w.fall).reduce((t, w) => Math.max(t, w.fall?.at ?? 0), 0);
  if (fell > 0 && now < fell + SIEGE_IMMUNE) return 'Город недавно пал. Пока его не трогают.';
  const theirSheet = ctx.sheet(def);
  if (!theirSheet) return 'Город ещё не готов к войне: его владелец не заходил с тех пор, как она началась.';
  // Защита слабого — та же мерка, что у логова (`lairs.weakCity`): жители или войско, что выше.
  if (weakCity(theirSheet.sheet.pop, theirSheet.sheet.power)) return 'Город под защитой слабого: он ещё мал. Нападать на него нельзя.';
  const mine = ctx.sheet(key);
  if (!mine) return 'Твой город ещё не записан на сервер. Подожди минуту.';
  // Участь — та же проверка, что у приказа против логова (`spoils.fateBlock`): замки гейта объявляющего и
  // неприкосновенность от огня у недавно сожжённого города.
  const burned = file.wars.filter((w) => w.def === def && w.fall?.burned).reduce((t, w) => Math.max(t, w.fall?.at ?? 0), 0);
  const why = fateBlock(order.fate, 'player', burned > 0 ? burnImmuneUntil(burned) : undefined, now, mine.sheet.locks);
  if (why) return why;
  if (troopTotal(asTroops(order.army.troops)) <= 0) return 'У полководца нет войска. Дай ему дружину у ворот.';
  if (!fits(order.army.troops, mine.sheet.army)) return 'Столько бойцов в войске нет.';
  // Энергия полководца — той же дверью, что у мира (`world/energy`): поход и дело у стен разом, при выходе
  // (docs/agent_energy.md, решение 3). Пока идёт война, энергия стоит.
  const need = priceOf('march') + priceOf(order.mode);
  const tired = energyBlock(energyAt(order.army.energy, now), need);
  if (tired) return tired;
  const energy = { ...spend(order.army.energy, now, need), mode: 'hold' as const };
  delete energy.homeAt;
  const from = { x: own.x, y: own.y };
  const to = { x: row.x, y: row.y };
  file.seq += 1;
  file.wars.push({
    id: `w${file.seq.toString(36)}${(now % 46656).toString(36)}`,
    atk: key,
    def,
    atkCastle: castleIdOf(key),
    defCastle: order.target,
    atkCity: cityName(own.city) ?? '',
    defCity: cityName(row.city) ?? '',
    from,
    to,
    mode: order.mode,
    fate: order.fate,
    sentAt: now,
    arriveAt: now + walk(from, to),
    phase: 'march',
    army: { ...order.army, energy },
    went: { ...order.army.troops },
    battles: [],
  });
  return null;
}

/** Мощь войска по видам — для слов, не для боя. */
export const armyPower = (t: Counts): number => troopPower(asTroops(t));

/** Сумма двух наборов по видам — для проверки сохранения добычи. */
export const addCounts = plus;

/** Роды боя из видов племени. */
export const kindsOfCounts = (t: Counts): Stack => kindsOf(asTroops(t));

// ------------------------------------------------ новости для бота ---

/** Новость войны для одного игрока: кому и что (`contract.NoticeItem`). */
export interface WarNews {
  player: string;
  item: NoticeItem;
}

/**
 * Новости одной войны — **выводятся из записи, а не копятся**: что бот скажет сторонам, есть функция того, что с
 * войной уже случилось (docs/NOTIFY.md, раздел 12). Решение владельца — о двух вещах: на город идут (защитнику, с
 * минуты выхода и до прихода; отозванный поход новостью не остаётся) и бой был (обеим сторонам — каждый бой и
 * падение голодом). Падение штурмом — тот же бой у стены, второй новостью не идёт.
 */
export function newsOf(w: WarRow): WarNews[] {
  const out: WarNews[] = [];
  const from = (role: 'atk' | 'def'): string => plainName(role === 'atk' ? w.defCity : w.atkCity);
  if (w.end !== 'recalled' && w.sentAt < w.arriveAt) {
    out.push({
      player: w.def,
      item: {
        key: `war:${w.id}`,
        kind: 'war',
        fireAt: w.sentAt,
        until: w.arriveAt,
        p: { from: from('def'), fate: w.fate, about: w.arriveAt, role: 'def', mode: w.mode },
      },
    });
  }
  for (const b of w.battles) {
    const taken = b.site === 'wall' && w.fall?.by === 'storm' && w.fall.at === b.at;
    for (const role of ['atk', 'def'] as const) {
      out.push({
        player: role === 'atk' ? w.atk : w.def,
        item: {
          key: `war-fight:${b.id}`,
          kind: 'war-fight',
          fireAt: b.at,
          until: b.at + RESULT_KEEP,
          p: {
            from: from(role),
            fate: w.fate,
            about: b.at,
            role,
            site: b.site,
            by: b.by,
            // `won` боя — у того, кто в нём нападал; у получателя — своя сторона.
            won: b.by === role ? b.won : !b.won,
            ...(taken ? { taken: true as const } : {}),
          },
        },
      });
    }
  }
  if (w.fall?.by === 'hunger') {
    const at = w.fall.at;
    for (const role of ['atk', 'def'] as const) {
      out.push({
        player: role === 'atk' ? w.atk : w.def,
        item: {
          key: `war-fall:${w.id}`,
          kind: 'war-fall',
          fireAt: at,
          until: at + RESULT_KEEP,
          p: { from: from(role), fate: w.fall.fate, about: at, role, taken: true },
        },
      });
    }
  }
  return out;
}

/** Все новости записи по ключу «игрок/пункт» — для сравнения до и после хода. */
export function newsMap(file: WarFile): Map<string, WarNews> {
  const out = new Map<string, WarNews>();
  for (const w of file.wars) for (const n of newsOf(w)) out.set(`${n.player}/${n.item.key}`, n);
  return out;
}

/** Что изменилось у каждого игрока: новые новости и снятые (отозванный поход). */
export function newsDiff(before: Map<string, WarNews>, after: Map<string, WarNews>): Map<string, { add: NoticeItem[]; drop: string[] }> {
  const out = new Map<string, { add: NoticeItem[]; drop: string[] }>();
  const at = (player: string) => {
    let x = out.get(player);
    if (!x) out.set(player, (x = { add: [], drop: [] }));
    return x;
  };
  for (const [k, n] of after) if (!before.has(k)) at(n.player).add.push(n.item);
  for (const [k, n] of before) if (!after.has(k)) at(n.player).drop.push(n.item.key);
  return out;
}
