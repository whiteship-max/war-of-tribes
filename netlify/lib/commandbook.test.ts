// Книга командиров флангов сервера (ДР-3, правило «command»; docs/trust-boundary.md): кандидат пересчётом по сиду, место — из
// окна своего найма, со своего места в списке и не выше Казарм книги стройки; один человек — одно место; покой по возрасту; счёт
// найма и жалованья; в войну — тактика книги, а не приказа и слепка; указ рыцарства — со слагаемым командиров. Честная партия —
// без флагов и с теми же числами, что у игры; подделка — флаг и пустое место. Каждая точка свойства сначала утверждает, что она
// внутри области правила (правило 11): опись с сидом, место занято, найм в окне.
import { describe, expect, it } from 'vitest';
import { claimedLead, commandAt, commandStep, readCommandBook, type CommandBook } from './commandbook.js';
import { commandFlags, estateFaults, readWatchRecord } from './watch.js';
import type { CastleClaim, WarArmy, WarSheet, WatchCard } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { applyOrder, emptyWars, liveSheet, type SheetAt, type WarFile, type WarRow } from './war.js';
import { COMMONER_SLIGHT, LORD_FAVOR, commandGrowth, commandRetireAge, commanderAt, commanderId, windowOfCommander } from '../../src/game/commandrules.js';
import { AGENT_YEAR, DEED_GAP } from '../../src/game/data/agents.js';
import { gameSecondsOfMs } from '../../src/game/pace.js';
import { AGENT_ROLES } from '../../src/game/agentrules.js';
import { createInitialState } from '../../src/game/state.js';
import { QUESTS } from '../../src/game/data/quests.js';
import { buildingOfType, commandLead } from '../../src/game/derived.js';
import { creditTech } from '../../src/game/sim/tech.js';
import { commandBattle, commandFlanks, commandSeat, commandWatch } from '../../src/game/sim/command.js';
import { commandersOf, hireCommander } from '../../src/game/sim/commanders.js';
import type { GameState } from '../../src/game/types.js';

const T0 = 1_900_000_000_000;
const HOME = { phase: 'home' as const, departAt: 0 };

/** Сыгранная партия с Казармами уровня `barracks`. */
function town(seed: number, barracks: number): GameState {
  const s = createInitialState(seed);
  s.tutorialDone = true;
  s.nextEventAt = Infinity;
  s.completedQuests = QUESTS.map((q) => q.id);
  s.faith.id = 'catholic';
  s.gold = 1_000_000;
  for (const id of AGENT_ROLES) s.agents[id].vacant = false;
  creditTech(s);
  buildingOfType(s, 'barracks')!.level = barracks;
  return s;
}

/** Опись командиров и сида — той же функцией, что собирает опись игры (`sim/command.commandWatch`). */
const card = (s: GameState): WatchCard =>
  JSON.parse(JSON.stringify({ command: commandWatch(s), seed: s.seed >>> 0, time: Math.floor(s.time) })) as WatchCard;

/** Лорд слева, безродный справа — первые кандидаты своего рода в окне. */
function staffed(seed: number, barracks: number): GameState {
  const s = town(seed, barracks);
  for (const [f, birth] of [['left', 'noble'], ['right', 'low']] as const) {
    const c = commandersOf(s).find((x) => x.birth === birth)!;
    expect(hireCommander(s, f, c.n, HOME)).toBeNull();
  }
  return s;
}

