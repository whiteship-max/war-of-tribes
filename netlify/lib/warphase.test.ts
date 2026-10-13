// Ход осады фазами между игроками (docs/siege_v2.md, разделы 2, 3, 8; этап 2б): фазы считает сервер сам, в своей очереди
// (`war.advance`), той же дверью, что мир (`world/siegeroll.rollPhase`); исход клиент не присылает. Кость подменяется
// (`setPhaseDie`), чтобы точка стояла внутри области правила.
import { afterEach, describe, expect, it } from 'vitest';
import { readWarOrder, type CastleClaim, type RosterFile, type WarArmy, type WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, newsOf, type SheetAt, type WarFile, type WarRow } from './war.js';
import { phaseAt, setPhaseDie, softerFate } from '../../src/world/siegeroll.js';
import { siegeSince, type SiegeWindow } from '../../src/world/siege.js';
import { ENERGY_MAX } from '../../src/world/data/energy.js';
import { priceOf } from '../../src/world/energy.js';

afterEach(() => setPhaseDie(null));

const A = 'tg-2001';
const B = 'tg-2002';
const T0 = 1_900_000_000_000;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });

const sheet = (over: Partial<WarSheet> = {}): WarSheet => ({
  army: { spearman: 60, archer: 30, swordsman: 30 },
  home: { spearman: 40, archer: 20 },
  militia: 20,
  archers: 6,
  resolve: 0,
  pips: {},
  rest: 1,
  // Хлеба — на дюжину фаз: голод не мешает фазам, о которых тест.
  food: 2000,
  townPerHour: 20,
  perManPerHour: 1,
  stock: { food: 2000, wood: 800, stone: 300 },
  stash: 100,
  gold: 400,
  pop: 400,
  bonded: 20,
  levels: { farm: 4, smithy: 2 },
  power: 5000,
  locks: {},
  seen: [],
  ...over,
});

function setup() {
  let roster: RosterFile = emptyRoster();
  roster = upsert(roster, A, claim('Альфа'), T0);
  roster = upsert(roster, B, claim('Бета'), T0);
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet(), at: T0 }],
    [B, { sheet: sheet(), at: T0 }],
  ]);
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
  return { sheets, ctx, file: emptyWars() as WarFile };
}

/** Поход с осадой дошёл и встал лагерем; энергия полководца — `energy` в минуту постановки. */
function camped(energy = ENERGY_MAX) {
  const s = setup();
  const army: WarArmy = { troops: { spearman: 60, archer: 30 }, resolve: 0, pips: {} };
  expect(applyOrder(s.file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'captives', army }, T0, s.ctx)).toBeNull();
  const w = s.file.wars[0] as WarRow;
  advance(s.file, w.arriveAt + 1, s.sheets);
  expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
  w.army = { ...w.army, energy: { value: energy, at: w.arriveAt, mode: 'camp' } };
  const since = siegeSince(w.camp as SiegeWindow);
  return { ...s, w, since };
}

