import { Suspense, lazy } from 'react';
import { useGame } from '@/game/store';
import { Leave } from '@/ui/parts/leave';
import { Crash } from './Crash';

/**
 * Тело окна — своим куском (РТ-2б, docs/stability.md, «РТ-2б»): зима приходит посреди партии, а не к первому кадру. Его код
 * подтягивается в фоне вместе с картой, когда замок встал (`boot/warm`); на медленной сети — к своему часу.
 */
export const winterUi = () => import('./WinterBody');
const WinterBody = lazy(() => winterUi().then((m) => ({ default: m.WinterBody })));

export function WinterModal() {
  const s = useGame((g) => g.s);
  const offline = useGame((g) => g.offlineSeconds);
  const dismiss = useGame((g) => g.dismissWinterWarning);
  // Модалки делят один слой: наложенное поверх окна офлайна предупреждение
  // закрыло бы его. Флаг живёт в состоянии, поэтому просто ждём своей очереди.
  // События больше не окно — они ждут в почте державы и слоя не занимают.
  const open = s.winterWarning && !(offline >= 60 || s.paceNotice);
  // Закрытое окно ещё тает (`leave.tsx`): тело — своим компонентом, его зовут только открытым.
  return (
    <Leave open={open}>
      {open && (
        <Crash where="зима" onClose={dismiss}>
          <Suspense fallback={null}>
            <WinterBody />
          </Suspense>
        </Crash>
      )}
    </Leave>
  );
}
