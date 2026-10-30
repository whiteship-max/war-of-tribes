// Договоры НПС (ПН-7, docs/gdd/path_of_sword.md, 3.8 и «Решения ПН-7»): доска заказчика, плата от эталона тира (E1), строка договора —
// функцией условий (правило 18), цикл «взят → исполнен → сдан / сорван», неустойка и долг, закрывающий доску.
//
// Путь включён подменой модуля (`vi.mock`), как в `pn5.test.ts`. Граница области — утверждениями: отряд правда стоит у заказчика или у
// цели, предложение правда того вида, срок правда вышел или не вышел, город правда II–III, у села правда угроза.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { beginRoam, campGain, foodAfter, mergeRoam, roamStep, setMove, setTrip } from '@/game/sim/roam';
import { takeFight } from '@/game/sim/roamfight';
import { dealStep, debtTo, failDeal, payDebt, refuseDeal, settle, takeBlock, takeDeal, termsOf } from '@/game/sim/contracts';
import { CONTRACTS_MAX, DEAL_DEFS } from '@/game/data/contracts';
import { contractTerms, dealLine, dealRow, settlePay, termWords, tierWord } from '@/game/contractrules';
import { roamStub } from '@/game/roamstubs';
import { DAY_LENGTH, realMs } from '@/game/pace';
import { RoamWorld, type RoamPort } from './local/RoamWorld';
import { SICILY, inSicilyTheatre } from './spawn';
import type { Spot } from './land';
import { roamSeat } from './roam';
import { standWay } from './roammove';
import { pointsIn, type RoamPoint } from './roampoints';
import { boardsAt, threatOf, type DealOffer } from './dealboard';
import { generateWorld, isLair } from './gen';
import '@/game/roamdoor';

vi.mock('@/game/roamflag', () => ({ ROAM_ON: true, roamOpenFor: () => true, roamOn: () => true, setRoamOpen: () => {} }));

const SEED = 20261029;
const T0 = Date.UTC(2026, 9, 29, 12);
const HOME: Spot = SICILY[0];
const SYNC = {} as Parameters<RoamWorld['sync']>[0];
const NONE = { lairs: [], beaten: (): boolean => false };
/** Логова мира бродяги у места выхода — те же, что строит мир (`world/gen` с клеткой выхода). */
const NEAR = {
  lairs: generateWorld(SEED, HOME)
    .settlements.filter(isLair)
    .map((st) => ({ id: st.id, x: st.x, y: st.y, name: st.name })),
  beaten: (): boolean => false,
};

function party(band: Record<string, number> = { spearman: 8, clubman: 4 }, prestige = 0): GameState {
  const s = createInitialState(SEED);
  expect(beginRoam(s, { origin: 'warrior', hero: { name: 'Ратко', war: 2 }, band, purse: 100, food: 200 })).toBeNull();
  setMove(s, roamSeat(HOME, T0));
  s.prestige = prestige;
  return s;
}

/** Отряд стоит в клетке `at` с минуты раньше `now` (та же запись хода, что кладёт сервер). */
const standAt = (s: GameState, at: { x: number; y: number }, now: number): void => void setMove(s, { way: standWay('normal', { x: at.x, y: at.y }, now - 60_000), camp: null });

function portOf(s: GameState): RoamPort {
  return {
    band: () => s.roam ?? null,
    apply: (m) => void setMove(s, m),
    foodAfter: (ms, g) => foodAfter(s, ms, g),
    campGain: (k, open) => campGain(s, k, open),
    partyTime: () => s.time,
    prestige: () => s.prestige,
    setTrip: (t) => setTrip(s, t),
    fight: (f) => takeFight(s, f),
    failDeal: (id, why) => failDeal(s, id, why),
  };
}

const world = (s: GameState, now: () => number): RoamWorld => new RoamWorld({ seed: SEED, storage: null, now, home: HOME }, portOf(s));

/** Ближайшие к месту выхода точки вида в регионе Сицилии. */
function nearest(kind: RoamPoint['kind'], ok: (p: RoamPoint) => boolean = () => true): RoamPoint[] {
  return pointsIn(SEED, HOME.x - 40, HOME.y - 40, HOME.x + 41, HOME.y + 41)
    .filter((p) => p.kind === kind && inSicilyTheatre(p) && ok(p))
    .sort((a, b) => Math.hypot(a.x - HOME.x, a.y - HOME.y) - Math.hypot(b.x - HOME.x, b.y - HOME.y));
}

