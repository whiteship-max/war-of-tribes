// Ход осады фазами — одна плашка на окно лагеря и окно осады (docs/siege_v2.md, 9.1–9.2). Своих чисел у неё нет: журнал,
// поправки следующей фазы и проломы — из мира (`SiegeView.phases`, дверь `world/siegeroll`, правило 18). Прогноза исхода
// нет: поправки — описание состояния, как у EU4 (ответ владельца 2).
import type { SiegePhasesView } from '@/world/types';
import type { SiegeOrders } from '@/world/siegeroll';
import { BREACH_MAX } from '@/world/data/siegeroll';
import { realLeft } from './wait';
import { Toggle } from '@/ui/kit/Toggle';
import { Tabs, type TabDef } from '@/ui/kit/SheetPage';

/** Наказ штурма вкладками: «нет» и сколько проломов можно назвать — 1..`BREACH_MAX`. */
type StormTab = `${number}`;
const STORM_TABS: TabDef<StormTab>[] = [
  { id: '0', label: 'нет' },
  ...Array.from({ length: BREACH_MAX }, (_, i) => ({ id: String(i + 1) as StormTab, label: String(i + 1) })),
];

export function SiegePhases(props: {
  phases: SiegePhasesView;
  now: number;
  /** Наказы — только у того, кто стоит лагерем. Нет — плашка без наказов. */
  onOrders?: (orders: SiegeOrders) => void;
  busy?: boolean;
}) {
  const { phases, now, onOrders, busy } = props;
  const orders = phases.orders ?? {};
  const left = realLeft(Math.max(0, (phases.nextAt - now) / 1000));
  return (
    <>
      <h3>Ход осады</h3>
      <p className="note">
        Фаза {phases.nextK} — через {left}. Проломов {phases.breaches} из {BREACH_MAX}, ход осады {phases.progress}.
      </p>
      <p className="note">Поправки следующей фазы: {phases.next}.</p>
      {phases.journal.length > 0 && (
        <div className="siege-journal">
          {phases.journal.map((line) => (
            <p className="note" key={line}>
              {line}
            </p>
          ))}
        </div>
      )}
      {onOrders && (
        <>
          {/* Наказы на отлучку — переключателем и вкладками 44, а не флажком и кнопками `.mini` (К5, UI-7). */}
          <h3>Наказы на отлучку</h3>
          <Toggle
            label="Залп каждую фазу"
            sub="Пока энергии хватает и на штурм; срабатывает в минуту фазы"
            on={Boolean(orders.volley)}
            disabled={busy}
            onChange={(on) => onOrders({ ...orders, volley: on })}
          />
          <p className="note">Штурм при проломах — сам, в минуту фазы, когда их столько:</p>
          <Tabs
            tabs={STORM_TABS}
            value={String(orders.storm ?? 0) as StormTab}
            onChange={(id) => !busy && onOrders({ ...orders, storm: Number(id) })}
          />
        </>
      )}
    </>
  );
}
