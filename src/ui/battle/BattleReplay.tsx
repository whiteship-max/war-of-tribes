// Ролик о бое поверх сцены — дверь ленивого куска (`vite.config.ts`, `LAZY_DOORS`, «ролик о бое»): отчёт открывает его
// через `import()`, и в первую загрузку он не едет. Ролик один — в стиле Total War (`TwReplay`, docs/battle_tw.md);
// прежний удалён вместе со своим проигрывателем и строкой «Ролик боя» в настройках (docs/ui_audit.md, 16): старый адрес
// `?battle=old` и выбор, записанный на устройстве, больше никто не читает.
import type { BattleRecord, Report } from '@/world/types';
import { TwReplay } from './TwReplay';

export function BattleReplay({ rec, report, onDone }: { rec: BattleRecord; report?: Report; onDone: () => void }) {
  return <TwReplay rec={rec} report={report} onDone={onDone} />;
}
