// Переговоры у стен — блок окна лагеря и окна осады (docs/siege_v2.md, раздел 7; этап 2е). Осаждающий предлагает сдачу на
// условиях и отвечает на дань, осаждённый — наоборот. Своей арифметики у блока нет: доля пути, цена дани и условия на выбор
// — из мира (`ParleyView`, дверь `world/parley`), сроки — словами `ui/parts/wait`. Прогноза исхода нет: доля пути — уже
// случившееся, а не обещание.
import { useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld } from '@/world/store';
import { FATE_META } from '@/world/data/fates';
import { secondsLeft } from '@/world/geo';
import { cleanDefend, cleanOrders, type DefendOrders, type SiegeOrders } from '@/world/siegeroll';
import type { Fate, ParleyView } from '@/world/types';
import { termsChoices } from '@/world/parley';
import { realLeft } from '@/ui/parts/wait';

const fateName = (f: Fate): string => `«${FATE_META[f].name.toLowerCase()}»`;

/** Своё предложение словами: что предложено и чем кончилось. */
function mineLine(m: NonNullable<ParleyView['mine']>, now: number): string {
  const what = m.kind === 'terms' ? `сдача на условиях, участь ${fateName(m.fate ?? 'plunder')}` : `дань ${m.price ?? 0}`;
  if (m.answer === 'no') return `Наше предложение — ${what} — отклонено.`;
  if (m.answer === 'yes') return `Наше предложение — ${what} — принято.`;
  if (now >= m.until) return `Наше предложение — ${what} — осталось без ответа.`;
  return `Наше предложение — ${what} — ждёт ответа ещё ${realLeft(secondsLeft(m.until, now))}.`;
}

export interface SiegeParleyProps {
  view: ParleyView;
  /** Объявленная участь. */
  fate: Fate;
  now: number;
  /** Наказы осаждающего (принимать дань) — у окна лагеря. */
  orders?: SiegeOrders;
  /** Наказы осаждённого (принимать условия) — у окна осады. */
  defend?: DefendOrders;
  busy?: boolean;
}

export function SiegeParley(props: SiegeParleyProps) {
  const { view, fate, now } = props;
  const showToast = useGame((g) => g.showToast);
  const parley = useWorld((g) => g.parley);
  const setOrders = useWorld((g) => g.setOrders);
  const defend = useWorld((g) => g.defend);
  const [mine, setMine] = useState(false);
  const busy = mine || Boolean(props.busy);
  const run = async (fn: () => Promise<string | null>, done: string): Promise<void> => {
    setMine(true);
    const err = await fn();
    setMine(false);
    showToast(err ?? done);
  };
  const atk = view.side === 'atk';
  const share = Math.round(view.share * 100);
  const inc = view.incoming;

  return (
    <>
      <h3>Переговоры</h3>
      <p className="note">
        Осада прошла {share} % пути. Чем дальше, тем дороже дань: цена — доля от того, что отнимет падение.
      </p>

      {inc && (
        <div className="card">
          <div className="ico">{inc.kind === 'terms' ? '🏳️' : '💰'}</div>
          <div className="body">
            <div className="title">{inc.kind === 'terms' ? 'Предлагают сдачу на условиях' : view.bot ? 'Предлагают выкуп' : 'Предлагают дань'}</div>
            <div className="desc">
              {inc.kind === 'terms'
                ? `Откроешь ворота — участь ${fateName(inc.fate ?? fate)} вместо ${fateName(fate)}, гарнизон уйдёт живым.`
                : `Дань ${inc.price ?? 0} — припасы и золото с их склада. Возьмёшь — лагерь снимется, осада кончена.`}{' '}
              {view.bot ? '' : `Ответить можно ещё ${realLeft(secondsLeft(inc.until, now))}.`}
            </div>
            <div className="cost">
              <button
                className="btn"
                disabled={busy}
                onClick={() => void run(() => parley({ act: 'answer', kind: inc.kind, yes: true }), inc.kind === 'terms' ? 'Ворота открыты.' : 'Дань взята.')}
              >
                {inc.kind === 'terms' ? 'Открыть ворота' : 'Взять'}
              </button>
              {!view.bot && (
                <button className="btn" disabled={busy} onClick={() => void run(() => parley({ act: 'answer', kind: inc.kind, yes: false }), 'Отказано.')}>
                  Отказать
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {atk ? (
        <>
          {(view.terms ?? []).map((f) => (
            <button
              key={f}
              className="btn wide"
              disabled={busy || view.block !== null}
              onClick={() => void run(() => parley({ act: 'offer', kind: 'terms', fate: f }), view.bot ? 'Ворота открыты.' : 'Условия отправлены.')}
            >
              Предложить сдачу: {fateName(f)} вместо {fateName(fate)}
            </button>
          ))}
          <p className="note">
            {view.block ?? 'Гарнизон уйдёт живым, город — нашим на этих условиях. Предложение стоит до конца следующей фазы, одно за фазу.'}
          </p>
          {(
            <label className="note">
              <input
                type="checkbox"
                checked={Boolean(props.orders?.tribute)}
                disabled={busy}
                onChange={(e) =>
                  void run(() => setOrders(cleanOrders({ ...(props.orders ?? {}), tribute: e.target.checked }) ?? {}), 'Наказы поставлены.')
                }
              />{' '}
              Брать дань, как только предложат: её цена — справедливая на минуту предложения
            </label>
          )}
        </>
      ) : (
        <>
          <button
            className="btn wide"
            disabled={busy || view.block !== null}
            onClick={() => void run(() => parley({ act: 'offer', kind: 'tribute' }), view.bot ? 'Дань отдана. Лагерь уходит.' : 'Дань предложена.')}
          >
            {view.bot ? 'Откупиться' : 'Предложить дань'} · {view.fair ?? 0}
          </button>
          <p className="note">
            {view.block ??
              `Припасы и золото с открытого склада, поровну тому, что лежит. Что в тайнике, останется. Возьмут — лагерь уйдёт, и город на время под защитой от осады.${view.bot ? ' Лагерь логова берёт дань по этой цене сразу.' : ''}`}
          </p>
          {!view.bot && (
            <div className="note">
              Наказ: открыть ворота на условиях не хуже{' '}
              <select
                value={props.defend?.terms ?? ''}
                disabled={busy}
                onChange={(e) =>
                  void run(
                    () => defend({ act: 'orders', defend: cleanDefend({ ...(props.defend ?? {}), terms: (e.target.value || undefined) as Fate | undefined }) ?? {} }),
                    'Наказы поставлены.',
                  )
                }
              >
                <option value="">— не открывать —</option>
                {termsChoices('burn').map((f) => (
                  <option key={f} value={f}>
                    {FATE_META[f].name.toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      {view.mine && <p className="note">{mineLine(view.mine, now)}</p>}
    </>
  );
}
