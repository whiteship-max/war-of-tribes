// Пул вольных замков на карте (ГДД 6.4, 3.5.6): где встают вольные замки и бродяги и сколько бродяге идти до ближайшего.
//
// Места — правилом расселения замка (`world/settle.placeCastle`, одно на игру и сервер): вольный замок стоит только там, где
// может стоять замок, и его клетка выпадает из расселения (6.4) — он входит в список стоящих. Место выхода бродяги — дверь ПН-3
// (`world/roam.placeBand`, одна на сервер и игру): у руин или опушки, не ближе заглушки `spawnGap` к замкам игроков и к другим
// новичкам. Путь — путь отряда (`world/roam.roamWalkMs`: дорога похода войны по земле) во всех трёх режимах марша.
import { placeCastle, settleRandom, type Spot } from '../../src/world/settle';
import { distance } from '../../src/world/geo';
import { placeBand, roamWalkMs } from '../../src/world/roam';
import { GAITS, type Gait } from '../../src/world/data/gait';

export interface Placed {
  lords: Spot[];
  free: Spot[];
  bands: Spot[];
  /** У каждого бродяги: клеток и настоящих часов по режиму марша до ближайшего вольного замка. */
  toFree: { cells: number; hours: Record<Gait, number> }[];
}

export function placeAll(run: number, lords: number, free: number, bands: number): Placed {
  const taken: Spot[] = [];
  const put = (key: string): Spot => {
    const at = placeCastle(settleRandom(`roam:${run}:${key}`), taken);
    taken.push(at);
    return at;
  };
  const L = Array.from({ length: lords }, (_, i) => put(`lord${i}`));
  const F = Array.from({ length: free }, (_, i) => put(`free${i}`));
  // Бродяги — новичками друг для друга: каждый следующий встаёт вдали от уже вышедших (реестр — `roster.newcomersOf`).
  const B: Spot[] = [];
  for (let i = 0; i < bands; i++) B.push(placeBand(settleRandom(`roam:${run}:band${i}`), L, B));
  const toFree = B.map((b) => {
    let best = F[0];
    for (const f of F) if (distance(b, f) < distance(b, best)) best = f;
    const cells = best ? distance(b, best) : NaN;
    const hours = Object.fromEntries(GAITS.map((g) => [g, best ? roamWalkMs(b, best, g) / 3_600_000 : NaN])) as Record<Gait, number>;
    return { cells, hours };
  });
  return { lords: L, free: F, bands: B, toFree };
}
