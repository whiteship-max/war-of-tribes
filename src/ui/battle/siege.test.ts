// Ролик = донесение (docs/gfx.md, ГФ-2): на наборе настоящих осад мира — логово у наших стен (частокол и камень) и наш
// лагерь под логовом, кость подменена, чтобы каждая осада стояла внутри области своего правила, — ролик показывает то, что
// игрок видел в окне осады по ходу и прочёл в донесении: проломы после броска каждой фазы, готовые машины и развязку с
// участью. Ролик строится из записи осады в донесении (`Report.siege`) той же дверью, что в игре (`showOfSiege`), а
// сверяется с тем, что мир говорил игроку живьём (`WorldPulse.siege`, `camp()`), — не с собой.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotifyingWorld } from '@/world/local/NotifyingWorld';
import type { WorldSave } from '@/world/local/state';
import type { GenSettlement } from '@/world/gen';
import type { PlayerProfile, Report, WorldPulse } from '@/world/types';
import type { SiegeEnd } from '@/world/siegerecord';
import { distance } from '@/world/geo';
import { shieldVillagers } from '@/world/lairs';
import { phaseAt, setPhaseDie, softerFate, type SiegeOrders } from '@/world/siegeroll';
import { siegeShare } from '@/world/parley';
import { LAIR_RANSOM_SHARE } from '@/world/data/parley';
import type { Fate } from '@/world/spoils';
import { FINALES, breachesAt, gateAt, machinesUp, siegeReel } from '@/render/siege/reel';
import type { ShowSite } from '@/render/siege/show';
import { clipsOfSiege, showOfSiege } from './siege';

// Энергия дороги здесь не предмет проверки (как в `siegephase.test.ts`): полководец стоит у логова сразу.
vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

afterEach(() => setPhaseDie(null));

const START = 1_700_000_000_000;

type Inner = { save: WorldSave; gen: { settlements: GenSettlement[] }; alive(s: GenSettlement, now: number): boolean };

function makeWorld(seed = 7) {
  let now = START;
  const world = new NotifyingWorld({ seed, now: () => now, storage: null });
  return {
    world,
    inner: world as unknown as Inner,
    now: () => now,
    at: (t: number) => {
      now = t;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}
type W = ReturnType<typeof makeWorld>;

/** Город, который логово не возьмёт с ходу и будет держать в осаде (как `siegeanswers.test.ts`): стена уровня `wall`. */
const holdout = (wall: number): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 100_000,
  militia: 1000,
  units: { warrior: 10, scout: 4 },
  army: { spearman: 10 },
  stock: { food: 600, wood: 5000, stone: 2000 },
  gold: 200,
  stash: 50,
  food: 6000 * 12,
  foodPerHour: 6000,
  soldierFoodPerHour: 60,
  levels: { palisade: wall },
});

async function besieged(w: W, p: PlayerProfile): Promise<WorldPulse> {
  for (let i = 0; i < 2500; i++) {
    w.advance(20_000);
    const pulse = await w.world.sync(p);
    if (pulse.siege) return pulse;
  }
  throw new Error('осады так и не случилось');
}

/** Что игрок видел по ходу осады: проломы после броска каждой фазы и готовые машины лагеря. */
interface Seen {
  breaches: number[];
  ready: string[];
  fate: Fate;
}

/** Чем бой осады должен быть в ролике (`BattleSite` мира): штурм стены, частокола логова и ворот, вылазка, удар с поля. */
const EPISODE_OF: Record<ShowSite, string> = { wall: 'assault', lair: 'assault', gate: 'assault', sortie: 'sortie', camp: 'relief', joint: 'relief' };

/** Донесение с записью осады — одно на осаду. */
async function siegeReport(w: W): Promise<Report> {
  const all = (await w.world.reports()).filter((r) => r.siege);
  expect(all, 'одно донесение несёт запись осады').toHaveLength(1);
  return all[0];
}

