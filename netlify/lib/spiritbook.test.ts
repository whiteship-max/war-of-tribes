// Книга духа дружины сервера (ДР-1, правило «spirit», docs/siege_v2.md, «Решения ДР-1»): жалованье — по часам сервера, потолок
// морали и дисциплины — формулами игры (`game/spiritrules`) при подтверждённых и лучших невидимых причинах; опись выше потолка,
// убывший счёт уплаченного и «полное жалованье без единой монеты при высоком духе» — флаг и «внимание:»; в бой слепка и приказа
// — не выше потолка. Опись до ДР-1 — без флагов и без духа в бою.
//
// Области (правило 11): потолок проверяется на минимальном жалованье, где он ниже верха шкалы (иначе срез не спрашивается); флаг
// неуплаты — на промежутке длиннее терпения, при войске в книге.
import { describe, expect, it } from 'vitest';
import { emptyWars, liveSheet } from './war.js';
import { readWatchRecord, wrote, WARN, type WatchRecord } from './watch.js';
import { ruleSpirit, seedBook } from './book.js';
import { seedTown } from './town.js';
import { SPIRIT_GRACE_DAYS, bookShare, spiritBookAfter, spiritCeil, spiritFaults, type SpiritBook } from './spiritbook.js';
import type { WarSheet, WatchCard, WatchSpirit } from './contract.js';
import { readArmy, readSheet, readWatch } from './contract.js';
import { START_POP } from '../../src/game/constants.js';
import { storageOf } from '../../src/game/build.js';
import { realMs } from '../../src/game/pace.js';
import { SPIRIT_FLOOR, SPIRIT_TOP, WAGE_FALL_MS, WAGE_RECOVER_MS } from '../../src/game/spiritrules.js';

const NOW = 1_900_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const LEVEL1 = seedTown(NOW).levels;

const card = (spirit?: WatchSpirit, over: Partial<WatchCard> = {}): WatchCard => ({
  build: 'v1',
  city: 'Энна',
  clock: NOW,
  time: 1000,
  level: 1,
  buildings: { ...LEVEL1 },
  pop: START_POP,
  stock: { wood: 100, gold: 10 },
  prod: {},
  cap: storageOf(LEVEL1),
  troops: { spearman: 40 },
  queued: 0,
  away: 0,
  caravans: 0,
  wounded: 0,
  train: 0,
  deeds: 0,
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
  windfalls: 0,
  bonded: 0,
  ...(spirit ? { spirit } : {}),
  ...over,
});

const sp = (wage: 'full' | 'min', morale: number, discipline: number, paid = 0): WatchSpirit => ({ wage, morale, discipline, paid });
const write = (rec: WatchRecord, at: number, c: WatchCard): WatchRecord => wrote(rec, at, { name: 'Вождь', power: 1, day: 1 }, c, 1);
const flagged = (rec: WatchRecord): string[] => rec.flags.filter((f) => f.kind === 'spirit').map((f) => f.text);
const KNOWN = { marshal: 0, knights: 0, barracks: 1, statue: 1 };

describe('книга: жалованье по часам сервера, смена — на выгодную игроку минуту', () => {
  it('уход на минимальное — минутой новой описи, возврат полного — минутой прежней', () => {
    const toMin = spiritBookAfter(undefined, 'min', NOW, NOW + 5 * MIN)!;
    expect(toMin).toEqual({ mode: 'min', at: NOW + 5 * MIN, from: 1 });
    const fell = toMin.at + WAGE_FALL_MS;
    const back = spiritBookAfter(toMin, 'full', fell, fell + 5 * MIN)!;
    expect(back.mode).toBe('full');
    expect(back.at, 'с прежней описи').toBe(fell);
    expect(back.from).toBe(0);
    expect(bookShare(back, fell + WAGE_RECOVER_MS)).toBe(1);
    expect(spiritBookAfter(back, 'full', NOW, NOW), 'то же — книга та же').toBe(back);
    expect(spiritBookAfter(undefined, 'full', NOW, NOW), 'полное без книги — книги нет').toBeUndefined();
  });

  it('потолок на минимальном падает к дну, на полном — возвращается к верху за шесть часов', () => {
    const book: SpiritBook = { mode: 'min', at: NOW, from: 1 };
    const top = spiritCeil(undefined, KNOWN, NOW, { rite: 0 });
    const low = spiritCeil(book, KNOWN, NOW + WAGE_FALL_MS, { rite: 0 });
    // Область: без книги потолок высок, на дне минимального — дно.
    expect(top.morale).toBeGreaterThan(80);
    expect(low).toEqual({ morale: SPIRIT_FLOOR, discipline: SPIRIT_FLOOR });
    const back: SpiritBook = { mode: 'full', at: NOW + WAGE_FALL_MS, from: 0 };
    const mid = spiritCeil(back, KNOWN, back.at + 3 * HOUR, { rite: 0 });
    expect(mid.morale).toBeGreaterThan(SPIRIT_FLOOR);
    expect(mid.morale).toBeLessThan(top.morale);
    expect(spiritCeil(back, KNOWN, back.at + WAGE_RECOVER_MS, { rite: 0 })).toEqual(top);
  });
});

