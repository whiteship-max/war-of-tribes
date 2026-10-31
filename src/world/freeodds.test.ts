// ПН-Э2б (docs/gdd/path_of_sword.md, 23.9): окно «Что нужно, чтобы взять» вольный замок — настоящий шанс репетицией сервером войны
// при составе отряда, а не равенство мощи; гарнизон — тем, что видит отряд; «сколько нужно» — тем же составом.
//
// Область правил: строки пути (штурм, измор) — у отряда с бойцами у стен замка I; «видит» — стоящий отряд в круге обзора (`sight`,
// наблюдатель «отряд», 8.2 клетки), «не видит» — дальше круга или в пути. Каждая точка проверена утверждением на то, что она внутри.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { freeId, freeTroopPower, freeTroops } from './freecastle';
import { FREE_ODDS_SEEDS, freeAt, freeBar, freeChance, freeLook, freeNeeds, freeReady, freeSeen, freeWay, rehearse, scaleBand, type FreeNeedIn } from './freeodds';
import { watchRadius } from './sight';
import { SICILY } from './spawn';
import { troopPower } from '@/game/battle/price';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';

const CELL = SICILY[0];
const AT = freeAt(freeId(CELL.x, CELL.y), 1);
const GARRISON = freeTroops(AT.id, 1);
const G_POWER = freeTroopPower(AT.id, 1);
/** Отряд состава гарнизона ступени в `men` человек. */
const mirror = (men: number): TroopStack => scaleBand(GARRISON, men);
/** Копейщиков столько, чтобы мощь была не ниже `power`. */
const spears = (power: number): TroopStack => {
  let n = 1;
  while (troopPower({ spearman: n }) < power) n++;
  return { spearman: n };
};
const AT_WALLS = { x: CELL.x + 1, y: CELL.y };
const watching = freeLook(AT_WALLS, false, CELL);
const window = (band: TroopStack, look = watching): ReturnType<typeof freeNeeds> =>
  freeNeeds({ prestige: 10_000, at: AT, near: true, look, band, online: true } satisfies FreeNeedIn);
const row = (rows: ReturnType<typeof freeNeeds>, id: 'storm' | 'siege') => {
  const r = rows.find((x) => x.id === id);
  if (!r?.odds) throw new Error(`строки ${id} нет`);
  return r;
};
/** Шанс напрямую — числом репетиций сервером войны на сидах окна. */
const direct = (band: TroopStack, mode: 'storm' | 'siege', share = 1): number => {
  let won = 0;
  for (let s = 1; s <= FREE_ODDS_SEEDS; s++) if (rehearse(band, AT, mode, s, share).won) won++;
  return won / FREE_ODDS_SEEDS;
};

describe('ПН-Э2б: шанс — ядром осады, а не равенством мощи', () => {
  it('мощь отряда не ниже гарнизона, а репетиция замка не берёт — окно говорит «нет» и тот шанс, что дала репетиция', () => {
    // Точка внутри области прежнего правила «да»: мощь не ниже гарнизона, состав — гарнизона, отряд у стен и видит их.
    let men = 1;
    while (troopPower(mirror(men)) < G_POWER) men++;
    const band = mirror(men);
    expect(troopPower(band), 'точка внутри области: мощь не ниже гарнизона').toBeGreaterThanOrEqual(G_POWER);
    expect(watching.watching, 'точка внутри области: отряд видит стены').toBe(true);
    const rows = window(band);
    for (const mode of ['storm', 'siege'] as const) {
      const r = row(rows, mode);
      expect(r.odds!.chance[0], `${mode}: шанс — репетицией сервером войны`).toBe(direct(band, mode));
      expect(r.odds!.chance[0], `${mode}: равная мощь замок не берёт`).toBeLessThan(freeBar());
      expect(r.ok, `${mode}: «нет» при равной мощи`).toBe(false);
    }
    expect(freeReady(rows)).toBe(false);
    expect(freeWay(rows)).toBeNull();
  }, 120_000);

  it('«сколько нужно» — с этого числа шанс не ниже порога, и это больше людей, чем дала бы равная мощь', () => {
    const band = mirror(170);
    const need = row(window(band), 'siege').odds!.need[0];
    expect(need.need, 'составом гарнизона замок I измором берут').not.toBeNull();
    const n = need.need as number;
    expect(freeChance(mirror(n), AT, 'siege').chance, 'с «сколько нужно» — не ниже порога').toBeGreaterThanOrEqual(freeBar());
    let even = 1;
    while (troopPower(mirror(even)) < G_POWER) even++;
    expect(n, 'нужно больше людей, чем при равной мощи').toBeGreaterThan(even);
  }, 120_000);
});

