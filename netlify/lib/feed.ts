/**
 * Вести края (docs/feed.md): лента событий региона — город взят, осада началась и снята, штурм отбит, удачное тайное
 * дело, пойманный лазутчик, новый сосед, новое первое место рейтинга.
 *
 * **Записи выводятся, а не копятся**, как новости войны для бота (`war.newsOf`): лента — функция того, что сервер уже
 * хранит, — записи войн (её пишет только сервер войны), реестра замков (`CastleRow.since`) и памяти первых мест. Своей
 * памяти у ленты одна строчка — кто и когда выходил на первое место (`LeaderFile`): рейтинг считается заново при каждом
 * чтении, и «первое место сменилось» без памяти не вывести. Клиент записей не присылает: тела у запроса нет.
 *
 * **Тайное остаётся тайным** (docs/spy_pvp.md): удавшийся поджог, кража или смута — без имени нападающего; имя — только
 * у пойманного лазутчика (плен или гибель), ровно как в `war.spyViewOf`. Разведка и тихий провал следа не оставляют.
 */
import { cityOr, type CastleRow, type FeedItem, type RosterFile } from './contract.js';
import type { SpyRow, WarFile, WarRow } from './war.js';
import type { Ranked } from './rating.js';
import { rivalHostile } from '../../src/world/rivalspy.js';
import { inHomeTheatre } from '../../src/world/theatre/theatre.js';

/** Ключ памяти первых мест в хранилище мира — рядом с реестром и войнами; чистый старт стирает её вместе с ними. */
export const FEED_KEY = 'feed';

/**
 * Сколько запись живёт в ленте — неделю, столько же, сколько кончившаяся война лежит в записи войн (`WAR_KEEP_MS`):
 * старше лента и не могла бы вывести. Потолок — сорок записей: на экране телефона это десяток прокруток.
 */
export const FEED_KEEP_MS = 7 * 24 * 3600_000;
export const FEED_MAX = 40;

/**
 * Первое место сменилось не раньше чем через час после прошлой смены. Мощь у двух близких городов качается от каждой
 * стройки и найма, и без паузы лента состояла бы из одних смен первого места.
 */
export const LEADER_QUIET_MS = 3600_000;
/** Сколько смен первого места помнить: больше ленте не показать (`FEED_KEEP_MS`). */
export const LEADER_MAX = 20;

/** Память первых мест: кто и когда вышел вперёд. */
export interface LeaderFile {
  v: 1;
  list: { key: string; at: number }[];
}

export const emptyLeaders = (): LeaderFile => ({ v: 1, list: [] });

/** Память из хранилища. Испорченное читается пустым: лента теряет только смены первого места. */
export function readLeaders(raw: unknown): LeaderFile {
  const r = raw as Partial<LeaderFile> | null;
  if (!r || r.v !== 1 || !Array.isArray(r.list)) return emptyLeaders();
  const list = r.list
    .filter((x) => x && typeof x.key === 'string' && Number(x.at) > 0)
    .map((x) => ({ key: x.key, at: Math.floor(Number(x.at)) }))
    .slice(-LEADER_MAX);
  return { v: 1, list };
}

/**
 * Новая память, если первое место сменилось, иначе `null` (писать нечего). Первое место — у одного: делят его двое —
 * смены нет, первым остаётся прежний.
 */
export function nextLeaders(file: LeaderFile, ranked: readonly Pick<Ranked, 'key' | 'place'>[], now: number): LeaderFile | null {
  const top = ranked[0];
  if (!top || top.place !== 1 || ranked[1]?.place === 1) return null;
  const last = file.list[file.list.length - 1];
  if (last?.key === top.key) return null;
  if (last && now - last.at < LEADER_QUIET_MS) return null;
  return { v: 1, list: [...file.list, { key: top.key, at: now }].slice(-LEADER_MAX) };
}

/** Что ленте нужно знать о мире. */
export interface FeedWorld {
  wars: WarFile;
  roster: RosterFile;
  leaders: LeaderFile;
}

const ruler = (roster: RosterFile, key: string): string => roster.rows[key]?.name ?? '';