describe('правило «spirit»: подделка — флаг и «внимание:»', () => {
  it('честная партия: смена жалованья и дух по правилам — без флага', () => {
    let rec = readWatchRecord({});
    rec = write(rec, NOW, card(sp('full', 70, 70)));
    rec = write(rec, NOW + 5 * MIN, card(sp('min', 70, 70)));
    // Опись через два часа на минимальном — дух на дне.
    rec = write(rec, NOW + 5 * MIN + WAGE_FALL_MS, card(sp('min', 0, 0)));
    expect(rec.spirit?.mode).toBe('min');
    rec = write(rec, NOW + 10 * MIN + WAGE_FALL_MS, card(sp('full', 0, 0)));
    expect(rec.spirit?.mode).toBe('full');
    expect(flagged(rec)).toEqual([]);
  });

  it('минимальное жалованье, а дух описи у верха — флаг и «внимание:» в журнале', () => {
    let rec = readWatchRecord({});
    rec = write(rec, NOW, card(sp('min', 70, 70)));
    const at = NOW + WAGE_FALL_MS + 10 * MIN;
    const prev = rec;
    rec = write(rec, at, card(sp('min', 80, 75)));
    expect(flagged(rec).length, 'флаг рода «дух дружины»').toBeGreaterThan(0);
    expect(rec.journal.some((e) => e.text.startsWith(WARN) && e.text.includes('Дух дружины'))).toBe(true);
    // Тексты — по сверке целиком (флаги одного рода журнал склеивает).
    const ceil = spiritCeil(rec.spirit, KNOWN, at, { rite: 0 });
    expect(ceil, 'на дне минимального потолок — дно').toEqual({ morale: SPIRIT_FLOOR, discipline: SPIRIT_FLOOR });
    const f = spiritFaults(prev.card, prev.cardAt, card(sp('min', 80, 75)), at, ceil, 40);
    expect(f.length, f.join(' | ')).toBe(2);
    expect(f[0]).toMatch(/мораль 80, а по книге духа сервера — не выше 0/);
    expect(f[1]).toMatch(/дисциплина 75/);
  });

  it('шкала вне 0…100 и убывший счёт уплаченного — флаг', () => {
    const a = card(sp('full', 70, 70, 500));
    const f = spiritFaults(a, NOW, card(sp('full', 150, -3, 100)), NOW + 5 * MIN, { morale: SPIRIT_TOP, discipline: SPIRIT_TOP }, 40).join(' | ');
    expect(f).toMatch(/мораль 150 — вне шкалы/);
    expect(f).toMatch(/дисциплина -3 — вне шкалы/);
    expect(f).toMatch(/Счёт жалованья дружине убыл: 500 → 100/);
    let rec = readWatchRecord({});
    rec = write(rec, NOW, a);
    rec = write(rec, NOW + 5 * MIN, card(sp('full', 150, -3, 100)));
    expect(flagged(rec).length, 'и в журнале города').toBeGreaterThan(0);
  });

  it('полное жалованье дольше терпения без единой монеты, а дух высок — флаг; в пределах терпения — нет', () => {
    const a = card(sp('full', 70, 70, 100));
    const lateAt = NOW + realMs((SPIRIT_GRACE_DAYS + 1) * 60);
    const ceil = { morale: SPIRIT_TOP, discipline: SPIRIT_TOP };
    expect(spiritFaults(a, NOW, card(sp('full', 70, 70, 100)), lateAt, ceil, 40).join(' ')).toMatch(/не уплачено ничего/);
    expect(spiritFaults(a, NOW, card(sp('full', SPIRIT_FLOOR, SPIRIT_FLOOR, 100)), lateAt, ceil, 40), 'дух на дне — честно').toEqual([]);
    expect(spiritFaults(a, NOW, card(sp('full', 70, 70, 100)), NOW + HOUR, ceil, 40), 'в пределах терпения').toEqual([]);
    expect(spiritFaults(a, NOW, card(sp('full', 70, 70, 100)), lateAt, ceil, 0), 'войска нет — платить некому').toEqual([]);
  });

  it('опись до ДР-1 — без флагов и без книги', () => {
    let rec = readWatchRecord({});
    rec = write(rec, NOW, card());
    rec = write(rec, NOW + HOUR, card());
    expect(flagged(rec)).toEqual([]);
    expect(rec.spirit).toBeUndefined();
  });

  it('книга переживает запись и чтение', () => {
    let rec = readWatchRecord({});
    rec = write(rec, NOW, card(sp('min', 70, 70)));
    const back = readWatchRecord(JSON.parse(JSON.stringify(rec)));
    expect(back.spirit).toEqual(rec.spirit);
  });
});

