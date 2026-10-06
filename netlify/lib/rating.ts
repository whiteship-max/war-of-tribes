/**
 * Рейтинг игроков (docs/rating.md): место, очки, мощь, жители, победы и взятые города всех игроков мира. Один счёт на
 * экран рейтинга (`routes/rating.ts`) и на итоговую рассылку админа (`/final`, `commands.ts`).
 *
 * **Очки считает сервер, клиент их не присылает.** Мощь — из описи наблюдения (`WatchCard`: уровни построек и войско)
 * той же формулой, что игра (`profile/power.powerOfCounts`); цифра мощи из описи партии (`SaveCard.power`) в рейтинг не
 * идёт вовсе. Победы и взятые города — из записи войн (`war.warTally`), которую пишет только сервер войны. Жители — из
 * описи наблюдения.
 *
 * Кто в рейтинге — замки реестра этой эпохи. Замороженного нет: заморозка — подозрение в подделке, и чужое место он
 * занимать не должен.
 */
import { cityOr, ratingPoints, type RatingRow } from './contract.js';
import { ROSTER_KEY, castleIdOf, readRoster } from './roster.js';
import { WARS_KEY, readWars, warTally } from './war.js';
import { readWatchRecord, type WatchRecord } from './watch.js';
import { frozenNow, isFrozen } from './admin.js';
import { parseJson } from './http.js';
import { STORES, type Stores } from './kv.js';
import { powerOfCounts } from '../../src/profile/power.js';

/** Строка рейтинга с ключом игрока: ключ нужен рассылке, наружу он не уходит (`publicRow`). */
export interface Ranked extends RatingRow {
  key: string;
}

/** Мощь по описи наблюдения: уровни построек и войско. Описи нет — ноль: числу клиента рейтинг не верит. */
export const cardPower = (rec: WatchRecord): number => (rec.card ? powerOfCounts(rec.card.buildings, rec.card.troops) : 0);

/**
 * Места по очкам. Равные очки делят место («1, 1, 3»); внутри равных — выше мощь, потом имя города, чтобы порядок не
 * прыгал между запросами.
 */
export function rank(rows: Omit<Ranked, 'place'>[]): Ranked[] {
  const sorted = [...rows].sort((a, b) => b.points - a.points || b.power - a.power || a.city.localeCompare(b.city, 'ru') || a.id.localeCompare(b.id));
  let place = 0;
  return sorted.map((r, i) => {
    if (i === 0 || sorted[i - 1].points !== r.points) place = i + 1;
    return { ...r, place };
  });
}

/** Рейтинг всех игроков мира сейчас. */
export async function ratingNow(stores: Stores): Promise<Ranked[]> {
  const world = stores(STORES.world, 'eventual');
  const rosterFound = await world.getWithMetadata(ROSTER_KEY);
  const roster = readRoster(rosterFound ? parseJson(String(rosterFound.data)) : null);
  const warsFound = await world.getWithMetadata(WARS_KEY);
  const tally = warTally(readWars(warsFound ? parseJson(String(warsFound.data)) : null));
  const frozen = await frozenNow(stores);

  const keys = Object.keys(roster.rows).filter((k) => !isFrozen(frozen, k));
  const watch = stores(STORES.watch, 'eventual');
  const recs = new Map<string, WatchRecord>();
  // Пачками: игроков теста — десятки, реестр не больше `ROSTER_MAX`.
  for (let i = 0; i < keys.length; i += 16) {
    await Promise.all(
      keys.slice(i, i + 16).map(async (key) => {
        const found = await watch.getWithMetadata(key);
        recs.set(key, readWatchRecord(found ? parseJson(String(found.data)) : null));
      }),
    );
  }

  return rank(
    keys.map((key) => {
      const row = roster.rows[key];
      const rec = recs.get(key) ?? readWatchRecord(null);
      const power = cardPower(rec);
      const won = tally[key]?.won ?? 0;
      const taken = tally[key]?.taken ?? 0;
      return {
        key,
        id: castleIdOf(key),
        x: row.x,
        y: row.y,
        city: cityOr(rec.card?.city || row.city),
        name: row.name,
        points: ratingPoints(power, won, taken),
        power,
        pop: rec.card?.pop ?? 0,
        won,
        taken,
      };
    }),
  );
}

/** Строка наружу: без ключа игрока; своя — с отметкой. */
export function publicRow(r: Ranked, me: string): RatingRow {
  const { key, ...rest } = r;
  return key === me ? { ...rest, mine: true } : rest;
}
