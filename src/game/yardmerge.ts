/**
 * Переход ЗД-1 — объединение ресурсных дворов (docs/city_v3.md, «Решения ЗД-1»): **одна дверь на партию, на сервер и на
 * мир**. Три пары прежних зданий стали тремя дворами с двумя делами:
 *
 *  · Ферма + Загон → Ферма (поле и загон), идентификатор `farm`;
 *  · Охотничий домик + Навес собирателей → Охотничий двор (охота и сбор), `hunter_hut`;
 *  · Рудник + Каменоломня → Шахта (руда и камень), `mine`.
 *
 * Правило перехода — «у игрока ничего не отнимаем»: уровень двора — больший из двух прежних; рабочие и невольники
 * переходят на свои дела (дело — профессия прежнего здания); стройка обеих частей на один и тот же следующий уровень
 * переносится одной стройкой двора с суммой сделанной работы — оплачена она ровно ценой двора (сумма цен дел); всякая
 * другая стройка ушедших частей возвращает цену целиком (`sim/pay.refund`), потому что перенести её не на что.
 *
 * Читают дверь: ступень сохранения 23 → 24 (`game/save.ts`, `foldParty`), книга стройки и опись сервера
 * (`netlify/lib/town.ts`, `watch.ts` — `foldLevels`, `foldSites`), и всё, что мир или старая запись везут с прежним
 * типом постройки (`keptType`): падение города, выстрел по постройке, донесение, весть бота. Чистая, без `@/`: модуль
 * читает серверная часть.
 */
import type { BuildingTypeId, JobId, ResourceId } from './types';
import { BUILDING_BY_ID, jobsOf } from './data/buildings';
import { YARD_BY_JOB } from './data/yards';
import { upgradeCost, upgradeWork } from './labour';

/** Ушедшее здание → двор, в который оно вошло. */
export const MERGED_INTO: Readonly<Record<string, BuildingTypeId>> = { pen: 'farm', gathering: 'hunter_hut', quarry: 'mine' };

/** Дело прежнего здания пары: его рабочие встают на это дело двора. Остальные здания несли одно дело — оно и есть. */
const OLD_JOB: Readonly<Record<string, JobId>> = {
  farm: 'farmer',
  pen: 'herder',
  hunter_hut: 'hunter',
  gathering: 'gatherer',
  mine: 'miner',
  quarry: 'stonecutter',
};

/** Пары перехода: двор и ушедшее в него здание. */
export const MERGED_PAIRS: readonly { kept: BuildingTypeId; gone: string }[] = Object.entries(MERGED_INTO).map(([gone, kept]) => ({ kept, gone }));

/** Тип постройки, каким его знает игра сейчас: ушедший — его двор, нынешний — он сам, чужой — null. */
export const keptType = (type: string): BuildingTypeId | null =>
  MERGED_INTO[type] ?? (Object.prototype.hasOwnProperty.call(BUILDING_BY_ID, type) ? (type as BuildingTypeId) : null);

/** Дело, на которое встают рабочие прежнего здания этого типа; у здания без дел — null. */
export const oldJobOf = (type: string): JobId | null => OLD_JOB[type] ?? (keptType(type) === type ? (jobsOf(type as BuildingTypeId)[0] ?? null) : null);

/** Цена прежнего здания — дела, из которого оно пришло, или самого здания, если оно не менялось. */
const oldPrice = (type: string): { cost: Partial<Record<ResourceId, number>>; work: number } | null => {
  const job = OLD_JOB[type];
  const yard = job ? YARD_BY_JOB.get(job) : undefined;
  if (yard) return { cost: yard.cost, work: yard.work };
  const kept = keptType(type);
  return kept === type ? BUILDING_BY_ID[kept] : null;
};

/** Цена улучшения прежнего здания до уровня `level` — её возвращает стройка, которую не на что перенести. */
export const oldUpgradeCost = (type: string, level: number): Partial<Record<ResourceId, number>> => {
  const p = oldPrice(type);
  return p ? upgradeCost(p, level) : {};
};

/** Есть ли среди типов ушедшие — значит, запись ещё до перехода. */
export const hasGone = (types: Iterable<string>): boolean => {
  for (const t of types) if (Object.prototype.hasOwnProperty.call(MERGED_INTO, t)) return true;
  return false;
};

/** Уровни по типам после перехода: двор — больший из двух прежних, ушедших типов нет. Вход не меняется. */
export function foldLevels(levels: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = { ...levels };
  for (const { kept, gone } of MERGED_PAIRS) {
    if (!(gone in out)) continue;
    const g = out[gone];
    delete out[gone];
    out[kept] = Math.max(out[kept] ?? 0, Number.isFinite(g) ? g : 0);
  }
  return out;
}

/** Стройка на постройке: тип, до какого уровня и сколько работы на ней сделано. */
export interface FoldSite {
  type: string;
  level: number;
  done: number;
}

