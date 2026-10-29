// Окно хода отряда бродяги (ПН-3, docs/gdd/path_of_sword.md, 5.4 «Карта бродяги»): отряд в руке → касание клетки → это окно.
// Куда и что там, три режима марша строками (срок, энергия к приходу, хлеб к приходу — числами мира `WorldApi.roamPlan`, теми же
// функциями, что исполнят приказ), засада выбранного режима — «засада N % · если засада — бой с ~M» (ПН-5, те же числа заморозит
// приказ), точка в клетке цели и «Напасть» у логова и ватаги — бой в минуту прихода с силой по ступени престижа; «Отправить» липнет
// к низу. Выбора состава нет: весь отряд при герое. Срок, который видел игрок, уходит с приказом — сервер сверяет его со своим.
import { useState, type ReactNode } from 'react';
import { useGame } from '@/game/store';
import { worldApi } from '@/world/api';
import type { RoamLegView, RoamPlanView } from '@/world/types';
import { GAIT_META, type Gait } from '@/world/data/gait';
import { formatCoord } from '@/world/geo';
import { realSpan } from '@/game/span';
import { Icon } from '@/ui/icons/Icon';

/** Срок дороги словами — настоящим временем (ход — по часам мира). */
export const roadText = (l: RoamLegView): string =>
  `${realSpan(l.walkMs / 1000)}${l.halt > 0 ? `, сначала стоянка смены режима — ${realSpan(l.halt / 1000)} и ${l.price} энергии` : ''}`;

/** Режим по умолчанию: нынешний, если им идти можно, иначе первый доступный. */
export function firstGait(p: RoamPlanView): Gait {
  const now = p.legs.find((l) => l.gait === p.gait);
  if (now && !now.block) return now.gait;
  return p.legs.find((l) => !l.block)?.gait ?? p.gait;
}

export function RoamSend({ plan, onClose, onSent }: { plan: RoamPlanView; onClose: () => void; onSent: () => void }) {
  const showToast = useGame((g) => g.showToast);
  const [gait, setGait] = useState<Gait>(() => firstGait(plan));
  const [busy, setBusy] = useState(false);
  const leg = plan.legs.find((l) => l.gait === gait) ?? null;
  const block = plan.block ?? leg?.block ?? null;
  const aim = plan.aim;
  const go = async (strike: boolean): Promise<void> => {
    if (!leg || block) return;
    setBusy(true);
    const err = await worldApi().roamTo?.(plan.to, gait, leg.until, strike);
    setBusy(false);
    showToast(err ?? `${strike && aim ? `Отряд идёт на ${aim.name}` : 'Отряд выступил'} ${GAIT_META[gait].short}: дорога — ${realSpan(leg.walkMs / 1000)}.`);
    if (!err) onSent();
  };
  return (
    <div className="am-wrap" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel nx-bpanel nx-am">
        <div className="nx-bhead">
          <span className="nx-bico">
            <Icon name="ui-banner" />
          </span>
          <div className="nx-btitle">
            <b className="one-line">Отряд → {formatCoord(plan.to)}</b>
            <span className="nx-blvl">подтверждение хода</span>
          </div>
          <button className="nx-bclose" onClick={onClose} aria-label="Закрыть">
            <Icon name="ui-close" />
          </button>
        </div>
        <div className="nx-am-body er-confirm">
          <Line label="Куда" value={`${plan.where} · ${formatCoord(plan.to)}`} />
          {plan.block ? (
            <p className="nx-bwarn">{plan.block}</p>
          ) : (
            <div className="roam-legs" role="radiogroup" aria-label="Режим марша">
              {plan.legs.map((l) => (
                <button
                  key={l.gait}
                  className={`roam-leg${l.gait === gait ? ' on' : ''}`}
                  role="radio"
                  aria-checked={l.gait === gait}
                  disabled={l.block !== null}
                  onClick={() => setGait(l.gait)}
                >
                  <b>{GAIT_META[l.gait].name}</b>
                  <span>{roadText(l)}</span>
                  <small className="muted">
                    {l.block ?? `энергия к приходу ${Math.floor(Math.max(0, l.energy.left))} из ${Math.floor(l.energy.now)} · хлеб к приходу ${Math.floor(l.food.at)} из ${Math.floor(l.food.now)}`}
                  </small>
                </button>
              ))}
            </div>
          )}
          {leg && !plan.block && <Line label="Засада" value={leg.ambush.words} />}
          {aim && (
            <>
              <Line label="Цель" value={aim.words} />
              {aim.strike && <Line label="Бой" value={aim.block ?? `с ~${aim.strike.men} в минуту прихода`} />}
            </>
          )}
        </div>
        <div className="nx-am-foot">
          <button className="nx-go nx-go-ghost" onClick={onClose}>
            Назад
          </button>
          {aim?.strike ? (
            <>
              <button className="nx-go nx-go-ghost" disabled={busy || block !== null} onClick={() => void go(false)}>
                Идти
              </button>
              <button className="nx-go" disabled={busy || block !== null || aim.block !== null} onClick={() => void go(true)}>
                Напасть
              </button>
            </>
          ) : (
            <button className="nx-go" disabled={busy || block !== null} onClick={() => void go(false)}>
              Отправить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="er-line">
      <span className="muted">{label}</span>
      <b>{value}</b>
    </div>
  );
}
