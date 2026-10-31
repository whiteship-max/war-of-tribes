// Партии автопилота пути — по ядрам (ПН-Э2г): `allRuns` раздела «Сила НПС» и всех, кто берёт его партии, — веером `scripts/lib/fan.ts`.
// Партии друг от друга не зависят (своя партия — свой сид, свой стиль, своё происхождение), и итог — в порядке доводов, как подряд в
// одном процессе; это тест (`runs.test.ts`: тот же итог буква в букву при бюджете 1 и 2).
//
// Модуль — задача веера: на верхнем уровне действий нет, задачу называет `serveFan` в конце. Довод задачи проходит структурным
// клонированием, поэтому двери игры в нём не едут: ручки пути — без функций (`upgrade`, `hire` — те самые двери игры, которыми их
// заполняет `knobsOf`; другие функции веер не несёт — `allRuns` откажет), стиль — именем.
//
// Заглушки игры, прочитанные в дочернем процессе, сторож раздела (`run.ts`, `watchStubs`) не слышит: задача их записывает и отдаёт с
// итогом, а `allRuns` читает их ещё раз дверью в процессе отчёта — сторож слышит каждую, как прежде.
import { fan, serveFan } from '../lib/fan';
import { promoteUnit } from '../../src/game/promoterules';
import { hireBase } from '../../src/game/townrules';
import { roamStub, watchStubs, type RoamStubId } from '../../src/game/roamstubs';
import { RUN_STYLES, runPath, type PathKnobs, type PathRun, type Style } from './path';
import type { Origin } from './kinds';

/** Ручки пути без функций: так они едут в дочерний процесс веера. */
export type PlainKnobs = Omit<PathKnobs, 'upgrade' | 'hire'>;

export interface PathJob {
  seed: number;
  style: Style['id'];
  origin: Origin;
  row: number[];
  even: number[];
  k: PlainKnobs;
}

export interface PathDone {
  run: PathRun;
  /** Заглушки, прочитанные задачей в дочернем процессе (в процессе отчёта их слышит сторож сам — пусто). */
  stubs: RoamStubId[];
}

/** Одна партия автопилота — задача веера. */
export function pathTask(j: PathJob): PathDone {
  const style = RUN_STYLES.find((s) => s.id === j.style);
  if (!style) throw new Error(`веер пути: стиля ${j.style} нет среди гоняемых`);
  const k: PathKnobs = { ...j.k, upgrade: promoteUnit, hire: hireBase };
  const child = !!process.env.TRIBE_FAN_CHILD;
  const read = new Set<RoamStubId>();
  if (child) watchStubs((id) => read.add(id));
  try {
    return { run: runPath(j.seed, style, j.origin, j.row, j.even, k), stubs: [...read] };
  } finally {
    if (child) watchStubs(null);
  }
}

/** Задачи пути в порядке «стиль × происхождение × сид» — тот же, что был у подряд идущих партий. */
export function pathJobs(k: PathKnobs, origins: readonly Origin[], row: readonly number[], even: readonly number[], seeds: number): PathJob[] {
  if (k.upgrade !== promoteUnit || k.hire !== hireBase) throw new Error('веер пути несёт только двери игры: повышение и найм — promoteUnit и hireBase');
  const { upgrade: _u, hire: _h, ...plain } = k;
  return RUN_STYLES.flatMap((st) =>
    origins.flatMap((o) => Array.from({ length: seeds }, (_, i) => ({ seed: i + 1, style: st.id, origin: o, row: [...row], even: [...even], k: plain }))),
  );
}

/** Веер с теми же доводами, что `fan`, без бюджета: отчёт бюджета не передаёт никогда (`fan.test.ts`), тест подставляет свой веер. */
export type Fan = <A, R>(task: (arg: A) => R | Promise<R>, where: string, args: readonly A[]) => Promise<R[]>;

/**
 * Партии автопилота всех гоняемых стилей, происхождений и сидов — веером по бюджету ядер (`fan`). Заглушки, прочитанные в дочерних,
 * сторож раздела слышит здесь — дверью, как если бы партии шли в этом процессе. `spread` — веер (тест подставляет бюджет в свой).
 */
export async function allRuns(k: PathKnobs, origins: readonly Origin[], row: readonly number[], even: readonly number[], seeds: number, spread: Fan = fan): Promise<PathRun[]> {
  const done = await spread(pathTask, import.meta.url, pathJobs(k, origins, row, even, seeds));
  for (const id of new Set(done.flatMap((d) => d.stubs))) roamStub(id);
  return done.map((d) => d.run);
}

serveFan(import.meta.url, { pathTask });