/** Записи одной войны. */
function warItems(w: WarRow, roster: RosterFile, now: number): FeedItem[] {
  const out: FeedItem[] = [];
  const base = {
    x: w.to.x,
    y: w.to.y,
    city: cityOr(w.defCity),
    byCity: cityOr(w.atkCity),
    byRuler: ruler(roster, w.atk),
  };
  // Лагерь встаёт в минуту прихода осадой; отозванный поход и город, ушедший из игры до прихода, осады не начинали.
  const camped = w.mode === 'siege' && w.arriveAt <= now && w.phase !== 'march' && w.end !== 'recalled' && !(w.end === 'gone' && w.endAt === w.arriveAt);
  if (camped) out.push({ id: `siege:${w.id}`, kind: 'siege', at: w.arriveAt, ...base });
  if (w.fall) {
    out.push({
      id: `fell:${w.id}`,
      kind: 'fell',
      at: w.fall.at,
      ...base,
      how: w.fall.by,
      ...(camped ? { siegeMs: Math.max(0, w.fall.at - w.arriveAt) } : {}),
    });
  } else if (w.endAt !== undefined && (w.end === 'retreat' || w.end === 'lifted' || w.end === 'beaten')) {
    // Штурм с ходу, отбитый у стен, — «штурм отбит»; всё, что кончилось у лагеря без падения, — «осада снята».
    if (camped) out.push({ id: `lifted:${w.id}`, kind: 'lifted', at: w.endAt, ...base, how: w.end });
    else if (w.end === 'beaten') out.push({ id: `repelled:${w.id}`, kind: 'repelled', at: w.endAt, ...base });
  }
  return out;
}

/** Запись тайного дела: пойманный — с именем хозяина, удавшееся нападение — без имени, остальное — ничего. */
function spyItem(x: SpyRow, roster: RosterFile): FeedItem | null {
  const o = x.out;
  if (!o || o.gone) return null;
  const base = { at: o.at, x: x.to.x, y: x.to.y, city: cityOr(x.defCity) };
  if (o.held || o.dead) {
    return { id: `caught:${x.id}`, kind: 'caught', ...base, byCity: cityOr(x.atkCity), byRuler: ruler(roster, x.atk), how: o.dead ? 'dead' : 'held' };
  }
  if (o.ok && rivalHostile(x.deed)) return { id: `spy:${x.id}`, kind: 'spy', ...base, how: x.deed };
  return null;
}

const castleItem = (kind: 'settled' | 'leader', id: string, at: number, row: CastleRow): FeedItem => ({
  id,
  kind,
  at,
  x: row.x,
  y: row.y,
  city: cityOr(row.city),
  ruler: row.name,
});

/** Ключи сторон записи — чтобы отметить свой город и не отдать ключи наружу. */
interface Keyed {
  item: FeedItem;
  keys: string[];
}

/**
 * Лента спросившего: записи его региона (`theatre.inHomeTheatre` от его замка) за неделю, свежие сверху. Смена первого
 * места — у всех: рейтинг один на мир (docs/feed.md, решение 4). Замка в реестре нет — ленты нет: регион не назвать.
 */
export function feedOf(world: FeedWorld, me: string, now: number): FeedItem[] {
  const home = world.roster.rows[me];
  if (!home) return [];
  const all: Keyed[] = [];
  for (const w of world.wars.wars) for (const item of warItems(w, world.roster, now)) all.push({ item, keys: [w.atk, w.def] });
  for (const x of world.wars.spies ?? []) {
    const item = spyItem(x, world.roster);
    // Свой город у нападающего отмечается только у пойманного: удача тайного дела не своя новость защитника о нём.
    if (item) all.push({ item, keys: item.kind === 'caught' ? [x.atk, x.def] : [x.def] });
  }
  for (const [key, row] of Object.entries(world.roster.rows)) {
    if (row.since) all.push({ item: castleItem('settled', `settled:${row.since}:${row.x}|${row.y}`, row.since, row), keys: [key] });
  }
  for (const l of world.leaders.list) {
    const row = world.roster.rows[l.key];
    if (row) all.push({ item: castleItem('leader', `leader:${l.at}`, l.at, row), keys: [l.key] });
  }
  return all
    .filter(({ item }) => item.at <= now && now - item.at <= FEED_KEEP_MS)
    .filter(({ item }) => item.kind === 'leader' || inHomeTheatre(home, item))
    .sort((a, b) => b.item.at - a.item.at || a.item.id.localeCompare(b.item.id))
    .slice(0, FEED_MAX)
    .map(({ item, keys }) => (keys.includes(me) ? { ...item, mine: true as const } : item));
}
