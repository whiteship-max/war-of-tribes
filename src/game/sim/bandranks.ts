// Дела с людьми отряда бродяги (ПН-6, docs/gdd/path_of_sword.md, 3.3.2, 3.4.2, 3.4.5; «Решения ПН-6»): повысить, разжаловать,
// распустить, принять пленных — одна дверь партии на каждое дело, и каждое кладёт приказ книги отряда сервера (`outbox`,
// `netlify/lib/roambook.ts`): люди отряда у сервера растут только тем, что он подтвердил сам (решение ВП4).
//
// Своей арифметики нет: дерево и цена повышения — `promoterules` (основа рынка, путь не важен), снаряжение — обоз отряда
// (`RoamState.gear`, не весит), пленные — `askrules.captivesOf`. Своим модулем — в куске пути (`game/roamdoor`).
import type { BandBookOrder } from '../../../netlify/lib/contract';
import type { EquipmentId, GameState, RoamState, TroopId } from '../types';
import { TROOP_BY_ID } from '../data/troops';
import { EQUIPMENT_BY_ID } from '../data/equipment';
import { roamOn } from '../roamflag';
import { demoteKit, promoteBill } from '../promoterules';
import { ASK_KIND } from '../askrules';
import { roamMoving } from '@/world/roam';
import { log } from './log';

/** Отряд бродяги, если путь открыт и партия в фазе бродяги. */
export const bandOf = (s: GameState): RoamState | null => (roamOn() && s.phase === 'roam' && s.roam ? s.roam : null);

/** Ключ приказа книги: сид партии и номер — один раз на дело. */
export const bookKey = (s: GameState, what: string): string => `${what}-${s.seed >>> 0}-${s.nextId++}`;

/** Приказы книги, ждущие связи, не длиннее этого: дальше старые уходят — книга сервера подождёт отметки. */
export const OUTBOX_MAX = 64;

/** Положить приказ книги в очередь (`net/bandbook` отправит его раньше отметки отряда). */
export function sendBook(s: GameState, o: BandBookOrder): void {
  const r = bandOf(s);
  if (!r) return;
  r.outbox = [...(r.outbox ?? []), o].slice(-OUTBOX_MAX);
}

/** Снять из очереди приказы с этими ключами — сервер их принял или отказал навсегда. */
export function dropBook(s: GameState, keys: readonly string[]): void {
  const r = bandOf(s);
  if (!r?.outbox) return;
  const left = r.outbox.filter((o) => !keys.includes(o.key));
  if (left.length) r.outbox = left;
  else delete r.outbox;
}

const add = (rec: Partial<Record<string, number>>, k: string, d: number): void => {
  const n = (rec[k] ?? 0) + d;
  if (n > 0) rec[k] = n;
  else delete rec[k];
};

const kindName = (id: TroopId): string => TROOP_BY_ID[id].name.toLowerCase();

/** Снаряжение словами: «копьё 2, щит 1». */
const kitWords = (kit: Partial<Record<EquipmentId, number>>): string =>
  (Object.entries(kit) as [EquipmentId, number][])
    .filter(([, n]) => n > 0)
    .map(([e, n]) => `${EQUIPMENT_BY_ID[e].name.toLowerCase()} ${n}`)
    .join(', ');

/** Почему отряд сейчас не меняет людей местами: в пути (повышают и разжалуют в любом лагере — ГДД 3.4.2). */
function standBlock(r: RoamState, now: number): string | null {
  if (!r.way) return 'Отряд ещё не вышел на карту.';
  return roamMoving(r.way, now) ? 'В пути не повышают: отряд должен стоять.' : null;
}

/** Можно ли повысить `n` бойцов `from` → `to` сейчас: отказ словами или `null`. Цена — `promoteBill` с обозом отряда. */
export function promoteBlock(s: GameState, from: TroopId, to: TroopId, n: number, now: number): string | null {
  const r = bandOf(s);
  if (!r) return 'Отряда нет.';
  const bill = promoteBill(from, to, n, r.gear);
  if (!bill) return 'Так не повышают.';
  if ((r.band[from] ?? 0) < n) return `В строю только ${r.band[from] ?? 0}.`;
  if (r.purse < bill.gold) return `Не хватает золота: нужно ${bill.gold}, в кошеле ${Math.floor(r.purse)}.`;
  return standBlock(r, now);
}

