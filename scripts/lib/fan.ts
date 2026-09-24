/**
 * Веер прогонов: независимые прогоны отчёта — по дочерним процессам, итог — в прежнем порядке.
 *
 * Зачем. Тяжёлые отчёты (`raid-hiring`, `raid-growth`, `raid-stable`, `raid-mix`) — это сотни
 * прогонов автопилота или тысячи боёв ядра, которые друг от друга не зависят: каждый сеется своим
 * миром и своим сидом, и итог строки — сводка их исходов. Шли они в одном процессе подряд, и
 * приёмка ждала сумму, хотя у машины двенадцать ядер (docs/realm.md, раздел 8).
 *
 * ЧТО ОБЯЗАНО ОСТАТЬСЯ ПРЕЖНИМ — вывод отчёта, буква в букву. Держится это тем, что веер не
 * решает ничего: задача — именованная функция модуля отчёта, её довод и итог проходят через
 * структурное клонирование (`serialization: 'advanced'`: NaN, бесконечность, `undefined`, `Map`
 * доезжают как есть), а итоги возвращаются в порядке доводов, а не прихода. Прогон, который
 * зависел бы от того, что считалось до него в том же процессе, здесь разошёлся бы с прежним
 * выводом — и это находка, а не шум: полная приёмка сравнивает вывод с базой.
 *
 * СКОЛЬКО ПРОЦЕССОВ — `TRIBE_FAN`, а без него — все ядра, кроме одного. `TRIBE_FAN=1` — прежний путь:
 * задачи идут в этом же процессе подряд, без единого дочернего. Под приёмкой ядра делят все отчёты
 * вместе: на каждый дочерний процесс берётся жетон (`slots.ts`), и отдаётся он, когда процесс вышел.
 *
 * ДОЧЕРНИЙ ПРОЦЕСС — тот же vite-node, запущенный на модуле, где лежат задачи. Модуль называет
 * свои задачи сам (`serveFan` в его конце): имя, по которому их спрашивает веер, и функция стоят
 * рядом, литералом. Динамического импорта по строке из сообщения здесь нет нарочно: подсчёт
 * замыканий такой импорт не читает и выбирал бы из-за него все отчёты (`lib/deps.ts`, «сомнения»).
 * Поэтому модуль задач обязан быть модулем без действий на верхнем уровне — раздел отчёта, а не
 * его вход. Вывод дочернего в консоль не попадает: отчёт печатает только из своего процесса, в
 * своём порядке. Запись прочитанного (`trace-fs.mjs`) дочерние наследуют через `NODE_OPTIONS`, и
 * прочитанное ими проверяется так же, как прочитанное отчётом.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { takeSlot } from './slots';

type Task = (arg: never) => unknown;

/** Сколько процессов берёт веер: `TRIBE_FAN`, а без него — все ядра, кроме одного. */
export function fanWidth(env: NodeJS.ProcessEnv = process.env): number {
  const n = Math.floor(Number(env.TRIBE_FAN));
  return n >= 1 ? n : Math.max(1, availableParallelism() - 1);
}

interface Job {
  i: number;
  name: string;
  arg: unknown;
}

type Reply = { i: number; ok: true; value: unknown } | { i: number; ok: false; error: string } | { ready: true };

/** Переменная, по которой модуль задач узнаёт, что он — дочерний процесс веера. */
const CHILD = 'TRIBE_FAN_CHILD';

const same = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function viteNode(): string {
  const pkg = createRequire(import.meta.url).resolve('vite-node/package.json');
  return path.join(path.dirname(pkg), 'vite-node.mjs');
}

/**
 * Модуль задач называет свои задачи. В процессе отчёта не делает ничего; в дочернем процессе,
 * запущенном на этом модуле, начинает брать задачи и отдавать итоги.
 */
export function serveFan(where: string, tasks: Record<string, Task>): void {
  const child = process.env[CHILD];
  const post = process.send?.bind(process);
  if (!child || !post || !same(child, fileURLToPath(where))) return;
  let chain = Promise.resolve();
  const send = (m: Reply): Promise<void> => new Promise((resolve, reject) => post(m, undefined, undefined, (e) => (e ? reject(e) : resolve())));
  // Сообщение, пришедшее раньше слушателя, теряется: веер ждёт этого «готов», прежде чем дать задачу.
  process.on('message', (m: Job | { end: true }) => {
    chain = chain.then(async () => {
      if ('end' in m) {
        process.disconnect?.();
        return;
      }
      try {
        const fn = tasks[m.name] as ((a: unknown) => unknown) | undefined;
        if (typeof fn !== 'function') throw new Error(`в ${where} задача ${m.name} не названа (serveFan)`);
        await send({ i: m.i, ok: true, value: await fn(m.arg) });
      } catch (e) {
        await send({ i: m.i, ok: false, error: (e as Error).stack ?? String(e) });
      }
    });
  });
  void send({ ready: true });
}

/**
 * Прогнать `task` на каждом доводе. `task` — задача модуля `where` (его `import.meta.url`),
 * названная там в `serveFan` своим именем. Итог — в порядке доводов.
 */
export async function fan<A, R>(task: (arg: A) => R | Promise<R>, where: string, args: readonly A[]): Promise<R[]> {
  const width = Math.min(fanWidth(), args.length);
  if (width <= 1) {
    const out: R[] = [];
    for (const a of args) out.push(await task(a));
    return out;
  }
  const file = fileURLToPath(where);
  const out = new Array<R>(args.length);
  let next = 0;
  let failed: Error | null = null;
  const bin = viteNode();
  const run = async (): Promise<void> => {
    const slot = await takeSlot();
    try {
      if (failed || next >= args.length) return;
      await work();
    } finally {
      slot?.release();
    }
  };
  const work = (): Promise<void> =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [bin, file], {
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        serialization: 'advanced',
        env: { ...process.env, TRIBE_FAN: '1', [CHILD]: file },
      });
      const give = (): void => {
        if (!child.connected) return;
        if (failed || next >= args.length) {
          child.send({ end: true });
          return;
        }
        const i = next++;
        child.send({ i, name: task.name, arg: args[i] } satisfies Job);
      };
      child.on('message', (m: Reply) => {
        if ('ready' in m) {
          give();
          return;
        }
        if (m.ok) out[m.i] = m.value as R;
        else failed ??= new Error(`веер: задача ${task.name}[${m.i}] упала:\n${m.error}`);
        give();
      });
      child.on('error', (e) => {
        failed ??= e;
      });
      child.on('exit', (code) => {
        if (code !== 0) failed ??= new Error(`веер: дочерний процесс ${task.name} вышел с кодом ${code}`);
        resolve();
      });
    });
  await Promise.all(Array.from({ length: width }, run));
  if (failed) throw failed;
  if (next < args.length) throw new Error(`веер: ${task.name} — роздано ${next} задач из ${args.length}`);
  return out;
}
