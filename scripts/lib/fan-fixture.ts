// Задачи для теста веера (`fan.test.ts`): что доезжает через границу процесса и что бывает с упавшей; идут ли задачи по очереди
// и поднимает ли веер больше одного процесса (ПН-Э2а).
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveFan } from './fan';

/** Итог, который JSON исказил бы: NaN, бесконечность, `undefined`, `Map`, отрицательный ноль. */
export function shape(n: number): { n: number; nan: number; inf: number; none: undefined; map: Map<string, number>; neg: number; pid: number } {
  return { n: n * n, nan: NaN, inf: n % 2 ? Infinity : -Infinity, none: undefined, map: new Map([['n', n]]), neg: -0, pid: process.pid };
}

export function boom(n: number): number {
  if (n === 2) throw new Error('задача номер два');
  return n;
}

/** Задача со сном: номер, когда началась и кончилась (часы процесса) и в каком процессе. По ней видно, шли ли задачи по очереди. */
export async function nap(n: number): Promise<{ n: number; from: number; to: number; pid: number }> {
  const from = performance.now();
  await new Promise((r) => setTimeout(r, 30));
  return { n, from, to: performance.now(), pid: process.pid };
}

/**
 * Встреча процессов: кладёт номер своего процесса в `dir` и ждёт, пока там не окажется двух разных, — не дольше `ms`. Отдаёт номер
 * процесса. Один процесс на весь веер встречи не дождётся и упадёт словами — так тест узнаёт, что больше одного не поднялось.
 */
export async function meet(arg: { dir: string; ms: number }): Promise<number> {
  writeFileSync(join(arg.dir, String(process.pid)), '');
  const end = Date.now() + arg.ms;
  while (readdirSync(arg.dir).length < 2) {
    if (Date.now() > end) throw new Error(`встреча: за ${arg.ms} мс поднялся один процесс веера`);
    await new Promise((r) => setTimeout(r, 20));
  }
  return process.pid;
}

serveFan(import.meta.url, { shape, boom, nap, meet });
