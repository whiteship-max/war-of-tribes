/**
 * Замок машины на прогон тестов (бюджет железа, `machinelock.mjs`): `npm test` — половина ядер на минуты, та же
 * тяжёлая работа, что веер отчёта, и рядом с чужой (рендер другого проекта, приёмка другой сессии) он ждёт, а не
 * начинает. Держит замок главный процесс тестов; работники и то, что они запускают, — его потомки, и замок им свой.
 * В режиме наблюдения (`vitest` без `run`) замок не берётся: он висел бы, пока открыт терминал.
 */
import type { GlobalSetupContext } from 'vitest/node';
import { lockMachine } from './budget';

export default async function setup({ config }: GlobalSetupContext): Promise<(() => void) | undefined> {
  if (config.watch) return undefined;
  return lockMachine('тесты');
}
