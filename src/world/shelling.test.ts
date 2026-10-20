// Обстрел машинами и блокада (Р-5, docs/siege_v2.md, 21.1): чистые двери `world/shelling` и `world/blockade` и их место в
// кости фазы (`siegeroll.rollPhase`) — одной на мир и сервер войны. Область правил: машина стоит готовой к минуте фазы
// (утверждается), цель задана приказом с минутой раньше фазы, у города есть постройки.
import { afterEach, describe, expect, it } from 'vitest';
import { openSiege, type SiegeWindow } from './siege';
import { artilleryAt, gunAfter, gunBlock, gunReady, gunTarget, gunsAt, idleBuildings, lostLevel, machineFaces, phaseShots } from './shelling';
import { blockadeAfter, blockadeAt, blockadeBlock, blockadeHolds, blockadeSince } from './blockade';
import { machineAfter, machinesAt } from './machines';
import { modsOf, phaseAt, rollPhase, setPhaseDie, wasteOf, type SiegeDeed } from './siegeroll';
import { ARTILLERY_WEIGHT } from './data/machines';
import { GUN_SPAN, SHOT_HIT } from './data/shelling';
import { BLOCKADE_RATIO, MOD_BLOCKADE } from './data/blockade';
import { SIEGE_PHASE } from './data/siegeroll';

afterEach(() => setPhaseDie(null));

const T0 = 1_800_000_000_000;

/** Лагерь игрока под городом со стеной; всё дерево — машинам, чтобы машины вставали быстро. */
function camp(over: Partial<SiegeWindow> = {}): SiegeWindow {
  return {
    ...openSiege({
      byId: 'c-1',
      campId: 'w-1',
      now: T0,
      food: 1e6,
      garrison: 50,
      townPerHour: 10,
      perManPerHour: 1,
      wall: 4,
      wood: { front: 0, rear: 0, machines: 1 },
      log: [],
      targets: ['farm', 'smithy', 'mill'],
    }),
    ...over,
  };
}

/** Окно с готовыми машинами к минуте `at`: заказ в минуту постановки, лес — весь машинам. */
function armed(ids: ('mangonel' | 'trebuchet')[], over: Partial<SiegeWindow> = {}): SiegeWindow {
  let w = camp(over);
  for (const id of ids) w = { ...w, machines: machineAfter(w, id, T0) };
  return w;
}

const aim = (w: SiegeWindow, a: 'wall' | 'town' | 'engines', at = T0 + 1): SiegeWindow => ({ ...w, log: [...(w.log ?? []), { at, act: 'aim', aim: a } as SiegeDeed] });

describe('артиллерия лагеря: вес и цель', () => {
  it('по стенам — камнемёт +1, требушет +2 к кости фазы; по городу — ничего к кости', () => {
    const w = armed(['mangonel', 'trebuchet']);
    const late = T0 + 40 * SIEGE_PHASE;
    expect(artilleryAt(w, late), 'точка внутри области: обе машины стоят').toEqual(['mangonel', 'trebuchet']);
    expect(machineFaces(w, late)).toBe(ARTILLERY_WEIGHT.mangonel + ARTILLERY_WEIGHT.trebuchet);
    expect(machineFaces(aim(w, 'town'), late)).toBe(0);
    const k = 40;
    expect(modsOf(w, k).machine).toBe(3);
    expect(modsOf(aim(w, 'town'), k).machine).toBeUndefined();
  });

  it('требушет строится из леса лагеря дольше камнемёта: ½ стороны против ⅓', () => {
    const w = armed(['trebuchet']);
    const m = armed(['mangonel']);
    expect(machinesAt(w, T0)[0].readyAt).toBeGreaterThan(machinesAt(m, T0)[0].readyAt);
  });
});

describe('обстрел города: выстрелы, простой и уровень', () => {
  const late = T0 + 40 * SIEGE_PHASE;
  it('выстрелов — вес машины; попадание — кость не ниже 8; второе попадание в ту же постройку — уровень', () => {
    const w = aim(armed(['trebuchet']), 'town');
    expect(artilleryAt(w, late)).toEqual(['trebuchet']);
    const always = (b: number) => (tag: string) => (tag.endsWith('b') ? b : SHOT_HIT);
    const first = phaseShots(w, late, always(1), []);
    expect(first.shots).toHaveLength(ARTILLERY_WEIGHT.trebuchet);
    expect(first.shots.every((s) => s.hit && s.building === 'farm')).toBe(true);
    // Два попадания одной фазы в одну постройку: второе — уровень.
    expect(first.shots.map((s) => Boolean(s.lost))).toEqual([false, true]);
    const miss = phaseShots(w, late, (t) => (t.endsWith('b') ? 1 : SHOT_HIT - 1), []);
    expect(miss.shots.every((s) => !s.hit && !s.lost)).toBe(true);
    // Прошлая фаза уже попала один раз — в этой первое попадание второе за осаду.
    const once = phaseShots(aim(armed(['mangonel']), 'town'), late, always(1), [{ shots: [{ by: 'mangonel', hit: true, building: 'farm' }] }]);
    expect(once.shots).toEqual([{ by: 'mangonel', hit: true, building: 'farm', lost: true }]);
  });

  it('построек нет (логово) — по городу бить нечего; без машин — выстрелов нет', () => {
    expect(phaseShots(aim(armed(['trebuchet'], { targets: undefined }), 'town'), late, () => 14, []).shots).toEqual([]);
    expect(phaseShots(aim(camp(), 'town'), late, () => 14, []).shots).toEqual([]);
  });

  it('попавшая постройка стоит без работы до броска следующей фазы; уровень не ниже первого', () => {
    const rows = [{ at: T0 + SIEGE_PHASE, shots: [{ by: 'mangonel' as const, hit: true, building: 'mill' }] }];
    expect(idleBuildings(rows, T0 + SIEGE_PHASE, SIEGE_PHASE)).toEqual(['mill']);
    expect(idleBuildings(rows, T0 + 2 * SIEGE_PHASE - 1, SIEGE_PHASE)).toEqual(['mill']);
    expect(idleBuildings(rows, T0 + 2 * SIEGE_PHASE, SIEGE_PHASE)).toEqual([]);
    expect(lostLevel(1)).toBe(1);
    expect(lostLevel(5)).toBe(4);
  });
});

