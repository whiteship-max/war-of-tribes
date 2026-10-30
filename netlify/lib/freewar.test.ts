// Осада вольного замка на сервере войны (ПН-10, docs/gdd/path_of_sword.md, 3.11): только мечом, последняя вылазка вместо сдачи
// голодом, две осады одного замка — замок тому, чей бой победил первым, «Занять» — только вольному замку, подделка — отказ и флаг.
import { afterEach, describe, expect, it } from 'vitest';
import type { BandRow, CastleClaim, RosterFile, WarArmy } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, battleWinner, emptyWars, type OrderCtx, type SheetAt, type WarFile, type WarRow } from './war.js';
import { phaseAt, setPhaseDie } from '../../src/world/siegeroll.js';
import { breadAt, siegeSince, type SiegeWindow } from '../../src/world/siege.js';
import { starves } from '../../src/world/siegefood.js';
import { roamSeat } from '../../src/world/roam.js';
import { SPAWNS } from '../../src/world/spawn.js';
import { freeId, freePrestige, freeTroops } from '../../src/world/freecastle.js';
import { fateBlock, FREE_FATE_IDS, FATE_IDS } from '../../src/world/spoils.js';
import { BURN_IMMUNE } from '../../src/world/data/tuning.js';
import { troopTotal } from '../../src/game/battle/kinds.js';

afterEach(() => setPhaseDie(null));

const A = 'tg-3001';
const B = 'tg-3002';
const L = 'tg-3003';
const T0 = 1_900_000_000_000;
const HOUR = 3_600_000;
// Замок — на шестом месте теста; лорды теста встают на первые (`upsert` в режиме Сицилии) — в одном краю.
const C = SPAWNS[5];
const FREE = freeId(C.x, C.y);

const STRONG: WarArmy['troops'] = { knight: 400, legionary: 500, archer: 300 };
const WEAK: WarArmy['troops'] = { clubman: 4 };

const band = (troops: WarArmy['troops'], prestige = 1000, at = { x: C.x + 1, y: C.y }): BandRow => ({
  ...roamSeat(at, T0),
  born: T0,
  name: 'Ватага',
  prestige,
  men: troopTotal(troops),
  seenAt: T0,
  book: { troops, join: -1, drill: 0, fights: 0, grant: 0, keys: [] } as unknown as BandRow['book'],
});

const claim: CastleClaim = { name: 'Лорд', city: 'Лорд', power: 5000, pop: 400 };

function world(bands: Record<string, BandRow>, tier: 1 | 2 | 3 = 1): { roster: RosterFile; file: WarFile; flags: string[]; ctx: (open?: boolean) => OrderCtx } {
  const roster: RosterFile = { ...upsert(emptyRoster(), L, claim, T0, 'sicily'), bands, free: { [FREE]: { x: C.x, y: C.y, tier, born: T0 } } };
  const flags: string[] = [];
  const sheets = new Map<string, SheetAt>();
  return {
    roster,
    file: emptyWars(),
    flags,
    ctx: (open = true) => ({ roster, sheet: (k) => sheets.get(k) ?? null, roamOpen: open, forged: (t) => flags.push(t) }),
  };
}

const NO_SHEETS = new Map<string, SheetAt | null>();

const march = (w: ReturnType<typeof world>, key: string, mode: 'storm' | 'siege', troops: WarArmy['troops'], at = T0, fate: WarRow['fate'] = 'occupy') =>
  applyOrder(w.file, key, { op: 'march', target: FREE, mode, fate, army: { troops, resolve: 0, pips: {} } }, at, w.ctx());

/** Падение — только боем: в ту же минуту есть бой, который выиграл осаждающий (взятие без победы — подделка, его нет). */
function fellBySword(w: WarRow): void {
  const f = w.fall;
  expect(f, 'точка внутри области: замок пал').toBeDefined();
  expect(
    w.battles.some((b) => b.at === f?.at && battleWinner(w, b) === w.atk),
    `падение ${f?.by} в ${f?.at} — без победы осаждающего в эту минуту`,
  ).toBe(true);
}

describe('ПН-10: штурм с ходу — только мечом', () => {
  it('сильный отряд берёт замок штурмом: бой у стены, падение, замок за ним; «Занять» — в обоз ничего', () => {
    const w = world({ [A]: band(STRONG) });
    expect(march(w, A, 'storm', STRONG)).toBeNull();
    const war = w.file.wars[0];
    advance(w.file, war.arriveAt + 1, NO_SHEETS);
    expect(war.end).toBe('taken');
    expect(war.fall?.by).toBe('storm');
    fellBySword(war);
    expect(w.file.free?.[FREE]).toMatchObject({ key: A, war: war.id, fate: 'occupy' });
    expect(war.fall?.taken, '«Занять» — в обоз ничего').toEqual({});
    expect(war.fall?.lost, 'склад и казна целы').toEqual({});
  });

  it('слабый отряд отбит: замок ничей, падения нет', () => {
    const w = world({ [A]: band(WEAK) });
    expect(march(w, A, 'storm', WEAK)).toBeNull();
    const war = w.file.wars[0];
    advance(w.file, war.arriveAt + 1, NO_SHEETS);
    expect(war.end).toBe('beaten');
    expect(war.fall).toBeUndefined();
    expect(w.file.free?.[FREE]).toBeUndefined();
  });
});

