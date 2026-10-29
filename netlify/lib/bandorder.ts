/**
 * Разбор приказов книги отряда и книги из строки реестра (ПН-6, решение ВП4) — своим модулем рядом с договором: типы — в договоре
 * (`contract.ts`: `BandBookOrder`, `RoamBookRow`), разбор читают сервер (`contract.readBandOrder`, `roster.readBandRow`,
 * `roambook.ts`) и кусок пути (`sim/roam` — очередь приказов в сохранении). Договор лежит в первой загрузке, и разбор, который читает
 * кусок пути, уехал бы туда вместе с ним (ВП1); отсюда он едет только с сервером и с куском пути.
 */
import { BAND_LIMITS, TROOP_KEYS, type BandBookOrder, type BandOrder, type RoamBookRow, type TroopKey } from './contract.js';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Виды приказов книги отряда. */
export const BAND_BOOK_OPS = ['join', 'hire', 'captives', 'promote', 'demote', 'dismiss'] as const;

/** Приказ книги отряда, а не хода. */
export const isBookOrder = (o: BandOrder): o is BandBookOrder => (BAND_BOOK_OPS as readonly string[]).includes(o.op);

/** Вид бойца из чужой строки: только из списка. */
const troopKey = (v: unknown): TroopKey | null => (typeof v === 'string' && (TROOP_KEYS as readonly string[]).includes(v) ? (v as TroopKey) : null);

/** Люди по видам из чужой строки: только виды из списка, целые от единицы, не выше потолка. */
export function readTroopKeys(v: unknown): Partial<Record<TroopKey, number>> {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out: Partial<Record<TroopKey, number>> = {};
  for (const k of TROOP_KEYS) {
    const n = num(r[k]);
    if (n !== null && n >= 1) out[k] = Math.min(BAND_LIMITS.men, Math.floor(n));
  }
  return out;
}

/** Книга отряда из строки реестра: новый объект; нет или кривая — `undefined`. */
export function readRoamBook(v: unknown): RoamBookRow | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const join = num(r.join);
  const drill = num(r.drill);
  const fights = num(r.fights);
  return {
    troops: readTroopKeys(r.troops),
    join: join !== null && join >= -1 ? Math.floor(join) : -1,
    drill: drill !== null && drill >= 0 ? drill : 0,
    fights: fights !== null ? Math.max(0, Math.min(2, Math.floor(fights))) : 0,
    grant: ((g) => (g !== null && g >= 0 ? Math.floor(g) : 0))(num(r.grant)),
    keys: Array.isArray(r.keys) ? r.keys.filter((k): k is string => typeof k === 'string' && k.length <= BAND_LIMITS.key).slice(-BAND_LIMITS.keys) : [],
  };
}

const bandKey = (v: unknown): string | null => (typeof v === 'string' && /^[\w.:-]{6,64}$/.test(v) ? v : null);

/** Приказ книги отряда из тела: новый объект; кривое — `null`. */
export function readBookOrder(r: Record<string, unknown>): BandBookOrder | null {
  const key = bandKey(r.key);
  const n = num(r.n);
  if (!key || n === null || !Number.isInteger(n) || n < 1 || n > BAND_LIMITS.men) return null;
  if (r.op === 'join') {
    const k = num(r.k);
    return k !== null && Number.isInteger(k) && k >= 0 ? { op: 'join', key, k, n } : null;
  }
  if (r.op === 'captives') return { op: 'captives', key, n };
  if (r.op === 'hire') {
    const kind = troopKey(r.kind);
    const at = (r.at && typeof r.at === 'object' ? r.at : {}) as Record<string, unknown>;
    const x = num(at.x);
    const y = num(at.y);
    return kind && x !== null && y !== null ? { op: 'hire', key, kind, n, at: { x: Math.round(x), y: Math.round(y) } } : null;
  }
  if (r.op === 'promote' || r.op === 'demote') {
    const from = troopKey(r.from);
    const to = troopKey(r.to);
    return from && to && from !== to ? { op: r.op, key, from, to, n } : null;
  }
  if (r.op === 'dismiss') {
    const kind = troopKey(r.kind);
    return kind ? { op: 'dismiss', key, kind, n } : null;
  }
  return null;
}
