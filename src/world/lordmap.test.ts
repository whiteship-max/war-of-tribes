// Карта лорда после ПН-3 — байт в байт как до неё (docs/gdd/path_of_sword.md, «Решения ПН-3»).
//
// ПН-3 правит мир, который рисует карту лорда каждую секунду: тип куска карты (`RegionChunk.ruins` — поле только мира бродяги),
// дверь режима марша (`readGait` переехал в данные) и `LocalWorld` (туман и вера стали доступны миру бродяги). Обещание задания —
// «партия и карта лорда — байт в байт как сейчас». Держит его отпечаток: мир лорда на месте острова, куски карты вокруг замка,
// фигуры и карточка своего города дают ту же запись, что на нетронутой `game/pn2` (`da4b47f`, второй worktree, тот же тест).
// Отпечаток снят там и вписан числом; сдвинется хоть одно поле — тест упадёт и назовёт оба. Сверяется дважды — с выключенным
// путём и с включённым (подмена модуля): мир лорда двери пути не спрашивает ни так, ни так.
//
// Граница области — утверждениями: в кусках правда есть поселения и разведанная земля, а руины вокруг — правда есть (их отдал бы
// мир бродяги), — иначе отпечаток мерил бы пустую карту, где руинам и неоткуда взяться.
import { describe, expect, it, vi } from 'vitest';

/** Отпечаток мира лорда, снятый на `game/pn2` `da4b47f` (второй worktree, тем же кодом теста). */
const BASE = '1bd891e9';

/** FNV-1a над строкой. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

const T0 = Date.UTC(2026, 9, 29, 12);

/** Мир лорда в свежем графе модулей: куски карты вокруг замка, фигуры, свой город. */
async function lordMap(): Promise<{ print: string; settlements: number; explored: number; ruinsNear: number }> {
  const { LocalWorld, HOME_ID } = await import('./local/LocalWorld');
  const { SICILY } = await import('./spawn');
  const home = SICILY[0];
  const w = new LocalWorld({ seed: 20261029, storage: null, now: () => T0, home });
  const parts: unknown[] = [await w.info(), await w.figures(), await w.settlement(HOME_ID)];
  let settlements = 0;
  let explored = 0;
  for (const [dx, dy] of [
    [-32, -32],
    [0, -32],
    [-32, 0],
    [0, 0],
  ]) {
    const c = await w.region({ x: home.x + dx, y: home.y + dy, w: 32, h: 32 });
    settlements += c.settlements.length;
    explored += c.explored.reduce((n, v) => n + v, 0);
    parts.push({ ...c, terrain: [...c.terrain], explored: [...c.explored], features: [...c.features], influence: [...c.influence] });
  }
  // Руины вокруг есть — их считает дверь руин (её читает только мир бродяги); у лорда в кусках их быть не должно.
  let ruinsNear = 0;
  try {
    const ruins = await import('./ruins');
    ruinsNear = ruins.ruinsIn(home.x - 32, home.y - 32, home.x + 32, home.y + 32).length;
  } catch {
    ruinsNear = -1;
  }
  return { print: fnv(JSON.stringify(parts)), settlements, explored, ruinsNear };
}

describe('карта лорда живёт как до ПН-3', () => {
  it('мир лорда даёт тот же отпечаток, что на game/pn2', async () => {
    vi.resetModules();
    const m = await lordMap();
    expect(m.settlements, 'в кусках есть поселения').toBeGreaterThan(0);
    expect(m.explored, 'и разведанная земля').toBeGreaterThan(100);
    expect(m.print).toBe(BASE);
  });

  it('и при включённом пути — мир лорда двери пути не спрашивает', async () => {
    vi.resetModules();
    vi.doMock('@/game/roamflag', () => ({ ROAM_ON: true, roamOpenFor: () => true, roamOn: () => true, setRoamOpen: () => {} }));
    const m = await lordMap();
    vi.doUnmock('@/game/roamflag');
    expect(m.ruinsNear, 'руины вокруг правда есть').toBeGreaterThan(0);
    expect(m.print).toBe(BASE);
  });
});