describe('книга командиров: кандидат пересчётом по сиду', () => {
  it('честная опись — без флагов, и числа книги — те же, что у игры: тактика флангов и слагаемое знати', () => {
    const s = staffed(901, 7);
    const c = card(s);
    const { book, found } = commandStep(undefined, c, T0, c.seed, 7);
    expect(found).toEqual([]);
    expect(Object.keys(book.seats).sort()).toEqual(['left', 'right']);
    expect(commandAt(book, c.seed)).toEqual({ flanks: commandFlanks(s), lead: commandLead(s) });
    expect(commandLead(s)).toBe(LORD_FAVOR - COMMONER_SLIGHT);
  });

  it('сида нет — мест не подтверждает: командиров в войне нет', () => {
    const s = staffed(902, 7);
    const c = { ...card(s), seed: undefined };
    const { book } = commandStep(undefined, c, T0, undefined, 7);
    expect(book.seats).toEqual({});
    expect(commandAt(book, undefined)).toEqual({ flanks: {}, lead: 0 });
  });

  /** Подделка одного места: правка описи → флаг с текстом и пустое место. */
  const forged = (edit: (c: WatchCard) => void, barracks: number, text: RegExp): void => {
    const s = staffed(903, 7);
    const c = card(s);
    // Граница области: без правки опись честная — флагов нет, оба места заняты.
    expect(commandStep(undefined, c, T0, c.seed, 7).found).toEqual([]);
    edit(c);
    const { book, found } = commandStep(undefined, c, T0, c.seed, barracks);
    expect(found.join(' | '), text.source).toMatch(text);
    expect(Object.keys(book.seats).length, 'неподтверждённое место — пустое').toBeLessThan(2);
  };

  it('подделки: ступень выше Казарм, чужое окно, место дальше списка, один на двух флангах, найм из будущего, чужое место', () => {
    forged(() => {}, 1, /при Казармах, что дают не выше 1/);
    forged((c) => (c.command!.seats[0].at += 1e9), 7, /не из окна своего найма|часы партии/);
    forged((c) => {
      const n = c.command!.seats[0].n;
      c.command!.seats[0] = { ...c.command!.seats[0], n: commanderId(windowOfCommander(n), 3), tier: 1 };
    }, 7, /4-й в списке, а ступень 1 даёт 2/);
    forged((c) => (c.command!.seats[1] = { ...c.command!.seats[1], n: c.command!.seats[0].n }), 7, /на двух флангах/);
    // Найм в той же сезонной сетке, но позже часов партии описи.
    forged((c) => (c.command!.seats[0] = { ...c.command!.seats[0], at: (c.time ?? 0) + 50 }), 7, /часы партии/);
    forged((c) => (c.command!.seats[0] = { ...c.command!.seats[0], flank: 'center' }), 7, /места «center» нет/);
  });

  it('командир старше своего покоя — место пустое, и прежний тоже', () => {
    const s = staffed(904, 7);
    const c = card(s);
    const first = commandStep(undefined, c, T0, c.seed, 7);
    expect(first.found).toEqual([]);
    const seat = c.command!.seats[0];
    const who = commanderAt(c.seed!, seat.n, seat.tier);
    const old = { ...c, time: seat.at + (commandRetireAge(who.traits) - who.age0 + 1) * AGENT_YEAR };
    const again = commandStep(first.book, old, T0 + 60_000, c.seed, 7);
    expect(again.found.join(' '), 'покой').toMatch(/старше своего покоя/);
    expect(again.book.seats[seat.flank as 'left']).toBeUndefined();
  });

  it('прежнее место не пересматривается по ступени: Казармы упали после найма — командир служит', () => {
    const s = staffed(905, 7);
    const c = card(s);
    const first = commandStep(undefined, c, T0, c.seed, 7);
    // Граница области: найм ступени 3 — Казармы 1 его бы не дали.
    expect(c.command!.seats.every((x) => x.tier === 3)).toBe(true);
    const later = commandStep(first.book, c, T0 + 60_000, c.seed, 1);
    expect(later.found).toEqual([]);
    expect(Object.keys(later.book.seats).length).toBe(2);
  });

  it('книга из записи читается с проверкой; старая запись — без книги', () => {
    const book: CommandBook = { at: 5, seats: { left: { n: 1, tier: 2, at: 3 } } };
    expect(readCommandBook(JSON.parse(JSON.stringify(book)))).toEqual(book);
    expect(readCommandBook({ seats: { center: { n: 1, tier: 1, at: 0 }, left: { n: -1, tier: 1, at: 0 } } })).toEqual({ at: 0, seats: {} });
    expect(readCommandBook(null)).toBeUndefined();
    expect(readWatchRecord({ v: 1 }).command).toBeUndefined();
  });
});