const TOWN = nearest('town')[0];
const townBoard = (s: GameState, now = T0): DealOffer[] => boardsAt(SEED, TOWN, now, s.prestige, NEAR).find((b) => b.from.who === 'town')?.offers ?? [];
/** Предложения доски города за `n` привозов от `T0` — вид ищется по нескольким доскам. */
const shiftsOf = (s: GameState, n = 16): DealOffer[] => Array.from({ length: n }, (_, w) => townBoard(s, T0 + w * 3 * 3600_000)).flat();
const offerOf = (s: GameState, kind: DealOffer['kind']): DealOffer => {
  const o = shiftsOf(s).find((x) => x.kind === kind);
  expect(o, `граница: на доске ${TOWN.name} есть «${kind}»`).toBeDefined();
  return o as DealOffer;
};
const outOps = (s: GameState): string[] => (s.roam?.outbox ?? []).map((o) => o.op);

describe('доска договоров (ГДД 3.8.1–3.8.2)', () => {
  it('вольный город: доска по привозу (3 ч UTC), виды города, тир — по ступени престижа', () => {
    expect(TOWN, 'граница: вольный город у места выхода есть').toBeDefined();
    const s = party();
    const a = townBoard(s, T0);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(roamStub('boardSize'));
    expect(a.every((o) => o.tier === 1 && ['lair', 'vataga', 'cargo'].includes(o.kind))).toBe(true);
    expect(townBoard(s, T0 + 60_000).map((o) => o.id), 'тот же привоз — та же доска').toEqual(a.map((o) => o.id));
    expect(townBoard(s, T0 + 3 * 3600_000).map((o) => o.id), 'новый привоз — новая доска').not.toEqual(a.map((o) => o.id));
    s.prestige = roamStub('stages')[2];
    expect(townBoard(s).every((o) => o.tier === 2)).toBe(true);
  });

  it('кастелян — у города II–III (до ПН-10) раз в сутки; село — только при угрозе', () => {
    const t2 = nearest('town', (p) => p.tier >= 2)[0];
    const t1 = nearest('town', (p) => p.tier === 1)[0];
    expect(t2 && t1, 'граница: города обеих ступеней есть').toBeTruthy();
    const whos = (c: RoamPoint): string[] => boardsAt(SEED, c, T0, 0, NONE).filter((b) => b.from.x === c.x && b.from.y === c.y).map((b) => b.from.who);
    expect(whos(t2)).toContain('castellan');
    expect(whos(t1)).not.toContain('castellan');
    const cast = (now: number): string[] => (boardsAt(SEED, t2, now, 0, NONE).find((b) => b.from.who === 'castellan')?.offers ?? []).map((o) => o.id);
    expect(cast(T0 + 6 * 3600_000), 'сутки те же — поручения те же').toEqual(cast(T0));
    const vill = nearest('village');
    const threatened = vill.find((v) => threatOf(SEED, v, NONE) !== null);
    const calm = vill.find((v) => threatOf(SEED, v, NONE) === null);
    expect(threatened && calm, 'граница: есть сёла с угрозой и без').toBeTruthy();
    const kinds = (v: RoamPoint): string[] => boardsAt(SEED, v, T0, 0, NONE).find((b) => b.from.who === 'village' && b.from.id === v.id)?.offers.map((o) => o.kind) ?? [];
    expect(kinds(threatened as RoamPoint)).toEqual(['defend', 'vataga']);
    expect(kinds(calm as RoamPoint)).toEqual([]);
  });
});

describe('плата — от эталона тира, а не от отряда игрока (E1, 6.2)', () => {
  it('отряд 12 и 120 человек при том же престиже: та же доска и те же условия, замороженные взятием', () => {
    const small = party({ spearman: 8, clubman: 4 }, 0);
    const big = party({ spearman: 120 }, 0);
    expect(townBoard(big)).toEqual(townBoard(small));
    const o = offerOf(small, 'lair');
    for (const s of [small, big]) {
      standAt(s, TOWN, T0);
      expect(takeDeal(s, o, T0)).toBeNull();
    }
    const pick = (s: GameState): unknown => {
      const d = s.roam?.deals?.[0];
      return d && { pay: d.pay, advance: d.advance, penalty: d.penalty, refuse: d.refuse, fame: d.fame, power: d.power, until: d.until };
    };
    expect(pick(big)).toEqual(pick(small));
    expect(small.roam?.deals?.[0].pay, 'граница: плата — не ноль').toBeGreaterThan(0);
  });

  it('ступень выше — договор дороже и противник сильнее', () => {
    const lo = contractTerms({ kind: 'lair', tier: 1, power: 10, roadMs: 3600_000 });
    const hi = contractTerms({ kind: 'lair', tier: 2, power: 60, roadMs: 3600_000 });
    expect(hi.pay).toBeGreaterThan(lo.pay);
    expect(hi.fame).toBe(20);
  });
});

