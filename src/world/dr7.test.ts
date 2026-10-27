// ДР-7 (docs/city_v3.md, «Решения ДР-7»): режим марша выбирают в окне дела полководца — после выбора дела, в одном окне с
// составом. Мир даёт строки трёх режимов у каждого дела с дорогой (`ErrandOption.gaits`: срок туда и назад, отказ, лагерь,
// энергия, множитель поклажи), приказ несёт режим (`ErrandOrder.gait`): дома он ставится даром тем же переводом, что смена
// дома, отказ дела возвращает прежний; не дома режим в приказе не берётся (в пути его меняют в окне отряда). Убыль и
// вывоз окно считает по выбранному составу дверью `gait.gaitTake` — тем же числом, что возьмёт добычу мир.
//
// Граница области (правило 11): полководец жив, в строю и в своём городе в минуту приказа (кроме блока «не дома»); цель в
// регионе игрока и жива; у каждого дела дорога длиннее нуля — это утверждается в каждой точке до приказа. Энергия дорогу не
// берёт (`ENERGY_ROAD`, как в `dr6.test.ts`).
import { describe, expect, it, vi } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { StoredMarch, WorldSave } from './local/state';
import type { GenSettlement } from './gen';
import { shieldVillagers } from './lairs';
import { distance } from './geo';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import type { ErrandId, ErrandOption, ErrandTarget, FigureView, PlayerCastle, PlayerProfile } from './types';
import type { WarOrder, WarView } from '../../netlify/lib/contract';
import { GAITS, LIGHT_NO_CAMP, siegeBlockOf, type Gait } from './gait';
import { gaitTake } from './gaitview';
import { gaitFor, inGait } from '@/ui/map/ActionMenu';
import { sendBlock } from '@/ui/map/ArmySend';

vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

const START = 1_700_000_000_000 + 14 * 3_600_000;
const HOUR = 3_600_000;
const HOST: TroopStack = { legionary: 60, spearman: 50, archer: 30 };
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

