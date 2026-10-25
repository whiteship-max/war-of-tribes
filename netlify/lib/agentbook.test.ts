// Книга агентов сервера (АГ-1, правило «agents»; docs/trust-boundary.md): кандидат пересчётом по сиду, опыт не быстрее дел, счёт
// найма и жалованья; в войну — числа подтверждённого человека, а не слепка клиента. Честная партия — без флагов и с теми же
// числами, что у игры; подделка — флаг и прежний потолок. Каждая точка свойства сначала утверждает, что она внутри области
// правила (правило 11): опись с сидом, человек на месте, найм в окне.
import { afterEach, describe, expect, it } from 'vitest';
import { agentsAt, agentsStep, capPips, xpGain, type AgentBook } from './agentbook.js';
import { agentFlags } from './watch.js';
import { readWatch, type CastleClaim, type WarArmy, type WarSheet, type WatchCard } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, fairOf, liveSheet, type SheetAt, type WarFile, type WarRow } from './war.js';
import { phaseAt, setPhaseDie } from '../../src/world/siegeroll.js';
import { siegeSince, starvesAt, type SiegeWindow } from '../../src/world/siege.js';
import { tributeAsk } from '../../src/world/parley.js';
import { ENERGY_MAX } from '../../src/world/data/energy.js';
import { AGENT_ROLES, recruitAt, recruitId } from '../../src/game/agentrules.js';
import { windowEnd, windowOf } from '../../src/game/councilrules.js';
import { DEED_GAP, XP_CAP } from '../../src/game/data/agents.js';
import { createInitialState } from '../../src/game/state.js';
import { QUESTS } from '../../src/game/data/quests.js';
import { buildingOfType } from '../../src/game/derived.js';
import { creditTech } from '../../src/game/sim/tech.js';
import { eloquenceOf, pipsOf, sabotageOf, stealthOf, veilOf } from '../../src/game/sim/agents.js';
import { bestRecruit, hireRecruit, recruitsOf } from '../../src/game/sim/recruits.js';
import { watchOf } from '../../src/net/snapshot.js';
import type { GameState } from '../../src/game/types.js';
import type { FigureId } from '../../src/world/types.js';

afterEach(() => setPhaseDie(null));

const T0 = 1_900_000_000_000;
const HOME = { phase: 'home' as const, departAt: 0 };

/** Сыгранная партия: вера названа, места открыты, ратуша и Статуя заданных уровней. */
function town(seed: number, hall: number, statue = 1): GameState {
  const s = createInitialState(seed);
  s.tutorialDone = true;
  s.nextEventAt = Infinity;
  s.completedQuests = QUESTS.map((q) => q.id);
  s.faith.id = 'catholic';
  s.gold = 1_000_000;
  for (const id of AGENT_ROLES) s.agents[id].vacant = false;
  creditTech(s);
  buildingOfType(s, 'town_hall')!.level = hall;
  buildingOfType(s, 'statue')!.level = statue;
  return s;
}

/** Опись партии так, как её прочтёт сервер (`contract.readWatch`). */
const card = (s: GameState): WatchCard => readWatch(JSON.parse(JSON.stringify(watchOf(s))))!;

/** Нанять на место кандидата с условием — в первом окне, где он есть. */
function hireWhere(s: GameState, role: FigureId, ok: (c: ReturnType<typeof recruitsOf>[number]) => boolean): void {
  for (let i = 0; i < 400; i++) {
    const c = recruitsOf(s, role).find(ok);
    if (c) {
      expect(hireRecruit(s, role, c.n, HOME)).toBeNull();
      return;
    }
    s.time = windowEnd(windowOf(s.time));
  }
  throw new Error('кандидата нет');
}