describe('строка договора — функцией условий (правило 18)', () => {
  it('поля строки — числа `contractTerms`, строка одной строкой — те же поля', () => {
    const s = party();
    const o = offerOf(s, 'vataga');
    const t = termsOf(o);
    const row = dealRow(t);
    expect(row.name).toBe(DEAL_DEFS.vataga.name);
    expect(row.pay).toBe(`плата ${t.pay}`);
    expect(row.advance).toBe(`аванс ${t.advance}`);
    expect(row.term).toBe(`срок ${termWords(t.days)}`);
    expect(row.tier).toBe(`тир ${tierWord(1)}`);
    expect(dealLine(t)).toBe(Object.values(row).join(' · '));
  });

  it('окно доски печатает строку `dealRow` и своей арифметики платы не держит', () => {
    const src = readFileSync(join(__dirname, '..', 'ui', 'map', 'roam', 'RoamDeals.tsx'), 'utf8');
    expect(src).toContain('d.dealRow(d.termsOf(o))');
    expect(src).toContain('door.settlePay(d)');
    for (const no of ['DEAL_K', 'DEAL_R', 'etalonUpkeep', 'LAIR_GOLD_PER_POWER', '.pay -', '.pay*', '.pay *']) expect(src, no).not.toContain(no);
  });
});

