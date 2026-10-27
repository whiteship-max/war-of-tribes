// ДР-6 (docs/siege_v2.md, «Решения ДР-6»): раскладки «Гарнизон | Отряд» в «Дружине» нет — состав отряда полководец берёт из
// гарнизона в окне каждого своего дела, и уходит он ровно с выбранным одним приказом мира (`ErrandOrder.troops`,
// `LocalWorld.takeBand`). Отказ дела возвращает всех в гарнизон. Вне города — тот отряд, что при нём. Переход: отряд,
// собранный дома по прежней раскладке, при чтении сохранения встаёт гарнизоном; отряд в поле не трогают. Приказ раскладки
// старого клиента мир принимает, как раньше, а сервер по слепку обороны вычитает ушедших в поход (`war.liveSheet`).
//
// Граница области (правило 11): полководец жив, в строю и в своём городе в минуту приказа (кроме блока «вне города»); цель в
// регионе игрока и жива; дело мир открывает или гасит только пустым отрядом (`ring.emptyRetinue`) — это утверждается в каждой
// точке до приказа. Энергия дорогу не берёт (`ENERGY_ROAD`, как в `errands.test.ts`).
import { describe, expect, it, vi } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { StoredMarch, WorldSave, WorldStorage } from './local/state';
import type { GenSettlement } from './gen';
import { shieldVillagers } from './lairs';
import { distance } from './geo';
import { awayOf, homeOf, BAND_AS_IS, NO_BAND_HOME } from './muster';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import type { ErrandId, ErrandTarget, FigureView, PlayerCastle, PlayerProfile } from './types';
import type { WarOrder, WarSheet, WarView, CastleClaim, WarArmy } from '../../netlify/lib/contract';
import { applyOrder, emptyWars, liveSheet, type SheetAt, type WarFile } from '../../netlify/lib/war';
import { castleIdOf, emptyRoster, upsert } from '../../netlify/lib/roster';
import { emptyRetinue } from '@/ui/map/ring';

vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

const START = 1_700_000_000_000 + 14 * 3_600_000;
const HOUR = 3_600_000;
const HOST: TroopStack = { legionary: 60, spearman: 50, archer: 30 };
/** Выбранный в окне состав: меньше гарнизона и не того состава, что был бы «всё войско». */
const WANT: TroopStack = { legionary: 20, archer: 10 };

const profile = (): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 900,
  units: { warrior: 10, scout: 4 },
  army: { ...HOST },
  stock: { food: 40000, wood: 40000, stone: 40000, hides: 40000, charcoal: 40000, copper: 40000, iron: 40000 },
  stash: 0,
  gold: 40000,
});

/** Хранилище в памяти: мир пишет и читает его, как localStorage. */
const memory = (): WorldStorage & { json: string | null } => {
  const m = { json: null as string | null, read: () => m.json, write: (j: string) => void (m.json = j) };
  return m;
};

interface BenchOpts {
  /** Союзник в осаде (для выручки). */
  ally?: boolean;
  /** Ответ сервера войны на приказ; по умолчанию — принят. */
  answer?: (o: WarOrder) => string | null;
  storage?: WorldStorage;
  /** Минута начала (чтение сохранения, записанного позже `START`). */
  at?: number;
}

