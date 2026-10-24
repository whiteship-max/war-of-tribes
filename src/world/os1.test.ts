// ОС-1 (docs/siege_v2.md, раздел 23): истощение от еды и сдача голодом — на настоящем мире и дверях.
//
// Штраф к добыче — от соотношения сил (кривая `siegefood.siegeCut` по трём точкам, плавная и монотонная); войска в осаде
// едят паёк жителя; сдачу голодом решает склад в шаге осады: добыча → прокорм → проверка, баланс ниже нуля
// (`siegefood.starves`). Ровно ноль, дробный остаток, хлеб, пришедший в тот же шаг, прогноз и округление город не сдают.
// Посёлок мерки (`autopilot.townAt`) живёт шагом игры (`tick`), логово садится лагерем той мощью, что назвал тест (`sitsDown`
// подменён: здесь меряется правило хлеба, а не частота осад), кость фаз — «без перемен».
import '@/game/pace.minute';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY_LENGTH, gameDaysOfMs, gameDaysPerHour, gameSeconds, realMs } from '@/game/pace';
import { SIEGE_SOLDIER_FOOD, SIEGE_YIELD, SOLDIER_FOOD } from '@/game/constants';
import {
  foodConsumptionPerDay,
  grossFoodPerDay,
  mastersFoodPerDay,
  mouthCount,
  productionPerDay,
  seasonMods,
  seasonOf,
  siegeDryIn,
  soldierFoodPerDay,
  townFoodPerDay,
} from '@/game/derived';
import { tick } from '@/game/sim/tick';
import { troopPower } from '@/game/battle/price';
import type { GameState } from '@/game/types';
import { applyEffects, playerProfile, syncSiege } from './bridge';
import { HOME_ID, LocalWorld } from './local/LocalWorld';
import { breadAt, openSiege, siegeSince, starvesAt, type SiegeWindow } from './siege';
import { hungerStepAt, phaseAt, setPhaseDie } from './siegeroll';
import { siegeCut, starves, yieldShare } from './siegefood';
import { breadSpan, breadWords, cutWords } from './siegewords';
import { CUT_MAX, CUT_MID, CUT_MIN, CUT_RATIO_EVEN, CUT_RATIO_STRONG, CUT_RATIO_WEAK } from './data/siegefood';
import { SIEGE_PHASE } from './data/siegeroll';
import { shieldVillagers } from './lairs';
import type { HomeEffect, PlayerProfile, Report, SiegeView, WorldPulse } from './types';
import { openSky, townAt, START, type Inside } from '../../scripts/autopilot';

// ВРЕМЕННО ВОЙСКО НЕ ЕСТ ДЛЯ ТЕСТА: этот тест держит расход и голод бойца при пайке — держим `TEST_ARMY_FOOD` 1;
// 0 проверяет src/game/armyfood.test.ts. Снять при возврате 1.
vi.mock('@/game/constants', async (actual) => ({ ...(await actual<object>()), TEST_ARMY_FOOD: 1 }));

vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));
afterEach(() => setPhaseDie(null));

// ------------------------------------------------------------------ кривая штрафа ---

