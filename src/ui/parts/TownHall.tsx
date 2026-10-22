import { Suspense, lazy } from 'react';
import type { Building } from '@/game/types';

/** Совет и разделы ратуши, что она даёт городу и дверь в «Указы» — в куске нового вида (`ui/next`): первая загрузка не платит. */
const HallCouncil = lazy(() => import('@/ui/next').then((m) => ({ default: m.HallCouncil })));
const HallGives = lazy(() => import('@/ui/next').then((m) => ({ default: m.HallGives })));

/**
 * Ратуша — своё здание со своими разделами (РТ-1, docs/city_v3.md, «Решения РТ-1»): «Советники» (совет Ратуши) и «Сословия»
 * (РТ-2, раздел закрыт), под ними — что ратуша даёт городу и строка-дверь в «Указы» державы. Вся стройка города — сетка,
 * улучшения и очередь — ушла в «Здания» низа (`ui/next/HallBuild.BuildingsPanel`); второй её копии здесь нет. Уровень
 * ратуши по-прежнему ускоряет стройку и даёт жильё, а теперь ещё ступень совета: лучших и больше просителей.
 *
 * Указ, паёк и налог прежде стояли и здесь вкладкой «Указы» — второй копией державы (находка Д3, docs/ui_v2.md, 5.6); с UI-7
 * их правят в одном месте — там, где казна. Алмазы — в «Сокровищнице» (docs/gems.md).
 */
export function TownHall({ b }: { b: Building }) {
  return (
    <Suspense fallback={null}>
      <HallCouncil />
      <HallGives b={b} />
    </Suspense>
  );
}
