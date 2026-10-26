// Книга черт армии (ДР-4, docs/siege_v2.md, «Решения ДР-4», Ш6–Ш7; правило «scars» — docs/security.md, раздел 1;
// docs/trust-boundary.md).
//
// Сервер хранит, а не судит, и черт клиента не берёт: его журнал — метки боёв войны, которые он посчитал и записал сам
// (`WarBattle.marks`), а черты — та же чистая функция от журнала, что в игре (`scarrules.scarsOf`), с полководцем из книги агентов.
// Записи войн чистятся, поэтому книга держит метки боёв игрока у себя (`WatchRecord.scars`, не больше `SCAR_LOG`), по номеру боя;
// в минуту боя к ним добавляются метки из нынешней записи войн, которых книга ещё не видела (`scarsAt`).
//
// Опись несёт черты клиента (`WatchCard.scars`) — их сервер только сверяет (`scarFaults`): черта не из таблицы, больше
// `SCARS_MAX`, обе черты одной темы; бой войны, которого у сервера нет; черты войны не те, что выводит сервер из своих меток тех же
// боёв. Бои с логовами и у своих ворот серверу не видны (Ш7, «открыто») — в войну черты из них не идут.
//
// Чистая: без хранилища и без часов.
import type { WarFile } from './war.js';
import type { WatchScars } from './contract.js';
import { castleIdOf } from './roster.js';
import { SCARS_MAX, SCAR_BY_ID, SCAR_LOG, isScarId, readMark, scarsOf, type FightMark, type ScarId } from '../../src/game/scarrules.js';

/** Книга черт: метки боёв войны игрока по минуте сервера, у каждой — номер и минута боя (`FightMark.war`). */
export interface ScarBook {
  marks: FightMark[];
}

/** Порядок журнала войны: по минуте сервера, при равной — по номеру боя. */
function byWar(a: FightMark, b: FightMark): number {
  const x = a.war!;
  const y = b.war!;
  return x.at - y.at || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
}

/** Метки игрока `key` во всех боях записи войн: поход — `atk`, город — `def`, союзник выручки — `ally`. */
export function warMarksOf(file: WarFile | null | undefined, key: string): FightMark[] {
  if (!file) return [];
  const me = castleIdOf(key);
  const out: FightMark[] = [];
  for (const w of file.wars) {
    for (const b of w.battles ?? []) {
      const m = w.atk === key ? b.marks?.atk : w.def === key ? b.marks?.def : b.ally === me ? b.marks?.ally : undefined;
      const read = m ? readMark({ ...m, war: { id: b.id, at: b.at } }) : null;
      if (read) out.push(read);
    }
  }
  return out;
}

/** Книга и записи войн вместе: по номеру боя без повторов, по порядку, не больше `SCAR_LOG` последних. */
function merged(book: ScarBook | undefined, file: WarFile | null | undefined, key: string): FightMark[] {
  const seen = new Set<string>();
  const all: FightMark[] = [];
  for (const m of [...(book?.marks ?? []), ...warMarksOf(file, key)]) {
    const id = m.war?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    all.push(m);
  }
  return all.sort(byWar).slice(-SCAR_LOG);
}

/** Книга после записи партии: метки новых боёв игрока из записи войн — в книгу (`WatchRecord.scars`). Пусто — нет книги. */
export function scarBookAfter(book: ScarBook | undefined, file: WarFile | null | undefined, key: string): ScarBook | undefined {
  const marks = merged(book, file, key);
  return marks.length > 0 ? { marks } : undefined;
}

/**
 * Черты армии игрока в войну (Ш6): книга и метки нынешней записи войн, полководец — по книге агентов (`gen`; неизвестен — смена
 * полководца черт не снимает). Ни одной — пусто.
 */
export function scarsAt(book: ScarBook | undefined, file: WarFile | null | undefined, key: string, gen?: number): ScarId[] {
  return scarsOf(merged(book, file, key), gen).map((h) => h.id);
}

/** Книга из записи наблюдения; нет или пусто — `undefined`. */
export function readScarBook(v: unknown): ScarBook | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const marks = Array.isArray(r.marks)
    ? r.marks.map(readMark).filter((m): m is FightMark => m !== null && m.war !== undefined).sort(byWar).slice(-SCAR_LOG)
    : [];
  return marks.length > 0 ? { marks } : undefined;
}

/**
 * Подделки в описи (Ш7): что клиент назвал против того, что правило черт и журнал сервера допускают. Сервер этими чертами не
 * пользуется — флаг для журнала города. `gen` — полководец книги агентов; неизвестен — черт войны не сверяют (их снимает смена
 * полководца, которой сервер тогда не видит).
 */
export function scarFaults(card: WatchScars | undefined, book: ScarBook | undefined, gen?: number): string[] {
  if (!card) return [];
  const out: string[] = [];
  const unknown = card.held.filter((id) => !isScarId(id));
  if (unknown.length > 0) out.push(`черты не из таблицы: ${unknown.map((x) => `«${x}»`).join(', ')}`);
  if (card.held.length > SCARS_MAX) out.push(`черт названо ${card.held.length} — больше ${SCARS_MAX}`);
  const known = card.held.filter(isScarId);
  for (const a of known) {
    const b = known.find((x) => x !== a && SCAR_BY_ID[x].theme === SCAR_BY_ID[a].theme && SCAR_BY_ID[x].good !== SCAR_BY_ID[a].good);
    if (b && SCAR_BY_ID[a].good) out.push(`обе черты одной темы: «${SCAR_BY_ID[a].name}» и «${SCAR_BY_ID[b].name}»`);
  }
  const marks = book?.marks ?? [];
  const have = new Map(marks.map((m) => [m.war!.id, m]));
  const strange = card.war.filter((id) => !have.has(id));
  if (strange.length > 0) out.push(`бои войны, которых у сервера нет: ${strange.slice(0, 3).join(', ')}${strange.length > 3 ? '…' : ''}`);
  else if (gen !== undefined) {
    const ids = new Set(card.war);
    const own = scarsOf(marks.filter((m) => ids.has(m.war!.id)), gen).map((h) => h.id);
    const told = [...card.warHeld].sort();
    if (own.slice().sort().join(',') !== told.join(',')) {
      const words = (xs: string[]): string => (xs.length ? xs.map((x) => (isScarId(x) ? `«${SCAR_BY_ID[x].name}»` : `«${x}»`)).join(', ') : 'никаких');
      out.push(`черты в войне названы ${words(told)}, а по боям войны выходят ${words(own)}`);
    }
  }
  return out;
}