/** Ролик из донесения сверяется с тем, что игрок видел: проломы по фазам, машины, развязка и участь. */
function filmMatches(report: Report, seen: Seen, how: SiegeEnd, fate: Fate | null): void {
  const rec = report.siege!;
  expect(rec.end.how, 'исход в записи — исход осады').toBe(how);
  const show = showOfSiege(rec, report);
  const reel = siegeReel(show, 'medium');
  // Граница области: фазы бросались, и каждая видна игроку до конца осады.
  expect(seen.breaches.length, 'точка внутри области: фазы были').toBeGreaterThan(0);
  expect(show.phases.length).toBeGreaterThanOrEqual(seen.breaches.length);
  if (show.wall > 0) {
    seen.breaches.forEach((n, i) => expect(breachesAt(reel, reel.phaseAt[i] + 0.01), `проломов после броска фазы ${i + 1}`).toBe(n));
  }
  expect(machinesUp(reel, reel.seconds).sort(), 'машины к концу — готовые в окне лагеря').toEqual([...seen.ready].sort());
  const finale = reel.episodes.find((e) => FINALES.includes(e.kind));
  expect(finale?.kind, 'развязка ролика — исход донесения').toBe(how);
  expect(show.end.fate, 'участь ролика — та, с которой пал город').toBe(fate);
  expect(reel.episodes.some((e) => e.kind === 'fate')).toBe(fate !== null);
  if (show.wall > 0 && (how === 'gates' || how === 'terms' || how === 'hunger')) expect(gateAt(reel, reel.seconds), 'ворота открыты').toBe(1);
  // Бои осады — эпизоды ролика своей фазы: штурм, вылазка, удар с поля, с исходом боя.
  for (const f of show.fights.filter((x) => !x.end)) {
    const ep = reel.episodes.find((e) => e.fight === f);
    expect(ep?.kind, `бой фазы ${f.k} (${f.site}) — эпизод ролика`).toBe(EPISODE_OF[f.site]);
    expect(ep?.k).toBe(f.k);
  }
  expect(show.fights.length, 'бои ролика — бои записи').toBe(rec.fights?.length ?? 0);
  // Короткие ролики донесения — те же эпизоды ролика: у каждого клипа есть свой эпизод.
  for (const c of clipsOfSiege(rec)) expect(reel.episodes.some((e) => e.kind === c.kind && e.k === c.k), `клип «${c.label}»`).toBe(true);
}

/** Логово у наших стен: фаза за фазой, пока осада стоит; `act` — ответ осаждённого после броска фазы. */
async function homeSiege(w: W, p: PlayerProfile, act?: (k: number) => Promise<void>): Promise<Seen> {
  const start = (await besieged(w, p)).siege!;
  const seen: Seen = { breaches: [], ready: [], fate: start.fate };
  for (let k = 1; k <= 60; k++) {
    w.at(phaseAt(start.since, k) + 1000);
    const pulse = await w.world.sync(p);
    if (!pulse.siege) break;
    seen.breaches.push(pulse.siege.phases!.breaches);
    if (act) await act(k);
    if (!w.inner.save.sieges.home) break;
  }
  return seen;
}

/** Ставит полководца в поле у логова — свежим, сразу, без дороги (как `siegephase.test.ts`). */
function standAt(w: W, s: { x: number; y: number }, troops: Record<string, number>): void {
  Object.assign(w.inner.save.figures.general, {
    phase: 'field',
    from: { x: s.x, y: s.y },
    to: { x: s.x, y: s.y },
    departAt: w.now(),
    arriveAt: w.now(),
    downUntil: 0,
    busyUntil: 0,
    held: false,
    watching: false,
    energy: undefined,
    spent: undefined,
    troops,
    handover: undefined,
  });
}

interface OurSiege {
  /** Дело полководца после броска фазы `k`. */
  act?: (k: number, lair: GenSettlement) => Promise<void>;
  /** Машина в очередь с первой минуты, весь лес лагеря — ей. */
  machine?: 'mangonel';
  /** Объявленная участь. */
  fate?: Fate;
  /** Наказы лагеря с первой минуты (штурм по проломам). */
  orders?: SiegeOrders;
  /** Копейщиков с полководцем. */
  troops?: number;
}

