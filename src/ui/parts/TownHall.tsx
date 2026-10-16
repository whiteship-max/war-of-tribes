import { Suspense, lazy } from 'react';
import type { Building } from '@/game/types';
import { TownBuild } from './TownBuild';

/** Что ратуша даёт городу и дверь в «Указы» — в куске нового вида, рядом с сеткой стройки (`ui/next/HallGives.tsx`). */
const HallGives = lazy(() => import('@/ui/next').then((m) => ({ default: m.HallGives })));

/**
 * Ратуша — сердце города: вся стройка — сетка «Стройки» (`TownBuild`), под ней — что ратуша даёт городу и строка-дверь в
 * «Указы» державы. Указ, паёк и налог прежде стояли и здесь вкладкой «Указы» — второй копией державы (находка Д3,
 * docs/ui_v2.md, 5.6); с UI-7 их правят в одном месте — там, где казна, — и туда же ведут подсказка золота, «Мораль» и
 * «Изменить паёк» склада.
 *
 * Алмазы ушли из ратуши в «Сокровищницу» — плашка под строкой запасов (docs/gems.md): баланс, покупка, лавка и история
 * живут на сервере и видны из любого места города, а не только из ратуши.
 */
export function TownHall({ b }: { b: Building }) {
  return (
    <>
      <TownBuild />
      <Suspense fallback={null}>
        <HallGives b={b} />
      </Suspense>
    </>
  );
}
