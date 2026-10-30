// Книга отряда на сервере (ПН-6, решение ВП4; docs/trust-boundary.md, 5б): приход только подтверждённый сервером, убыль — словами
// клиента вниз, сверх книги — флаг; строка реестра и видимость считают людей по книге.
//
// Граница области — утверждениями: приход прихода `k` правда наступил и не старше суток, отряд правда стоит у точки найма, ход правда
// принят — иначе отказ мерил бы не то правило.
import { describe, expect, it, vi } from 'vitest';
import type { RoamBookRow } from './contract.js';
import { bandOrder, emptyRoster } from './roster.js';
import { BOOK_SLACK_MS, DRILL_AHEAD_MS, bookClaim, bookGrants, bookMen, bookMoved, bookOrder, captivesCapNow, dealsPerCell, startBook, type BookAt } from './roambook.js';
import { CONTRACTS_MAX } from '../../src/game/data/contracts.js';
import { DEED_TABLE } from '../../src/game/data/deedgain.js';
import { SHIFT } from '../../src/game/shift.js';
import { askCap, drillMs } from '../../src/game/askrules.js';
import { awayArrival } from '../../src/game/mailgrid.js';
import { WARRIOR } from '../../src/game/roamstart.js';
import { LETTER_TTL } from '../../src/world/data/tuning.js';

vi.mock('../../src/game/roamflag.js', () => ({ ROAM_ON: true, roamOpenFor: () => true, roamOn: () => true, setRoamOpen: () => {} }));

const SEED = 4242;
const K = 300;
const AT = awayArrival(SEED, K);
const at = (over: Partial<BookAt> = {}): BookAt => ({ now: AT + 60_000, cell: { x: 10, y: 10 }, moving: false, seed: SEED, ...over });