/** Осада до события: шаги по одной фазе, пока лагерь стоит. */
function siegeUntilEnd(w: ReturnType<typeof world>, war: WarRow, phases = 12): void {
  advance(w.file, war.arriveAt + 1, NO_SHEETS);
  expect(war.phase, 'точка внутри области: лагерь встал').toBe('camp');
  const since = siegeSince(war.camp as SiegeWindow);
  for (let k = 1; k <= phases && war.phase === 'camp'; k++) advance(w.file, phaseAt(since, k) + 1, NO_SHEETS);
}

describe('ПН-10: осада → голод → последняя вылазка (решение Н5)', () => {
  it('голод не сдаёт замок: гарнизон выходит всем, отбит — замок взят вылазкой, а не голодом', () => {
    setPhaseDie(() => 7);
    const w = world({ [A]: band(STRONG) });
    expect(march(w, A, 'siege', STRONG)).toBeNull();
    const war = w.file.wars[0];
    advance(w.file, war.arriveAt + 1, NO_SHEETS);
    const camp = war.camp as SiegeWindow;
    const since = siegeSince(camp);
    let k = 1;
    while (war.phase === 'camp' && k <= 12) advance(w.file, phaseAt(since, k++) + 1, NO_SHEETS);
    const at = war.fall?.at ?? 0;
    expect(starves(breadAt(camp, at)), 'точка внутри области: в минуту падения хлеба нет').toBe(true);
    expect(war.fall?.by, 'голодом вольный замок не сдаётся').toBe('sortie');
    const sortie = war.battles.find((b) => b.at === at);
    expect(sortie?.site, 'бой падения — вылазка гарнизона').toBe('sortie');
    expect(troopTotal(sortie?.homeTroops as never), 'вышел весь гарнизон, что остался').toBe(troopTotal(freeTroops(FREE, 1)));
    fellBySword(war);
    expect(w.file.free?.[FREE]?.war).toBe(war.id);
  });

  it('вылазка прорвала слабый лагерь — осада снята, замок ничей', () => {
    setPhaseDie(() => 7);
    // Рогатки лагеря пропускают вылазку по частям (`fights.campFight`): прорывает она только совсем малый лагерь.
    const troops = { clubman: 3 };
    const w = world({ [A]: band(troops) });
    expect(march(w, A, 'siege', troops)).toBeNull();
    const war = w.file.wars[0];
    siegeUntilEnd(w, war);
    expect(war.battles.some((b) => b.site === 'sortie'), 'точка внутри области: последняя вылазка была').toBe(true);
    expect(war.end).toBe('lifted');
    expect(war.fall).toBeUndefined();
    expect(w.file.free?.[FREE]).toBeUndefined();
  });

  it('ворота фазы у вольного замка — не сдача, а та же последняя вылазка', () => {
    // Кость 14: фаза 1 — пролом, фаза 2 — ворота.
    setPhaseDie(() => 14);
    const w = world({ [A]: band(STRONG) });
    expect(march(w, A, 'siege', STRONG)).toBeNull();
    const war = w.file.wars[0];
    advance(w.file, war.arriveAt + 1, NO_SHEETS);
    const since = siegeSince(war.camp as SiegeWindow);
    advance(w.file, phaseAt(since, 2) + 1, NO_SHEETS);
    expect(war.phases?.[1]?.out, 'точка внутри области: ворота фазы').toBe('gates');
    expect(war.fall?.by).toBe('sortie');
    fellBySword(war);
  });
});

describe('ПН-10: две осады одного замка — замок тому, чей бой победил первым', () => {
  it('раньше легла в запись осада, а раньше победил штурм второго — замок второму, первый лагерь снят без потерь', () => {
    setPhaseDie(() => 14);
    const w = world({ [A]: band(STRONG), [B]: band(STRONG, 1000, { x: C.x, y: C.y + 1 }) });
    expect(march(w, A, 'siege', STRONG)).toBeNull();
    expect(march(w, B, 'storm', STRONG, T0 + HOUR / 2), 'две осады одного замка допустимы').toBeNull();
    const [x, y] = w.file.wars;
    // Одним ходом через оба события: без порядка по времени осада A (первая в записи) успела бы взять замок воротами фазы 2.
    advance(w.file, T0 + 12 * HOUR, NO_SHEETS);
    expect(y.fall?.by, 'точка внутри области: штурм B взял замок').toBe('storm');
    fellBySword(y);
    expect(w.file.free?.[FREE]?.war).toBe(y.id);
    expect(x.end).toBe('gone');
    expect(x.fall).toBeUndefined();
    expect(x.endAt).toBe(y.fall?.at);
    expect(x.army.troops, 'лагерь снят без потерь').toEqual(STRONG);
  });
});