describe('ОС-1: штраф к добыче — по соотношению сил, плавно и монотонно', () => {
  it('три точки: слабее на треть — наименьший, вровень — средний, сильнее на половину — наибольший; за крайними — ровно', () => {
    expect(siegeCut(CUT_RATIO_WEAK)).toBeCloseTo(CUT_MIN, 12);
    expect(siegeCut(CUT_RATIO_EVEN)).toBeCloseTo(CUT_MID, 12);
    expect(siegeCut(CUT_RATIO_STRONG)).toBeCloseTo(CUT_MAX, 12);
    expect(siegeCut(0.2), 'лагерь вчетверо слабее — тот же наименьший').toBe(CUT_MIN);
    expect(siegeCut(4), 'вчетверо сильнее — тот же наибольший').toBe(CUT_MAX);
    expect(siegeCut(Infinity), 'гарнизона за воротами нет').toBe(CUT_MAX);
    expect(siegeCut(0), 'лагеря нет').toBe(CUT_MIN);
    // Точки внутри области правила: наименьший меньше среднего, средний — наибольшего.
    expect(CUT_MIN).toBeLessThan(CUT_MID);
    expect(CUT_MID).toBeLessThan(CUT_MAX);
  });

  it('монотонно: больше соотношение — не меньше штраф; между точками — строго больше', () => {
    let prev = -1;
    for (let i = 0; i <= 4000; i++) {
      const r = 0.25 * Math.pow(16, i / 4000);
      const c = siegeCut(r);
      expect(c, `×${r}`).toBeGreaterThanOrEqual(prev);
      if (r > CUT_RATIO_WEAK * 1.001 && r < CUT_RATIO_STRONG / 1.001) expect(c, `×${r} строго`).toBeGreaterThan(prev);
      prev = c;
    }
  });

  it('без скачка на пороге: один боец сверх сотни меняет штраф меньше чем на процент — у трёх точек и между ними', () => {
    // Граница области: соотношения вокруг всех трёх точек и между ними, гарнизон из ста бойцов (шаг — один боец).
    const men = 100;
    const one = (men + 1) / men;
    for (const at of [CUT_RATIO_WEAK, CUT_RATIO_EVEN, CUT_RATIO_STRONG, 0.8, 1.25]) {
      for (const k of [-3, -2, -1, 0, 1, 2, 3]) {
        const r = at * Math.pow(one, k);
        expect(Math.abs(siegeCut(r * one) - siegeCut(r)), `×${r.toFixed(4)}`).toBeLessThan(0.01);
      }
    }
  });

  it('доля добычи: хлеб — за стеной целиком, прочее — на три четверти; наибольший штраф — как осада до ОС-1', () => {
    expect(yieldShare(CUT_MAX, true)).toBe(0);
    expect(yieldShare(CUT_MAX, false)).toBeCloseTo(SIEGE_YIELD, 12);
    expect(yieldShare(CUT_MIN, true)).toBeCloseTo(1 - CUT_MIN, 12);
    expect(yieldShare(CUT_MIN, false)).toBeCloseTo(1 - CUT_MIN * (1 - SIEGE_YIELD), 12);
  });
});

// ------------------------------------------------------------------ паёк войска ---

/** Посёлок мерки под осадой со штрафом `cut`: задания уже засчитаны шагом, чтобы их награда не легла посреди проверки. */
function besieged(level: number, cut = CUT_MAX): GameState {
  const s = townAt(level);
  tick(s, 1);
  s.siege = { byName: 'Тест', until: Number.MAX_SAFE_INTEGER, cut };
  return s;
}

