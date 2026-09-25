// Общее разделов бывшего `raid:report`: миры, печать и счёт прогона. Вынесено из
// `raid-lair-growth.ts` переносом, без правки: разделы разведены по отчётам (docs/realm.md, раздел 8),
// и сосед, бравший отсюда `pad`, не должен тянуть в своё замыкание весь «Рост логова».
import { HOUR, MIN, type Run } from './autopilot';

export const SEEDS = [7, 11, 42, 51, 77];
export const NEW_SEEDS = SEEDS.slice(0, 3);

export const pad = (v: string | number, w: number): string => String(v).padStart(w);
export const pct = (x: number): string => `${Math.round(x * 100)}%`;
export const hm = (ms: number): string => {
  const m = Math.round(ms / MIN);
  return m >= 60 ? `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')}` : `${m} мин`;
};
export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]): number => (xs.length ? sum(xs) / xs.length : 0);
export const q = (xs: number[], p: number): number => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
export const range = (xs: number[]): string => (xs.length ? `${pct(q(xs, 0.1))}…${pct(q(xs, 0.5))}…${pct(q(xs, 0.9))}` : '—');

/** С какого числа бойцов дома доля павших в бою что-то значит. */
const SHARE_FLOOR = 10;

export function tally(runs: Run[], hours: number) {
  const walls = runs.flatMap((r) => r.walls);
  const broke = walls.filter((x) => !x.held).length;
  const falls = sum(runs.map((r) => r.siegeFalls));
  const sieges = sum(runs.map((r) => r.sieges));
  return {
    raids: sum(runs.map((r) => r.raids)),
    ratio: range(runs.flatMap((r) => r.ratio)),
    walls: walls.length,
    broke: walls.length ? pct(broke / walls.length) : '—',
    sieges,
    siegeShare: walls.length + sieges ? pct(sieges / (walls.length + sieges)) : '—',
    sorties: `${sum(runs.map((r) => r.sortieWins))} из ${sum(runs.map((r) => r.sorties))}`,
    falls,
    perHour: ((broke + falls) / (hours * runs.length)).toFixed(2),
    held: range(walls.filter((x) => x.held && x.home >= SHARE_FLOOR).map((x) => x.lost / x.home)),
    half: pct(sum(runs.map((r) => r.half)) / (hours * HOUR * runs.length)),
    armyEnd: Math.round(mean(runs.map((r) => r.armyEnd))),
    lost: sum(runs.map((r) => r.lost)),
    hired: sum(runs.map((r) => r.hired)),
    first: runs.filter((r) => r.losses.length).map((r) => r.losses[0]),
    hunger: runs.flatMap((r) => r.hunger),
  };
}
