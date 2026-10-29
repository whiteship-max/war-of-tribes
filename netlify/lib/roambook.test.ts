// Книга отряда на сервере (ПН-6, решение ВП4; docs/trust-boundary.md, 5б): приход только подтверждённый сервером, убыль — словами
// клиента вниз, сверх книги — флаг; строка реестра и видимость считают людей по книге.
//
// Граница области — утверждениями: приход прихода `k` правда наступил и не старше суток, отряд правда стоит у точки найма, ход правда
// принят — иначе отказ мерил бы не то правило.
import { describe, expect, it, vi } from 'vitest';
import type { RoamBookRow } from './contract.js';
import { bandOrder, emptyRoster } from './roster.js';
import { BOOK_SLACK_MS, DRILL_AHEAD_MS, bookClaim, bookGrants, bookMen, bookMoved, bookOrder, captivesCapNow, startBook, type BookAt } from './roambook.js';
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
    const late = bookOrder(startBook(), { op: 'join', key: 'join-late', k: K, n: 1 }, at({ now: AT + LETTER_TTL + BOOK_SLACK_MS + 1 }));
    expect(late.forged).toMatch(/старше суток/);
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