describe('книга отряда: приход', () => {
  it('новый отряд — Воин', () => {
    expect(startBook().troops).toEqual(WARRIOR.band);
    expect(bookMen(startBook())).toBe(6);
  });

  it('просящиеся: приход по сетке почты от сида, один раз, не больше потолка прихода', () => {
    const cap = askCap(SEED, K);
    expect(cap).toBeGreaterThan(1);
    const ok = bookOrder(startBook(), { op: 'join', key: 'join-300', k: K, n: cap }, at());
    expect(ok.error).toBeNull();
    expect(ok.book.troops.clubman).toBe(2 + cap);
    expect(ok.book.join).toBe(K);
    // Повтор того же ключа — прежняя книга, второго прихода нет.
    expect(bookOrder(ok.book, { op: 'join', key: 'join-300', k: K, n: cap }, at()).book.troops.clubman).toBe(2 + cap);
    // Тот же приход другим ключом — отказ и флаг.
    const twice = bookOrder(ok.book, { op: 'join', key: 'join-300b', k: K, n: 1 }, at());
    expect(twice.error).not.toBeNull();
    expect(twice.forged).toMatch(/второй раз/);
    // Сверх потолка — отказ и флаг.
    const over = bookOrder(startBook(), { op: 'join', key: 'join-over', k: K, n: cap + 1 }, at());
    expect(over.forged).toMatch(/потолок прихода/);
    // Приход ещё не наступил — и старше суток.
    expect(at().now).toBeGreaterThan(AT);
    const early = bookOrder(startBook(), { op: 'join', key: 'join-early', k: K, n: 1 }, at({ now: AT - BOOK_SLACK_MS - 1 }));
    expect(early.forged).toMatch(/не наступил/);
    // Ответ, ждавший связи, — принят до двух сроков вести; старше — отказ без флага.
    expect(bookOrder(startBook(), { op: 'join', key: 'join-wait', k: K, n: 1 }, at({ now: AT + LETTER_TTL + BOOK_SLACK_MS + 1 })).error).toBeNull();
    const late = bookOrder(startBook(), { op: 'join', key: 'join-late', k: K, n: 1 }, at({ now: AT + 2 * LETTER_TTL + 1 }));
    expect([late.error !== null, late.forged]).toEqual([true, null]);
    // Описи ещё нет — отказ без флага: честная партия повторит.
    const blind = bookOrder(startBook(), { op: 'join', key: 'join-blind', k: K, n: 1 }, at({ seed: undefined }));
    expect([blind.error !== null, blind.forged]).toEqual([true, null]);
  });

  it('найм — стоя у точки и не быстрее учений казарм первого уровня', () => {
    const ok = bookOrder(startBook(), { op: 'hire', key: 'hire-1', kind: 'spearman', n: 3, at: { x: 11, y: 10 } }, at());
    expect(ok.error).toBeNull();
    expect(ok.book.troops.spearman).toBe(7);
    expect(ok.book.drill).toBe(at().now + drillMs('spearman', 3));
    expect(bookOrder(startBook(), { op: 'hire', key: 'hire-2', kind: 'spearman', n: 1, at: { x: 10, y: 10 } }, at({ moving: true })).error).not.toBeNull();
    expect(bookOrder(startBook(), { op: 'hire', key: 'hire-3', kind: 'spearman', n: 1, at: { x: 13, y: 10 } }, at()).forged).toMatch(/отряд стоит/);
    // Учений больше чем на сутки — отказ: столько казармы за раз не берут.
    const many = Math.ceil(DRILL_AHEAD_MS / drillMs('spearman', 1)) + 2;
    expect(drillMs('spearman', many)).toBeGreaterThan(DRILL_AHEAD_MS + BOOK_SLACK_MS);
    expect(bookOrder(startBook(), { op: 'hire', key: 'hire-4', kind: 'spearman', n: many, at: { x: 10, y: 10 } }, at()).forged).toMatch(/учений на/);
  });

  it('пленные — только после хода и не больше потолка боя', () => {
    const cap = captivesCapNow();
    expect(cap).toBeGreaterThan(0);
    expect(bookOrder(startBook(), { op: 'captives', key: 'cap-1', n: 1 }, at()).forged).toMatch(/без боя/);
    const moved = bookMoved(startBook());
    const one = bookOrder(moved, { op: 'captives', key: 'cap-2', n: cap }, at());
    expect(one.book.troops.clubman).toBe(2 + cap);
    const two = bookOrder(one.book, { op: 'captives', key: 'cap-3', n: 1 }, at());
    expect(two.error).toBeNull();
    expect(bookOrder(two.book, { op: 'captives', key: 'cap-4', n: 1 }, at()).forged).toMatch(/без боя/);
    expect(bookOrder(moved, { op: 'captives', key: 'cap-5', n: cap + 1 }, at()).forged).toMatch(/потолок боя/);
  });

  it('повышение и разжалование — по дереву снаряжения и не больше, чем есть', () => {
    const up = bookOrder(startBook(), { op: 'promote', key: 'up-1', from: 'spearman', to: 'rider', n: 2 }, at());
    expect(up.book.troops).toEqual({ clubman: 2, spearman: 2, rider: 2 });
    expect(bookOrder(startBook(), { op: 'promote', key: 'up-2', from: 'spearman', to: 'archer', n: 1 }, at()).forged).toMatch(/вне дерева/);
    expect(bookOrder(startBook(), { op: 'promote', key: 'up-3', from: 'clubman', to: 'spearman', n: 3 }, at()).forged).toMatch(/в книге 2/);
    const down = bookOrder(up.book, { op: 'demote', key: 'dn-1', from: 'rider', to: 'clubman', n: 1 }, at());
    expect(down.book.troops).toEqual({ clubman: 3, spearman: 2, rider: 1 });
    expect(bookOrder(startBook(), { op: 'dismiss', key: 'ds-1', kind: 'spearman', n: 4 }, at()).book.troops).toEqual({ clubman: 2 });
  });

  it('указы админа ложатся по номеру один раз', () => {
    const g = bookGrants(startBook(), [{ n: 2, troops: { archer: 5 } }, { n: 3, troops: { clubman: -9 } }]);
    expect(g.troops).toEqual({ spearman: 4, archer: 5 });
    expect(g.grant).toBe(3);
    expect(bookGrants(g, [{ n: 3, troops: { archer: 5 } }])).toBe(g);
  });
});

describe('книга отряда: отметка', () => {
  it('меньше книги — убыль; больше — флаг, книга не растёт', () => {
    const book: RoamBookRow = startBook();
    const lost = bookClaim(book, { spearman: 3, clubman: 2 });
    expect([lost.book.troops, lost.forged]).toEqual([{ spearman: 3, clubman: 2 }, null]);
    const over = bookClaim(book, { spearman: 9, clubman: 2 });
    expect(over.book.troops).toEqual(book.troops);
    expect(over.forged).toMatch(/сверх книги: spearman 9 при 4/);
  });

  it('строка реестра считает людей по книге, а не по слову `men`', () => {
    const now = 1_900_000_000_000;
    const first = bandOrder(emptyRoster(), 'tg-7', { op: 'seat', name: 'Герой', prestige: 0, men: 1, troops: { spearman: 4, clubman: 2 } }, now, null);
    expect(first.error).toBeNull();
    expect(first.file.bands?.['tg-7'].men).toBe(6);
    expect(first.file.bands?.['tg-7'].book?.troops).toEqual(WARRIOR.band);
    // Назвал больше книги — флаг, людей в строке — по книге.
    const lie = bandOrder(first.file, 'tg-7', { op: 'seat', name: 'Герой', prestige: 0, men: 60, troops: { spearman: 50, clubman: 10 } }, now + 1000, null);
    expect(lie.forged?.text).toMatch(/сверх книги/);
    expect(lie.file.bands?.['tg-7'].men).toBe(6);
  });
});