async function bench(o: { ally?: boolean; answer?: (x: WarOrder) => string | null } = {}) {
  const clock = { now: START };
  let rival: PlayerCastle = { id: 'castle-x', x: 0, y: 0, name: 'Сосед', city: 'Соседград', power: 500, pop: 100, seenAt: START };
  const orders: WarOrder[] = [];
  const wars: WarView[] = [];
  const world = new LocalWorld({
    seed: 7,
    now: () => clock.now,
    storage: null,
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
  if (o.ally) wars.push({ id: 'w-ally', role: 'ally', me: 'c-me', defCastle: rival.id, phase: 'camp', camp: {}, battles: [], reliefs: [] } as unknown as WarView);
  await world.sync(profile());
  const fig = async (): Promise<FigureView> => (await world.figures()).find((f) => f.id === 'general')!;
  const w = world as unknown as { gen: { settlements: GenSettlement[] }; alive(x: GenSettlement, now: number): boolean; inRealm(c: { x: number; y: number }): boolean; save: WorldSave };
  const lair = w.gen.settlements.filter((x) => w.alive(x, clock.now) && w.inRealm(x)).sort((a, c) => distance(a, info.home) - distance(c, info.home))[0];
  const raid: StoredMarch = {
    id: 'raid-dr7',
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
  return { world, clock, fig, save: w.save, lair, rival, raid, orders };
}

type Bench = Awaited<ReturnType<typeof bench>>;

const DEEDS: { name: string; deed: ErrandId; goal: (b: Bench) => ErrandTarget; ally?: boolean; war?: WarOrder['op']; camp?: true; loot?: true }[] = [
  { name: 'удар по логову', deed: 'storm', goal: (b) => ({ kind: 'place', id: b.lair.id }), loot: true },
  { name: 'осада логова', deed: 'siege', goal: (b) => ({ kind: 'place', id: b.lair.id }), camp: true, loot: true },
  { name: 'блокада логова', deed: 'blockade', goal: (b) => ({ kind: 'place', id: b.lair.id }), camp: true, loot: true },
  { name: 'перехват набега', deed: 'intercept', goal: (b) => ({ kind: 'march', id: b.raid.id }) },
  { name: 'поход на город соседа', deed: 'storm', goal: (b) => ({ kind: 'place', id: b.rival.id }), war: 'march', loot: true },
  { name: 'осада города соседа', deed: 'siege', goal: (b) => ({ kind: 'place', id: b.rival.id }), war: 'march', camp: true, loot: true },
  { name: 'выручка союзника', deed: 'relief', goal: (b) => ({ kind: 'place', id: b.rival.id }), ally: true, war: 'relief' },
];

const rowOf = (o: ErrandOption, g: Gait) => o.gaits!.find((r) => r.gait === g)!;

describe('ДР-7: режим марша — в окне дела, у каждого дела с дорогой', () => {
  it.each(DEEDS)('$name: три режима — срок туда и назад, отказ и лагерь; приказ уходит выбранным режимом', async (d) => {
    const b = await bench({ ally: d.ally });
    const goal = d.goal(b);
    const g0 = await b.fig();
    expect(g0.phase, 'область: дома').toBe('home');
    expect(g0.march?.change.free, 'область: режим дома меняют даром').toBe(true);
    const opt = (await b.world.errands('general', goal)).find((o) => o.id === d.deed)!;
    expect(opt, `${d.name}: дело есть`).toBeDefined();
    expect(opt.gaits?.map((r) => r.gait), `${d.name}: строки трёх режимов`).toEqual([...GAITS]);
    for (const r of opt.gaits!) {
      expect(r.walkMs, `${d.name}, ${r.gait}: точка внутри области — дорога есть`).toBeGreaterThan(0);
      expect(r.backMs, `${d.name}, ${r.gait}: дорога назад есть`).toBeGreaterThan(0);
      // Лагерь налегке не встаёт: у осады и блокады это отказ строки, у остальных — только столбец «Осада».
      expect(siegeBlockOf(r.gait), `${d.name}, ${r.gait}: осада в этом режиме`).toBe(r.gait === 'light' ? LIGHT_NO_CAMP : null);
      expect(r.block, `${d.name}, ${r.gait}: отказ дела в режиме`).toBe(d.camp && r.gait === 'light' ? LIGHT_NO_CAMP : null);
    }
    expect((opt.haul ?? 0) > 0, `${d.name}: вывоз — у дел с добычей`).toBe(Boolean(d.loot));
    // Быстрее режим — короче дорога: налегке быстрее обычного, обоз вдвое медленнее.
    expect(rowOf(opt, 'light').walkMs).toBeLessThan(rowOf(opt, 'normal').walkMs);
    expect(rowOf(opt, 'train').walkMs).toBeGreaterThan(rowOf(opt, 'normal').walkMs);
    // Назад — тем же режимом: обоз и домой идёт медленнее.
    expect(rowOf(opt, 'train').backMs, `${d.name}: назад обозом дольше`).toBeGreaterThan(rowOf(opt, 'normal').backMs);

    // Приказ в режиме, выбранном окном (налегке — где лагерь не нужен, иначе обоз): состав и режим одним приказом.
    const g: Gait = d.camp ? 'train' : 'light';
    const err = await b.world.errand({ agent: 'general', target: goal, deed: d.deed, fate: 'plunder', shownAt: opt.at, troops: { ...WANT }, gait: g });
    expect(err, `${d.name}: дело принято`).toBeNull();
    const g1 = await b.fig();
    expect(g1.march?.gait, `${d.name}: режим полководца — выбранный`).toBe(g);
    if (d.war) {
      const sent = b.orders.find((x) => x.op === d.war) as { gait?: Gait; walkMs?: number } | undefined;
      expect(sent?.gait, `${d.name}: серверу ушёл выбранный режим`).toBe(g);
      if (d.war === 'relief') expect(sent?.walkMs, `${d.name}: срок приказа — срок строки`).toBe(rowOf(opt, g).walkMs);
    } else {
      expect(g1.arriveAt - g1.departAt, `${d.name}: срок приказа — срок строки`).toBe(rowOf(opt, g).walkMs);
    }
  });

  it('налегке на осаду и блокаду — отказ словами режима, и всё как до приказа: режим и состав', async () => {
    for (const deed of ['siege', 'blockade'] as const) {
      const b = await bench();
      const goal: ErrandTarget = { kind: 'place', id: b.lair.id };
      const opt = (await b.world.errands('general', goal)).find((o) => o.id === deed)!;
      expect(rowOf(opt, 'light').block, 'точка внутри области: налегке отказ строки').toBe(LIGHT_NO_CAMP);
      expect(await b.world.errand({ agent: 'general', target: goal, deed, fate: 'plunder', shownAt: opt.at, troops: { ...WANT }, gait: 'light' })).toBe(LIGHT_NO_CAMP);
      const g = await b.fig();
      expect(g.march?.gait, `${deed}: режим прежний`).toBe('normal');
      expect(troopTotal(g.troops), `${deed}: отряд снова гарнизон`).toBe(0);
      expect(g.phase).toBe('home');
    }
  });

  it('дома режим ставится даром: энергии не тратит, стоянки нет; отказ дела (сервер) возвращает прежний режим', async () => {
    const b = await bench({ answer: () => 'Сервер отказал.' });
    const goal: ErrandTarget = { kind: 'place', id: b.rival.id };
    const opt = (await b.world.errands('general', goal)).find((o) => o.id === 'storm')!;
    const before = await b.fig();
    expect(await b.world.errand({ agent: 'general', target: goal, deed: 'storm', fate: 'plunder', shownAt: opt.at, troops: { ...WANT }, gait: 'train' })).toBe('Сервер отказал.');
    const after = await b.fig();
    expect(after.march?.gait, 'отказ — режим прежний').toBe('normal');
    expect(after.energy?.value, 'энергия та же').toBe(before.energy?.value);
    expect(after.march?.haltUntil, 'стоянки нет').toBe(0);
    // Принятый приказ — режим остаётся, стоянки и платы нет.
    const ok = await bench();
    const lairGoal: ErrandTarget = { kind: 'place', id: ok.lair.id };
    const o2 = (await ok.world.errands('general', lairGoal)).find((o) => o.id === 'storm')!;
    const e0 = (await ok.fig()).energy?.value ?? 0;
    expect(await ok.world.errand({ agent: 'general', target: lairGoal, deed: 'storm', fate: 'plunder', shownAt: o2.at, troops: { ...WANT }, gait: 'train' })).toBeNull();
    const g = await ok.fig();
    expect(g.march?.gait).toBe('train');
    expect(g.march?.haltUntil, 'дома стоянки нет').toBe(0);
    // Платит он только цену дела — та же, что без режима: смена дома даром.
    expect(e0 - (g.energy?.value ?? 0), 'списана только цена удара').toBe(o2.energy?.price ?? 0);
  });

  it('не дома режим в приказе не берётся: дело идёт нынешним, даром режим не меняется', async () => {
    const b = await bench();
    const goal: ErrandTarget = { kind: 'place', id: b.lair.id };
    const opt = (await b.world.errands('general', goal)).find((o) => o.id === 'storm')!;
    expect(await b.world.errand({ agent: 'general', target: goal, deed: 'storm', fate: 'plunder', shownAt: opt.at, troops: { ...WANT } })).toBeNull();
    b.clock.now += Math.round(rowOf(opt, 'normal').walkMs / 3);
    const away = await b.fig();
    expect(away.phase, 'область: в пути').toBe('moving');
    expect(away.march?.change.free, 'область: не дома').toBe(false);
    const raid: ErrandTarget = { kind: 'march', id: b.raid.id };
    const chase = (await b.world.errands('general', raid)).find((o) => o.id === 'intercept')!;
    const e0 = away.energy?.value;
    const err = await b.world.errand({ agent: 'general', target: raid, deed: 'intercept', shownAt: chase.at, gait: 'light' });
    const still = await b.fig();
    expect(still.march?.gait, 'режим прежний').toBe('normal');
    expect(still.march?.haltUntil, 'стоянки нет').toBe(0);
    // Тот же приказ без поля — тот же итог: режим в пути приказ дела не меняет.
    const twin = await bench();
    const o2 = (await twin.world.errands('general', goal)).find((o) => o.id === 'storm')!;
    expect(await twin.world.errand({ agent: 'general', target: goal, deed: 'storm', fate: 'plunder', shownAt: o2.at, troops: { ...WANT } })).toBeNull();
    twin.clock.now = b.clock.now;
    const c2 = (await twin.world.errands('general', raid)).find((o) => o.id === 'intercept')!;
    expect(await twin.world.errand({ agent: 'general', target: raid, deed: 'intercept', shownAt: c2.at }), 'тот же итог').toBe(err);
    const t2 = await twin.fig();
    expect(t2.arriveAt, 'та же дорога').toBe(still.arriveAt);
    expect(t2.energy?.value, 'та же энергия').toBe(still.energy?.value);
    expect(e0, 'область: энергия есть').toBeDefined();
  });
});

describe('ДР-7: убыль и вывоз — по составу, выбранному в окне', () => {
  it('дома отряда нет, а строки считаются по составу окна — той же поклажей, что возьмёт добычу мир', async () => {
    const b = await bench();
    const opt = (await b.world.errands('general', { kind: 'place', id: b.lair.id })).find((o) => o.id === 'storm')!;
    expect(troopTotal((await b.fig()).troops), 'область: дома отряда нет').toBe(0);
    type Hauling = { haul(units: { warrior?: number }, ours: boolean, g?: Gait): { carry: number } };
    const h = b.world as unknown as Hauling;
    for (const men of [troopTotal(WANT), 400, 5000]) {
      for (const r of opt.gaits!) {
        const t = gaitTake(men, r.gait, r.walkMs, opt.haul ?? 0);
        expect(t.carry, `${men}, ${r.gait}: вывоз — поклажа мира`).toBe(Math.floor(h.haul({ warrior: men - t.lost }, true, r.gait).carry));
        expect(t.lost, `${r.gait}: не налегке — без убыли`).toBe(r.gait === 'light' ? t.lost : 0);
      }
    }
    // Пустой состав — «—» (прежде так стояло всё: строки считались по отряду дома, а он пуст).
    expect(gaitTake(0, 'normal', rowOf(opt, 'normal').walkMs, opt.haul ?? 0)).toEqual({ lost: 0, carry: 0 });
    // Больше уходит — больше вывоз; налегке убыль растёт с составом (точка внутри области: дорога достаточно длинная).
    const big = gaitTake(5000, 'light', rowOf(opt, 'light').walkMs, opt.haul ?? 0);
    expect(big.lost, 'область: налегке пять тысяч к приходу теряют').toBeGreaterThan(0);
    expect(big.carry).toBeGreaterThan(gaitTake(400, 'light', rowOf(opt, 'light').walkMs, opt.haul ?? 0).carry);
  });
});

describe('ДР-7: окно — режим по делу, срок на кнопках — по выбранному режиму', () => {
  it('у осады «Налегке» погашен с причиной; режим окна — выбранный, если годен, иначе нынешний, иначе первый годный', async () => {
    const b = await bench();
    const list = await b.world.errands('general', { kind: 'place', id: b.lair.id });
    const siege = list.find((o) => o.id === 'siege')!;
    const storm = list.find((o) => o.id === 'storm')!;
    expect(gaitFor(siege, 'light', 'light', true), 'налегке на осаду не выбрать').toBe('normal');
    expect(gaitFor(siege, 'train', 'normal', true)).toBe('train');
    expect(gaitFor(storm, 'light', 'normal', true)).toBe('light');
    expect(gaitFor(storm, 'light', 'normal', false), 'не дома — нынешний').toBe('normal');
    expect(sendBlock(siege, 'light', 30), '«Отправить» налегке на осаду — отказ режима').toBe(LIGHT_NO_CAMP);
    expect(sendBlock(siege, 'normal', 30), 'обычным — уходит').toBeNull();
    expect(sendBlock(siege, 'normal', 0), 'пустой состав — гасит').not.toBeNull();
    // Срок на кнопке дела — строка выбранного режима.
    for (const g of GAITS) {
      expect(inGait(storm, g).walkMs).toBe(rowOf(storm, g).walkMs);
      expect(inGait(storm, g).backMs).toBe(rowOf(storm, g).backMs);
    }
  });
});
