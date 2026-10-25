// Лазутчик дома у соседа (BTL-8, п. 5): слепок обороны знает, дома ли лазутчик города, а дела, которых слепок ещё не знал,
// его поправляют (`war.spyHomeAt`). Гибель, случившаяся раньше слепка, в нём уже учтена — на месте павшего новый, — а прежде
// любой павший лазутчик записи войн держал город «без лазутчика дома» всю неделю записи, и охрана от чужих была ниже.
import { describe, expect, it, vi } from 'vitest';
import type { CastleClaim, RosterFile, SpyWatch, WarOrder, WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { applyOrder, emptyWars, spyMenuOf, type SheetAt, type SpyRow, type WarFile } from './war.js';
import { ENERGY_MAX } from '../../src/world/data/energy.js';

// ВРЕМЕННО ×3 ДЛЯ ТЕСТА: держим ×1, как spy.test.ts; ×3 проверяет netlify/lib/warfast.test.ts. Снять вместе с возвратом
// `TEST_TRAVEL_SPEED` к 1.
vi.mock('../../src/world/data/tuning.js', async (actual) => ({ ...(await actual<object>()), TEST_TRAVEL_SPEED: 1 }));

const A = 'tg-1001';
const B = 'tg-1002';
const T0 = 1_900_000_000_000;
const HOUR = 3_600_000;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });
const watch = (over: Partial<SpyWatch> = {}): SpyWatch => ({ keen: 1, veil: 1, stealth: 0, held: 1, home: false, ...over });
const sheet = (over: Partial<WarSheet> = {}): WarSheet =>
  ({
    army: { spearman: 60, archer: 30, swordsman: 30 },
    home: { spearman: 40, archer: 20 },
    militia: 20,
    archers: 6,
    resolve: 0,
    pips: {},
    rest: 1,
    food: 2000,
    townPerHour: 20,
    perManPerHour: 1,
    stock: { food: 2000 },
    stash: 100,
    gold: 400,
    pop: 400,
    bonded: 20,
    levels: {},
    power: 5000,
    locks: {},
    seen: [],
    watch: watch(),
    time: 0,
    ...over,
  }) as WarSheet;

/** A смотрит меню дел против B; слепок B лёг в `T0` и говорит: его лазутчик дома. */
function setup() {
  let roster: RosterFile = emptyRoster();
  roster = upsert(roster, A, claim('Альфа'), T0);
  roster = upsert(roster, B, claim('Бета'), T0);
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet(), at: T0 }],
    [B, { sheet: sheet({ watch: watch({ home: true }) }), at: T0 }],
  ]);
  return { ctx: { roster, sheet: (k: string) => sheets.get(k) ?? null }, file: emptyWars() as WarFile, target: castleIdOf(B) };
}

/** Дело лазутчика B против A, кончившееся его гибелью в минуту `at`. */
const fallen = (at: number): SpyRow =>
  ({ id: 's-dead', atk: B, def: A, deed: 'look', phase: 'done', sentAt: at - HOUR, arriveAt: at, endAt: at, chance: 0.5, peril: 0.5, out: { at, ok: false, slipped: false, held: false, dead: true } }) as unknown as SpyRow;

const chanceOf = (g: ReturnType<typeof setup>, now: number): number => {
  const menu = spyMenuOf(g.file, A, g.target, now, g.ctx);
  if (typeof menu === 'string') throw new Error(menu);
  return menu.options.find((o) => o.deed === 'look')!.chance;
};

describe('лазутчик дома у соседа — по слепку и делам после него', () => {
  it('гибель раньше слепка в нём уже учтена: охрана та же, что без неё', () => {
    const clean = setup();
    const old = setup();
    old.file.spies = [fallen(T0 - 24 * HOUR)];
    expect(chanceOf(old, T0 + 1000)).toBe(chanceOf(clean, T0 + 1000));
  });

  it('гибель после слепка — лазутчика дома нет: охрана ниже (точка внутри области правила)', () => {
    const clean = setup();
    const fresh = setup();
    fresh.file.spies = [fallen(T0 + 500)];
    expect(chanceOf(fresh, T0 + 1000)).toBeGreaterThan(chanceOf(clean, T0 + 1000));
  });
});

// Минута приказа (BTL-8, п. 6): числа дела сервер считает на свою минуту, а не на ту, что назвал клиент. Прежде приказ
// исполнялся по минуте из приказа, если ей не больше 10 с, — и подделанный клиент выбирал в этом окне минуту послабее.
describe('приказ лазутчику — по минуте сервера', () => {
  it('минута, когда лазутчик соседа ещё не вернулся, — отказ: сейчас он дома', () => {
    const g = setup();
    // Слепок B в T0: его лазутчик в деле (дома нет); вернулся он в R — позже слепка.
    g.ctx.sheet(B)!.sheet.watch = watch({ home: false });
    const R = T0 + 60_000;
    g.file.spies = [{ id: 's-back', atk: B, def: A, deed: 'look', phase: 'done', sentAt: T0 - HOUR, arriveAt: T0, endAt: R, backAt: R, chance: 0.5, peril: 0.5, out: { at: T0, ok: true, slipped: false, held: false, dead: false } } as unknown as SpyRow];
    const now = R + 2000;
    const earlier = R - 3000;
    const weak = chanceOf(g, earlier);
    expect(weak, 'точка внутри области: до возврата охрана ниже').toBeGreaterThan(chanceOf(g, now));
    const menu = spyMenuOf(g.file, A, g.target, earlier, g.ctx);
    if (typeof menu === 'string') throw new Error(menu);
    const opt = menu.options.find((o) => o.deed === 'look')!;
    const order: WarOrder = { op: 'spy', target: g.target, deed: 'look', energy: { value: ENERGY_MAX, at: now, mode: 'fill' }, shown: { chance: opt.chance, peril: opt.peril }, at: earlier };
    expect(applyOrder(g.file, A, order, now, g.ctx)).toBe('Обстановка у города сменилась. Посмотри дела заново.');
    expect(g.file.spies.filter((x) => x.atk === A)).toEqual([]);
  });
});