/**
 * Повысить `n` бойцов `from` → `to` (ГДД 3.4.2): золото — разность полных цен по основе рынка, снаряжение из обоза засчитано даром и
 * уходит из обоза. Отказ — словами, ничего не меняется.
 */
export function promoteBand(s: GameState, from: TroopId, to: TroopId, n: number, now: number): string | null {
  const why = promoteBlock(s, from, to, n, now);
  if (why) return why;
  const r = s.roam as RoamState;
  const bill = promoteBill(from, to, n, r.gear)!;
  r.purse -= bill.gold;
  for (const [e, k] of Object.entries(bill.fromCargo) as [EquipmentId, number][]) add(r.gear, e, -k);
  add(r.band, from, -n);
  add(r.band, to, n);
  const kit = kitWords(bill.fromCargo);
  log(s, `Повышены: ${kindName(from)} → ${kindName(to)}, ${n}. Золота ${bill.gold}${kit ? `, из обоза — ${kit}` : ''}.`, 'good');
  sendBook(s, { op: 'promote', key: bookKey(s, 'up'), from, to, n });
  return null;
}

/** Разжаловать `n` бойцов `from` → `to`: снятое снаряжение — в обоз, золото не возвращается. */
export function demoteBand(s: GameState, from: TroopId, to: TroopId, n: number, now: number): string | null {
  const r = bandOf(s);
  if (!r) return 'Отряда нет.';
  const kit = demoteKit(from, to, n);
  if (!kit) return 'Так не разжалуют.';
  if ((r.band[from] ?? 0) < n) return `В строю только ${r.band[from] ?? 0}.`;
  const why = standBlock(r, now);
  if (why) return why;
  for (const [e, k] of Object.entries(kit) as [EquipmentId, number][]) add(r.gear, e, k);
  add(r.band, from, -n);
  add(r.band, to, n);
  log(s, `Разжалованы: ${kindName(from)} → ${kindName(to)}, ${n}. В обоз — ${kitWords(kit)}.`, 'info');
  sendBook(s, { op: 'demote', key: bookKey(s, 'down'), from, to, n });
  return null;
}

/** Распустить `n` бойцов вида: снаряжение — в обоз (ГДД 3.3.2), людей больше нет. Можно всегда. */
export function dismissBand(s: GameState, kind: TroopId, n: number): string | null {
  const r = bandOf(s);
  if (!r) return 'Отряда нет.';
  if (!(n > 0) || !Number.isInteger(n)) return 'Сколько распустить?';
  if ((r.band[kind] ?? 0) < n) return `В строю только ${r.band[kind] ?? 0}.`;
  const kit: Partial<Record<EquipmentId, number>> = {};
  for (const [e, k] of Object.entries(TROOP_BY_ID[kind].gear) as [EquipmentId, number][]) kit[e] = k * n;
  for (const [e, k] of Object.entries(kit) as [EquipmentId, number][]) add(r.gear, e, k);
  add(r.band, kind, -n);
  const words = kitWords(kit);
  log(s, `Распущены: ${kindName(kind)}, ${n}.${words ? ` В обоз — ${words}.` : ''}`, 'info');
  sendBook(s, { op: 'dismiss', key: bookKey(s, 'off'), kind, n });
  return null;
}

/** Пленные, которых можно принять сейчас (срок не вышел), или `null`. */
export function captivesNow(s: GameState, now: number): number | null {
  const c = bandOf(s)?.captives;
  return c && c.until > now && c.n > 0 ? c.n : null;
}

/** «Принять в отряд» пленных (ГДД 3.4.5): дубинщиками, один раз. */
export function takeCaptives(s: GameState, now: number): string | null {
  const r = bandOf(s);
  const n = captivesNow(s, now);
  if (!r || n === null) return 'Пленных нет.';
  const key = (r.captives as NonNullable<RoamState['captives']>).key;
  delete r.captives;
  add(r.band, ASK_KIND, n);
  log(s, `Пленные приняты в отряд: ${kindName(ASK_KIND)}, ${n}.`, 'info');
  sendBook(s, { op: 'captives', key, n });
  return null;
}

/** Отпустить пленных: в отряд не идут, книга не растёт. */
export function freeCaptives(s: GameState): void {
  const r = bandOf(s);
  if (r?.captives) delete r.captives;
}
