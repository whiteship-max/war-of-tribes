// Ход осады фазами — одна плашка на окно лагеря и окно осады (docs/siege_v2.md, 9.1–9.2). Своих чисел у неё нет: журнал,
// поправки следующей фазы и проломы — из мира (`SiegeView.phases`, дверь `world/siegeroll`, правило 18). Прогноза исхода
// нет: поправки — описание состояния, как у EU4 (ответ владельца 2).
import type { SiegePhasesView } from '@/world/types';
import type { SiegeOrders } from '@/world/siegeroll';
import { BREACH_MAX } from '@/world/data/siegeroll';
import { realLeft } from './wait';

/** Сколько проломов можно назвать наказу штурма: 1..3. */
const STORM_AT = Array.from({ length: BREACH_MAX }, (_, i) => i + 1);

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
          <h3>Наказы на отлучку</h3>
          <p className="note">Срабатывают в минуту фазы, как кнопка, пока тебя нет.</p>
          <label className="note">
            <input
              type="checkbox"
              checked={Boolean(orders.volley)}
              disabled={busy}
              onChange={(e) => onOrders({ ...orders, volley: e.target.checked })}
            />{' '}
            Залп каждую фазу, пока энергии хватает и на штурм
          </label>
          <div className="fate-shares">
            <span className="note">Штурм при проломах:</span>
            <button className={`mini${orders.storm ? '' : ' on'}`} disabled={busy || !orders.storm} onClick={() => onOrders({ ...orders, storm: 0 })}>
              нет
            </button>
            {STORM_AT.map((n) => (
              <button
                key={n}
                className={`mini${orders.storm === n ? ' on' : ''}`}
                disabled={busy || orders.storm === n}
                onClick={() => onOrders({ ...orders, storm: n })}
              >
                {n}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
