// Допуск разовых дел (AC-1 аудита): дело больше не выключает сверку роста склада и войска и нижнюю границу книги запасов —
// оно прибавляет к допуску столько, сколько может дать по таблице наград (`data/deedgain`). Доказательства аудита
// `round2/prove-7-1/p7.test.ts` (счётчик +1 — любой склад без флага) и `prove-13-1/c13.test.ts` (счётчик +1 прячет склад от
// налётчика) здесь переписаны под vitest и стали утверждениями.
import { describe, expect, it } from 'vitest';
import { flagsBetween } from './watch.js';
import { goodsStep, holdsBetween } from './goods.js';
import { DEEDS_PER_MIN_MAX, deedGain, deedLoss, deedSplit, deedTroops } from './deeds.js';
import type { WatchCard } from './contract.js';
import { DEED_TABLE } from '../../src/game/data/deedgain.js';
import { START_POP } from '../../src/game/constants.js';
import { storageOf } from '../../src/game/build.js';

const NOW = 1_900_000_000_000;
const MIN = 60_000;

/** Опись новой сборки: счётчик добра без дела есть, склад и казна — как задано. */
const card = (o: Partial<WatchCard> = {}): WatchCard =>
  ({
    build: 'v1',
    city: 'Город',
    clock: NOW,
    time: 1000,
    level: 1,
    buildings: { town_hall: 1, storage: 1 },
    pop: START_POP,
    stock: { wood: 100, gold: 10 },
    prod: { wood: 30, gold: 5 },
    cap: storageOf({ storage: 1 }),
    troops: {},
    queued: 0,
    away: 0,
    caravans: 0,
    wounded: 0,
    train: 0,
    deeds: 0,
    windfalls: 0,
    outlays: 0,
    won: 0,
    lost: 0,
    lairs: 0,
    raids: 0,
    games: 0,
    haul: 0,
    haulCap: 0,
    cheated: false,
    lead: 0,
    seen: 0,
    ...o,
  }) as WatchCard;

const kinds = (a: WatchCard, b: WatchCard, ms = MIN): string[] => flagsBetween(a, NOW, b, NOW + ms).map((f) => f.kind);