describe('ОС-1: войска в осаде едят паёк жителя', () => {
  it('расход в осаде: бойцы — `SIEGE_SOLDIER_FOOD` своего пайка (−16,7 %), жители и мастера — как прежде', () => {
    const s = besieged(6);
    const mods = seasonMods(s);
    const before = foodConsumptionPerDay({ ...s, siege: null }, mods);
    const after = foodConsumptionPerDay(s, mods);
    const army = mouthCount(s) * soldierFoodPerDay(s, mods);
    // Точка внутри области: у посёлка мерки войско есть — расход бойцов не ноль.
    expect(army).toBeGreaterThan(0);
    expect(SIEGE_SOLDIER_FOOD * SOLDIER_FOOD, 'на стене боец ест паёк жителя').toBeCloseTo(1, 12);
    expect(after).toBeCloseTo(townFoodPerDay(s, mods) + mastersFoodPerDay(s, mods) + army * SIEGE_SOLDIER_FOOD, 9);
    expect(before - after).toBeCloseTo(army * (1 - SIEGE_SOLDIER_FOOD), 9);
    expect(1 - SIEGE_SOLDIER_FOOD, 'ориентир владельца — 10–20 %').toBeGreaterThan(0.1);
    expect(1 - SIEGE_SOLDIER_FOOD).toBeLessThan(0.2);
  });

  it('слепок осады везёт тот же осадный паёк бойца, что ест племя: окно не множит его второй раз', () => {
    const s = besieged(6);
    const p = playerProfile(s);
    expect(p.soldierFoodPerHour ?? 0).toBeCloseTo(soldierFoodPerDay(s) * SIEGE_SOLDIER_FOOD * gameDaysPerHour(), 9);
    expect(p.besieged).toBe(true);
    expect(p.yieldPerHour ?? 0, 'валовая добыча — без штрафа').toBeCloseTo(grossFoodPerDay(s) * gameDaysPerHour(), 6);
    expect(p.yieldPerHour ?? 0).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ правило шага ---

describe('ОС-1: шаг племени — добыча → прокорм → проверка', () => {
  /** Хлеб ровно на прокорм одного шага `dt` (под наибольшим штрафом добычи хлеба нет). */
  const exact = (s: GameState, dt: number): number => (foodConsumptionPerDay(s, seasonMods(s)) * dt) / DAY_LENGTH;

  it('ровно ноль — прокорм оплачен: засухи нет', () => {
    const s = besieged(5);
    expect(productionPerDay(s).food, 'точка внутри области: поля не кормят').toBe(0);
    s.resources.food = exact(s, 1);
    tick(s, 1);
    expect(s.resources.food).toBe(0);
    expect(s.siege?.dry).toBeUndefined();
  });

  it('дробный остаток — оплачен: на складе видно ноль (вниз до целого), а засухи нет', () => {
    const s = besieged(5);
    s.resources.food = exact(s, 1) + 0.4;
    tick(s, 1);
    expect(Math.floor(s.resources.food)).toBe(0);
    expect(s.resources.food).toBeGreaterThan(0);
    expect(s.siege?.dry).toBeUndefined();
  });

  it('хлеба не хватило — засуха с этого шага; следующий шаг её держит, пока прокорм не оплачен', () => {
    const s = besieged(5);
    s.resources.food = exact(s, 1) - 1;
    tick(s, 1);
    expect(s.resources.food).toBe(0);
    const since = s.siege?.dry;
    expect(since, 'засуха началась').toBe(s.time);
    tick(s, 1);
    expect(s.siege?.dry, 'та же засуха, с той же минуты').toBe(since);
  });

  it('хлеб пришёл в тот же шаг (караван разгрузился после прокорма) — прокорм оплачен, засухи нет', () => {
    const s = besieged(5);
    s.resources.food = exact(s, 1) - 1;
    s.caravans = [{ id: 1, good: 'food', count: 100, gold: 0, departAt: s.time - 10, arriveAt: s.time + 0.5 }];
    tick(s, 1);
    expect(s.caravans, 'точка внутри области: караван разгрузился этим шагом').toHaveLength(0);
    expect(s.resources.food).toBeGreaterThan(0);
    expect(s.siege?.dry).toBeUndefined();
  });

  it('хлеб пришёл между шагами — засуха кончилась', () => {
    const s = besieged(5);
    s.resources.food = 0;
    tick(s, 1);
    expect(s.siege?.dry).toBeDefined();
    s.resources.food += 50;
    tick(s, 1);
    expect(s.siege?.dry).toBeUndefined();
  });

  it('правило шага одно: ниже нуля — голод, ноль и выше — нет', () => {
    expect(starves(-1e-9)).toBe(true);
    expect(starves(0)).toBe(false);
    expect(starves(1e-9)).toBe(false);
  });
});

// ------------------------------------------------------------------ мир: слепок и шаг осады ---

function makeWorld(seed = 7) {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
  return { world, at: (t: number): void => void (now = t), advance: (ms: number): void => void (now += ms), now: (): number => now };
}

/** Деревня, которую с ходу не взять (огромное ополчение): набег садится лагерем. Склад слепка — шесть тысяч хлеба. */
const holdout = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 100_000,
  militia: 1000,
  units: { warrior: 10, scout: 4 },
  army: { spearman: 10 },
  stock: { food: 6000, wood: 400 },
  stash: 0,
  food: 6000,
  foodPerHour: 6000,
  soldierFoodPerHour: 60,
  ...over,
});

/**
 * Слепок склада под осадой: `food` хлеба; засуха — `dry` настоящих мс до минуты пульса (нет — склад кормит); прогноз — склад
 * опустеет через `ahead` настоящих мс (по умолчанию час: город не кормится сам, и лагерь логова не уходит).
 */
const larder = (food: number, dry?: number, ahead = 3_600_000): PlayerProfile =>
  holdout({
    besieged: true,
    food,
    stock: { ...(food > 0 ? { food } : {}), wood: 400 },
    ...(dry !== undefined ? { dryFor: gameSeconds(dry / 1000) } : { dryIn: gameSeconds(ahead / 1000) }),
  });

/** Первая фаза после минуты `t` от начала осады `since`. */
const phaseAfter = (since: number, t: number): number => Math.floor((t - since) / SIEGE_PHASE) + 1;

async function besiege(w: ReturnType<typeof makeWorld>, p: PlayerProfile): Promise<WorldPulse> {
  for (let i = 0; i < 2500; i++) {
    w.advance(20_000);
    const pulse = await w.world.sync(p);
    if (pulse.siege) return pulse;
  }
  throw new Error('осады так и не случилось');
}

const fell = (pulse: WorldPulse): HomeEffect | undefined => pulse.effects.find((e) => e.starved);

describe('ОС-1: мир сдаёт наш город голодом только по засухе склада, в шаге осады', () => {
  it('склад кормит (ноль или дробь, засухи нет) — шаги осады проходят, хотя окно мира давно «доело» город', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld();
    const pulse = await besiege(w, holdout());
    const since = pulse.siege!.since;
    // Точка внутри области: шаги — после того, как прогноз окна мира (хлеб слепка при постановке) кончился.
    const win: SiegeWindow = (w.world as Inside).save.sieges[HOME_ID];
    const k = phaseAfter(since, starvesAt(win));
    w.at(phaseAt(since, k) + 1000);
    let after = await w.world.sync(larder(0));
    expect(fell(after), 'склад ровно пуст, прокорм оплачен — город стоит').toBeUndefined();
    w.at(phaseAt(since, k + 1) + 1000);
    after = await w.world.sync(larder(0.4));
    expect(fell(after), 'дробь хлеба — город стоит').toBeUndefined();
    expect(after.siege, 'осада идёт').not.toBeNull();
  }, 60_000);

  it('засуха склада — город сдан голодом в шаге осады после неё, не раньше; в обоз хлеба не кладут', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld();
    const pulse = await besiege(w, holdout());
    const since = pulse.siege!.since;
    // Засуха началась посреди третьей фазы: между шагами город держится.
    const dryAt = phaseAt(since, 2) + 60_000;
    w.at(dryAt + 60_000);
    let after = await w.world.sync(larder(0, 60_000));
    expect(fell(after), 'между шагами — не падает').toBeUndefined();
    const step = phaseAt(since, 3);
    w.at(step + 1000);
    after = await w.world.sync(larder(0, step + 1000 - dryAt));
    const e = fell(after);
    expect(e, 'шаг осады после засухи — голод').toBeDefined();
    expect(e?.resources.food ?? 0, 'хлеба в обозе нет').toBe(0);
    expect(after.reports.find((r: Report) => r.title === 'Хлеб кончился')?.at, 'в минуту шага').toBe(step);
  }, 60_000);

  it('хлеб пришёл в шаге осады — засуха снята до броска, и шаг город не сдаёт', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld();
    const pulse = await besiege(w, holdout());
    const since = pulse.siege!.since;
    // Сухой склад весь шаг до последних секунд, потом подвоз (весть, караван): слепок у броска — сыт.
    w.at(phaseAt(since, 1) - 30_000);
    await w.world.sync(larder(0, 600_000));
    w.at(phaseAt(since, 1) + 1000);
    const after = await w.world.sync(larder(300));
    expect(fell(after)).toBeUndefined();
    expect(after.siege).not.toBeNull();
  }, 60_000);
});