/** Очередь после перехода и стройки ушедших частей, которые вернули цену. */
export interface FoldedSites {
  /** Очередь по порядку: стройки двора и всех прочих построек. */
  sites: FoldSite[];
  /** Стройки частей пары, которые не на что перенести: возврат полной цены прежнего здания (`oldUpgradeCost`). */
  refunds: FoldSite[];
}

/**
 * Очередь стройки после перехода (СТ-1). `levels` — уровни **до** перехода, `sites` — очередь по порядку. Стройка обеих
 * частей пары на один и тот же следующий уровень — уровень двора плюс один — становится одной стройкой двора на месте
 * первой из двух, работа — сумма: оплачена она ровно ценой двора. Стройка части в любом другом случае не переносится, а
 * возвращает цену прежнего здания. Стройка не на следующий уровень своей постройки (испорченная запись) отбрасывается.
 * Стройки прочих построек проходят как есть.
 */
export function foldSites(levels: Readonly<Record<string, number>>, sites: readonly FoldSite[]): FoldedSites {
  const out: (FoldSite | null)[] = sites.map((x) => ({ ...x }));
  const refunds: FoldSite[] = [];
  for (const { kept, gone } of MERGED_PAIRS) {
    if (!(gone in levels)) continue;
    const top = Math.max(levels[kept] ?? 0, levels[gone] ?? 0);
    const at = (type: string): number => out.findIndex((x) => x !== null && x.type === type);
    const valid = (i: number): boolean => i >= 0 && out[i]!.level === (levels[out[i]!.type] ?? 0) + 1;
    const ik = at(kept);
    const ig = at(gone);
    if (valid(ik) && valid(ig) && out[ik]!.level === top + 1 && out[ig]!.level === top + 1) {
      const first = Math.min(ik, ig);
      out[first] = { type: kept, level: top + 1, done: out[ik]!.done + out[ig]!.done };
      out[Math.max(ik, ig)] = null;
      continue;
    }
    for (const i of [ik, ig]) {
      if (i < 0) continue;
      if (valid(i)) refunds.push(out[i]!);
      out[i] = null;
    }
  }
  return { sites: out.filter((x): x is FoldSite => x !== null), refunds };
}

/** Постройка в записи партии — как она лежит в сохранении. */
interface RawBuilding {
  id: number;
  type: string;
  level: number;
  work: number;
  workRequired: number;
}

