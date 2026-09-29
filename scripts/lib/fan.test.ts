// Веер обязан отдавать ровно то, что задача отдала бы в процессе отчёта, и в порядке доводов:
// на этом держится «полный режим совпал с прежним буква в букву» (`fan.ts`).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { budgetCores } from './budget';
import { fan, fanWidth, viteNode } from './fan';
import { boom, shape } from './fan-fixture';
import { serveSlots, takeSlot } from './slots';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const was = process.env.TRIBE_FAN;
afterEach(() => {
  if (was === undefined) delete process.env.TRIBE_FAN;
  else process.env.TRIBE_FAN = was;
});

describe('веер прогонов', () => {
  it('ширина — из TRIBE_FAN, без неё — бюджет железа; выше бюджета не бывает никогда', () => {
    expect(fanWidth({ TRIBE_FAN: '3' })).toBe(Math.min(3, budgetCores()));
    expect(fanWidth({ TRIBE_FAN: '1' })).toBe(1);
    expect(fanWidth({})).toBe(budgetCores());
    expect(fanWidth({ TRIBE_FAN: '999' })).toBe(budgetCores());
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

  it('под приёмкой главный процесс считает под своим жетоном и отдаёт его на время веера', async () => {
    // Бюджет железа: разделы, не отданные вееру, главный процесс считает сам — и считает под жетоном, как любой счётный
    // отчёт. Жетон один на всех, и сперва его держит тест: главный процесс обязан ждать. Потом жетон отдан, и веер
    // обязан пойти — дочерним он достаётся только от главного, отданный на время веера. И процесс обязан выйти, хотя
    // держит свой жетон до конца.
    const srv = await serveSlots(1);
    const mine = await takeSlot(srv.env);
    const fixture = fileURLToPath(new URL('./fan-main-fixture.ts', import.meta.url));
    const child = spawn(process.execPath, [viteNode(), fixture], {
      env: { ...process.env, ...srv.env, TRIBE_FAN: '2' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    const exited = new Promise<number | string>((r) => child.on('exit', (code) => r(code ?? 'убит')));
    const until = async (what: string, ms: number): Promise<boolean> => {
      for (const end = Date.now() + ms; Date.now() < end && !out.includes(what); ) await sleep(100);
      return out.includes(what);
    };
    try {
      expect(await until('запущен', 30_000), 'главный процесс не запустился').toBe(true);
      await sleep(4000);
      expect(out.includes('считаю'), 'главный процесс считает без жетона').toBe(false);
      mine!.release();
      expect(await until('веер: 1,4', 45_000), 'веер не пошёл при одном жетоне: главный не отдал свой').toBe(true);
      expect(await Promise.race([exited, sleep(10_000).then(() => 'висит')]), 'процесс не вышел, держа жетон').toBe(0);
    } finally {
      child.kill();
      await srv.close();
    }
  }, 120_000);
});