// ------------------------------------------------------------------ настоящий мир: посёлок живёт, лагерь стоит ---

/** Прежний час голода — хлеб на складе против расхода без осады, игровых секунд: так считало окно до ОС-1. */
const beforeOs1 = (g: GameState): number => (g.resources.food / foodConsumptionPerDay({ ...g, siege: null })) * DAY_LENGTH;

interface Run {
  g: GameState;
  w: Inside;
  views: SiegeView[];
  fellAt: number | null;
  fellFood: number | null;
  leftAt: number | null;
  sat: SiegeView | null;
  satSeason: string | null;
  /** Сколько хлеба мост снял со склада на пульсах без последствий — урезания Р-5 больше нет. */
  bridgeCut: number;
  /** Минута пульса, на котором склад впервые в засухе. */
  dryAt: number | null;
  /** Прогноз склада и прежний час голода (`beforeOs1`) в минуту, когда лагерь сел, игровых секунд. */
  satDryIn: number;
  satBefore: number;
}

/**
 * Осада посёлка мерки `level` лагерем мощью `ratio` мощностей гарнизона. Посёлок живёт шагом игры; лагерь садится всегда,
 * кроме прорыва; кость — «без перемен»; других набегов нет. `shift` — игровых дней до похода (сезон). До конца осады или
 * `days` игр. дн.
 */