describe('счёт найма командиров между описями', () => {
  it('честный найм — без флагов; найм без счёта, плата меньше цены, убывший счёт, неуплата — флаг', () => {
    const s = town(906, 7);
    const a = card(s);
    const c = commandersOf(s).find((x) => x.advance > 0)!;
    // Граница области: кандидат с платой вперёд.
    expect(c).toBeTruthy();
    expect(hireCommander(s, 'left', c.n, HOME)).toBeNull();
    const b = card(s);
    expect(commandFlags(a, b, 1, 60_000)).toEqual([]);
    const cheat = { ...b, command: { ...b.command!, hired: 0, fees: 0 } };
    const text = commandFlags(a, cheat, 1, 60_000).map((f) => f.text).join(' ');
    expect(text).toMatch(/наймов в счёте 0/);
    expect(text).toMatch(/плата вперёд/);
    expect(commandFlags(b, { ...b, command: { ...b.command!, hired: 0 } }, 1, 60_000).map((f) => f.text).join(' ')).toMatch(/Счёт командиров убыл/);
    const unpaid = commandFlags(b, { ...b, command: { ...b.command! } }, 400, 400 * 1_800_000).map((f) => f.text).join(' ');
    expect(unpaid).toMatch(/жалованья уплачено/);
  });
});

describe('знать: указ рыцарства меряется со слагаемым командиров', () => {
  it('два безродных при ровной знати закрывают указ рыцарства — он ложится флагом; без них — нет', () => {
    const s = town(907, 7);
    for (const f of ['left', 'right'] as const) {
      const c = commandersOf(s).find((x) => x.birth === 'low')!;
      expect(hireCommander(s, f, c.n, HOME)).toBeNull();
    }
    // Граница области: знать ровная по весу — все постройки первого уровня, перевеса нет, и потолок указа решают слагаемые.
    const base: WatchCard = {
      ...card(s),
      buildings: Object.fromEntries(s.buildings.map((b) => [b.type, 1])),
      estates: { priv: [0, 0, 0, 0, 0], decree: 'knights', infl: [], grants: 0, revokes: 0, gifts: 0 },
    } as WatchCard;
    expect(claimedLead(base)).toBe(-2 * COMMONER_SLIGHT);
    expect(estateFaults(base).join(' ')).toMatch(/указ «knights»/);
    const none = { ...base, command: undefined } as WatchCard;
    expect(claimedLead(none)).toBe(0);
    expect(estateFaults(none).join(' ')).not.toMatch(/указ «knights»/);
  });
});

describe('война: тактика флангов книги, а не приказа и слепка', () => {
  // Те же игроки, что у переговоров (`warparley.test.ts`): их замки стоят в одном краю.
  const A = 'tg-2001';
  const B = 'tg-2002';
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
  const booked = { flanks: { A: 2, C: -1 }, lead: LORD_FAVOR - COMMONER_SLIGHT };

  it('поход: приказ с названной тактикой — в войске тактика книги нападающего; книги нет — командиров нет', () => {
    let roster = upsert(emptyRoster(), A, claim('Альфа'), T0);
    roster = upsert(roster, B, claim('Бета'), T0);
    roster = upsert(roster, 'tg-2003', claim('Гамма'), T0);
    for (const [cmd, want] of [
      [booked, booked.flanks],
      [undefined, undefined],
    ] as const) {
      const sheets = new Map<string, SheetAt>([
        [A, { sheet, at: T0, ...(cmd ? { command: cmd } : {}) }],
        [B, { sheet, at: T0 }],
      ]);
      const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
      const file = emptyWars() as WarFile;
      const army = { troops: { spearman: 60, archer: 30 }, resolve: 0, pips: {}, flanks: { A: 9, C: 9 } } as WarArmy;
      expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'captives', army }, T0, ctx)).toBeNull();
      expect((file.wars[0] as WarRow).army.flanks).toEqual(want);
    }
  });

  it('у стен: полководец в городе — тактика книги защитника; не в городе — нет; названная слепком — не читается', () => {
    const file = emptyWars() as WarFile;
    const at = (s: Partial<WarSheet>, cmd?: typeof booked): SheetAt => ({ sheet: { ...sheet, ...s }, at: T0, ...(cmd ? { command: cmd } : {}) });
    expect(liveSheet(file, B, at({ led: true }, booked), T0).flanks).toEqual(booked.flanks);
    expect(liveSheet(file, B, at({}, booked), T0).flanks, 'полководца нет — командиров нет').toBeUndefined();
    expect(liveSheet(file, B, at({ led: true, flanks: { A: 9 } }), T0).flanks, 'слепок не судит').toBeUndefined();
    expect(liveSheet(file, B, at({ flanks: { A: 9 } }, booked), T0).flanks).toBeUndefined();
  });
});


