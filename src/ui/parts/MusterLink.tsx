// Строка-вход в «Дружину» — в Статуе и в карточке своего замка (docs/retinue.md; UI-4, docs/ui_v2.md, 5.3), и строка «где
// полководец и его отряд» — одна на строку-вход и на окно состава дела (`Muster`). Раскладки в «Дружине» с ДР-6 нет: состав
// отряда выбирают в окне дела, и строка ведёт к войску, а не к передаче.
//
// Отдельным лёгким файлом нарочно: Статуя лежит в первой загрузке, а окно состава — в куске окна дела вместе с набором `kit`
// и подсказками верха; строка-вход, тянущая их за собой, вернула бы их в первую загрузку.
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { seated } from '@/game/sim/agents';
import { secondsLeft } from '@/world/geo';
import { inTown, postureOf } from '@/world/muster';
import { troopTotal } from '@/game/battle/kinds';
import type { FigureView } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { realSpanText } from './wait';

/**
 * Где полководец и его отряд — одной строкой: за разницу между «в городе» и «в поле» игрок платит обороной. В городе
 * полководец «защищает стены» всем гарнизоном (решение владельца 16.10.2026, docs/ui_v2.md, 6.10): своего отряда там у
 * него нет (ДР-6) — о нём строка и не говорит.
 */
export function postureLine(general: FigureView | undefined, now = worldNow()): string {
  if (!general) return 'Где полководец, пока неизвестно';
  if (general.gone) return 'Полководца нет';
  const n = troopTotal(general.troops);
  if (general.phase === 'down') return n > 0 ? 'Полководец вне строя' : 'Полководец вне строя, отряда нет';
  const left = secondsLeft(general.readyAt, now);
  const gathering = general.readyAt > 0 && left > 0 ? ` · сбор ещё ${realSpanText(left)}` : '';
  if (inTown(general)) return `В городе — защищает стены${gathering}`;
  if (postureOf(general) === 'gathering') return `Сбор ещё ${realSpanText(left)}, город не защищает`;
  return n > 0 ? 'В походе — город не защищает' : 'В походе, отряда нет';
}

/**
 * Строка-вход в Статуе и в карточке своего замка: где полководец и, если он в походе, сколько с ним бойцов; касание ведёт в
 * «Дружину». Своего окна у строки нет.
 */
export function MusterLink() {
  const s = useGame((g) => g.s);
  const sheet = useGame((g) => g.sheet);
  const mapOpen = useGame((g) => g.mapOpen);
  const closeMap = useGame((g) => g.closeMap);
  const openTab = useGame((g) => g.openTab);
  const general = useWorld((g) => g.figures.find((f) => f.id === 'general'));
  if (!seated(s, 'general')) return null;
  const n = troopTotal(general?.troops ?? {});
  const go = (): void => {
    // Шторки живут над городом: из карты «Дружина» открывается в городе, как и с нижнего места.
    if (mapOpen) closeMap();
    if (!(sheet?.kind === 'tab' && sheet.tab === 'army')) openTab('army');
  };
  return (
    <button className="card as-row" onClick={go} aria-label="В «Дружину»">
      <div className="ico">
        <Icon name="fig-general" />
      </div>
      <div className="body">
        <div className="title">
          Полководец и дружина
          {n > 0 && <span className="count">с ним {n}</span>}
        </div>
        <div className="desc">{postureLine(general)}</div>
      </div>
      <div className="chev">›</div>
    </button>
  );
}