async function siegeRun(level: number, ratio: number, o: { shift?: number; days?: number } = {}): Promise<Run> {
  setPhaseDie(() => 7);
  const g = townAt(level);
  g.time += (o.shift ?? 0) * DAY_LENGTH;
  const run: Run = { g, w: null, views: [], fellAt: null, fellFood: null, leftAt: null, sat: null, satSeason: null, bridgeCut: 0, dryAt: null, satDryIn: 0, satBefore: 0 };
  const sky = openSky(g, { seed: 7, pulse: 30, raids: true, ripe: true, step: { name: 'тест', rho: null, shield: false } }, {
    effect: (e) => {
      if (e.starved && run.fellFood === null) run.fellFood = g.resources.food;
    },
  });
  await sky.pulse();
  const w: Inside = sky.world;
  run.w = w;
  w.sitsDown = (id: string, _m: unknown, _at: number, field: { won: boolean }): boolean => !field.won && !w.save.sieges[id];
  w.save.nextAiAt = sky.now();
  w.scheduleAi(sky.now());
  const m = w.save.marches.find((x: Inside) => !x.own && x.targetId === HOME_ID);
  m.power = ratio * troopPower(g.army);
  m.units = { warrior: Math.max(1, Math.round(m.power / 3)) };
  w.save.nextAiAt = Number.MAX_SAFE_INTEGER;
  const end = sky.now() + realMs((o.days ?? 200) * DAY_LENGTH);
  while (sky.now() < end) {
    sky.at(sky.now() + 60_000);
    for (let left = gameSeconds(60); left > 0; left -= 5) tick(g, Math.min(5, left));
    if (g.siege?.dry !== undefined && run.dryAt === null) run.dryAt = sky.now();
    const before = g.resources.food;
    const p = await sky.pulse();
    if (!p.effects.length) run.bridgeCut += Math.max(0, before - g.resources.food);
    if (p.siege) {
      run.views.push(p.siege);
      if (!run.sat) {
        run.sat = p.siege;
        run.satSeason = seasonOf(g.time);
        run.satDryIn = siegeDryIn(g);
        run.satBefore = beforeOs1(g);
      }
    }
    for (const r of p.reports) {
      if (r.title === 'Хлеб кончился') run.fellAt = r.at;
      if (r.title === 'Осада снята') run.leftAt = r.at;
    }
    if (run.sat && !w.save.sieges[HOME_ID]) break;
  }
  return run;
}

describe('ОС-1: три соотношения на настоящем мире — посёлок 5-го уровня живёт, лагерь логова стоит', () => {
  it('слабый лагерь (×⅔): штраф наименьший, поля кормят город — лагерь снимается в первом шаге, голода нет', async () => {
    const r = await siegeRun(5, CUT_RATIO_WEAK);
    expect(r.sat, 'лагерь сел').not.toBeNull();
    expect(r.sat!.ratio!).toBeCloseTo(CUT_RATIO_WEAK, 2);
    expect(r.sat!.cut!).toBeCloseTo(siegeCut(r.sat!.ratio!), 12);
    expect(r.sat!.dryAt, 'склад не опустеет: срока нет — окно пишет «кормит»').toBeUndefined();
    // Уход — первым: живой посёлок под долгой осадой теряет стабильность (СБ-1), мятеж снимает руки с работы, и добыча падает
    // втрое — слабому лагерю, который остался бы, голод достался бы этим путём. Не уморить его держит уход в первом шаге.
    expect(r.leftAt, 'лагерь ушёл в первом шаге').toBe(phaseAt(r.sat!.since, 1));
    expect(r.fellAt, 'голодом не взят').toBeNull();
  }, 120_000);

  it('равные (×1): средний штраф; добыча племени — валовая за вычетом штрафа; голод — заметно позже, чем до ОС-1', async () => {
    const r = await siegeRun(5, CUT_RATIO_EVEN, { days: 16 });
    const v = r.sat!;
    expect(v.ratio!).toBeCloseTo(CUT_RATIO_EVEN, 2);
    expect(v.cut!).toBeCloseTo(siegeCut(v.ratio!), 12);
    // Племя добывает по штрафу мира — тем же числом.
    expect(r.g.siege?.cut).toBeCloseTo(r.views[r.views.length - 1].cut!, 12);
    expect(productionPerDay(r.g).food).toBeCloseTo(grossFoodPerDay(r.g) * yieldShare(r.g.siege!.cut!, true), 6);
    expect(r.satDryIn, 'склад держится больше чем вдвое дольше прежнего часа голода').toBeGreaterThan(2 * r.satBefore);
  }, 120_000);

  it('сильный лагерь (×1,5): штраф наибольший — хлеб с полей ноль, как до ОС-1; склад держится дольше лишь на паёк войска', async () => {
    const r = await siegeRun(5, CUT_RATIO_STRONG, { days: 16 });
    expect(r.sat!.cut!).toBeCloseTo(CUT_MAX, 3);
    expect(yieldShare(r.sat!.cut!, true), 'хлеб с полей — ноль').toBeCloseTo(0, 3);
    // Склад опустеет: голод реален. Дольше прежнего часа голода — не больше, чем даёт паёк войска (прогноз — по сезонам, зима
    // может сделать его и короче прежнего часа, сосчитанного сезоном постановки).
    expect(Number.isFinite(r.satDryIn), 'склад опустеет').toBe(true);
    expect(r.satDryIn, 'не дольше, чем даёт паёк войска').toBeLessThanOrEqual(r.satBefore / SIEGE_SOLDIER_FOOD);
  }, 120_000);

  it('вдвое сильнее (×2): город сдан голодом — в шаге осады после засухи склада; хлеба в нём нет, ложной сдачи нет', async () => {
    const r = await siegeRun(5, 2);
    expect(r.fellAt, 'взят голодом').not.toBeNull();
    expect((r.fellAt! - r.sat!.since) % SIEGE_PHASE, 'в минуту шага').toBe(0);
    expect(r.dryAt, 'склад опустел').not.toBeNull();
    expect(r.fellFood ?? 1, 'склад к шагу пуст').toBeLessThanOrEqual(0);
    expect(r.g.stats.fedFalls ?? 0).toBe(0);
  }, 120_000);
});