describe('служба командиров (ДР-5): опыт под потолком дел, ушедший не возвращается', () => {
  it('честный опыт — без флага, и тактика книги в войну — по опыту, та же, что у игры', () => {
    const s = staffed(911, 7);
    const t0 = 1_000_000;
    // Бои полководца не ближе срока между делами — честно растёт.
    for (let k = 0; k < 12; k++) commandBattle(s, { at: t0 + k * DEED_GAP, ok: true, seed: k + 1, peril: { left: 0, right: 0 } });
    const xp = commandSeat(s, 'right')?.xp ?? 0;
    expect(commandGrowth(xp), 'точка внутри области: командир вырос').toBeGreaterThan(0);
    // Партия сыграна с минуты найма достаточно долго, чтобы двенадцать дел уместились.
    s.time = commandSeat(s, 'right')!.at + gameSecondsOfMs(12 * DEED_GAP);
    const c = card(s);
    const { book, found } = commandStep(undefined, c, T0, c.seed, 7);
    expect(found).toEqual([]);
    expect(book.seats.right?.xp).toBe(xp);
    expect(commandAt(book, c.seed).flanks).toEqual(commandFlanks(s));
  });

  it('опыт быстрее дел — флаг, в книгу — потолок; тактика не выше потолка', () => {
    const s = staffed(912, 7);
    const c = card(s);
    const seat = c.command!.seats.find((x) => x.flank === 'right')!;
    // Только что нанят: за минуты службы дел не больше одного.
    seat.xp = 60;
    const { book, found } = commandStep(undefined, c, T0, c.seed, 7);
    expect(found.some((t) => t.includes('опыт командира 60'))).toBe(true);
    expect(book.seats.right?.xp ?? 0).toBeLessThan(60);
    expect(commandGrowth(book.seats.right?.xp ?? 0)).toBe(0);
  });

  it('ушедший с места назад не садится: флаг и пустое место', () => {
    const s = staffed(913, 7);
    const c1 = card(s);
    const first = commandStep(undefined, c1, T0, c1.seed, 7).book;
    const n = first.seats.right!.n;
    // Пал — места нет в следующей описи: номер ушёл в память книги.
    const c2 = card(s);
    c2.command!.seats = c2.command!.seats.filter((x) => x.flank !== 'right');
    const second = commandStep(first, c2, T0 + 60_000, c2.seed, 7);
    expect(second.found).toEqual([]);
    expect(second.book.gone).toContain(n);
    // Тот же номер снова на месте — флаг, место пустое; книга помнит его и после чтения.
    const back = commandStep(readCommandBook(JSON.parse(JSON.stringify(second.book))), card(s), T0 + 120_000, c1.seed, 7);
    expect(back.found.some((t) => t.includes(`№${n} ушёл с места и вернулся`))).toBe(true);
    expect(back.book.seats.right).toBeUndefined();
  });
});
