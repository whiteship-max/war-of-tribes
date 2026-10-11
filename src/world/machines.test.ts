// Осадные машины из древесины лагеря (docs/siege_v2.md, 4.3–4.4): очередь, готовность, трата на штурм, камнемёт к кости.
import { describe, expect, it } from 'vitest';
import { assaultOf, mangonelAt, machineAfter, machineBlock, machinesAt, machinesSpent, stormMachines, type MachineWindow } from './machines';
import { MACHINE_IDS, MACHINE_WOOD, MOD_MACHINE, STORM_MACHINES } from './data/machines';
import { CAMP_WORKS_RIPE, PLAYER_CAMP_WOOD } from './data/tuning';
import { machineShare, machineWood, playerWood, rebaseWood, sideWorks, woodShare } from './works';
import { modsOf, phaseAt } from './siegeroll';
import { SIEGE_PHASE } from './data/siegeroll';
import type { SiegeWindow } from './siege';
import { WAR_MACHINES, WAR_MACHINE_SHARES } from '../../netlify/lib/contract';
import { MACHINE_SHARES } from './data/machines';

const T0 = 1_000_000;
/** Лагерь игрока: половина леса машинам. */
const camp = (machines = 0.5, over: Partial<MachineWindow> = {}): MachineWindow => ({ startedAt: T0, wood: playerWood(1, machines), ...over });
/** Минута, к которой лагерь нарубит машинам `need` сторон при доле `machines`. */
const after = (need: number, machines: number): number => T0 + (need / (machines * PLAYER_CAMP_WOOD)) * CAMP_WORKS_RIPE;

describe('древесина делится между рогатками и машинами', () => {
  it('доля машинам отнимается у рогаток: фронт дозревает во столько раз дольше, во сколько меньше ему леса', () => {
    for (const e of [0.25, 0.5, 0.75]) {
      const at = T0 + CAMP_WORKS_RIPE / 2;
      expect(sideWorks(T0, at, 'front', playerWood(1, e))).toBeCloseTo(sideWorks(T0, at, 'front', playerWood(1)) * (1 - e), 9);
      expect(machineWood(T0, at, playerWood(1, e))).toBeCloseTo((e * PLAYER_CAMP_WOOD) / 2, 9);
      expect(machineShare(playerWood(0.5, e))).toBeCloseTo(e, 9);
      expect(woodShare(playerWood(0.5, e))).toBe(0.5);
    }
  });

  it('смена долей не переписывает прошлое: нарубленное машинам к минуте смены остаётся', () => {
    const plan = playerWood(1, 0.5);
    const at = T0 + CAMP_WORKS_RIPE / 4;
    const cut = machineWood(T0, at, plan);
    expect(cut, 'точка внутри области: к минуте смены что-то нарублено').toBeGreaterThan(0);
    const next = rebaseWood(T0, at, plan, 1, 0);
    expect(machineWood(T0, at, next)).toBeCloseTo(cut, 9);
    expect(machineWood(T0, at + CAMP_WORKS_RIPE, next)).toBeCloseTo(cut, 9);
    expect(sideWorks(T0, at, 'front', next)).toBeCloseTo(sideWorks(T0, at, 'front', plan), 9);
  });
});