describe('цикл договора (ГДД 3.8.4–3.8.5)', () => {
  it('взять: аванс — в кошель, номер доски — второй раз не взять, приказ книги «взят»; только у заказчика', () => {
    const s = party();
    const o = offerOf(s, 'lair');
    expect(takeBlock(s, o, T0), 'граница: отряд не у заказчика').toMatch(/у заказчика/);
    standAt(s, TOWN, T0);
    const purse = s.roam?.purse ?? 0;
    expect(takeDeal(s, o, T0)).toBeNull();
    expect(s.roam?.purse).toBe(purse + termsOf(o).advance);
    expect(takeBlock(s, o, T0)).toMatch(/уже взят/);
    expect(outOps(s)).toContain('take');
  });

  it(`разом — не больше ${CONTRACTS_MAX}`, () => {
    const s = party({ spearman: 40 }, 0);
    standAt(s, TOWN, T0);
    const offers = shiftsOf(s).filter((o) => o.kind !== 'cargo');
    expect(offers.length, 'граница: на доске больше, чем можно взять').toBeGreaterThan(CONTRACTS_MAX);
    for (const o of offers.slice(0, CONTRACTS_MAX)) expect(takeDeal(s, o, T0)).toBeNull();
    expect(takeBlock(s, offers[CONTRACTS_MAX], T0)).toMatch(/больше не взять/);
  });

  it('удар по цели выигран — исполнен и сдан: остаток платы — в кошель, престиж тира, приказ книги «сдан»', () => {
    const s = party();
    const o = offerOf(s, 'vataga');
    standAt(s, TOWN, T0);
    expect(takeDeal(s, o, T0)).toBeNull();
    const purse = s.roam?.purse ?? 0;
    const fame0 = s.prestige;
    const t = termsOf(o);
    takeFight(s, { how: 'strike', id: o.target.id, name: o.target.name, power: o.power, foeMen: 5, foeLoss: 1, won: true, lost: {}, seed: 7, at: T0 + 3600_000 });
    expect(s.roam?.deals).toBeUndefined();
    // Победа даёт и свою добычу (золото логова) и престиж мощь / S — сверх договора.
    expect((s.roam?.purse ?? 0) - purse).toBeGreaterThanOrEqual(settlePay(t));
    expect(s.prestige - fame0).toBeGreaterThanOrEqual(t.fame);
    expect(outOps(s)).toEqual(expect.arrayContaining(['take', 'deal']));
  });

  it('не исполнен — не сдаётся; проигранный удар договор не закрывает', () => {
    const s = party();
    const o = offerOf(s, 'lair');
    standAt(s, TOWN, T0);
    takeDeal(s, o, T0);
    expect(settle(s, o.id, T0)).toMatch(/не исполнен/);
    takeFight(s, { how: 'strike', id: o.target.id, name: o.target.name, power: o.power, foeMen: 5, foeLoss: 0.1, won: false, lost: { clubman: 1 }, seed: 7, at: T0 + 60_000 });
    expect(s.roam?.deals?.map((d) => d.id)).toEqual([o.id]);
  });

  it('срок вышел — сорван: неустойка — долг заказчику; долг закрывает его доску до уплаты; уплатил — открыта', () => {
    const s = party();
    const o = offerOf(s, 'lair');
    standAt(s, TOWN, T0);
    takeDeal(s, o, T0);
    const d = s.roam?.deals?.[0];
    expect(d?.until, 'граница: срок впереди').toBeGreaterThan(T0);
    dealStep(s, 1, (d?.until ?? 0) - 1);
    expect(s.roam?.deals?.length, 'до срока — жив').toBe(1);
    dealStep(s, 1, d?.until ?? 0);
    expect(s.roam?.deals).toBeUndefined();
    expect(debtTo(s.roam!, TOWN.id)).toBe(d?.penalty);
    expect(outOps(s)).toContain('drop');
    const next = townBoard(s, T0 + 3 * 3600_000)[0];
    standAt(s, TOWN, T0 + 3 * 3600_000);
    expect(takeBlock(s, next, T0 + 3 * 3600_000)).toMatch(/доска закрыта до уплаты/);
    s.roam!.purse = (d?.penalty ?? 0) + 5;
    expect(payDebt(s, { id: TOWN.id, x: TOWN.x, y: TOWN.y }, T0 + 3 * 3600_000)).toBeNull();
    expect(s.roam?.purse).toBe(5);
    expect(takeBlock(s, next, T0 + 3 * 3600_000)).toBeNull();
  });

  it('отказ — половина неустойки долгом', () => {
    const s = party();
    const o = offerOf(s, 'lair');
    standAt(s, TOWN, T0);
    takeDeal(s, o, T0);
    const d = s.roam?.deals?.[0];
    expect(refuseDeal(s, o.id)).toBeNull();
    expect(debtTo(s.roam!, TOWN.id)).toBe(d?.refuse);
    expect(d?.refuse).toBe(Math.round((d?.penalty ?? 0) * 0.5));
  });

  it('груз: в обоз при взятии, довезён до города — сдан и снят с обоза; продан по дороге — сорван', () => {
    const s = party({ spearman: 30 });
    const o = offerOf(s, 'cargo');
    standAt(s, TOWN, T0);
    expect(takeDeal(s, o, T0)).toBeNull();
    const g = o.goods as NonNullable<DealOffer['goods']>;
    expect(s.roam?.cargo[g.id]).toBe(g.n);
    standAt(s, o.target, T0 + 3600_000);
    dealStep(s, 1, T0 + 3600_000);
    expect(s.roam?.deals).toBeUndefined();
    expect(s.roam?.cargo[g.id] ?? 0).toBe(0);
    const s2 = party({ spearman: 30 });
    standAt(s2, TOWN, T0);
    takeDeal(s2, o, T0);
    s2.roam!.cargo[g.id] = 0;
    standAt(s2, o.target, T0 + 3600_000);
    dealStep(s2, 1, T0 + 3600_000);
    expect(s2.roam?.deals?.length, 'груза нет — не исполнен').toBe(1);
    dealStep(s2, 1, s2.roam!.deals![0].until);
    expect(debtTo(s2.roam!, TOWN.id)).toBeGreaterThan(0);
  });

  it('гарнизонная служба: стоять у замка кастеляна весь срок — сдан; ушёл — сорван', () => {
    const t2 = nearest('town', (p) => p.tier >= 2)[0];
    const s = party({ spearman: 30 }, roamStub('stages')[2]);
    const o = boardsAt(SEED, t2, T0, s.prestige, NONE).find((b) => b.from.who === 'castellan')?.offers.find((x) => x.kind === 'garrison');
    expect(o, 'граница: при ступени «Известный» кастелян даёт службу').toBeDefined();
    const run = (stay: boolean): GameState => {
      const p = party({ spearman: 30 }, s.prestige);
      standAt(p, t2, T0);
      expect(takeDeal(p, o as DealOffer, T0)).toBeNull();
      const need = p.roam!.deals![0].need ?? 0;
      let now = T0;
      for (let t = 0; t < need + 2 * DAY_LENGTH; t += DAY_LENGTH / 2) {
        now += realMs(DAY_LENGTH / 2);
        if (!stay && t > need / 2) standAt(p, HOME, now);
        dealStep(p, DAY_LENGTH / 2, now);
      }
      return p;
    };
    const stayed = run(true);
    expect(stayed.roam?.deals).toBeUndefined();
    expect(debtTo(stayed.roam!, (o as DealOffer).from.id)).toBe(0);
    const left = run(false);
    expect(left.roam?.deals).toBeUndefined();
    expect(debtTo(left.roam!, (o as DealOffer).from.id)).toBeGreaterThan(0);
  });
});

