// Веер обязан отдавать ровно то, что задача отдала бы в процессе отчёта, и в порядке доводов:
// на этом держится «полный режим совпал с прежним буква в букву» (`fan.ts`).
//
// Тест от машины не зависит (ПН-Э2а): бюджет ядер подставляется явно доводом (`fan(…, budget)`, `fanWidth(env, budget)`), и обе ветки
// держатся на любой машине — при бюджете в одно ядро задачи идут в процессе отчёта по очереди до конца, при двух и больше веер
// правда поднимает больше одного процесса. Прежде бюджет брался с машины, и на 4 ядрах (бюджет 1) тест краснел: `TRIBE_FAN=2`
// срезался до 1, и веер шёл в процессе отчёта.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { budgetCores } from './budget';
import { fan, fanWidth, viteNode } from './fan';
import { boom, meet, nap, shape } from './fan-fixture';
import { serveSlots, takeSlot } from './slots';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const FIXTURE = new URL('./fan-fixture.ts', import.meta.url).href;
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

const was = process.env.TRIBE_FAN;
afterEach(() => {
  if (was === undefined) delete process.env.TRIBE_FAN;
  else process.env.TRIBE_FAN = was;
});

describe('веер прогонов', () => {
  it('ширина — из TRIBE_FAN, без неё — бюджет железа; выше бюджета не бывает никогда — при любом бюджете', () => {
    for (const budget of [1, 2, 4, 12]) {
      expect(fanWidth({ TRIBE_FAN: '3' }, budget), `бюджет ${budget}`).toBe(Math.min(3, budget));
      expect(fanWidth({ TRIBE_FAN: '1' }, budget), `бюджет ${budget}`).toBe(1);
      expect(fanWidth({}, budget), `бюджет ${budget}`).toBe(budget);
      expect(fanWidth({ TRIBE_FAN: '999' }, budget), `бюджет ${budget}`).toBe(budget);
    }
    // Без довода — бюджет этой машины: отчёты бюджета не передают.
    expect(fanWidth({})).toBe(budgetCores());
  });

  it('бюджет в одно ядро: задачи идут в процессе отчёта по очереди и до конца — TRIBE_FAN выше бюджета не поднимает', async () => {
    process.env.TRIBE_FAN = '4';
    const got = await fan(nap, FIXTURE, [1, 2, 3, 4], 1);
    expect(got.map((x) => x.n), 'не до конца или не в порядке доводов').toEqual([1, 2, 3, 4]);
    expect(
      got.every((x) => x.pid === process.pid),
      'при бюджете 1 веер поднял дочерний процесс',
    ).toBe(true);
    for (let i = 1; i < got.length; i++) {
      expect(got[i].from, `задача ${i + 1} началась раньше, чем кончилась ${i}: при бюджете 1 — не по очереди`).toBeGreaterThanOrEqual(got[i - 1].to);
    }
    await expect(fan(boom, FIXTURE, [1, 2, 3], 1)).rejects.toThrow(/задача номер два/);
  }, 60_000);

  it('бюджет в два ядра: веер поднимает больше одного процесса, и итог тот же, что подряд в процессе отчёта, в порядке доводов', async () => {
    delete process.env.TRIBE_FAN;
    // Встреча: каждая задача ждёт, пока в папке не будет двух процессов, — один процесс на весь веер её не дождётся.
    const dir = mkdtempSync(join(tmpdir(), 'fan-meet-'));
    try {
      const pids = await fan(meet, FIXTURE, Array.from({ length: 4 }, () => ({ dir, ms: 30_000 })), 2);
      expect(new Set(pids).size, 'при бюджете 2 веер не поднял двух процессов').toBe(2);
      expect(pids.every((p) => p !== process.pid)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const args = [1, 2, 3, 4, 5];
    const here = await fan(shape, FIXTURE, args, 1);
    const there = await fan(shape, FIXTURE, args, 2);
    // Задачи и правда шли в других процессах — иначе проверять было бы нечего.
    expect(here.every((x) => x.pid === process.pid)).toBe(true);
    expect(there.every((x) => x.pid !== process.pid)).toBe(true);
    const strip = (xs: ReturnType<typeof shape>[]) => xs.map(({ pid: _, ...rest }) => rest);
    expect(strip(there)).toEqual(strip(here));
    expect(Object.is(there[0].neg, -0)).toBe(true);
    expect('none' in there[0]).toBe(true);
    expect(there.map((x) => x.n)).toEqual([1, 4, 9, 16, 25]);
  }, 120_000);

  it('упавшая задача роняет веер с её сообщением, а не теряется — и по процессам', async () => {
    await expect(fan(boom, FIXTURE, [1, 2, 3], 2)).rejects.toThrow(/задача номер два/);
  }, 60_000);

  it.each([1, 2])('под приёмкой главный процесс считает под своим жетоном и отдаёт его на время веера — бюджет %i', async (budget) => {
    // Бюджет железа: разделы, не отданные вееру, главный процесс считает сам — и считает под жетоном, как любой счётный
    // отчёт. Жетон один на всех, и сперва его держит тест: главный процесс обязан ждать. Потом жетон отдан, и веер
    // обязан пойти — при бюджете 2 дочерним он достаётся только от главного, отданный на время веера; при бюджете 1 главный
    // считает сам под своим. И процесс обязан выйти, хотя держит свой жетон до конца.
    const srv = await serveSlots(1);
    const mine = await takeSlot(srv.env);
    const fixture = fileURLToPath(new URL('./fan-main-fixture.ts', import.meta.url));
    const child = spawn(process.execPath, [viteNode(), fixture], {
      env: { ...process.env, ...srv.env, TRIBE_FAN: '2', FAN_FIXTURE_BUDGET: String(budget) },
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

/** Комментарии вон — строки кода остаются на своих местах (как `strip` в `budget.test.ts`). */
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Доводы вызова, начинающегося сразу после `(` на месте `from`: сколько их на верхнем уровне скобок (строки и шаблоны — мимо). */
function argsAt(src: string, from: number): number {
  let depth = 1;
  let commas = 0;
  let tail = false;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      // Строка или шаблон — до своей закрывающей; подстановки шаблона `${…}` — со своими скобками.
      let nest = 0;
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') i++;
        else if (c === '`' && src[i] === '$' && src[i + 1] === '{') {
          nest++;
          i++;
        } else if (c === '`' && nest > 0 && src[i] === '}') nest--;
        else if (src[i] === c && nest === 0) break;
      }
      tail = true;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      depth--;
      if (depth === 0) return commas + (tail ? 1 : 0);
    } else if (c === ',' && depth === 1) {
      commas++;
      tail = false;
      continue;
    }
    if (!/\s/.test(c) && depth >= 1) tail = true;
  }
  throw new Error('вызов без закрывающей скобки');
}

const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f) && !/fixture\.ts$/.test(f)) out.push(p);
  }
  return out;
};

describe('бюджет вееру подставляет только тест', () => {
  it('счёт доводов вызова — верхний уровень скобок, строки и шаблоны мимо', () => {
    const n = (s: string): number => argsAt(s, s.indexOf('(') + 1);
    expect(n('fan(a, b, c)')).toBe(3);
    expect(n('fan(a, b, c,)')).toBe(3);
    expect(n('fan(task, url, xs.map((x) => ({ a: x, b: [1, 2] })))')).toBe(3);
    expect(n("fan(task, 'a,b', `x${f(1, 2)},y`, 2)")).toBe(4);
    expect(n('fan()')).toBe(0);
  });

  it('ни один отчёт не зовёт веер с бюджетом: четвёртый довод `fan` есть только у теста', () => {
    // Довод бюджета снимает бюджет железа с машины — отчёт, передавший его, считал бы сверх трети ядер. Подставлять его можно только
    // тесту, где задачи — миллисекунды фикстуры.
    const bad: string[] = [];
    for (const f of walk(join(ROOT, 'scripts'))) {
      const src = strip(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/(?<![\w.$])fan\(/g)) {
        const n = argsAt(src, (m.index ?? 0) + m[0].length);
        if (n !== 3) bad.push(`${f.slice(ROOT.length + 1)}:${src.slice(0, m.index).split('\n').length} — доводов ${n}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
