/**
 * Кто кого видит из отрядов бродяг (ПН-4у, docs/gdd/path_of_sword.md, 3.5.4, 6.6 и «Решения ПН-4у») — сервер считает сам.
 *
 * Правило одно с игрой — дверь `world/sight` (заметность × радиус наблюдателя); здесь только то, что знает сервер: строки реестра.
 * Положение отряда — функция его хода и минуты (`world/roam`), местность и руины — общая земля, ночь и сезон — часы партии отряда,
 * которые сервер ставит **по событию** — приказом отряда, из описи партии (`clockAt`), — и дальше ведёт сам (`world/sight.partyTimeAt`).
 * Шага у сервера нет: чтение реестра ничего не пишет, обнаружение — чистая функция строк и минуты, а строки меняются только
 * событиями (приказ, ход, лагерь, отметка). Клиентское «меня не видно» не читается: в приказе отряда такого поля нет, и разбор приказа
 * лишнего не пропускает (`contract.readBandOrder`).
 *
 * Наблюдатели — те, кого сервер знает сам: круг замка игрока (строка замка) и его стоящий отряд (строка отряда). Лазутчик-наблюдатель
 * и дружина в поле — тоже наблюдатели двери, но их места живут в мире игрока, и слову клиента о них сервер не верит; в Срезе 1
 * отряды игроков они не обнаруживают (решение ПН-4у; вернутся с охотой игроков, Срез 2).
 */
import type { BandRow, BandView, RosterFile, SeenBy, SeenView, WatchCard } from './contract.js';
import { bandLook, conspicuity, partyTimeAt, sees, type Look, type Watcher } from '../../src/world/sight.js';
import { roamCell, roamMoving } from '../../src/world/roam.js';
import { DAY_LENGTH, gameSecondsOfMs, realMs } from '../../src/game/pace.js';
import { MAX_OFFLINE_DAYS } from '../../src/game/constants.js';
import { CLOCK_SKEW_SECONDS } from './initdata.js';
import { castleIdOf, moveOfRow } from './roster.js';

/** Опознавательный номер отряда наружу — не ключ игрока: тот же секрет, что у замка, со своей приставкой. */
export const bandIdOf = (key: string): string => castleIdOf(`band:${key}`);

/** Часы партии отряда в минуту `now`: по отметке строки; нет отметки — с рождения строки (путь начинают с новой партии). */
export const bandTime = (b: BandRow, now: number): number => partyTimeAt(b.clock ?? { time: 0, at: b.born }, now);

/** Как отряд выглядит в минуту `now` — дверью `world/sight`. */
export const lookOfRow = (b: BandRow, now: number): Look => bandLook(moveOfRow(b), b.men, bandTime(b, now), now);

/** Заметность отряда в минуту `now`. */
export const rowConspicuity = (b: BandRow, now: number): number => conspicuity(lookOfRow(b, now));

/** Стоящий отряд — наблюдатель; идущий не смотрит (как фигура в пути, `lookout.standing`). */
const bandWatcher = (b: BandRow, now: number): Watcher | null => (roamMoving(b.way, now) ? null : { kind: 'band', at: roamCell(b.way, now) });