async function bench(o: BenchOpts = {}) {
  const clock = { now: o.at ?? START };
  let rival: PlayerCastle = { id: 'castle-x', x: 0, y: 0, name: 'Сосед', city: 'Соседград', power: 500, pop: 100, seenAt: START };
  const orders: WarOrder[] = [];
  const wars: WarView[] = [];
  const world = new LocalWorld({
    seed: 7,
    now: () => clock.now,
    storage: o.storage ?? null,
    castles: () => [rival],
    wars: () => wars,
    warsKnown: () => true,
    warOrder: async (x) => {
      orders.push(x);
      return o.answer?.(x) ?? null;
    },
  });
  const info = await world.info();
  rival = { ...rival, x: info.home.x + 4, y: info.home.y + 3 };
  if (o.ally) {
    // Союзник в осаде: война с сервера, где мы — союзник защитника, лагерь стоит (`allySiege`).
    wars.push({ id: 'w-ally', role: 'ally', me: 'c-me', defCastle: rival.id, phase: 'camp', camp: {}, battles: [], reliefs: [] } as unknown as WarView);
  }
  const p = profile();
  await world.sync(p);
  const fig = async (): Promise<FigureView> => (await world.figures()).find((f) => f.id === 'general')!;
  const w = world as unknown as { gen: { settlements: GenSettlement[] }; alive(x: GenSettlement, now: number): boolean; inRealm(c: { x: number; y: number }): boolean; save: WorldSave };
  const lair = w.gen.settlements.filter((x) => w.alive(x, clock.now) && w.inRealm(x)).sort((a, c) => distance(a, info.home) - distance(c, info.home))[0];
  const raid: StoredMarch = {
    id: 'raid-dr6',
    seed: 5,
    mission: 'raid',
    units: { warrior: 5 },
    own: false,
    fromId: lair.id,
    targetId: 'home',
    from: { x: info.home.x + 30, y: info.home.y },
    to: { x: info.home.x, y: info.home.y },
    fromName: 'Логово',
    toName: 'дом',
    departAt: clock.now,
    arriveAt: clock.now + 6 * HOUR,
    phase: 'out',
    power: 15,
    loot: null,
  };
  w.save.marches.push(raid);
  return { world, clock, fig, save: w.save, profile: p, lair, rival, raid, orders, home: info.home };
}

type Bench = Awaited<ReturnType<typeof bench>>;

/** Дела полководца из города: цель, дело и где проверять состав — у фигуры (мир) или в приказе сервера войны (война). */
const DEEDS: { name: string; deed: ErrandId; goal: (b: Bench) => ErrandTarget; ally?: boolean; war?: WarOrder['op'] }[] = [
  { name: 'удар по логову', deed: 'storm', goal: (b) => ({ kind: 'place', id: b.lair.id }) },
  { name: 'осада логова', deed: 'siege', goal: (b) => ({ kind: 'place', id: b.lair.id }) },
  { name: 'перехват набега', deed: 'intercept', goal: (b) => ({ kind: 'march', id: b.raid.id }) },
  { name: 'поход на город соседа', deed: 'storm', goal: (b) => ({ kind: 'place', id: b.rival.id }), war: 'march' },
  { name: 'осада города соседа', deed: 'siege', goal: (b) => ({ kind: 'place', id: b.rival.id }), war: 'march' },
  { name: 'выручка союзника', deed: 'relief', goal: (b) => ({ kind: 'place', id: b.rival.id }), ally: true, war: 'relief' },
];

/** Войско, ушедшее приказом сервера войны. */
const armyOf = (o: WarOrder | undefined): TroopStack => ((o as { army?: WarArmy } | undefined)?.army?.troops ?? {}) as TroopStack;

