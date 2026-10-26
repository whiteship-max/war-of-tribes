// Книга черт армии сервера (ДР-4, правило «scars»; docs/trust-boundary.md): журнал сервера — метки боёв войны, которые он записал
// сам; черты — той же функцией, что в игре; книга переживает чистку войн; в войну — черты книги, а не приказа и слепка; бой войны
// пишет метки сторон; опись сверяется — честная без флагов, подделка — флаг. Каждая точка сначала утверждает, что она внутри
// области правила (правило 11): у игрока есть бои войны с метками.
import { describe, expect, it } from 'vitest';
import { readScarBook, scarBookAfter, scarFaults, scarsAt, warMarksOf, type ScarBook } from './scarbook.js';
import { readWatchRecord, scarsOfRec } from './watch.js';
import type { CastleClaim, WarArmy, WarBattle, WarSheet } from './contract.js';
import { readArmy, readSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, liveSheet, type SheetAt, type WarFile, type WarRow } from './war.js';
import { NO_GENERAL, scarsOf, warMarks, type FightMark } from '../../src/game/scarrules.js';

const T0 = 1_900_000_000_000;
// Те же игроки, что у переговоров и командиров (`warparley.test.ts`): их замки стоят в одном краю.
const A = 'tg-2001';
const B = 'tg-2002';
const C = 'tg-2003';

/** Запись войн из боёв: у каждого — свои метки по ролям. */
function file(...battles: { atk?: string; def?: string; id: string; at: number; ally?: string; marks: WarBattle['marks'] }[]): WarFile {
  const f = emptyWars() as WarFile;
  for (const b of battles) {
    f.wars.push({ id: b.id.split('.')[0], atk: b.atk ?? A, def: b.def ?? B, phase: 'camp', battles: [{ id: b.id, at: b.at, ...(b.ally ? { ally: b.ally } : {}), marks: b.marks } as WarBattle] } as unknown as WarRow);
  }
  return f;
}

const river: FightMark = { out: 'win', river: true, siege: true };
const lostRiver: FightMark = { out: 'loss', river: true, siege: true };

describe('журнал сервера — метки боёв войны', () => {
  it('у похода — его метка, у города — своя, у союзника выручки — своя', () => {
    const f = file(
      { id: 'w1.0', at: 10, marks: { atk: river, def: lostRiver } },
      { id: 'w2.0', at: 20, atk: C, def: B, ally: castleIdOf(A), marks: { ally: river, atk: lostRiver } },
    );
    expect(warMarksOf(f, A).map((m) => [m.war!.id, m.out])).toEqual([
      ['w1.0', 'win'],
      ['w2.0', 'win'],
    ]);
    expect(warMarksOf(f, B).map((m) => [m.war!.id, m.out])).toEqual([['w1.0', 'loss']]);
    expect(warMarksOf(f, C).map((m) => [m.war!.id, m.out])).toEqual([['w2.0', 'loss']]);
  });
  it('бои до ДР-4 меток не несут — в журнал не идут: история до выкладки не считается', () => {
    expect(warMarksOf(file({ id: 'w1.0', at: 10, marks: undefined }), A)).toEqual([]);
    expect(scarBookAfter(undefined, file({ id: 'w1.0', at: 10, marks: undefined }), A)).toBeUndefined();
  });
  it('книга переживает чистку войн и не берёт бой дважды', () => {
    const f = file({ id: 'w1.0', at: 10, marks: { atk: river } }, { id: 'w1.1', at: 20, marks: { atk: river } });
    const book = scarBookAfter(undefined, f, A)!;
    expect(scarsAt(book, emptyWars() as WarFile, A)).toEqual(['fords']);
    expect(scarBookAfter(book, f, A)!.marks.length).toBe(2);
    expect(readScarBook(JSON.parse(JSON.stringify(book)))).toEqual(book);
    expect(readScarBook({ marks: [{ out: 'win' }] }), 'метка без номера боя войны — не из книги').toBeUndefined();
  });
  it('черты — той же функцией, что в игре; полководец книги агентов снимает «Страх обстрела»', () => {
    const f = file({ id: 'w1.0', at: 10, marks: { atk: { out: 'loss', arrows: 0.4, gen: 1 } } });
    expect(scarsAt(undefined, f, A, 1)).toEqual(['arrowfear']);
    expect(scarsAt(undefined, f, A, 2)).toEqual([]);
    expect(scarsAt(undefined, f, A, NO_GENERAL)).toEqual([]);
    expect(scarsAt(undefined, f, A), 'полководец неизвестен — держится').toEqual(['arrowfear']);
  });
  it('полководец книги агентов: без сида — неизвестен, пустое место — нет полководца', () => {
    const rec = readWatchRecord({ agents: { seed: 5, at: T0, seats: { general: { person: 3, xp: 0 } } } });
    expect(scarsOfRec(rec).scars?.gen).toBe(3);
    expect(scarsOfRec(readWatchRecord({ agents: { seed: 5, at: T0, seats: { general: { person: 3, xp: 0, vacant: true } } } })).scars?.gen).toBe(NO_GENERAL);
    expect(scarsOfRec(readWatchRecord({ agents: { at: T0, seats: { general: { person: 3, xp: 0 } } } })).scars).toBeUndefined();
  });
});