describe('ПН-Э2б: окно считает состав отряда', () => {
  it('одна мощь, разный состав — разный шанс: состав гарнизона берёт, копейщики той же мощи — нет', () => {
    let men = 1;
    while (troopPower(mirror(men)) < 1.8 * G_POWER) men++;
    const a = mirror(men);
    const b = spears(troopPower(a));
    expect(troopPower(b) / troopPower(a), 'точка внутри области: мощь та же (до бойца)').toBeLessThan(1.02);
    const ra = row(window(a), 'siege');
    const rb = row(window(b), 'siege');
    expect(ra.ok, 'состав гарнизона при 1.8 мощи берёт измором').toBe(true);
    expect(rb.ok, 'копейщики той же мощи — нет').toBe(false);
    expect(rb.odds!.chance[0]).toBe(direct(b, 'siege'));
    // «Сколько нужно» — тем же составом: копейщиков нужно больше, чем людей состава гарнизона.
    expect(rb.odds!.need[0].need ?? Infinity).toBeGreaterThan(ra.odds!.need[0].need as number);
  }, 120_000);
});

describe('ПН-Э2б: окно видит только то, что видит отряд', () => {
  it('стоящий отряд в круге обзора видит гарнизон точкой; дальше круга или в пути — вилкой вниз от правила ступени', () => {
    const r = watchRadius({ kind: 'band', at: AT_WALLS });
    const far = { x: CELL.x + Math.ceil(r) + 1, y: CELL.y };
    expect(Math.hypot(far.x - CELL.x, far.y - CELL.y), 'точка внутри области: дальше круга обзора').toBeGreaterThan(r);
    expect(freeLook(AT_WALLS, false, CELL)).toEqual({ watching: true, spread: 0 });
    expect(freeLook(far, false, CELL).watching, 'дальше круга — не видит').toBe(false);
    expect(freeLook(AT_WALLS, true, CELL).watching, 'в пути отряд не наблюдает (ГДД 3.5.4)').toBe(false);
    expect(freeLook(null, false, CELL).watching).toBe(false);
    const seen = freeSeen(AT, freeLook(far, false, CELL));
    expect(seen.hi, 'верх вилки — правило ступени').toBe(troopTotal(GARRISON));
    expect(seen.lo).toBeLessThan(seen.hi);
    expect(freeSeen(AT, watching)).toMatchObject({ lo: troopTotal(GARRISON), hi: troopTotal(GARRISON) });
  });

  it('издали — шанс вилкой; «да» — только если порог держится при любом гарнизоне из вилки', () => {
    // Точка внутри области: при правиле ступени шанс ниже порога, при нижнем крае вилки — не ниже (у самой границы взятия).
    const far = freeLook({ x: CELL.x + 20, y: CELL.y }, false, CELL);
    let men = 1;
    while (direct(mirror(men), 'siege', 1 - far.spread) < freeBar()) men += 5;
    const band = mirror(men);
    expect(direct(band, 'siege'), 'точка внутри области: при правиле ступени — ниже порога').toBeLessThan(freeBar());
    const r = row(window(band, far), 'siege');
    expect(r.odds!.chance, 'шанс по краям вилки: худший — первым').toEqual([direct(band, 'siege'), direct(band, 'siege', 1 - far.spread)]);
    expect(r.odds!.chance[1]).toBeGreaterThanOrEqual(freeBar());
    expect(r.ok, 'нижний край вилки «да» не даёт').toBe(false);
    expect(r.odds!.need, '«сколько нужно» — по обоим краям').toHaveLength(2);
    expect(r.text).toMatch(/шанс \d+ %–\d+ %/);
    // Стоя у стен, тот же отряд видит гарнизон точкой — одна строка шанса.
    expect(row(window(band), 'siege').odds!.chance).toEqual([direct(band, 'siege')]);
  }, 180_000);

  it('окно мира бродяги — той же дверью: что видит отряд — по его клетке и ходу, шанс — по его составу', () => {
    const world = readFileSync(join(__dirname, 'local/RoamWorld.ts'), 'utf8');
    expect(world).toMatch(/freeLook\(at, !!m && roamMoving\(m\.way, now\)/);
    expect(world).toMatch(/freeNeedsSteps\(\{[^}]*band: r\?\.band/);
    const rules = readFileSync(join(__dirname, 'freecastle.ts'), 'utf8');
    expect(rules, 'строки силы равенством мощи больше нет').not.toMatch(/i\.band >= i\.garrison/);
    const odds = readFileSync(join(__dirname, 'freeodds.ts'), 'utf8');
    expect(odds, 'исход — сервер: окно в партию не пишет').not.toMatch(/from '@\/game\/sim\//);
  });
});