describe('AC-1: дело прибавляет к допуску, а не выключает сверку', () => {
  it('p7: счётчик дел +1 и склад +899 900 за минуту — флаг «рост склада»; без дела — тоже', () => {
    const a = card();
    const b = card({ time: 1002, stock: { wood: 900_000, gold: 10 } });
    expect(kinds(a, b)).toContain('stock');
    expect(kinds(a, { ...b, deeds: 1 })).toContain('stock');
    // Точка внутри правила: одно прочее дело даёт допуск, но конечный и много меньше подделки.
    const could = deedGain(a, { ...b, deeds: 1 }, MIN, { wood: 30 }).wood ?? 0;
    expect(Number.isFinite(could) && could < 10_000, `допуск одного дела: ${could}`).toBe(true);
  });

  it('честная весть: прибавка в пределах таблицы — без флага', () => {
    const a = card();
    const gain = Math.floor(DEED_TABLE.gain.flat.food + DEED_TABLE.gain.scale.food);
    expect(gain).toBeGreaterThan(0);
    expect(kinds(a, card({ time: 1002, deeds: 1, stock: { wood: 100, food: gain, gold: 10 } }))).not.toContain('stock');
    expect(kinds(a, card({ time: 1002, deeds: 1, stock: { wood: 100, food: gain * 3, gold: 10 } }))).toContain('stock');
  });

  it('c13: счётчик дел +1 не прячет склад от налётчика — книга держит своё и пишет флаг', () => {
    const a = card({ stock: { wood: 500, gold: 5000 } });
    const ctx = { levels: a.buildings, pop: a.pop, soldiers: 0 };
    const book = goodsStep(null, undefined, 0, a, 0, ctx).book;
    const b = { ...a, stock: { wood: 0, gold: 0 }, deeds: a.deeds + 1 };
    expect(holdsBetween(a, b, MIN), 'точка внутри правила: граница держится').toBe(true);
    const step = goodsStep(book, a, 0, b, MIN, ctx);
    expect(step.book.have.wood ?? 0).toBeGreaterThan(400);
    expect(step.hidden.map((h) => h.kind)).toEqual(expect.arrayContaining(['wood', 'gold']));
    // Убыль в пределах таблицы (цена ответа на весть) — без флага.
    const fair = { ...a, stock: { wood: 500 - Math.floor(DEED_TABLE.loss.scale.wood), gold: 5000 }, deeds: a.deeds + 1 };
    expect(goodsStep(book, a, 0, fair, MIN, ctx).hidden).toEqual([]);
  });

  it('счётчик быстрее 30 дел в минуту — флаг «дела», и сверх скорости дела в допуск не идут', () => {
    const a = card();
    expect(kinds(a, card({ time: 1002, deeds: DEEDS_PER_MIN_MAX }))).not.toContain('deeds');
    expect(kinds(a, card({ time: 1002, deeds: DEEDS_PER_MIN_MAX + 1 }))).toContain('deeds');
    // Час — тридцать в минуту на час, не меньше.
    expect(kinds(a, card({ time: 1002, deeds: DEEDS_PER_MIN_MAX * 60 }), 60 * MIN)).not.toContain('deeds');
    const many = deedSplit(a, card({ deeds: 10_000 }), MIN);
    expect(many.other).toBeLessThanOrEqual(DEEDS_PER_MIN_MAX);
    // Указы и дела лавки сервер знает сам: в счёт скорости они не идут.
    expect(kinds(a, card({ time: 1002, deeds: 50, seen: 50 }))).not.toContain('deeds');
  });

  it('добро без дела (возврат, дань, продажа) — до вместимости склада; сверх — флаг', () => {
    const a = card();
    const cap = storageOf(a.buildings);
    expect(kinds(a, card({ time: 1002, deeds: 1, windfalls: 1, stock: { wood: cap, gold: 10 } }))).not.toContain('stock');
    expect(kinds(a, card({ time: 1002, deeds: 1, windfalls: 1, stock: { wood: cap * 3, gold: 10 } }))).toContain('stock');
  });

  it('бой: добыча — грузом отряда; без бойцов логово не даёт столько', () => {
    const loot = 20 * DEED_TABLE.fight.carry;
    const a = card({ troops: { spearman: 20 }, buildings: { town_hall: 1, storage: 20 } });
    const b = { ...a, time: 1002, deeds: 1, won: 1, stock: { wood: 100 + loot, gold: 10 } };
    expect(kinds(a, b)).not.toContain('stock');
    expect(kinds(card({ buildings: { town_hall: 1, storage: 20 } }), { ...b, troops: {} })).toContain('stock');
  });

  it('указы — по книге указов: положенное без флага, сверх — флаг; без книги — до потолка указа', () => {
    const a = card();
    const b = card({ time: 1002, deeds: 1, seen: 1, stock: { wood: 600, gold: 10 } });
    const known = { grants: [{ n: 1, stock: { wood: 500 }, troops: {} }] };
    expect(flagsBetween(a, NOW, b, NOW + MIN, known).map((f) => f.kind)).not.toContain('stock');
    expect(flagsBetween(a, NOW, { ...b, stock: { wood: 5000, gold: 10 } }, NOW + MIN, known).map((f) => f.kind)).toContain('stock');
    expect(kinds(a, { ...b, stock: { wood: 5000, gold: 10 } })).not.toContain('stock');
    // Бойцы указа — в допуске войска.
    expect(deedTroops(a, card({ seen: 1 }), MIN, { grants: [{ n: 1, troops: { spearman: 40 } }] })).toBe(40);
  });

  it('караван: пришёл — привоз в допуске; без каравана в пути — нет', () => {
    const a = card({ caravans: 1 });
    expect(kinds(a, card({ time: 1002, stock: { wood: 2000, gold: 10 } }))).not.toContain('stock');
    expect(kinds(card(), card({ time: 1002, stock: { wood: 2000, gold: 10 } }))).toContain('stock');
  });

  it('старая опись без счётчика добра без дела — дела без потолка, как до AC-1: ложных флагов у старого клиента нет', () => {
    const a = { ...card(), windfalls: undefined };
    const b = { ...card({ time: 1002, deeds: 1, stock: { wood: 900_000, gold: 10 } }), windfalls: undefined };
    expect(kinds(a, b)).not.toContain('stock');
    expect(Object.values(deedLoss(a, b, MIN)).every((v) => v === Infinity)).toBe(true);
    // Без дел и у старой описи сверка прежняя.
    expect(kinds(a, { ...b, deeds: 0 })).toContain('stock');
  });
});