describe('опись: честная — без флагов, подделка — флаг', () => {
  const f = file({ id: 'w1.0', at: 10, marks: { atk: river } }, { id: 'w1.1', at: 20, marks: { atk: river } });
  const book = scarBookAfter(undefined, f, A) as ScarBook;
  // Граница области: у игрока два боя войны с метками, черта войны из них выходит.
  const honest = { held: ['ghosts', 'fords'], war: ['w1.0', 'w1.1'], warHeld: scarsOf(warMarks(book.marks), 4).map((h) => h.id) };
  it('граница области: бои войны с метками есть, черта войны выходит', () => {
    expect(book.marks.length).toBe(2);
    expect(honest.warHeld).toEqual(['fords']);
  });
  it('честная опись — без флагов; клиент, ещё не принявший второй бой, — тоже', () => {
    expect(scarFaults(honest, book, 4)).toEqual([]);
    expect(scarFaults({ held: ['ghosts'], war: ['w1.0'], warHeld: [] }, book, 4)).toEqual([]);
    expect(scarFaults(undefined, book, 4)).toEqual([]);
  });
  it('черта не из таблицы, больше трёх, обе одной темы — флаг', () => {
    expect(scarFaults({ ...honest, held: ['ghosts', 'dragon'] }, book, 4).join()).toMatch(/не из таблицы: «dragon»/);
    expect(scarFaults({ ...honest, held: ['ghosts', 'fords', 'highland', 'walls'] }, book, 4).join()).toMatch(/больше 3/);
    expect(scarFaults({ ...honest, held: ['ghosts', 'woodfear'] }, book, 4).join()).toMatch(/обе черты одной темы/);
  });
  it('бой войны, которого у сервера нет, — флаг; черты войны не те — флаг; полководец неизвестен — черт войны не сверяет', () => {
    expect(scarFaults({ ...honest, war: ['w1.0', 'w9.9'] }, book, 4).join()).toMatch(/которых у сервера нет: w9\.9/);
    expect(scarFaults({ ...honest, warHeld: ['fords', 'ghosts'] }, book, 4).join()).toMatch(/черты в войне названы/);
    expect(scarFaults({ ...honest, warHeld: [] }, book, 4).join()).toMatch(/а по боям войны выходят «Бродники»/);
    expect(scarFaults({ ...honest, warHeld: [] }, book, undefined)).toEqual([]);
  });
});