/** Что переход сделал с партией — для слов игроку и возврата цены после слияния (`save.migrate`). */
export interface PartyFold {
  /** Пары, которые были в партии: двор, его уровень после перехода и уровни двух прежних зданий. */
  merged: { kept: BuildingTypeId; gone: string; level: number; was: [number, number] }[];
  /** Стройки, вернувшие цену: тип прежнего здания и уровень, до которого он строился. */
  refunds: FoldSite[];
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Ступень сохранения 23 → 24 на прочитанном JSON, до слияния с новой партией (`save.deserialize`): постройки, стройка и
 * очередь, рабочие и невольники по делам, постройки без работы под обстрелом. Возврат цены кладёт ступень после слияния
 * дверью склада — здесь он только назван. Записи без построек не трогает.
 */
export function foldParty(data: Record<string, unknown>): PartyFold {
  const fold: PartyFold = { merged: [], refunds: [] };
  if (!Array.isArray(data.buildings)) return fold;
  const all = (data.buildings as RawBuilding[]).filter((b) => b && typeof b.type === 'string');
  const typeOfId = new Map(all.map((b) => [b.id, b.type]));
  const levels: Record<string, number> = {};
  for (const b of all) levels[b.type] = num(b.level);

  // Очередь до перехода тем же порядком, что `derived.buildQueue`: названные — первыми, остальные — порядком построек,
  // начатая — впереди всех.
  const sites = all.filter((b) => num(b.workRequired) > 0);
  const order: RawBuilding[] = [];
  for (const id of Array.isArray(data.buildQueue) ? (data.buildQueue as unknown[]) : []) {
    const b = sites.find((x) => x.id === id);
    if (b && !order.includes(b)) order.push(b);
  }
  for (const b of sites) if (!order.includes(b)) order.push(b);
  const started = order.findIndex((b) => num(b.work) > 0);
  if (started > 0) order.unshift(...order.splice(started, 1));
  const folded = foldSites(levels, order.map((b) => ({ type: b.type, level: num(b.level) + 1, done: num(b.work) })));
  fold.refunds = folded.refunds;

  const next = foldLevels(levels);
  const buildings: RawBuilding[] = [];
  for (const b of all) {
    if (Object.prototype.hasOwnProperty.call(MERGED_INTO, b.type)) continue;
    const pair = MERGED_PAIRS.find((p) => p.kept === b.type && p.gone in levels);
    if (!pair) {
      buildings.push(b);
      continue;
    }
    const level = next[b.type];
    const site = folded.sites.find((x) => x.type === b.type);
    buildings.push({
      ...b,
      level,
      work: site ? site.done : 0,
      workRequired: site ? upgradeWork(BUILDING_BY_ID[pair.kept], level + 1) : 0,
    });
    fold.merged.push({ kept: pair.kept, gone: pair.gone, level, was: [levels[pair.kept], levels[pair.gone]] });
  }
  // Ушедшее здание без своего двора в записи (испорченная запись): двор встанет первым уровнем из умолчаний, а уровень
  // ушедшего ляжет на него здесь — тем же правилом «больший».
  for (const { kept, gone } of MERGED_PAIRS) {
    if (!(gone in levels) || kept in levels) continue;
    const g = all.find((b) => b.type === gone)!;
    buildings.push({ ...g, type: kept, level: next[kept], work: 0, workRequired: 0 });
    fold.merged.push({ kept, gone, level: next[kept], was: [0, levels[gone]] });
  }
  data.buildings = buildings;
  const idOf = new Map(buildings.map((b) => [b.type, b.id]));
  data.buildQueue = folded.sites.map((x) => idOf.get(keptType(x.type) ?? '')).filter((id): id is number => id !== undefined);

  // Рабочие и невольники — с номера постройки на дело (`GameState.workers`): дело — профессия прежнего здания.
  for (const key of ['workers', 'bondedWork'] as const) {
    const was = data[key] && typeof data[key] === 'object' ? (data[key] as Record<string, unknown>) : {};
    const now: Partial<Record<JobId, number>> = {};
    for (const [id, n] of Object.entries(was)) {
      const type = typeOfId.get(Number(id));
      const job = type !== undefined ? oldJobOf(type) : null;
      if (job && num(n) > 0) now[job] = (now[job] ?? 0) + Math.floor(num(n));
    }
    data[key] = now;
  }

  // Постройки без работы под обстрелом (`SiegeState.idle`) — по типу: ушедшая — её двор.
  const siege = data.siege as { idle?: unknown } | null | undefined;
  if (siege && Array.isArray(siege.idle)) {
    siege.idle = [...new Set((siege.idle as unknown[]).map((t) => (typeof t === 'string' ? keptType(t) : null)).filter((t): t is BuildingTypeId => t !== null))];
  }
  return fold;
}

/** Прежние имена ушедших зданий — для слов сервера о подделке и для вестей, записанных до перехода. */
export const GONE_NAME: Readonly<Record<string, string>> = { pen: 'Загон', gathering: 'Навес собирателей', quarry: 'Каменоломня' };

/** С какой ступени сохранения дворы объединены: опись этой ступени и новее прежних построек не называет. */
export const MERGED_SAVE = 24;

/** Уровни, очередь и идущая стройка — как их держат опись наблюдения и книга стройки сервера. */
export interface FoldTown {
  levels: Readonly<Record<string, number>>;
  /** Очередь по порядку; первое — строящееся. */
  queue?: readonly { type: string; level: number }[];
  /** Идущая стройка и сделанная на ней работа. */
  site?: FoldSite | null;
}

/**
 * Опись или книга стройки после перехода: уровни — `foldLevels`, очередь и идущая стройка — `foldSites`, работа — у
 * идущей. Записи без ушедших построек проходят как есть, тем же объектом.
 */
export function foldTown<T extends FoldTown>(t: T): T {
  const pairs = MERGED_PAIRS.filter((p) => p.gone in t.levels);
  const touches = (type: string): boolean => pairs.some((p) => p.kept === type || p.gone === type);
  if (pairs.length === 0 && !(t.queue ?? []).some((e) => hasGone([e.type])) && !(t.site && hasGone([t.site.type]))) return t;
  const entries = t.queue ?? (t.site ? [t.site] : []);
  const doneOf = (e: { type: string; level: number }): number => (t.site && t.site.type === e.type && t.site.level === e.level ? t.site.done : 0);
  const folded = foldSites(
    t.levels,
    entries.map((e) => ({ type: e.type, level: e.level, done: doneOf(e) })),
  );
  // Очередь и стройка с ушедшим типом без его уровня (испорченная запись) — без места: переносить её не на что.
  const sites = folded.sites.filter((x) => !hasGone([x.type]));
  const out: T = { ...t, levels: foldLevels(t.levels) };
  if (t.queue) out.queue = sites.map(({ type, level }) => ({ type, level }));
  if (t.site) {
    const kept = keptType(t.site.type);
    const merged = touches(t.site.type) ? sites.find((x) => x.type === kept && x.level === (out.levels[x.type] ?? 0) + 1) : null;
    const site = merged ?? (touches(t.site.type) || hasGone([t.site.type]) ? null : t.site);
    // Стройки нет — нет и поля: опись без стройки его не несёт, книга читает «нет» как `null`.
    if (site) out.site = site;
    else delete out.site;
  }
  return out;
}