// ------------------------------------------------------------------ причина ложной сдачи — починена ---

describe('ОС-1: причина ложной сдачи (23.1) — починена', () => {
  it('лагерь встал зимой: мост склад не урезает, город держится, пока склад кормит, и сдан в шаге после засухи', async () => {
    const r = await siegeRun(8, 3000 / troopPower(townAt(8).army), { shift: 5 });
    expect(r.satSeason, 'точка внутри области: лагерь встал зимой').toBe('winter');
    expect(r.bridgeCut, 'склад не урезан').toBe(0);
    expect(r.fellAt, 'город пал голодом').not.toBeNull();
    expect(r.dryAt, 'склад опустел').not.toBeNull();
    // Засуха — между прошлым пульсом и этим; голод — в первом шаге после неё.
    const dryFrom = r.dryAt! - 60_000;
    expect(r.fellAt!).toBeGreaterThanOrEqual(dryFrom);
    expect(r.fellAt! - dryFrom).toBeLessThanOrEqual(SIEGE_PHASE + 60_000);
    expect(r.g.stats.fedFalls ?? 0, 'ложной сдачи нет').toBe(0);
  }, 120_000);
});

// ------------------------------------------------------------------ старое сохранение ---

describe('ОС-1: сохранение с идущей осадой до ОС-1', () => {
  it('племя без штрафа в поле осады — наибольший штраф, как было: хлеб ноль, прочее четверть', () => {
    const s = townAt(5);
    tick(s, 1);
    const gross = productionPerDay(s);
    s.siege = { byName: 'Старое', until: 1e9 };
    const cut = productionPerDay(s);
    expect(cut.food).toBe(0);
    expect(cut.wood).toBeCloseTo(gross.wood * SIEGE_YIELD, 6);
  });

  it('окно и лагерь из сохранения до ОС-1: срок стоянки «час голода» город не сдаёт — склад кормит, осада идёт', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld();
    await besiege(w, holdout());
    const win: SiegeWindow = (w.world as Inside).save.sieges[HOME_ID];
    // Окно до ОС-1: без добычи, штрафа и меры хлеба; стоянка — до часа голода окна, как писал прежний код.
    delete win.yieldPerHour;
    delete win.cut;
    delete win.breadAtSince;
    const camp = (w.world as Inside).save.marches.find((m: { id: string }) => m.id === win.campId);
    camp.stayUntil = starvesAt(win);
    expect(Number.isFinite(camp.stayUntil), 'точка внутри области: у стоянки срок').toBe(true);
    w.at(camp.stayUntil + 1000);
    const after = await w.world.sync(larder(3000));
    expect(fell(after), 'срок стоянки город не сдал').toBeUndefined();
    expect(after.siege).not.toBeNull();
    expect(camp.stayUntil, 'стоянка у нашего города больше не кончается сроком').toBe(Number.MAX_SAFE_INTEGER);
  }, 60_000);

  it('мост: осада без поля штрафа — племя добывает по наибольшему, пока мир не назовёт штраф', () => {
    const s = townAt(5);
    syncSiege(s, { byId: 'l', byName: 'Старое', since: START, starvesAt: START + 3600_000, garrison: 1, foodAtStart: 1, campMen: 1 } as unknown as SiegeView, START);
    expect(s.siege?.cut).toBeUndefined();
    expect(productionPerDay(s).food).toBe(0);
  });
});