describe('каждое дело полководца — состав в своём окне', () => {
  it.each(DEEDS)('$name: в городе отряда нет, дело гасит только пустой отряд, уходит ровно с выбранным', async (d) => {
    const b = await bench({ ally: d.ally });
    const goal = d.goal(b);
    const g0 = await b.fig();
    // Область: полководец в городе, перевод мгновенный, отряда при нём нет.
    expect(g0.phase, 'область: дома').toBe('home');
    expect(g0.regroup?.instant, 'область: перевод мгновенный').toBe(true);
    expect(troopTotal(g0.troops), 'в городе отряда нет').toBe(0);
    const opt = (await b.world.errands('general', goal)).find((o) => o.id === d.deed);
    expect(opt, `${d.name}: дело есть в меню`).toBeDefined();
    // Дело гаснет только пустым отрядом — и словами окна, которое его даёт.
    expect(opt!.can, `${d.name}: без отряда мир дело гасит`).toBe(false);
    expect(opt!.reason, `${d.name}: отказ — «дай в окне дела»`).toBe(NO_BAND_HOME);
    expect(emptyRetinue(opt!), `${d.name}: окно снимает этот отказ`).toBe(true);

    const err = await b.world.errand({ agent: 'general', target: goal, deed: d.deed, fate: 'plunder', shownAt: opt!.at, troops: { ...WANT } });
    expect(err, `${d.name}: ушёл`).toBeNull();
    if (d.war) {
      const sent = b.orders.filter((o) => o.op === d.war);
      expect(sent.length, `${d.name}: приказ серверу войны один`).toBe(1);
      expect(armyOf(sent[0]), `${d.name}: серверу ушло ровно выбранное`).toEqual(WANT);
    } else {
      const g = await b.fig();
      expect(g.phase, `${d.name}: пошёл`).toBe('moving');
      expect(g.troops, `${d.name}: при нём ровно выбранное`).toEqual(WANT);
      // Гарнизон — всё войско минус ушедшие: никто не потерян и не удвоен.
      const left = homeOf(HOST, awayOf([], [g]));
      expect(troopTotal(left) + troopTotal(WANT), `${d.name}: войско целиком`).toBe(troopTotal(HOST));
    }
  }, 120_000);

  it('отказ дела возвращает всех в гарнизон — состав, усталость и мораль гарнизона прежние', async () => {
    const b = await bench({ answer: () => 'Сервер отказал.' });
    const goal: ErrandTarget = { kind: 'place', id: b.rival.id };
    const opt = (await b.world.errands('general', goal)).find((o) => o.id === 'storm')!;
    expect(emptyRetinue(opt), 'область: дело гасит только пустой отряд').toBe(true);
    const f = b.save.figures.general;
    const was = JSON.stringify({ troops: f.troops ?? null, rest: f.rest ?? null, home: b.save.homeRest ?? null, handover: f.handover ?? null });
    const err = await b.world.errand({ agent: 'general', target: goal, deed: 'storm', fate: 'plunder', shownAt: opt.at, troops: { ...WANT } });
    expect(err, 'отказ сервера — словами сервера').toBe('Сервер отказал.');
    expect(b.orders.length, 'область: приказ ушёл и вернулся отказом').toBe(1);
    expect(armyOf(b.orders[0]), 'область: приказ нёс выбранный состав').toEqual(WANT);
    const now = JSON.stringify({ troops: f.troops ?? null, rest: f.rest ?? null, home: b.save.homeRest ?? null, handover: f.handover ?? null });
    expect(now, 'всё как до приказа').toBe(was);
    expect(troopTotal((await b.fig()).troops), 'отряда нет — все в гарнизоне').toBe(0);
  }, 120_000);

  it('вне города состав не меняется: тот же — уходит, иной — отказ словами мира', async () => {
    const b = await bench();
    // Отряд при нём и он в поле: приказ раскладки старого клиента дома, затем выход за ворота.
    expect(await b.world.setGarrison({ ...WANT })).toBeNull();
    expect(await b.world.moveFigure('general', { x: b.home.x + 5, y: b.home.y + 1 })).toBeNull();
    let g = await b.fig();
    for (let i = 0; i < 200 && g.phase !== 'field'; i++) {
      b.clock.now += 5 * 60_000;
      await b.world.sync(b.profile);
      g = await b.fig();
    }
    expect(g.phase, 'область: стоит в поле').toBe('field');
    expect(g.troops, 'область: отряд при нём').toEqual(WANT);
    const goal: ErrandTarget = { kind: 'place', id: b.lair.id };
    const opt = (await b.world.errands('general', goal)).find((o) => o.id === 'storm')!;
    expect(opt.can, `область: удар из поля открыт — ${opt.reason}`).toBe(true);
    const other = await b.world.errand({ agent: 'general', target: goal, deed: 'storm', fate: 'plunder', shownAt: opt.at, troops: { ...HOST } });
    expect(other, 'иной состав вне города — отказ').toBe(BAND_AS_IS);
    expect((await b.fig()).troops, 'отряд тот же').toEqual(WANT);
    expect(await b.world.errand({ agent: 'general', target: goal, deed: 'storm', fate: 'plunder', shownAt: opt.at, troops: { ...WANT } })).toBeNull();
    expect((await b.fig()).troops, 'ушёл с тем, что при нём').toEqual(WANT);
  }, 120_000);
});