describe('фазы осады между игроками считает сервер', () => {
  it('в минуту фазы — строка журнала, истощение войска похода, энергия лагеря копится; без перемен — без вести', () => {
    setPhaseDie(() => 7);
    const { file, sheets, w, since } = camped();
    expect(w.camp?.log, 'лагерь фазовый: журнал дел пустой').toEqual([]);
    expect(w.army.energy?.mode).toBe('camp');
    const men = (w.army.troops.spearman ?? 0) + (w.army.troops.archer ?? 0);
    expect(w.starvesAt ?? 0, 'точка внутри области: голод позже фазы').toBeGreaterThan(phaseAt(since, 1));
    advance(file, phaseAt(since, 1) + 1, sheets);
    expect(w.camp?.phases).toHaveLength(1);
    const row = w.camp!.phases![0];
    expect(row.at).toBe(phaseAt(since, 1));
    expect(row.out).toBe('calm');
    expect(row.waste).toBeGreaterThan(0);
    expect((w.army.troops.spearman ?? 0) + (w.army.troops.archer ?? 0), 'войско истощилось').toBeLessThan(men);
    expect(newsOf(w).some((n) => n.item.kind === 'war-phase'), '«без перемен» молчит').toBe(false);
  });

  it('пролом — весть обеим сторонам; ворота — не раньше следующей фазы, участь мягче, гарнизон не рассеян', () => {
    // Кость 14, стены нет: фаза 1 — 14, пролом; фаза 2 — 14 + 1 + 1 = 16, ворота.
    setPhaseDie(() => 14);
    const { file, sheets, w, since } = camped();
    advance(file, phaseAt(since, 1) + 1, sheets);
    expect(w.phase, 'после пролома город стоит фазу').toBe('camp');
    expect(w.camp?.phases?.[0].out).toBe('breach');
    const news = newsOf(w).filter((n) => n.item.kind === 'war-phase');
    expect(news.map((n) => n.player).sort()).toEqual([A, B].sort());
    for (const n of news) expect(n.item.p).toMatchObject({ phase: 'breach', k: 1, breaches: 1, about: phaseAt(since, 1) });
    advance(file, phaseAt(since, 2) + 1, sheets);
    expect(w.fall?.by).toBe('gates');
    expect(w.fall?.at).toBe(phaseAt(since, 2));
    expect(w.fall?.fate).toBe(softerFate('captives'));
    expect(w.fall?.routed, 'гарнизон ушёл живым').toEqual({});
    expect(w.end).toBe('taken');
    // Журнал пережил лагерь — по нему вести и донесение.
    expect(w.phases?.map((r) => r.out)).toEqual(['breach', 'gates']);
    const fall = newsOf(w).filter((n) => n.item.kind === 'war-fall');
    expect(fall).toHaveLength(2);
    for (const n of fall) expect(n.item.p.gates).toBe(true);
  });

  it('наказы: залп в минуту фазы, пока энергии хватает и на штурм; весть нападающему о сработавшем наказе', () => {
    setPhaseDie(() => 7);
    const { file, sheets, ctx, w, since } = camped(ENERGY_MAX);
    // Приказ наказов — только у нападающего и только полями наказов.
    const parsed = readWarOrder({ op: 'orders', id: w.id, orders: { volley: true, storm: 9, extra: 1 } });
    expect(parsed).toEqual({ op: 'orders', id: w.id, orders: { volley: true, storm: 3 } });
    expect(applyOrder(file, B, { op: 'orders', id: w.id, orders: { volley: true } }, phaseAt(since, 0) + 2, ctx)).toBe('Лагеря уже нет.');
    expect(applyOrder(file, A, { op: 'orders', id: w.id, orders: { volley: true } }, phaseAt(since, 0) + 2, ctx)).toBeNull();
    expect(w.camp?.orders).toEqual({ volley: true });
    advance(file, phaseAt(since, 1) + 1, sheets);
    const row = w.camp!.phases![0];
    expect(row.orders).toEqual(['volley']);
    expect(w.camp?.log).toEqual([{ at: phaseAt(since, 1), act: 'volley' }]);
    const atk = newsOf(w).find((n) => n.item.kind === 'war-phase' && n.player === A);
    expect(atk?.item.p.order).toBe('volley');
    expect(newsOf(w).some((n) => n.item.kind === 'war-phase' && n.player === B), 'защитнику о «без перемен» — молча').toBe(false);
    // Залп лёг в фазу 2 — её кость получит +2.
    advance(file, phaseAt(since, 2) + 1, sheets);
    expect(w.camp?.phases?.[1].mods.volley).toBe(2);
  });

  it('наказ «штурм при проломе»: пролом выпал — штурм той же дверью, что приказ, в минуту фазы', () => {
    setPhaseDie(() => 14);
    const { file, sheets, ctx, w, since } = camped(priceOf('storm') + 1);
    expect(applyOrder(file, A, { op: 'orders', id: w.id, orders: { storm: 1 } }, phaseAt(since, 0) + 2, ctx)).toBeNull();
    advance(file, phaseAt(since, 1) + 1, sheets);
    // Журнал фаз — в окне лагеря, пока он стоит, и у войны, когда лагеря не стало.
    expect((w.camp?.phases ?? w.phases)?.[0].orders).toEqual(['storm']);
    const fight = w.battles[w.battles.length - 1];
    expect(fight.site).toBe('wall');
    expect(fight.at).toBe(phaseAt(since, 1));
    expect(fight.craft?.breach, 'штурм шёл через пролом фазы').toBe(1);
    // Исход — дело боя у стены (17.1): взяли — война кончилась, отбит — лагерь стоит (`STORM_HOLDS`).
    if (fight.won) expect(w.phase === 'back' || w.phase === 'done').toBe(true);
    else expect(w.camp, 'отбитый штурм лагерь не снимает').toBeTruthy();
  });
});