describe('книга договоров (ПН-7, ГДД 3.8): взятие у заказчика, сдача — не выше таблицы наград дел, подделка — флаг', () => {
  // Граница области: отряд правда стоит (не в пути) в клетке заказчика, ключ взятия правда открыт, тир правда из I–III.
  const STAND = { x: 10, y: 10 };
  const take = (book: RoamBookRow, key: string, tier = 1, over: Partial<BookAt> = {}): ReturnType<typeof bookOrder> =>
    bookOrder(book, { op: 'take', key, at: { ...STAND }, tier }, at(over));

  it('взятие — стоя у заказчика: в пути — отказ без флага, не у его клетки — отказ и флаг', () => {
    const ok = take(startBook(), 'take-0001');
    expect(ok.error).toBeNull();
    expect(ok.book.deals?.open.map((o) => o.key)).toEqual(['take-0001']);
    const moving = take(startBook(), 'take-0002', 1, { moving: true });
    expect(moving.error).not.toBeNull();
    expect(moving.forged).toBeNull();
    const far = bookOrder(startBook(), { op: 'take', key: 'take-0003', at: { x: 30, y: 30 }, tier: 1 }, at());
    expect(far.error).not.toBeNull();
    expect(far.forged).toMatch(/отряд стоит/);
  });

  it(`договоров разом — не больше ${CONTRACTS_MAX}; доска одной клетки за привоз — не больше доски города и видов кастеляна`, () => {
    let book = startBook();
    for (let i = 0; i < CONTRACTS_MAX; i++) book = take(book, `take-c${i}0`).book;
    const fourth = take(book, 'take-c99');
    expect(fourth.error).not.toBeNull();
    expect(fourth.forged).toMatch(/разом/);
    // Сдали и взяли снова — пока доска клетки не пуста за этот привоз.
    let b2 = startBook();
    let n = 0;
    for (let i = 0; i < dealsPerCell() + 2; i++) {
      const t = take(b2, `take-p${i}0`);
      if (t.error) {
        expect(t.forged).toMatch(/доска даёт не больше/);
        break;
      }
      n++;
      b2 = bookOrder(t.book, { op: 'drop', key: `drop-p${i}0`, take: `take-p${i}0` }, at()).book;
    }
    expect(n, 'граница: клетка дала ровно столько, сколько доска').toBe(dealsPerCell());
    // Новый привоз — доска снова полна.
    expect(take(b2, 'take-next', 1, { now: AT + 60_000 + SHIFT }).error).toBeNull();
  });

  it('сдача — только взятого; плата и престиж — не выше строки таблицы наград дел тира: сверх — срезано и флаг', () => {
    const book = take(startBook(), 'take-g001', 2).book;
    const cap = DEED_TABLE.deal;
    expect(cap.gold[1]).toBeGreaterThan(0);
    const honest = bookOrder(book, { op: 'deal', key: 'deal-g001', take: 'take-g001', gold: cap.gold[1], fame: cap.fame[1] }, at());
    expect(honest.error).toBeNull();
    expect(honest.forged).toBeNull();
    expect(honest.book.deals).toMatchObject({ n: 1, gold: cap.gold[1], fame: cap.fame[1], open: [] });
    const over = bookOrder(book, { op: 'deal', key: 'deal-g002', take: 'take-g001', gold: cap.gold[1] * 3, fame: 999 }, at());
    expect(over.error).toBeNull();
    expect(over.forged).toMatch(/при потолке/);
    expect(over.book.deals?.gold).toBe(cap.gold[1]);
    expect(over.book.deals?.fame).toBe(cap.fame[1]);
    // Сдача без взятия — отказ и флаг; повтор ключа — прежний итог.
    const none = bookOrder(startBook(), { op: 'deal', key: 'deal-g003', take: 'take-none', gold: 10, fame: 10 }, at());
    expect(none.error).not.toBeNull();
    expect(none.forged).toMatch(/без взятия/);
    expect(bookOrder(honest.book, { op: 'deal', key: 'deal-g001', take: 'take-g001', gold: cap.gold[1], fame: cap.fame[1] }, at()).book.deals?.n).toBe(1);
  });

  it('срыв закрывает взятый договор; сдать его потом нельзя', () => {
    const book = take(startBook(), 'take-d001').book;
    const dropped = bookOrder(book, { op: 'drop', key: 'drop-d001', take: 'take-d001' }, at());
    expect(dropped.book.deals?.open).toEqual([]);
    expect(bookOrder(dropped.book, { op: 'deal', key: 'deal-d001', take: 'take-d001', gold: 1, fame: 1 }, at()).forged).toMatch(/без взятия/);
  });

  it('строка таблицы наград дел договоров — вывод из правил игры (тест вывода сверяет её буква в букву)', () => {
    expect(DEED_TABLE.deal.gold).toHaveLength(3);
    expect(DEED_TABLE.deal.gold[0]).toBeLessThan(DEED_TABLE.deal.gold[1]);
    expect(DEED_TABLE.deal.fame).toEqual([12, 24, 36]);
  });
});