describe('ПН-10: участи вольного замка', () => {
  it('«Занять» — только вольный замок; в лестницу лорда не входит', () => {
    expect(FATE_IDS).not.toContain('occupy');
    expect(FREE_FATE_IDS).toContain('occupy');
    expect(fateBlock('occupy', 'castle', undefined, T0)).toBeNull();
    expect(fateBlock('occupy', 'player', undefined, T0)).toBe('Занять можно только вольный замок.');
    expect(fateBlock('occupy', 'world', undefined, T0)).toBe('Занять можно только вольный замок.');
    expect(fateBlock('burn', 'castle', undefined, T0), 'вольный замок можно сжечь').toBeNull();
  });

  it('лорд не объявит «Занять» городу игрока', () => {
    const w = world({});
    const roster: RosterFile = upsert(w.roster, B, { ...claim, name: 'Сосед' }, T0, 'sicily');
    const sheet = { army: { spearman: 10 }, home: { spearman: 10 }, militia: 0, archers: 0, resolve: 0, pips: {}, rest: 1, food: 100, townPerHour: 1, perManPerHour: 1, stock: {}, stash: 0, gold: 0, pop: 400, bonded: 0, levels: {}, power: 5000, locks: {}, seen: [] };
    const ctx: OrderCtx = { roster, sheet: () => ({ sheet, at: T0 }), noShield: true };
    const no = applyOrder(w.file, L, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'occupy', army: { troops: { spearman: 5 }, resolve: 0, pips: {} } }, T0, ctx);
    expect(no).toBe('Занять можно только вольный замок.');
  });

  it('сожжённый замок не взят и отстраивается BURN_IMMUNE — потом снова открыт', () => {
    const w = world({ [A]: band(STRONG), [B]: band(STRONG, 1000, { x: C.x, y: C.y + 1 }) });
    expect(march(w, A, 'storm', STRONG, T0, 'burn')).toBeNull();
    const war = w.file.wars[0];
    advance(w.file, war.arriveAt + 1, NO_SHEETS);
    const h = w.file.free?.[FREE];
    expect(h).toMatchObject({ fate: 'burn', burnt: (war.fall?.at ?? 0) + BURN_IMMUNE });
    expect(march(w, B, 'storm', STRONG, war.arriveAt + HOUR)).toMatch(/отстраивается/);
    expect(march(w, B, 'storm', STRONG, (h?.burnt ?? 0) + 1)).toBeNull();
  });
});

describe('ПН-10: сервер — доступ и подделка', () => {
  it('путь закрыт — отказ; престиж ниже порога ступени — отказ', () => {
    const w = world({ [A]: band(STRONG, freePrestige(1) - 1) });
    const order = { op: 'march' as const, target: FREE, mode: 'storm' as const, fate: 'occupy' as const, army: { troops: STRONG, resolve: 0, pips: {} } };
    expect(applyOrder(w.file, A, order, T0, w.ctx(false))).toBe('Путь меча закрыт.');
    expect(applyOrder(w.file, A, order, T0, w.ctx())).toMatch(/нужен престиж/);
    expect(w.file.wars).toHaveLength(0);
  });

  it('не у стен — отказ без флага', () => {
    const w = world({ [A]: band(STRONG, 1000, { x: C.x + 5, y: C.y }) });
    expect(march(w, A, 'storm', STRONG)).toMatch(/не у стен/);
    expect(w.flags).toHaveLength(0);
  });

  it('город игрока на вольный замок, войско сверх книги отряда, чужой взятый замок, условия сдачи — отказ и флаг', () => {
    const w = world({ [A]: band(STRONG), [B]: band(STRONG, 1000, { x: C.x, y: C.y + 1 }) });
    expect(march(w, L, 'storm', STRONG)).toBe('На вольный замок ходит только отряд бродяги.');
    expect(march(w, A, 'storm', { ...STRONG, knight: 401 })).toBe('Столько людей в отряде нет.');
    expect(w.flags).toHaveLength(2);
    // Замок взят A — поход B на него — мимо интерфейса.
    expect(march(w, A, 'storm', STRONG)).toBeNull();
    advance(w.file, w.file.wars[0].arriveAt + 1, NO_SHEETS);
    expect(march(w, B, 'storm', STRONG, T0 + HOUR)).toBe('Замок уже взял другой отряд.');
    expect(w.flags).toHaveLength(3);
    // Условия сдачи вольному замку.
    const v = world({ [A]: band(STRONG) });
    expect(march(v, A, 'siege', STRONG)).toBeNull();
    const war = v.file.wars[0];
    advance(v.file, war.arriveAt + 1, NO_SHEETS);
    const no = applyOrder(v.file, A, { op: 'offer', id: war.id, kind: 'terms', fate: 'plunder' }, war.arriveAt + 2, v.ctx());
    expect(no).toBe('Вольный замок не сдаётся на условиях: его берут только мечом.');
    expect(v.flags).toHaveLength(1);
  });
});
