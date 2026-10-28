// Пул вольных замков на карте (ГДД 6.4, 3.5.6): где встают вольные замки и бродяги и сколько бродяге идти до ближайшего.
//
// Места — правилом расселения замка (`world/settle.placeCastle`, одно на игру и сервер): вольный замок стоит только там, где
// может стоять замок, и его клетка выпадает из расселения (6.4) — он входит в список стоящих. Место выхода бродяги своего
// правила ещё не имеет (ПН-17): здесь оно — то же расселение с рамкой «не ближе `gap` клеток к замкам игроков» (вход
// `spawnGap`). Путь — дверью пути по земле между клетками (`geo.travelTime`, `terrainFactor`), обычным маршем полководца.
import { placeCastle, settleRandom, type Spot } from '../../src/world/settle';
import { distance, terrainFactor, travelTime } from '../../src/world/geo';
import { generalSpeed } from '../../src/world/pvp';
import { realMs } from '../../src/game/pace';

export interface Placed {
  lords: Spot[];
  free: Spot[];
  bands: Spot[];
  /** У каждого бродяги: клеток и настоящих часов до ближайшего вольного замка. */
  toFree: { cells: number; hours: number }[];
}

export function placeAll(run: number, lords: number, free: number, bands: number, gap: number): Placed {
  const taken: Spot[] = [];
  const put = (key: string, within?: (at: Spot) => boolean): Spot => {
    const at = placeCastle(settleRandom(`roam:${run}:${key}`), taken, within);
    taken.push(at);
    return at;
  };
  const L = Array.from({ length: lords }, (_, i) => put(`lord${i}`));
  const F = Array.from({ length: free }, (_, i) => put(`free${i}`));
  const far = (at: Spot): boolean => L.every((c) => distance(at, c) >= gap);
  const B = Array.from({ length: bands }, (_, i) => put(`band${i}`, lords > 0 ? far : undefined));
  const toFree = B.map((b) => {
    let best = F[0];
    for (const f of F) if (distance(b, f) < distance(b, best)) best = f;
    const cells = best ? distance(b, best) : NaN;
    const hours = best ? realMs(travelTime(cells, terrainFactor(run, b, best), generalSpeed('normal'))) / 3_600_000 : NaN;
    return { cells, hours };
  });
  return { lords: L, free: F, bands: B, toFree };
}