describe('в бой — не выше потолка книги', () => {
  it('ruleSpirit: меньшее из названного и потолка; без духа — без духа', () => {
    expect(ruleSpirit({ morale: 90, discipline: 40 }, { morale: 50, discipline: 60 })).toEqual({ morale: 50, discipline: 40 });
    expect(ruleSpirit(undefined, { morale: 50, discipline: 60 })).toBeUndefined();
    expect(ruleSpirit({ morale: 150, discipline: -5 }, undefined)).toEqual({ morale: 100, discipline: 0 });
  });

  it('слепок обороны на минимальном жалованье идёт в бой с духом книги, а не слепка', () => {
    const sheet = readSheet({ army: { spearman: 40 }, home: { spearman: 40 }, resolve: 0, pips: {}, rest: 1, spirit: { morale: 95, discipline: 95 } })!;
    expect(sheet.spirit, 'договор читает дух слепка').toEqual({ morale: 95, discipline: 95 });
    const ceil = spiritCeil({ mode: 'min', at: NOW - WAGE_FALL_MS, from: 1 }, KNOWN, NOW, { rite: 0 });
    const live: WarSheet = liveSheet(emptyWars(), 'tg-1', { sheet, at: NOW, book: { ...seedBook(NOW), bodies: { spearman: 40 } }, spirit: ceil }, NOW);
    expect(live.spirit).toEqual({ morale: SPIRIT_FLOOR, discipline: SPIRIT_FLOOR });
    const plain = readSheet({ army: {}, home: {}, resolve: 0, pips: {}, rest: 1 })!;
    expect(liveSheet(emptyWars(), 'tg-1', { sheet: plain, at: NOW, spirit: ceil }, NOW).spirit, 'слепок до ДР-1 — без духа').toBeUndefined();
  });

  it('договор: дух приказа и описи — числами в пределах, мусор — нет духа', () => {
    expect(readArmy({ troops: {}, resolve: 0, pips: {}, spirit: { morale: 'x', discipline: 3 } })!.spirit).toBeUndefined();
    expect(readArmy({ troops: {}, resolve: 0, pips: {}, spirit: { morale: 400, discipline: 3 } })!.spirit).toEqual({ morale: 100, discipline: 3 });
    expect(readWatch({ spirit: { wage: 'half', morale: 1, discipline: 1 } })?.spirit).toBeUndefined();
    expect(readWatch({ spirit: { wage: 'min', morale: 12.345, discipline: 7, paid: 9.7 } })?.spirit).toEqual({ wage: 'min', morale: 12.3, discipline: 7, paid: 9 });
  });
});