describe('книга агентов: честная партия', () => {
  it('сид — первый увиденный; люди и метки — как в описи; флагов нет; числа войны — те же, что у игры', () => {
    const s = town(101, 10, 3);
    hireWhere(s, 'general', (c) => (c.head.pips ?? 0) >= 1);
    hireWhere(s, 'spy', (c) => (c.head.stealth ?? 0) >= 1 && (c.head.sabotage ?? 0) >= 1);
    hireWhere(s, 'diplomat', (c) => (c.head.eloquence ?? 0) >= 1);
    const c = card(s);
    expect(c.seed, 'точка внутри области: опись несёт сид').toBe(s.seed >>> 0);
    const { book, found } = agentsStep(undefined, c, T0, 10);
    expect(found).toEqual([]);
    expect(book.seed).toBe(s.seed >>> 0);
    for (const role of AGENT_ROLES) expect(book.seats[role]?.person).toBe(s.agents[role].person);
    expect(book.seats.general?.n).toBe(s.agents.general.cand!.n);
    const at = agentsAt(book, 3);
    expect(at.pips, 'отметки — те же, что у игры').toEqual(pipsOf(s));
    expect(at.stealth).toBeCloseTo(stealthOf(s), 9);
    expect(at.veil).toBeCloseTo(veilOf(s), 9);
    expect(at.sabotage).toBeCloseTo(sabotageOf(s), 9);
    expect(at.eloquence).toBeCloseTo(eloquenceOf(s), 9);
    // Прошло время, опыт вырос честно — без флагов.
    s.agents.spy.xp = 4;
    const next = agentsStep(book, card(s), T0 + 2 * DEED_GAP, 10);
    expect(next.found).toEqual([]);
    expect(next.book.seats.spy?.xp).toBe(4);
  });

  it('опись без сида (до АГ-1) — книга чисел войны не даёт: правило прежнее', () => {
    const s = town(102, 10);
    const c = card(s);
    delete c.seed;
    const { book } = agentsStep(undefined, c, T0, 10);
    expect(book.seed).toBeUndefined();
    expect(agentsAt(book, 10)).toEqual({});
    expect(capPips({ fire: 3 }, undefined), 'нет потолка — как есть').toEqual({ fire: 3 });
  });
});

describe('книга агентов: подделка — флаг, человек ровный, потолок прежний', () => {
  /** Опись честной партии с нанятым лазутчиком, книга после неё — и книга после правки описи. */
  function forged(edit: (c: WatchCard) => void, hall = 10): { found: string[]; book: AgentBook } {
    const s = town(103, 10);
    const first = agentsStep(undefined, card(s), T0, 10);
    expect(first.found, 'точка внутри области: до подделки чисто').toEqual([]);
    s.agents.spy.vacant = true;
    const c = bestRecruit(s, 'spy')!;
    expect(hireRecruit(s, 'spy', c.n, null)).toBeNull();
    const w = card(s);
    edit(w);
    return agentsStep(first.book, w, T0 + 60_000, hall);
  }
  const spyOf = (c: WatchCard) => c.agents!.seats.find((x) => x.role === 'spy')!;

  it('кандидат чужого места — флаг, человек ровный', () => {
    const r = forged((c) => {
      spyOf(c).n = recruitId(windowOf(spyOf(c).at!), 'general', 0);
    });
    expect(r.found.join(' ')).toMatch(/не на это место/);
    expect(r.book.seats.spy?.n, 'ровный').toBeUndefined();
  });

  it('кандидат не из окна своего найма — флаг', () => {
    const r = forged((c) => {
      spyOf(c).n = recruitId(windowOf(spyOf(c).at!) + 3, 'spy', 0);
    });
    expect(r.found.join(' ')).toMatch(/не из окна/);
    expect(r.book.seats.spy?.n).toBeUndefined();
  });

  it('ступень выше той, что даёт ратуша книги стройки, — флаг', () => {
    const r = forged((c) => {
      spyOf(c).tier = 3;
    }, 1);
    expect(r.found.join(' ')).toMatch(/ступени 3 при ратуше/);
    expect(r.book.seats.spy?.n).toBeUndefined();
  });

  it('опыт быстрее дел — флаг и потолок; сид сменился — флаг, книга держит первый; номер человека убыл — флаг', () => {
    const r = forged((c) => {
      spyOf(c).xp = XP_CAP;
      c.seed = (c.seed ?? 0) + 1;
    });
    const text = r.found.join(' ');
    expect(text).toMatch(/опыт/);
    expect(text).toMatch(/сид партии сменился/);
    expect(r.book.seats.spy?.xp, 'опыт под потолком дел').toBeLessThanOrEqual(xpGain(60_000, ['apt']));
    expect(r.book.seats.spy?.xp).toBeLessThan(XP_CAP);
    const s = town(104, 10);
    const b = agentsStep(undefined, card(s), T0, 10).book;
    b.seats.scout = { person: 5, xp: 0 };
    expect(agentsStep(b, card(s), T0 + 1, 10).found.join(' '), 'опись называет человека №0 после №5').toMatch(/номер человека убыл/);
  });

  it('счёт найма: новых нанятых больше наймов, плата вперёд меньше цены, жалованье не уплачено — флаги', () => {
    const s = town(105, 10);
    const a = card(s);
    s.agents.scout.vacant = true;
    const c = bestRecruit(s, 'scout')!;
    expect(hireRecruit(s, 'scout', c.n, null)).toBeNull();
    const b = card(s);
    expect(agentFlags(a, b, 1, 60_000), 'точка внутри области: честный найм — без флагов').toEqual([]);
    const r = recruitAt(s.seed, c.n, c.tier);
    expect(r.level, 'кандидат с платой').toBeGreaterThan(0);
    const cheat = { ...b, agents: { ...b.agents!, hired: a.agents!.hired, fees: a.agents!.fees } };
    const text = agentFlags(a, cheat, 1, 60_000).map((f) => f.text).join(' ');
    expect(text).toMatch(/наймов в счёте/);
    if (c.advance > 0) expect(text).toMatch(/плата вперёд/);
    const unpaid = agentFlags(b, { ...b, agents: { ...b.agents! } }, 400, 400 * 1_800_000).map((f) => f.text).join(' ');
    expect(unpaid).toMatch(/жалованья уплачено/);
  });
});

