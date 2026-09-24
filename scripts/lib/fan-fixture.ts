// Задачи для теста веера (`fan.test.ts`): что доезжает через границу процесса и что бывает с упавшей.
import { serveFan } from './fan';

/** Итог, который JSON исказил бы: NaN, бесконечность, `undefined`, `Map`, отрицательный ноль. */
export function shape(n: number): { n: number; nan: number; inf: number; none: undefined; map: Map<string, number>; neg: number; pid: number } {
  return { n: n * n, nan: NaN, inf: n % 2 ? Infinity : -Infinity, none: undefined, map: new Map([['n', n]]), neg: -0, pid: process.pid };
}

export function boom(n: number): number {
  if (n === 2) throw new Error('задача номер два');
  return n;
}

serveFan(import.meta.url, { shape, boom });
