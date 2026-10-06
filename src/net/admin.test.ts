import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { RESOURCE_IDS } from '@/game/constants';
import { TROOP_IDS } from '@/game/data/troops';
import { storageCap } from '@/game/derived';
import { applyGrants, adminSeen } from '@/game/sim/admin';
import { deserialize, serialize } from '@/game/save';
import { STOCK_KEYS, TROOP_KEYS, readGrant, type AdminGrant } from '../../netlify/lib/contract';
import { provideGrants, takeNote, useAdmin } from './admin';
import { watchOf } from './snapshot';

/**
 * Указ админа в партии (docs/admin.md): ложится одной дверью и ровно один раз, по правилам склада, и алмазов не знает.
 * Тесты там, где без них можно начислить из ничего: указ, приехавший дважды, лёг бы дважды.
 */
const grant = (n: number, stock: AdminGrant['stock'] = {}, troops: AdminGrant['troops'] = {}): AdminGrant => ({ n, at: 0, stock, troops });

describe('виды указа — те же, что у игры', () => {
  it('склад — припасы игры и золото; бойцы — виды игры; алмазов нет', () => {
    expect([...STOCK_KEYS]).toEqual([...RESOURCE_IDS, 'gold']);
    expect([...TROOP_KEYS].sort()).toEqual([...TROOP_IDS].sort());
    expect(STOCK_KEYS as readonly string[]).not.toContain('gems');
  });
});

describe('указ ложится ровно один раз', () => {
  it('приехавший дважды — второй раз не применяется; номера по порядку', () => {
    const s = createInitialState();
    const wood = s.resources.wood;
    const g = [grant(2, { stone: 5 }), grant(1, { wood: 10 })];
    expect(applyGrants(s, g)).toBe(2);
    expect(adminSeen(s)).toBe(2);
    const after = JSON.stringify({ r: s.resources, a: s.army, g: s.gold });
    expect(applyGrants(s, g)).toBe(0);
    expect(JSON.stringify({ r: s.resources, a: s.army, g: s.gold })).toBe(after);
    expect(s.resources.wood).toBe(Math.min(storageCap(s), wood + 10));
    // Летопись говорит, что легло.
    expect(s.log[0].text).toMatch(/Указ админа №2: камень \+5/);
  });

  it('номер указа переживает сохранение: после перезапуска тот же указ не ложится второй раз', () => {
    const s = createInitialState();
    applyGrants(s, [grant(1, { stone: 7 })]);
    const back = deserialize(serialize(s));
    expect(back && adminSeen(back)).toBe(1);
    expect(back && applyGrants(back, [grant(1, { stone: 7 })])).toBe(0);
  });

  it('прибавка — не сверх склада, убавка — не ниже нуля; бойцов не меньше, чем в походе; золото — в казну', () => {
    const s = createInitialState();
    const cap = storageCap(s);
    s.army.spearman = 10;
    s.away = { ...(s.away ?? {}), spearman: 4 };
    const gold = s.gold;
    const wood = s.resources.wood;
    applyGrants(s, [grant(1, { wood: 10 * cap, stone: -10 * cap, gold: 25 }, { spearman: -100, archer: 3 })]);
    expect(s.resources.wood).toBe(Math.max(wood, cap));
    expect(s.resources.stone).toBe(0);
    expect(s.army.spearman).toBe(4);
    expect(s.army.archer).toBe(3);
    expect(s.gold).toBe(gold + 25);
  });

  it('алмазы указом не меняются: чужой вид договор отбрасывает, дверь его не знает', () => {
    const s = createInitialState();
    const gems = s.gems;
    const forged = readGrant({ n: 1, at: 0, stock: { gems: 1000, wood: 1 } });
    expect(forged?.stock).toEqual({ wood: 1 });
    applyGrants(s, [forged as AdminGrant, { n: 2, at: 0, stock: { gems: 5000 } as never, troops: {} }]);
    expect(s.gems).toBe(gems);
  });
});

describe('записка сервера', () => {
  it('заморозка — в стор плашки; указы — в дверь; нет записки (старый сервер) — ничего не меняется', () => {
    const got: number[] = [];
    provideGrants((g) => got.push(...g.map((x) => x.n)));
    takeNote({ frozen: true, grants: [grant(3, { wood: 1 })] });
    expect(useAdmin.getState().frozen).toBe(true);
    expect(got).toEqual([3]);
    takeNote(undefined);
    expect(useAdmin.getState().frozen).toBe(true);
    takeNote({ frozen: false, grants: [] });
    expect(useAdmin.getState().frozen).toBe(false);
  });
});

describe('опись наблюдения', () => {
  it('числа партии и их пределы: склад с золотом, выработка, вместимость, номер указа', () => {
    const s = createInitialState();
    applyGrants(s, [grant(1, { wood: 1 })]);
    const w = watchOf(s);
    expect(w.seen).toBe(1);
    expect(w.stock.gold).toBe(Math.round(s.gold));
    expect(w.stock.wood).toBe(Math.round(s.resources.wood));
    expect(w.cap).toBe(Math.round(storageCap(s)));
    expect(w.deeds).toBeGreaterThanOrEqual(1);
    expect(w.haulCap).toBeGreaterThan(0);
    expect(w.train).toBeGreaterThanOrEqual(0);
  });
});