describe('очередь машин', () => {
  it('машина готова, когда на неё нарублено: срок — её древесина на долю лагеря', () => {
    for (const id of MACHINE_IDS) {
      const w = camp(0.5, { machines: [{ id, at: T0 }] });
      const ready = after(MACHINE_WOOD[id], 0.5);
      expect(machinesAt(w, ready - 1)[0].ready).toBe(false);
      expect(machinesAt(w, ready + 1)[0].ready).toBe(true);
    }
  });

  it('очередь, а не склад: вторая машина ждёт древесины на обе', () => {
    const w = camp(0.5, { machines: [{ id: 'ram', at: T0 }, { id: 'ladders', at: T0 }] });
    const both = after(MACHINE_WOOD.ram + MACHINE_WOOD.ladders, 0.5);
    expect(machinesAt(w, both - 1)[1].ready).toBe(false);
    expect(machinesAt(w, both + 1)[1].ready).toBe(true);
  });

  it('заказанная позже нарубленного — готова в минуту заказа, не раньше', () => {
    const late = T0 + CAMP_WORKS_RIPE;
    const w = camp(0.5, { machines: [{ id: 'ladders', at: late }] });
    expect(machineWood(T0, late, w.wood), 'точка внутри области: древесины на лестницы уже хватает').toBeGreaterThan(MACHINE_WOOD.ladders);
    expect(machinesAt(w, late - 1)[0].ready).toBe(false);
    expect(machinesAt(w, late)[0].ready).toBe(true);
  });

  it('леса машинам нет — не строится никогда', () => {
    const w = camp(0, { machines: [{ id: 'ladders', at: T0 }] });
    expect(machinesAt(w, T0 + 100 * CAMP_WORKS_RIPE)[0].readyAt).toBe(Infinity);
  });

  it('штурм тратит пущенные машины — по одной каждого рода; древесина не возвращается', () => {
    const w = camp(1, { machines: [{ id: 'ladders', at: T0 }, { id: 'ram', at: T0 }, { id: 'mangonel', at: T0 }] });
    const at = after(MACHINE_WOOD.ladders + MACHINE_WOOD.ram + MACHINE_WOOD.mangonel, 1) + 1;
    expect(stormMachines(w, at)).toEqual(['ladders', 'ram']);
    expect(stormMachines(w, at, ['ram'])).toEqual(['ram']);
    const spent = { ...w, machines: machinesSpent(w, at, ['ram']) };
    expect(stormMachines(spent, at + 1)).toEqual(['ladders']);
    // Новый таран — в конец очереди: древесину истраченного он не берёт.
    const again = { ...spent, machines: machineAfter(spent, 'ram', at + 1) };
    expect(machinesAt(again, at + 2)[3].ready).toBe(false);
  });

  it('камнемёт штурмом не тратится и камнемёт не штурмовая машина', () => {
    expect(STORM_MACHINES).not.toContain('mangonel');
    const w = camp(1, { machines: [{ id: 'mangonel', at: T0 }] });
    const at = after(MACHINE_WOOD.mangonel, 1) + 1;
    expect(stormMachines(w, at)).toEqual([]);
    expect(mangonelAt({ ...w, machines: machinesSpent(w, at, ['mangonel']) }, at + 1)).toBe(true);
  });

  it('заказать можно не больше одной машины рода; без стены — только камнемёт', () => {
    const w = camp(0.5, { machines: [{ id: 'ram', at: T0 }] });
    expect(machineBlock(w, 'ram', T0 + 1, true)).toMatch(/строится/);
    expect(machineBlock(w, 'tower', T0 + 1, true)).toBeNull();
    for (const id of STORM_MACHINES) expect(machineBlock(camp(), id, T0, false)).toMatch(/нет стены/);
    expect(machineBlock(camp(), 'mangonel', T0, false)).toBeNull();
  });

  it('проёмы штурма — из пущенных машин', () => {
    expect(assaultOf(2, ['ladders', 'tower'])).toEqual({ breaches: 2, ladders: true, tower: true });
    expect(assaultOf(0, [])).toEqual({ breaches: 0 });
  });
});

describe('камнемёт — +1 к кости каждой фазы (siegeroll.modsOf)', () => {
  const window = (machines: MachineWindow['machines']): SiegeWindow =>
    ({
      byId: 'x',
      campId: 'c',
      startedAt: T0,
      foodAtStart: 1e6,
      garrisonAtStart: 10,
      townPerHour: 1,
      perManPerHour: 0,
      wood: playerWood(1, 1),
      machines,
    }) as unknown as SiegeWindow;

  it('стоит к минуте фазы — поправка есть; не достроен — нет', () => {
    const w = window([{ id: 'mangonel', at: T0 }]);
    const ready = after(MACHINE_WOOD.mangonel, 1);
    const k = Math.ceil((ready - T0) / SIEGE_PHASE);
    expect(phaseAt(T0, k), 'точка внутри области: фаза k — после готовности').toBeGreaterThanOrEqual(ready);
    expect(phaseAt(T0, k - 1), 'точка внутри области: фаза k−1 — до неё').toBeLessThan(ready);
    expect(modsOf(w, k).machine).toBe(MOD_MACHINE);
    expect(modsOf(w, k - 1).machine).toBeUndefined();
    expect(modsOf(window(undefined), k).machine).toBeUndefined();
  });
});

describe('договор с сервером', () => {
  it('машины и доли древесины у сервера те же, что у мира', () => {
    expect([...WAR_MACHINES]).toEqual([...MACHINE_IDS]);
    expect([...WAR_MACHINE_SHARES]).toEqual([...MACHINE_SHARES]);
  });
});