describe('война: числа подтверждённого человека, а не слепка', () => {
  it('отметки слепка и приказа — не выше подтверждённого полководца; «осада» — своим счётом', () => {
    expect(capPips({ fire: 3, shock: 1, siege: 2 }, { fire: 1, melee: 2 })).toEqual({ fire: 1, siege: 2 });
    const s = town(106, 10, 1);
    const book = agentsStep(undefined, card(s), T0, 10).book;
    const at = agentsAt(book, 1);
    expect(at.pips, 'свой полководец первого уровня при Статуе 1 — без отметок').toEqual({});
    expect(capPips({ fire: 4 }, at.pips), 'названные отметки срезаны').toEqual({});
  });

  /** Альфа осадила Бету: лагерь стоит, Бета — с дипломатом подтверждённого красноречия `eloquence`. */
  function camped(eloquence: number) {
    setPhaseDie(() => 7);
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
    let roster = upsert(emptyRoster(), A, claim('Альфа'), T0);
    roster = upsert(roster, B, claim('Бета'), T0);
    roster = upsert(roster, 'tg-2003', claim('Гамма'), T0);
    const sheets = new Map<string, SheetAt>([
      [A, { sheet, at: T0 }],
      [B, { sheet, at: T0, ...(eloquence > 0 ? { agents: { eloquence } } : {}) }],
    ]);
    const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
    const file = emptyWars() as WarFile;
    const army: WarArmy = { troops: { spearman: 60, archer: 30 }, resolve: 0, pips: {} };
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'captives', army }, T0, ctx)).toBeNull();
    const w = file.wars[0] as WarRow;
    advance(file, w.arriveAt + 1, sheets);
    w.army = { ...w.army, energy: { value: ENERGY_MAX, at: w.arriveAt, mode: 'camp' } };
    const at = phaseAt(siegeSince(w.camp as SiegeWindow), 1) + 3_600_000;
    advance(file, at, sheets);
    expect(w.phase, 'точка внутри области: лагерь стоит').toBe('camp');
    expect(at < starvesAt(w.camp as SiegeWindow)).toBe(true);
    return { file, sheets, ctx, w, at, B };
  }

  it('дань за снятие: красноречие дипломата по книге сервера сбавляет цену; без него — справедливая', () => {
    const plain = camped(0);
    expect(applyOrder(plain.file, plain.B, { op: 'offer', id: plain.w.id, kind: 'tribute' }, plain.at, plain.ctx)).toBeNull();
    const fair = fairOf(plain.w, plain.at, liveSheet(plain.file, plain.B, plain.sheets.get(plain.B)!, plain.at));
    expect(fair, 'точка внутри области: дань не пустая').toBeGreaterThan(0);
    expect(plain.w.camp!.offers![0].price).toBe(fair);
    const sweet = camped(0.25);
    expect(applyOrder(sweet.file, sweet.B, { op: 'offer', id: sweet.w.id, kind: 'tribute' }, sweet.at, sweet.ctx)).toBeNull();
    expect(sweet.w.camp!.offers![0].price).toBe(tributeAsk(fair, 0.25));
    expect(sweet.w.camp!.offers![0].price!).toBeLessThan(fair);
  });
});
