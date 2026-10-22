// Сословия (РТ-2, docs/stability.md, «РТ-2») — единственная дверь записи `GameState.estates`: привилегии, дары и книга для
// сервера. Пишет поле только этот модуль (замок — `estates.test.ts`, чтением исходников).
//
// **Влияние и лояльность выводятся, а не хранятся** (`derived.estatesNow`, формулы — `estaterules`): уровни построек,
// привилегии, указ и усилители — всё, из чего они сделаны. Здесь — только то, чего не вывести: сколько привилегий у кого и счёт
// дарований, отнятий и даров. Лояльность от дара и обиды — усилители той же двери, что у вестей (`sim/boons.grantBoon`): имя,
// срок, продлевается, не складывается.
//
// Указ сословия — строка общей таблицы указов (`data/policy`), пишет его одна дверь `sim/actions.setDecree`, открывает —
// лояльность (`derived.decreeBlock`). Упала ниже порога — указ снимается сам (`estatesStep`), той же дверью.
import type { EstateId, EstatesState, GameState } from '../types';
import { ESTATES, LOYAL, PRIV_MAX, isEstate, privOf } from '../estaterules';
import { ESTATE_LOG, ESTATE_META } from '../data/estates';
import { estateBoon } from '../data/boons';
import { decreeOf, estateDecree, estateGiftPrice, estatesNow } from '../derived';
import { grantBoon } from './boons';
import { setDecree } from './actions';
import { outlay, pay } from './pay';
import { log } from './log';

/** Пустая книга — так читаются новая и старая партия: привилегий нет, лояльность у всех ровная. */
const empty = (): EstatesState => ({ priv: {}, grants: 0, revokes: 0, gifts: 0 });

/** Сословия партии для чтения; поля нет — пустые. Не пишет. */
export const estatesOf = (s: GameState): EstatesState => s.estates ?? empty();

/** Поле для записи: заводится на первой записи. */
function own(s: GameState): EstatesState {
  if (!s.estates) s.estates = empty();
  return s.estates;
}

// ---------- Привилегии ----------

/** Можно ли даровать сословию следующую привилегию; null — можно. */
export const grantBlock = (s: GameState, e: EstateId): string | null =>
  privOf(s.estates?.priv, e) >= PRIV_MAX ? `${ESTATE_META[e].name}: обе привилегии уже дарованы.` : null;

/**
 * Даровать сословию следующую привилегию: его влияние растёт на десятую долю, лояльность — на `PRIV_LOYALTY`, у остальных
 * падает завистью (`estaterules.loyaltyParts`). Цены у привилегии нет: её цена — власть, ушедшая сословию, и ропот соперников.
 */
export function grantPrivilege(s: GameState, e: EstateId): string | null {
  const why = grantBlock(s, e);
  if (why) return why;
  const st = own(s);
  const n = privOf(st.priv, e);
  st.priv[e] = n + 1;
  st.grants++;
  log(s, ESTATE_LOG.granted(e, ESTATE_META[e].priv[n]), 'good', undefined, 'stab');
  estatesStep(s);
  return null;
}

/** Можно ли отнять привилегию; null — можно. */
export const revokeBlock = (s: GameState, e: EstateId): string | null =>
  privOf(s.estates?.priv, e) <= 0 ? `${ESTATE_META[e].name}: привилегий нет.` : null;

/**
 * Отнять последнюю дарованную привилегию: власть возвращается городу, а сословие помнит обиду сезон — `−PRIV_LOYALTY`
 * усилителем (отнятое бьёт тем же, чем даровано).
 */
export function revokePrivilege(s: GameState, e: EstateId): string | null {
  const why = revokeBlock(s, e);
  if (why) return why;
  const st = own(s);
  const n = privOf(st.priv, e) - 1;
  if (n > 0) st.priv[e] = n;
  else delete st.priv[e];
  st.revokes++;
  grantBoon(s, estateBoon('rev', e));
  log(s, ESTATE_LOG.revoked(e, ESTATE_META[e].priv[n]), 'bad', undefined, 'stab');
  estatesStep(s);
  return null;
}

// ---------- Дар ----------

/** Цена дара — одна мерка с жалобой сословия (`derived.estateGiftPrice`). */
export const giftPrice = estateGiftPrice;

/** Хватает ли на дар; null — хватает. */
export function giftBlock(s: GameState, e: EstateId): string | null {
  const p = giftPrice(s, e);
  if ('gold' in p) return s.gold >= p.gold ? null : 'Не хватает золота.';
  return s.resources.food >= p.food ? null : 'Не хватает хлеба.';
}

/** Одарить сословие: сезон лояльности своей привилегии без власти; повтор продлевает, не складывается. Разовая трата описи. */
export function giftEstate(s: GameState, e: EstateId): string | null {
  const why = giftBlock(s, e);
  if (why) return why;
  const p = giftPrice(s, e);
  if ('gold' in p) {
    s.gold = Math.max(0, s.gold - p.gold);
    outlay(s);
  } else pay(s, { food: p.food });
  grantBoon(s, estateBoon('gift', e));
  own(s).gifts++;
  log(s, ESTATE_LOG.gifted(e), 'info', undefined, 'stab');
  estatesStep(s);
  return null;
}

// ---------- Шаг ----------

/**
 * Указ сословия держится, пока сословие верно: лояльность упала ниже `LOYAL` (дар кончился, соперник получил привилегию) —
 * указ снимается той же дверью, что ставит его (`sim/actions.setDecree`), и строка в летопись. Зовут шаг партии (`sim/tick`)
 * и каждая перемена привилегий.
 */
export function estatesStep(s: GameState): void {
  const e = estateDecree(s);
  if (!e || estatesNow(s)[e].loyalty >= LOYAL) return;
  const name = decreeOf(s).name;
  setDecree(s, 'none');
  log(s, ESTATE_LOG.lapsed(e, name), 'bad', undefined, 'stab');
}

// ---------- Чтение из сохранения ----------

const count = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0);

/**
 * Сословия из сохранения — каждое поле с проверкой (`save.deserialize`): чужое сословие не садится, привилегий — в пределах
 * лестницы, счёт — неотрицательным целым. Поля нет — `undefined`: привилегий не было, и версия не растёт.
 */
export function mergeEstates(v: unknown): EstatesState | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const raw = r.priv && typeof r.priv === 'object' ? (r.priv as Record<string, unknown>) : {};
  const priv: Partial<Record<EstateId, number>> = {};
  for (const [k, n] of Object.entries(raw)) {
    if (!isEstate(k)) continue;
    const m = Math.min(PRIV_MAX, count(n));
    if (m > 0) priv[k] = m;
  }
  return { priv, grants: count(r.grants), revokes: count(r.revokes), gifts: count(r.gifts) };
}

/** Привилегии по порядку сословий — для описи сервера. */
export const privList = (s: GameState): number[] => ESTATES.map((e) => privOf(s.estates?.priv, e));
