// Блокада (Р-5, docs/siege_v2.md, 21.1): лагерь замыкает кольцо вокруг города. Одна дверь на мир на клиенте и на сервер
// войны — кто может замкнуть, когда кольцо держится и чем размыкается; отметки лежат журналом дел окна (`SiegeWindow.log`,
// `act: 'blockade'`) с минутой, и кость фазы читает кольцо задним числом (`siegeroll.modsOf`, +1).
//
// Модуль чистый, того же рода, что `siegecraft.ts`: ни состояния мира, ни часов, ни `Math.random`, и без `@/` — его
// собирает сервер. Мощь лагеря и гарнизона приносит тот, кто зовёт: мир считает её своими дверями, сервер — книгой войска.
//
// Что кольцо делает: добыча города — ноль (вместо ¼ осады, `game/derived.siegeYield`), караваны в ворота не входят, к кости
// фазы +1. Рынок, найм и выход из ворот закрыты уже осадой — кольцо их не закрывает второй раз. Размыкают кольцо: мощь
// лагеря ниже порога в минуту события (фаза, бой, смена гарнизона), вылазка «прорвать блокаду» — бой гарнизона с постом
// кольца (четвертью лагеря) в поле, удар по лагерю с поля (выручка союзника, удар полководца города). Замкнуть снова — со
// следующей фазы.
import type { SiegeWindow } from './siege';
import type { SiegeDeed } from './siegeroll';
import { BLOCKADE_POSTS, BLOCKADE_RATIO } from './data/blockade';
import { SIEGE_PHASE } from './data/siegeroll';
import { num } from '../game/num';

/** Чем кольцо разомкнуто: приказом лагеря, мощью ниже порога, вылазкой гарнизона, ударом с поля. */
export type BlockadeBreak = 'order' | 'ratio' | 'sortie' | 'relief';

type LogWindow = Pick<SiegeWindow, 'log' | 'startedAt' | 'sinceAt'>;

const since = (w: LogWindow): number => w.sinceAt ?? w.startedAt;

/** Отметки кольца в журнале окна, по минутам. */
export const blockadeDeeds = (w: Pick<SiegeWindow, 'log'>): SiegeDeed[] =>
  (w.log ?? []).filter((d) => d.act === 'blockade').sort((a, b) => a.at - b.at);

/** Замкнуто ли кольцо в минуту `at`: последняя отметка до неё. */
export function blockadeAt(w: Pick<SiegeWindow, 'log'>, at: number): boolean {
  let on = false;
  for (const d of blockadeDeeds(w)) if (d.at <= at) on = Boolean(d.on);
  return on;
}

/** С какой минуты кольцо замкнуто сейчас; не замкнуто — null. */
export function blockadeSince(w: Pick<SiegeWindow, 'log'>, at: number): number | null {
  let from: number | null = null;
  for (const d of blockadeDeeds(w)) if (d.at <= at) from = d.on ? (from ?? d.at) : null;
  return from;
}

/** Держит ли мощь кольцо: лагерь — не меньше `BLOCKADE_RATIO` мощностей гарнизона (без гарнизона — держит всегда). */
export const blockadeHolds = (campPower: number, garrisonPower: number): boolean =>
  Math.max(0, campPower) >= BLOCKADE_RATIO * Math.max(0, garrisonPower);

/** Во сколько раз лагерь сильнее гарнизона — для окна; гарнизона нет — бесконечность. */
export const blockadeRatio = (campPower: number, garrisonPower: number): number =>
  garrisonPower > 0 ? Math.max(0, campPower) / garrisonPower : Infinity;

/** Разомкнуто ли кольцо в этой фазе (не приказом): замкнуть снова — со следующей. */
function brokenThisPhase(w: LogWindow, at: number): boolean {
  const k = Math.floor(Math.max(0, at - since(w)) / SIEGE_PHASE);
  return blockadeDeeds(w).some((d) => !d.on && d.why !== 'order' && d.at <= at && Math.floor(Math.max(0, d.at - since(w)) / SIEGE_PHASE) === k);
}

/** Почему кольцо не замкнуть в минуту `at`; null — можно. */
export function blockadeBlock(w: LogWindow, at: number, campPower: number, garrisonPower: number): string | null {
  const busy = blockadeBusy(w, at);
  if (busy) return busy;
  if (!blockadeHolds(campPower, garrisonPower)) return `Для кольца лагерь должен быть вчетверо сильнее гарнизона: сейчас ${ratioWords(blockadeRatio(campPower, garrisonPower))}.`;
  return null;
}

/** Почему кольцо не замкнуть, не глядя на мощь: уже замкнуто или прорвано в этой фазе; null — мощь решит. */
export function blockadeBusy(w: LogWindow, at: number): string | null {
  if (blockadeAt(w, at)) return 'Кольцо и так замкнуто.';
  if (brokenThisPhase(w, at)) return 'Кольцо прорвали в этой фазе. Замкнуть снова — со следующей.';
  return null;
}

/** Выйдет ли кольцо, если гарнизон известен вилкой. */
export type RingOdds = 'yes' | 'no' | 'maybe';

/**
 * Выйдет ли кольцо при вилке соотношения сил (ОС-1в, `siegefood.RatioRange`): вся вилка не ниже порога — «удастся», вся ниже —
 * «не удастся», накрывает порог — зависит от гарнизона. Порог тот же, что у решения (`blockadeHolds`): решает сервер.
 */
export const ringOdds = (r: { lo: number; hi: number }): RingOdds => (r.lo >= BLOCKADE_RATIO ? 'yes' : r.hi < BLOCKADE_RATIO ? 'no' : 'maybe');

/** Окно после отметки кольца в минуту `at`: замкнуто или разомкнуто, и чем. */
export const blockadeAfter = (w: Pick<SiegeWindow, 'log'>, at: number, on: boolean, why?: BlockadeBreak): { log: SiegeDeed[] } => ({
  log: [...(w.log ?? []), { at, act: 'blockade', on, ...(!on && why ? { why } : {}) }],
});

/** Какая доля лагеря стоит постом у одних ворот, — с ним бьётся вылазка «прорвать блокаду» (`fights.machineFight`). */
export const BREAKOUT_SHARE = 1 / BLOCKADE_POSTS;

/** «×3,2», «больше вчетверо»: соотношение словами без процента исхода. */
export function ratioWords(r: number): string {
  if (!Number.isFinite(r)) return 'гарнизона нет';
  return `×${num(r)}`;
}

/** Что даёт кольцо — строкой окна (правило 18: слова о числах — этой дверью). */
export const BLOCKADE_GIVES = 'Добыча города — ноль, караваны не входят, кость фазы +1.';

/** Чем размыкают кольцо — строкой окна. */
export const BLOCKADE_BREAKS = 'Размыкают: мощь лагеря ниже вчетверо гарнизона, вылазка на пост кольца, удар по лагерю с поля.';

/** Что даст вылазка на пост кольца — строкой окна осаждённого. */
export const BREAKOUT_GIVES = 'Бой с постом кольца в поле, без рогаток. Победа размыкает кольцо: добыча и караваны снова идут, лагерь стоит и замкнуть его снова сможет со следующей фазы.';

/** Отметка «кольцо разомкнуто» словами: почему. */
export const BREAK_WORDS: Record<BlockadeBreak, string> = {
  order: 'лагерь разомкнул кольцо сам',
  ratio: 'лагерю не хватает мощи держать кольцо',
  sortie: 'вылазка прорвала кольцо',
  relief: 'удар с поля прорвал кольцо',
};
