// Осадные машины из древесины лагеря (docs/siege_v2.md, 4.3–4.4): очередь, готовность, трата на штурм, камнемёт к кости.
import { describe, expect, it } from 'vitest';
import { assaultOf, catapultAt, engineAfter, engineBlock, enginesAt, enginesSpent, stormEngines, type EngineWindow } from './engines';
import { ENGINE_IDS, ENGINE_WOOD, MOD_ENGINE, STORM_ENGINES } from './data/engines';
import { CAMP_WORKS_RIPE, PLAYER_CAMP_WOOD } from './data/tuning';
import { engineShare, engineWood, playerWood, rebaseWood, sideWorks, woodShare } from './works';
import { modsOf, phaseAt } from './siegeroll';
import { SIEGE_PHASE } from './data/siegeroll';
import type { SiegeWindow } from './siege';
import { WAR_ENGINES, WAR_ENGINE_SHARES } from '../../netlify/lib/contract';
import { ENGINE_SHARES } from './data/engines';

const T0 = 1_000_000;
/** Лагерь игрока: половина леса машинам. */
const camp = (engines = 0.5, over: Partial<EngineWindow> = {}): EngineWindow => ({ startedAt: T0, wood: playerWood(1, engines), ...over });
/** Минута, к которой лагерь нарубит машинам `need` сторон при доле `engines`. */
const after = (need: number, engines: number): number => T0 + (need / (engines * PLAYER_CAMP_WOOD)) * CAMP_WORKS_RIPE;

describe('древесина делится между рогатками и машинами', () => {
  it('доля машинам отнимается у рогаток: фронт дозревает во столько раз дольше, во сколько меньше ему леса', () => {
    for (const e of [0.25, 0.5, 0.75]) {
      const at = T0 + CAMP_WORKS_RIPE / 2;
      expect(sideWorks(T0, at, 'front', playerWood(1, e))).toBeCloseTo(sideWorks(T0, at, 'front', playerWood(1)) * (1 - e), 9);
      expect(engineWood(T0, at, playerWood(1, e))).toBeCloseTo((e * PLAYER_CAMP_WOOD) / 2, 9);
      expect(engineShare(playerWood(0.5, e))).toBeCloseTo(e, 9);
      expect(woodShare(playerWood(0.5, e))).toBe(0.5);
    }
  });

  it('смена долей не переписывает прошлое: нарубленное машинам к минуте смены остаётся', () => {
    const plan = playerWood(1, 0.5);
    const at = T0 + CAMP_WORKS_RIPE / 4;
    const cut = engineWood(T0, at, plan);
    expect(cut, 'точка внутри области: к минуте смены что-то нарублено').toBeGreaterThan(0);
    const next = rebaseWood(T0, at, plan, 1, 0);
    expect(engineWood(T0, at, next)).toBeCloseTo(cut, 9);
    expect(engineWood(T0, at + CAMP_WORKS_RIPE, next)).toBeCloseTo(cut, 9);
    expect(sideWorks(T0, at, 'front', next)).toBeCloseTo(sideWorks(T0, at, 'front', plan), 9);
  });
});