describe('защита села — набег в свою минуту, бой у ворот или срыв (мир бродяги)', () => {
  const village = nearest('village').find((v) => threatOf(SEED, v, NONE) !== null) as RoamPoint;

  const defend = (stay: boolean): GameState => {
    expect(village, 'граница: село с угрозой есть').toBeDefined();
    const s = party({ spearman: 40 });
    standAt(s, village, T0);
    const o = boardsAt(SEED, village, T0, 0, NONE).find((b) => b.from.who === 'village')?.offers.find((x) => x.kind === 'defend') as DealOffer;
    expect(takeDeal(s, o, T0)).toBeNull();
    const due = s.roam!.deals![0].due as number;
    expect(due, 'граница: набег впереди').toBeGreaterThan(T0);
    if (!stay) standAt(s, HOME, T0 + 60_000);
    let now = due + 60_000;
    const w = world(s, () => now);
    void w.sync(SYNC);
    now += 60_000;
    void w.sync(SYNC);
    return s;
  };

  it('стоял у села — бой у ворот, один раз: договор закрыт (сдан или сорван боем)', () => {
    const s = defend(true);
    expect(s.roam?.deals).toBeUndefined();
    expect(s.log.filter((l) => l.text.startsWith(`Набег на ${village.name}`)).length).toBe(1);
  });

  it('не стоял — сорван без боя, неустойка — долг селу', () => {
    const s = defend(false);
    expect(s.roam?.deals).toBeUndefined();
    expect(s.log.some((l) => l.text.startsWith('Набег на'))).toBe(false);
    expect(debtTo(s.roam!, village.id)).toBeGreaterThan(0);
  });
});

describe('сохранение и шаг', () => {
  it('договоры, долги и взятые номера переживают чтение партии; мусор не читается', () => {
    const s = party();
    const o = offerOf(s, 'lair');
    standAt(s, TOWN, T0);
    takeDeal(s, o, T0);
    s.roam!.debts = [{ id: 'town:1:2', name: 'Х', gold: 40 }];
    const back = mergeRoam(JSON.parse(JSON.stringify(s)));
    expect(back.roam?.deals).toEqual(s.roam?.deals);
    expect(back.roam?.debts).toEqual(s.roam?.debts);
    expect(back.roam?.took).toEqual(s.roam?.took);
    const junk = mergeRoam({ ...JSON.parse(JSON.stringify(s)), roam: { ...JSON.parse(JSON.stringify(s.roam)), deals: [{ kind: 'loot', tier: 9 }], debts: [{ id: 3 }] } });
    expect(junk.roam?.deals).toBeUndefined();
    expect(junk.roam?.debts).toBeUndefined();
  });

  it('шаг отряда ведёт срок договоров (`roamStep` с минутой мира)', () => {
    const s = party();
    const o = offerOf(s, 'lair');
    standAt(s, TOWN, T0);
    takeDeal(s, o, T0);
    roamStep(s, 1, s.roam!.deals![0].until + 1);
    expect(s.roam?.deals).toBeUndefined();
    expect(debtTo(s.roam!, TOWN.id)).toBeGreaterThan(0);
  });

  it('у лорда двери договоров ничего не делают', () => {
    const lord = createInitialState(SEED);
    const o = { id: 'x', kind: 'lair', tier: 1, from: { id: 'town:1:1', x: 1, y: 1, name: 'Х', who: 'town' }, target: { id: 'y', x: 2, y: 2, name: 'У' }, power: 1, roadMs: 0, stand: 0 } as DealOffer;
    expect(takeDeal(lord, o, T0)).toBe('Отряда нет.');
    dealStep(lord, 10, T0);
    expect(lord.roam).toBeUndefined();
  });
});