// ------------------------------------------------------------------ окно: слова для сведения ---

describe('ОС-1: окно защитника — «хлеба хватит на ~N ч» и штраф с причиной', () => {
  it('срок — настоящим временем с точностью до получаса; сытый город — «кормится сам»', () => {
    expect(breadSpan(Infinity)).toBe('не кончится');
    expect(breadSpan(100)).toBe('меньше получаса');
    expect(breadSpan(6.4 * 3600)).toBe('~6 ч 30 мин');
    expect(breadWords(6 * 3600)).toBe('Хлеба хватит на ~6 ч.');
    expect(breadWords(Infinity)).toBe('Хлеба хватает: поля кормят город.');
  });

  it('окно мира и прогноз племени — одно число: минута пустого склада — от минуты пульса', async () => {
    const r = await siegeRun(5, CUT_RATIO_STRONG, { days: 16 });
    const v = r.views[r.views.length - 1];
    expect(v.dryAt, 'склад опустеет').toBeDefined();
    expect(Math.abs(v.dryAt! - (r.w.save.profileAt + realMs(siegeDryIn(r.g))))).toBeLessThan(realMs(gameSeconds(120)));
    expect(cutWords(r.sat!.ratio!)).toMatch(/^Добыча: хлеб −\d+ %, прочее −\d+ % — лагерь сильнее гарнизона \(×1,5\)\.$/);
  }, 120_000);
});

// Склад внутри окна (сервер войны, город без слепка осады): шаг голода — первая фаза после пустого склада.
describe('ОС-1: окно со складом внутри — шаг голода — первая фаза после пустого склада', () => {
  it('склад опустел ровно в минуту броска — этот шаг оплачен, голод — следующим', () => {
    const w = openSiege({ byId: 'l', campId: 'm', now: START, food: 1000, garrison: 0, townPerHour: 1000 / (SIEGE_PHASE / 3_600_000), perManPerHour: 0 });
    expect(starvesAt(w), 'точка внутри области: склад пуст в минуту первого броска').toBeCloseTo(phaseAt(START, 1), -1);
    expect(starves(breadAt(w, phaseAt(START, 1) - 1)), 'до броска баланс выше нуля').toBe(false);
    expect(hungerStepAt(siegeSince(w), phaseAt(START, 1)), 'ровно на броске — не этот шаг').toBe(phaseAt(START, 2));
    expect(gameDaysOfMs(hungerStepAt(siegeSince(w), starvesAt(w)) - START)).toBeGreaterThanOrEqual(4);
  });
});

// Последствие падения голодом считает ложную сдачу, только если племя знало об осаде, а склад кормил.
describe('ОС-1: счёт ложных сдач — племя знало об осаде, а склад кормил', () => {
  const starved: HomeEffect = { id: 'x-fell', lost: {}, resources: {}, prestige: 0, morale: 0, battle: null, text: 'Осада доела город', good: false, starved: true };

  it('засуха была — сдача честная', () => {
    const s = besieged(5);
    s.siege!.dry = s.time;
    applyEffects(s, [starved]);
    expect(s.stats.fedFalls ?? 0).toBe(0);
  });

  it('засухи не было — ложная сдача в счёт (опись повезёт её серверу, правило «starve»)', () => {
    const s = besieged(5);
    applyEffects(s, [starved]);
    expect(s.stats.fedFalls).toBe(1);
  });

  it('племя осады не знало — судило окно мира, счёта нет', () => {
    const s = townAt(5);
    applyEffects(s, [starved]);
    expect(s.stats.fedFalls ?? 0).toBe(0);
  });
});