describe('война: черты книги, а не приказа и слепка', () => {
  const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });
  const sheet: WarSheet = {
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
    stock: { food: 2000, wood: 3000, stone: 1000 },
    stash: 100,
    gold: 400,
    pop: 400,
    bonded: 20,
    levels: { farm: 4, palisade: 1 },
    power: 5000,
    locks: {},
    seen: [],
  };
  const fordsBook = scarBookAfter(undefined, file({ id: 'w0.0', at: 1, marks: { atk: river } }, { id: 'w0.1', at: 2, marks: { atk: river } }), A)!;
  const roster = () => {
    let r = upsert(emptyRoster(), A, claim('Альфа'), T0);
    r = upsert(r, B, claim('Бета'), T0);
    return upsert(r, C, claim('Гамма'), T0);
  };

  it('приказ и слепок черт не несут: разбор их выбрасывает', () => {
    expect(readArmy({ troops: { spearman: 5 }, resolve: 0, pips: {}, scars: ['ghosts'], scarGen: 1 })).not.toHaveProperty('scars');
    expect(readSheet({ ...sheet, scars: ['ghosts'], scarGen: 1 })).not.toHaveProperty('scars');
  });
  it('поход: в войске — черты книги нападающего и его полководец; книги нет — черт нет', () => {
    for (const [book, want] of [
      [fordsBook, ['fords']],
      [undefined, undefined],
    ] as const) {
      const sheets = new Map<string, SheetAt>([
        [A, { sheet, at: T0, scars: { ...(book ? { book } : {}), gen: 7 } }],
        [B, { sheet, at: T0 }],
      ]);
      const f = emptyWars() as WarFile;
      const army = { troops: { spearman: 60, archer: 30 }, resolve: 0, pips: {}, scars: ['ghosts'], scarGen: 99 } as WarArmy;
      expect(applyOrder(f, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army }, T0, { roster: roster(), sheet: (k) => sheets.get(k) ?? null })).toBeNull();
      expect((f.wars[0] as WarRow).army.scars).toEqual(want);
      expect((f.wars[0] as WarRow).army.scarGen).toBe(7);
    }
  });
  it('у стен: черты книги защитника; названные слепком — не читаются', () => {
    const f = emptyWars() as WarFile;
    expect(liveSheet(f, A, { sheet, at: T0, scars: { book: fordsBook } }, T0).scars).toEqual(['fords']);
    expect(liveSheet(f, A, { sheet: { ...sheet, scars: ['ghosts'] }, at: T0 }, T0).scars).toBeUndefined();
  });
  it('бой войны пишет метки сторон с их полководцами; бой — с чертами книги, у реки', () => {
    const sheets = new Map<string, SheetAt>([
      [A, { sheet, at: T0, scars: { book: fordsBook, gen: 7 } }],
      [B, { sheet, at: T0, scars: { gen: 3 } }],
    ]);
    const f = emptyWars() as WarFile;
    const army = { troops: { spearman: 60, swordsman: 30 }, resolve: 0, pips: {} } as WarArmy;
    expect(applyOrder(f, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army }, T0, { roster: roster(), sheet: (k) => sheets.get(k) ?? null })).toBeNull();
    const w = f.wars[0] as WarRow;
    advance(f, w.arriveAt + 1, sheets);
    const b = w.battles[0];
    // Граница области: бой был.
    expect(b).toBeDefined();
    expect(b.marks?.atk).toMatchObject({ out: b.won ? 'win' : 'loss', siege: true, gen: 7 });
    expect(b.marks?.def).toMatchObject({ out: b.won ? 'loss' : 'win', siege: true, gen: 3 });
    // Ночи, зимы и голода у боя войны нет (Ш6).
    for (const m of [b.marks!.atk!, b.marks!.def!]) for (const k of ['night', 'winter', 'hungry'] as const) expect(m[k]).toBeUndefined();
    // Черты нападающего — во входе боя: клиент пересчитает ролик тем же боем.
    const input = b.input as unknown as { attacker: { scars?: { held: string[] } }; defender: { scars?: unknown }; where?: { siege?: true } };
    expect(input.attacker.scars?.held).toEqual(['fords']);
    expect(input.defender.scars, 'у защитника черт нет').toBeUndefined();
    expect(input.where?.siege).toBe(true);
    // И бой попадает в журнал нападающего и защитника по их ролям.
    expect(warMarksOf(f, A).map((m) => m.war!.id)).toEqual([b.id]);
    expect(warMarksOf(f, B).map((m) => m.war!.id)).toEqual([b.id]);
  });
});