/** Наш лагерь под ближним логовом: фаза за фазой, пока осада стоит. */
async function ourSiege(w: W, { act, machine, fate = 'plunder', orders, troops = 40 }: OurSiege = {}): Promise<Seen> {
  const p: PlayerProfile = {
    name: 'Тест',
    pop: shieldVillagers(0.1),
    defense: 30,
    units: { warrior: 10, scout: 4 },
    army: { spearman: troops },
    stock: { food: 600, wood: 400 },
    stash: 0,
  };
  await w.world.sync(p);
  const home = w.inner.save.home;
  const lair = w.inner.gen.settlements.filter((s) => w.inner.alive(s, w.now())).sort((a, b) => distance(home, a) - distance(home, b))[0];
  standAt(w, lair, { spearman: troops });
  expect(await w.world.besiege(fate)).toBeNull();
  const win = w.inner.save.sieges[lair.id];
  // Вылазка и выручка логова — свои события; здесь держится запись, а не бой у рогаток.
  win.sortied = true;
  win.relieved = true;
  if (machine) {
    // Весь лес лагеря — машинам: камнемёт встаёт до конца осады.
    expect(await w.world.setMachineWood(1)).toBeNull();
    expect(await w.world.orderMachine(machine)).toBeNull();
  }
  if (orders) expect(await w.world.setOrders(orders)).toBeNull();
  const since = win.sinceAt ?? win.startedAt;
  const seen: Seen = { breaches: [], ready: [], fate };
  for (let k = 1; k <= 60; k++) {
    w.at(phaseAt(since, k) + 1000);
    await w.world.sync(p);
    const camp = await w.world.camp();
    if (!camp || !w.inner.save.sieges[lair.id]) break;
    seen.breaches.push(camp.machines?.breaches ?? camp.phases?.breaches ?? 0);
    seen.ready = (camp.machines?.list ?? []).filter((m) => m.state === 'ready').map((m) => m.id);
    if (act) await act(k, lair);
    if (!w.inner.save.sieges[lair.id]) break;
  }
  return seen;
}

describe('ролик = донесение: логово у наших стен', () => {
  it('частокол: проломы фаза за фазой, ворота открыли — сдача мягче объявленной', async () => {
    setPhaseDie(() => 14);
    const w = makeWorld();
    const seen = await homeSiege(w, holdout(2));
    expect(Math.max(...seen.breaches), 'точка внутри области: стену проломили').toBeGreaterThan(0);
    filmMatches(await siegeReport(w), seen, 'gates', softerFate(seen.fate));
  }, 120_000);

  it('камень: пролом, починка к броску следующей фазы, пролом снова', async () => {
    // Кость 14, пока камень не проломят; пролом заделывают, и фазу, к которой его заделали, кость тихая — стена цела; дальше
    // снова 14 (камень четвёртого уровня снимает две грани: пролом не с первой фазы).
    let calm = Infinity;
    setPhaseDie((_s, k) => (k === calm ? 7 : 14));
    const w = makeWorld();
    const seen = await homeSiege(w, holdout(4), async (k) => {
      const rows = w.inner.save.sieges.home?.phases ?? [];
      if (calm === Infinity && rows[rows.length - 1]?.out === 'breach') {
        expect(await w.world.defend({ act: 'repair' })).toBeNull();
        calm = k + 1;
      }
    });
    // Граница области: пролом был, его заделали к броску следующей фазы (ноль) и проломили снова.
    const first = seen.breaches.findIndex((n) => n > 0);
    expect(first, 'точка внутри области: камень проломили').toBeGreaterThanOrEqual(0);
    expect(seen.breaches[first + 1], 'заделан к броску следующей фазы').toBe(0);
    expect(Math.max(...seen.breaches.slice(first + 2)), 'проломили снова').toBeGreaterThan(0);
    filmMatches(await siegeReport(w), seen, 'gates', softerFate(seen.fate));
  }, 120_000);

  it('без перемен: город доели голодом, стена цела', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld();
    const seen = await homeSiege(w, holdout(3));
    expect(seen.breaches.every((n) => n === 0)).toBe(true);
    filmMatches(await siegeReport(w), seen, 'hunger', seen.fate);
  }, 120_000);

  it('сдались после второй фазы: ворота открыли, гарнизон вышел', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld();
    const seen = await homeSiege(w, holdout(4), async (k) => {
      if (k === 2) expect(await w.world.defend({ act: 'surrender' })).toBeNull();
    });
    expect(seen.breaches).toHaveLength(2);
    filmMatches(await siegeReport(w), seen, 'gates', softerFate(seen.fate));
  }, 120_000);

  it('дань отдана: лагерь снят, города не взяли', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld();
    const seen = await homeSiege(w, holdout(2), async (k) => {
      if (k === 1) expect(await w.world.parley({ act: 'offer', kind: 'tribute' })).toBeNull();
    });
    filmMatches(await siegeReport(w), seen, 'paid', null);
  }, 120_000);
});

