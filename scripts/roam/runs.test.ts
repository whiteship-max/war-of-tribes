// Партии автопилота по ядрам (ПН-Э2г): веер `allRuns` отдаёт ровно то, что те же партии подряд в одном процессе, — буква в букву и в том
// же порядке; заглушки, прочитанные в дочерних процессах, сторож раздела слышит так же, как в одном процессе. Бюджет подставляется
// доводом (`fan(…, budget)`, как в `fan.test.ts`): обе ветки держатся на любой машине.
//
// Область: оба гоняемых стиля — мирный и «к замку» (у него окно замка `freeNeeds` с памятью репетиций в процессе — память у каждого
// дочернего своя, итог обязан не зависеть от неё); партия «к замку» правда спрашивала окно — утверждением.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { watchStubs, type RoamStubId } from '../../src/game/roamstubs';
import { INPUTS } from './inputs';
import { RUN_STYLES } from './path';
import { fan } from '../lib/fan';
import { allRuns, type Fan } from './runs';
import { knobsOf } from './sections';

const use = ((k: string) => (INPUTS as Record<string, { value: unknown }>)[k].value) as Parameters<typeof knobsOf>[0]['use'];
const k = knobsOf({ use });
const origins = (use('origins') as unknown as Parameters<typeof allRuns>[1]).slice(0, 2);
const ROW = [12, 79, 79, 243, 682];
const EVEN = [1, 1, 1, 1, 1];

/** Веер с бюджетом `budget` — бюджет подставляет только тест. */
const fanOf = (budget: number): Fan => (task, where, args) => fan(task, where, args, budget);

async function heard(budget: number): Promise<{ runs: Awaited<ReturnType<typeof allRuns>>; stubs: RoamStubId[] }> {
  const stubs = new Set<RoamStubId>();
  watchStubs((id) => stubs.add(id));
  try {
    return { runs: await allRuns(k, origins, ROW, EVEN, 1, fanOf(budget)), stubs: [...stubs].sort() };
  } finally {
    watchStubs(null);
  }
}

const was = process.env.TRIBE_FAN;
beforeAll(() => {
  // Ширину веера держит бюджет теста, а не окружение прогона.
  delete process.env.TRIBE_FAN;
});
afterAll(() => {
  if (was !== undefined) process.env.TRIBE_FAN = was;
});

describe('ПН-Э2г: автопилот пути по ядрам', () => {
  it('итог по ядрам буква в букву совпадает с одним процессом; заглушки дочерних сторож слышит', async () => {
    expect(RUN_STYLES.map((s) => s.id), 'область: оба гоняемых стиля').toEqual(['peace', 'castle']);
    const one = await heard(1);
    const two = await heard(2);
    expect(one.runs).toHaveLength(RUN_STYLES.length * origins.length);
    expect(one.runs.some((r) => r.style === 'castle' && r.asks > 0), 'область: партия «к замку» спрашивала окно').toBe(true);
    expect(JSON.stringify(two.runs), 'итог по ядрам — не тот, что в одном процессе').toBe(JSON.stringify(one.runs));
    expect(two.stubs, 'заглушки дочерних не дошли до сторожа').toEqual(one.stubs);
    expect(one.stubs).toContain('freeOdds');
  }, 300_000);

  it('веер несёт только двери игры: чужая функция найма — отказ, а не тихая подмена', async () => {
    await expect(allRuns({ ...k, hire: (id) => k.hire(id) / 50 }, origins, ROW, EVEN, 1, fanOf(1))).rejects.toThrow(/только двери игры/);
  });
});