describe('требушет на стене: по лагерю и по машинам; артиллерия лагеря — по нему', () => {
  const late = T0 + 40 * SIEGE_PHASE;
  it('строится сроком требушета лагеря при всём лесе; один на стене; без стены — некуда', () => {
    const w = { ...camp(), guns: gunAfter(camp(), T0) };
    expect(gunsAt(w, T0)[0].readyAt).toBe(T0 + GUN_SPAN);
    expect(gunReady(w, T0 + GUN_SPAN - 1)).toBe(false);
    expect(gunReady(w, T0 + GUN_SPAN)).toBe(true);
    expect(gunBlock(w, T0)).toBe('Требушет на стене уже строят.');
    expect(gunBlock({ ...camp(), wall: undefined }, T0)).toBe('Стены нет — требушет ставить некуда.');
  });

  it('по лагерю — два выстрела; попадание — ещё доля истощения фазы', () => {
    const w = { ...camp(), guns: gunAfter(camp(), T0) };
    const s = phaseShots(w, late, () => SHOT_HIT, []);
    expect(s.gun).toEqual([{ by: 'gun', hit: true, camp: true }, { by: 'gun', hit: true, camp: true }]);
    // В броске фазы — та же дверь: истощение = доля фазы + доля за каждое попадание.
    setPhaseDie(() => 7);
    const k = 40;
    const row = rollPhase(w, k);
    const hits = (row.gun ?? []).filter((x) => x.hit && x.camp).length;
    expect(row.waste).toBeCloseTo(wasteOf(row.out, w.homeDays) + hits * wasteOf('calm', w.homeDays), 9);
  });

  it('по машинам — самая дорогая машина у стены; попадание её разбивает, второй выстрел — по следующей', () => {
    let w = armed(['mangonel', 'trebuchet']);
    w = { ...w, guns: gunAfter(w, T0), log: [{ at: T0 + 1, act: 'gunAim', aim: 'machines' }] };
    expect(gunTarget(w, late)).toBe('trebuchet');
    const s = phaseShots(w, late, (t) => (t.startsWith('gun') ? SHOT_HIT : 1), []);
    expect(s.gun).toEqual([{ by: 'gun', hit: true, machine: 'trebuchet' }, { by: 'gun', hit: true, machine: 'mangonel' }]);
  });

  it('артиллерия лагеря по машинам — по требушету на стене; первое попадание его разбивает', () => {
    let w = aim(armed(['trebuchet']), 'engines');
    w = { ...w, guns: gunAfter(w, T0) };
    const s = phaseShots(w, late, (t) => (t.startsWith('gun') ? 1 : SHOT_HIT), []);
    expect(s.shots).toEqual([{ by: 'trebuchet', hit: true, gun: true }]);
    // Требушета на стене нет — бить не по чему.
    expect(phaseShots(aim(armed(['trebuchet']), 'engines'), late, () => 14, []).shots).toEqual([]);
  });
});

describe('блокада: порог, кольцо и его прорыв', () => {
  it('кольцо держится от вчетверо и выше; ниже — нет', () => {
    expect(BLOCKADE_RATIO).toBe(4);
    expect(blockadeHolds(400, 100)).toBe(true);
    expect(blockadeHolds(399, 100)).toBe(false);
    expect(blockadeHolds(10, 0), 'гарнизона нет — держит').toBe(true);
  });

  it('замкнуть — только при пороге; прорванное — снова со следующей фазы; приказом — сразу', () => {
    const w = camp();
    expect(blockadeBlock(w, T0 + 10, 300, 100)).toMatch(/вчетверо/);
    expect(blockadeBlock(w, T0 + 10, 400, 100)).toBeNull();
    const on = { ...w, ...blockadeAfter(w, T0 + 10, true) };
    expect(blockadeAt(on, T0 + 9)).toBe(false);
    expect(blockadeAt(on, T0 + 10)).toBe(true);
    expect(blockadeSince(on, T0 + 20)).toBe(T0 + 10);
    expect(blockadeBlock(on, T0 + 11, 400, 100)).toBe('Кольцо и так замкнуто.');
    const broken = { ...on, ...blockadeAfter(on, T0 + 20, false, 'sortie') };
    expect(blockadeBlock(broken, T0 + 21, 400, 100)).toMatch(/следующей/);
    expect(blockadeBlock(broken, T0 + SIEGE_PHASE, 400, 100)).toBeNull();
    const opened = { ...on, ...blockadeAfter(on, T0 + 20, false, 'order') };
    expect(blockadeBlock(opened, T0 + 21, 400, 100)).toBeNull();
  });

  it('в кости фазы — +1, пока кольцо замкнуто в минуту броска', () => {
    const w = { ...camp(), ...blockadeAfter(camp(), T0 + 10, true) };
    expect(modsOf(w, 1).blockade).toBe(MOD_BLOCKADE);
    const off = { ...w, ...blockadeAfter(w, phaseAt(T0, 1) - 1, false, 'ratio') };
    expect(modsOf(off, 1).blockade).toBeUndefined();
  });
});