describe('переход: отряд прежней раскладки дома — гарнизон, в поле — не трогают', () => {
  it('прочитав сохранение, отряд в городе встаёт гарнизоном без потерь; отряд в поле остаётся при нём', async () => {
    const store = memory();
    const a = await bench({ storage: store });
    // Сохранение прежней раскладки: отряд собран дома.
    expect(await a.world.setGarrison({ ...WANT })).toBeNull();
    const g0 = await a.fig();
    expect(g0.phase, 'область: дома').toBe('home');
    expect(g0.troops, 'область: отряд дома собран').toEqual(WANT);
    const garrisonBefore = homeOf(HOST, awayOf([], [g0]));
    expect(troopTotal(garrisonBefore), 'область: в городе — весь гарнизон с отрядом').toBe(troopTotal(HOST));
    expect(store.json, 'область: сохранение записано').not.toBeNull();

    const b = await bench({ storage: store });
    const g1 = await b.fig();
    expect(g1.phase, 'дома, как и был').toBe('home');
    expect(g1.troops, 'отряд встал гарнизоном').toEqual({});
    const garrisonAfter = homeOf(HOST, awayOf([], [g1]));
    expect(garrisonAfter, 'без потерь: гарнизон — всё войско').toEqual(garrisonBefore);
    expect(b.save.figures.general.handover, 'сбора нет').toBeUndefined();

    // Отряд в поле: сохранение с полководцем за воротами — читается как есть.
    const field = memory();
    const c = await bench({ storage: field });
    expect(await c.world.setGarrison({ ...WANT })).toBeNull();
    expect(await c.world.moveFigure('general', { x: c.home.x + 5, y: c.home.y + 1 })).toBeNull();
    let g = await c.fig();
    for (let i = 0; i < 200 && g.phase !== 'field'; i++) {
      c.clock.now += 5 * 60_000;
      await c.world.sync(c.profile);
      g = await c.fig();
    }
    expect(g.phase, 'область: стоит в поле').toBe('field');
    const d = await bench({ storage: field, at: c.clock.now });
    const g2 = await d.fig();
    expect(g2.phase, 'в поле, как и был').toBe('field');
    expect(g2.troops, 'отряд в поле не тронут').toEqual(WANT);
  }, 120_000);
});

describe('старый клиент и сервер войны: приказ раскладки и слепок обороны', () => {
  it('приказ раскладки принимается, как раньше; слепок в городе называет весь гарнизон тем, кто может уйти', async () => {
    const b = await bench();
    expect(await b.world.setGarrison({ ...WANT }), 'старый приказ раскладки принят').toBeNull();
    expect((await b.fig()).troops).toEqual(WANT);
    expect(await b.world.setGarrison(null), 'и обратный — тоже').toBeNull();
    const sheet = b.world.warSheet();
    expect(sheet?.led, 'область: полководец в городе').toBe(true);
    expect(sheet?.retinue, 'может уйти любой из гарнизона').toEqual(sheet?.home);
  }, 120_000);

  it('сервер вычитает ушедших в поход из слепка, лёгшего до выхода, — и по слепку старого клиента, и по новому', () => {
    const A = 'tg-2001';
    const B = 'tg-2002';
    const T0 = 1_900_000_000_000;
    const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });
    let roster = emptyRoster();
    roster = upsert(roster, A, claim('Альфа'), T0);
    roster = upsert(roster, B, claim('Бета'), T0);
    const home: TroopStack = { spearman: 60, archer: 30 };
    const base = (retinue?: TroopStack): WarSheet =>
      ({
        army: { ...home },
        home: { ...home },
        ...(retinue ? { retinue } : {}),
        led: true,
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
      }) as WarSheet;
    const went: TroopStack = { spearman: 20, archer: 10 };
    // Слепки, лёгшие до выхода: новый (ДР-6 — может уйти весь гарнизон), старого клиента с собранным дома отрядом и без поля.
    const cases: { name: string; retinue?: TroopStack }[] = [
      { name: 'ДР-6: весь гарнизон', retinue: home },
      { name: 'старый клиент: отряд дома', retinue: { spearman: 25, archer: 10 } },
      { name: 'слепок без поля', retinue: undefined },
    ];
    for (const c of cases) {
      const file = emptyWars() as WarFile;
      const sheets = new Map<string, SheetAt>([
        [A, { sheet: base(c.retinue), at: T0 - 1 }],
        [B, { sheet: base(), at: T0 - 1 }],
      ]);
      const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
      const army: WarArmy = { troops: { ...went }, resolve: 0, pips: {} };
      expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army }, T0, ctx), `${c.name}: поход принят`).toBeNull();
      const live = liveSheet(file, A, sheets.get(A)!, T0 + 1);
      expect(live.home, `${c.name}: дома — без ушедших`).toEqual({ spearman: 40, archer: 20 });
    }
  });
});