describe('ролик = донесение: наш лагерь под логовом', () => {
  it('камнемёт построен и стоит, выкуп взят с половины пути', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld(11);
    const seen = await ourSiege(w, {
      machine: 'mangonel',
      act: async (k, lair) => {
        const win = w.inner.save.sieges[lair.id];
        if (siegeShare(win, phaseAt(win.sinceAt ?? win.startedAt, k) + 1000) < LAIR_RANSOM_SHARE) return;
        if (!(await w.world.camp())?.parley?.incoming) return;
        expect(await w.world.parley({ act: 'answer', kind: 'tribute', yes: true })).toBeNull();
      },
    });
    expect(seen.ready, 'точка внутри области: камнемёт достроили до конца осады').toContain('mangonel');
    filmMatches(await siegeReport(w), seen, 'ransom', null);
  }, 120_000);

  it('логово открыло ворота: участь — наша, на ступень мягче', async () => {
    setPhaseDie(() => 14);
    const w = makeWorld(11);
    const seen = await ourSiege(w);
    filmMatches(await siegeReport(w), seen, 'gates', softerFate('plunder'));
  }, 120_000);

  it('логово сдалось на условиях: участь — из условий', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld(11);
    let said: string | null = 'не предлагали';
    const seen = await ourSiege(w, {
      fate: 'captives',
      act: async (k) => {
        if (k === 1) said = await w.world.parley({ act: 'offer', kind: 'terms', fate: 'plunder' });
      },
    });
    expect(said, 'точка внутри области: логово согласилось').toBeNull();
    filmMatches(await siegeReport(w), seen, 'terms', 'plunder');
  }, 120_000);

  it('штурм по наказу отбит: осада идёт дальше, ворота открыли — в ролике отбитый штурм своей фазы', async () => {
    // Кость 7 до второй фазы, 14 — дальше: во второй фазе пролом, наказ штурмует в ту же минуту малой дружиной.
    setPhaseDie((_s, k) => (k >= 2 ? 14 : 7));
    const w = makeWorld(11);
    const seen = await ourSiege(w, { orders: { storm: 1 } });
    const report = await siegeReport(w);
    const storm = report.siege!.fights?.find((f) => f.at === phaseAt(report.siege!.sinceAt ?? report.siege!.startedAt, 2));
    expect(storm, 'точка внутри области: штурм был').toBeTruthy();
    expect(storm!.won, 'точка внутри области: штурм отбит').toBe(false);
    filmMatches(report, seen, 'gates', softerFate('plunder'));
  }, 120_000);

  it('штурм по наказу взял логово: донесение о бое несёт осаду, ролик кончается штурмом', async () => {
    setPhaseDie((_s, k) => (k >= 2 ? 14 : 7));
    const w = makeWorld(11);
    const seen = await ourSiege(w, { orders: { storm: 1 }, troops: 400 });
    const report = await siegeReport(w);
    expect(report.battle, 'точка внутри области: штурм был боем').toBeTruthy();
    expect(report.won, 'точка внутри области: логово взято').toBe(true);
    filmMatches(report, seen, 'storm', 'plunder');
    const show = showOfSiege(report.siege!, report);
    expect(show.fights.find((f) => f.end)?.report, 'бой развязки — это донесение').toBe(report.id);
  }, 120_000);
});