describe('очередь машин', () => {
  it('машина готова, когда на неё нарублено: срок — её древесина на долю лагеря', () => {
    for (const id of ENGINE_IDS) {
      const w = camp(0.5, { engines: [{ id, at: T0 }] });
      const ready = after(ENGINE_WOOD[id], 0.5);
      expect(enginesAt(w, ready - 1)[0].ready).toBe(false);
      expect(enginesAt(w, ready + 1)[0].ready).toBe(true);
    }
  });

  it('очередь, а не склад: вторая машина ждёт древесины на обе', () => {
    const w = camp(0.5, { engines: [{ id: 'ram', at: T0 }, { id: 'ladders', at: T0 }] });
    const both = after(ENGINE_WOOD.ram + ENGINE_WOOD.ladders, 0.5);
    expect(enginesAt(w, both - 1)[1].ready).toBe(false);
    expect(enginesAt(w, both + 1)[1].ready).toBe(true);
  });

  it('заказанная позже нарубленного — готова в минуту заказа, не раньше', () => {
    const late = T0 + CAMP_WORKS_RIPE;
    const w = camp(0.5, { engines: [{ id: 'ladders', at: late }] });
    expect(engineWood(T0, late, w.wood), 'точка внутри области: древесины на лестницы уже хватает').toBeGreaterThan(ENGINE_WOOD.ladders);
    expect(enginesAt(w, late - 1)[0].ready).toBe(false);
    expect(enginesAt(w, late)[0].ready).toBe(true);
  });

  it('леса машинам нет — не строится никогда', () => {
    const w = camp(0, { engines: [{ id: 'ladders', at: T0 }] });
    expect(enginesAt(w, T0 + 100 * CAMP_WORKS_RIPE)[0].readyAt).toBe(Infinity);
  });

  it('штурм тратит пущенные машины — по одной каждого рода; древесина не возвращается', () => {
    const w = camp(1, { engines: [{ id: 'ladders', at: T0 }, { id: 'ram', at: T0 }, { id: 'catapult', at: T0 }] });
    const at = after(ENGINE_WOOD.ladders + ENGINE_WOOD.ram + ENGINE_WOOD.catapult, 1) + 1;
    expect(stormEngines(w, at)).toEqual(['ladders', 'ram']);
    expect(stormEngines(w, at, ['ram'])).toEqual(['ram']);
    const spent = { ...w, engines: enginesSpent(w, at, ['ram']) };
    expect(stormEngines(spent, at + 1)).toEqual(['ladders']);
    // Новый таран — в конец очереди: древесину истраченного он не берёт.
    const again = { ...spent, engines: engineAfter(spent, 'ram', at + 1) };
    expect(enginesAt(again, at + 2)[3].ready).toBe(false);
  });

  it('камнемёт штурмом не тратится и камнемёт не штурмовая машина', () => {
    expect(STORM_ENGINES).not.toContain('catapult');
    const w = camp(1, { engines: [{ id: 'catapult', at: T0 }] });
    const at = after(ENGINE_WOOD.catapult, 1) + 1;
    expect(stormEngines(w, at)).toEqual([]);
    expect(catapultAt({ ...w, engines: enginesSpent(w, at, ['catapult']) }, at + 1)).toBe(true);
  });

  it('заказать можно не больше одной машины рода; без стены — только камнемёт', () => {
    const w = camp(0.5, { engines: [{ id: 'ram', at: T0 }] });
    expect(engineBlock(w, 'ram', T0 + 1, true)).toMatch(/строится/);
    expect(engineBlock(w, 'tower', T0 + 1, true)).toBeNull();
    for (const id of STORM_ENGINES) expect(engineBlock(camp(), id, T0, false)).toMatch(/нет стены/);
    expect(engineBlock(camp(), 'catapult', T0, false)).toBeNull();
  });

  it('проёмы штурма — из пущенных машин', () => {
    expect(assaultOf(2, ['ladders', 'tower'])).toEqual({ breaches: 2, ladders: true, tower: true });
    expect(assaultOf(0, [])).toEqual({ breaches: 0 });
  });
});

describe('камнемёт — +1 к кости каждой фазы (siegeroll.modsOf)', () => {
  const window = (engines: EngineWindow['engines']): SiegeWindow =>
    ({
      byId: 'x',
      campId: 'c',
      startedAt: T0,
      foodAtStart: 1e6,
      garrisonAtStart: 10,
      townPerHour: 1,
      perManPerHour: 0,
      wood: playerWood(1, 1),
      engines,
    }) as unknown as SiegeWindow;

  it('стоит к минуте фазы — поправка есть; не достроен — нет', () => {
    const w = window([{ id: 'catapult', at: T0 }]);
    const ready = after(ENGINE_WOOD.catapult, 1);
    const k = Math.ceil((ready - T0) / SIEGE_PHASE);
    expect(phaseAt(T0, k), 'точка внутри области: фаза k — после готовности').toBeGreaterThanOrEqual(ready);
    expect(phaseAt(T0, k - 1), 'точка внутри области: фаза k−1 — до неё').toBeLessThan(ready);
    expect(modsOf(w, k).engine).toBe(MOD_ENGINE);
    expect(modsOf(w, k - 1).engine).toBeUndefined();
    expect(modsOf(window(undefined), k).engine).toBeUndefined();
  });
});

describe('договор с сервером', () => {
  it('машины и доли древесины у сервера те же, что у мира', () => {
    expect([...WAR_ENGINES]).toEqual([...ENGINE_IDS]);
    expect([...WAR_ENGINE_SHARES]).toEqual([...ENGINE_SHARES]);
  });
});