/** Наблюдатели игрока `key`, которых сервер знает сам: круг его замка и его стоящий отряд. */
export function watchersOf(file: RosterFile, key: string, now: number): Watcher[] {
  const out: Watcher[] = [];
  const own = file.rows[key];
  if (own) out.push({ kind: 'castle', at: { x: own.x, y: own.y } });
  const band = file.bands?.[key];
  const w = band ? bandWatcher(band, now) : null;
  if (w) out.push(w);
  return out;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

/** Чужой отряд глазами наблюдателя: клетка, люди, куда смотрит колонна, вид лагеря. Цели хода нет. */
export function bandView(key: string, b: BandRow, now: number): BandView {
  const at = roamCell(b.way, now);
  const moving = roamMoving(b.way, now);
  const dx = b.way.to.x - b.way.from.x;
  const dy = b.way.to.y - b.way.from.y;
  const len = Math.hypot(dx, dy);
  return {
    id: bandIdOf(key),
    name: b.name,
    ...(b.arms ? { arms: b.arms } : {}),
    prestige: b.prestige,
    men: b.men,
    at,
    ...(moving && len > 0 ? { heading: { x: r2(dx / len), y: r2(dy / len) } } : {}),
    ...(!moving && b.camp ? { camp: b.camp.kind } : {}),
  };
}

/** Видят ли наблюдатели `ws` отряд `b` в минуту `now`. */
const seenByAny = (ws: readonly Watcher[], b: BandRow, now: number): boolean => {
  if (ws.length === 0) return false;
  const at = roamCell(b.way, now);
  const c = rowConspicuity(b, now);
  return ws.some((w) => sees(w, at, c));
};

/** Чужие отряды, которых игрок `key` видит в минуту `now` (не видит — их нет в списке вовсе). */
export function bandsSeen(file: RosterFile, key: string, now: number): BandView[] {
  const ws = watchersOf(file, key, now);
  if (ws.length === 0) return [];
  const out: BandView[] = [];
  for (const [k, b] of Object.entries(file.bands ?? {})) if (k !== key && seenByAny(ws, b, now)) out.push(bandView(k, b, now));
  return out;
}

/**
 * Кто видит отряд игрока `key` в минуту `now`: замки (их место видно всем — по имени) и стоящие отряды (по имени — если и мы их
 * видим; иначе только числом). Отряда нет — `null`.
 */
export function seenOf(file: RosterFile, key: string, now: number): SeenView | null {
  const own = file.bands?.[key];
  if (!own) return null;
  const at = roamCell(own.way, now);
  const c = rowConspicuity(own, now);
  const mine = watchersOf(file, key, now);
  let count = 0;
  const by: SeenBy[] = [];
  for (const [k, row] of Object.entries(file.rows)) {
    if (k === key || !sees({ kind: 'castle', at: { x: row.x, y: row.y } }, at, c)) continue;
    count++;
    by.push({ kind: 'castle', id: castleIdOf(k), name: row.name, ...(row.city ? { city: row.city } : {}) });
  }
  for (const [k, b] of Object.entries(file.bands ?? {})) {
    if (k === key) continue;
    const w = bandWatcher(b, now);
    if (!w || !sees(w, at, c)) continue;
    count++;
    if (seenByAny(mine, b, now)) by.push({ kind: 'band', id: bandIdOf(k), name: b.name });
  }
  return { count, by };
}

// ---------- Часы отряда по событию ----------

/**
 * Часы партии из описи: какие были часы (`card.time`) в минуту её прихода (`cardAt`). Описи нет — `undefined`: строка живёт
 * прежней отметкой или с рождения.
 */
export const clockOfCard = (card: WatchCard | undefined, cardAt: number): BandRow['clock'] =>
  card && cardAt > 0 && Number.isFinite(card.time) ? { time: Math.max(0, card.time), at: cardAt } : undefined;

/** Допуск часов, игровых секунд: часы устройства и сети (`CLOCK_SKEW_SECONDS`) и целые секунды описи. */
export const CLOCK_SLACK = gameSecondsOfMs(CLOCK_SKEW_SECONDS * 1000) + 1;

/**
 * Насколько часы отряда в новой описи отстали от прежней отметки, ведомой сервером, игровых секунд. Честные часы партии идут вровень
 * с настоящими (шаг и отлучка — одной дверью времени); медленнее они идут только после отлучки дольше потолка догона
 * (`MAX_OFFLINE_DAYS`) — тогда промежуток длиннее потолка, и отставание не меряется (`null`). Вперёд часы уходят под скоростью
 * проверки — это не здесь (правило «time» наблюдения).
 */
export function clockLag(prev: BandRow['clock'], next: BandRow['clock']): number | null {
  if (!prev || !next || next.at <= prev.at) return null;
  if (next.at - prev.at >= realMs(MAX_OFFLINE_DAYS * DAY_LENGTH)) return null;
  return partyTimeAt(prev, next.at) - next.time;
}

/**
 * Отметка часов отряда, которую сервер ставит приказом, и флаг подделки. Часы описи отстали больше допуска — ночь и сезон отряда
 * сервер ведёт дальше своей отметкой, а не названной (остановить ночь словом нельзя), и это флаг «time».
 */
export function clockAt(prev: BandRow['clock'], card: WatchCard | undefined, cardAt: number): { clock: BandRow['clock']; flag: { kind: 'time'; text: string } | null } {
  const next = clockOfCard(card, cardAt);
  if (!next) return { clock: prev, flag: null };
  const lag = clockLag(prev, next);
  if (lag === null || lag <= CLOCK_SLACK) return { clock: next, flag: null };
  const kept = { time: partyTimeAt(prev as { time: number; at: number }, next.at), at: next.at };
  return {
    clock: kept,
    flag: { kind: 'time', text: `Часы отряда бродяги отстали на ${Math.round(lag)} игр. с от настоящего времени без долгой отлучки: ночь и сезон отряда сервер ведёт своими часами.` },
  };
}
