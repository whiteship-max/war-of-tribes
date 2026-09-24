// Веер обязан отдавать ровно то, что задача отдала бы в процессе отчёта, и в порядке доводов:
// на этом держится «полный режим совпал с прежним буква в букву» (`fan.ts`).
import { afterEach, describe, expect, it } from 'vitest';
import { fan, fanWidth } from './fan';
import { boom, shape } from './fan-fixture';

const was = process.env.TRIBE_FAN;
afterEach(() => {
  if (was === undefined) delete process.env.TRIBE_FAN;
  else process.env.TRIBE_FAN = was;
});

describe('веер прогонов', () => {
  it('ширина — из TRIBE_FAN, без неё — все ядра, кроме одного', () => {
    expect(fanWidth({ TRIBE_FAN: '3' })).toBe(3);
    expect(fanWidth({ TRIBE_FAN: '1' })).toBe(1);
    expect(fanWidth({})).toBeGreaterThanOrEqual(1);
  });

  it('по процессам — тот же итог, что подряд в процессе отчёта, и в порядке доводов', async () => {
    const args = [1, 2, 3, 4, 5];
    process.env.TRIBE_FAN = '1';
    const here = await fan(shape, import.meta.url.replace('fan.test.ts', 'fan-fixture.ts'), args);
    process.env.TRIBE_FAN = '2';
    const there = await fan(shape, import.meta.url.replace('fan.test.ts', 'fan-fixture.ts'), args);
    // Задачи и правда шли в других процессах — иначе проверять было бы нечего.
    expect(here.every((x) => x.pid === process.pid)).toBe(true);
    expect(there.every((x) => x.pid !== process.pid)).toBe(true);
    const strip = (xs: ReturnType<typeof shape>[]) => xs.map(({ pid: _, ...rest }) => rest);
    expect(strip(there)).toEqual(strip(here));
    expect(Object.is(there[0].neg, -0)).toBe(true);
    expect('none' in there[0]).toBe(true);
    expect(there.map((x) => x.n)).toEqual([1, 4, 9, 16, 25]);
  }, 60_000);

  it('упавшая задача роняет веер с её сообщением, а не теряется', async () => {
    process.env.TRIBE_FAN = '2';
    await expect(fan(boom, import.meta.url.replace('fan.test.ts', 'fan-fixture.ts'), [1, 2, 3])).rejects.toThrow(/задача номер два/);
  }, 60_000);
});
