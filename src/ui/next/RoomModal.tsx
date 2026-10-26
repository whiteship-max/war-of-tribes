// Окно «Склад заполнен» (решение владельца, docs/audit/OWNER-DECISIONS.md, п. 1): по видам — сколько обещано и сколько
// ляжет, полосой и строкой, и вопрос «Продолжить?». «Да» делает дело, «Отмена» и касание мимо окна — нет, и ничего не
// потрачено. Вопрос ставит `ui/room` (`askRoom`, `actRoom`); числа — дверь склада (`sim/stockview`).
//
// Встаёт поверх всего, промысла тоже: его зовёт касание игрока, другие окна в эту минуту не открыты.
import './room.css';
import { RESOURCE_META } from '@/game/constants';
import { roomText } from '@/game/sim/stockview';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';
import { Bar, Btn } from '@/ui/kit';
import { Leave } from '@/ui/parts/leave';
import { useRoom } from '@/ui/room';

export function RoomModal() {
  const ask = useRoom((r) => r.ask);
  const no = (): void => ask?.answer(false);
  return (
    <Leave open={ask !== null}>
      {ask && (
        <div className="modal-backdrop room-back" onClick={no}>
          <div className="modal room" role="alertdialog" aria-labelledby="room-title" aria-describedby="room-text" onClick={(e) => e.stopPropagation()}>
            <div className="m-ico">
              <Icon name="bld-storage" />
            </div>
            <h2 id="room-title">Склад заполнен</h2>
            <ul className="room-rows">
              {ask.over.map((o) => (
                <li key={o.resource}>
                  <Icon name={iconName('res', o.resource)} />
                  <Bar value={o.fits} max={o.wanted} label={RESOURCE_META[o.resource].name} text={`${o.fits} из ${o.wanted}`} paint={LOST} />
                </li>
              ))}
            </ul>
            <p id="room-text">{cap(roomText(ask.over))}</p>
            <div className="room-act">
              <Btn kind="main" onClick={() => ask.answer(true)}>
                Да
              </Btn>
              <Btn onClick={no}>Отмена</Btn>
            </div>
          </div>
        </div>
      )}
    </Leave>
  );
}

const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** Полоса вида: что ляжет — золотом набора, что пропадёт — красным остатком дорожки. */
const LOST = { fill: 'var(--m-fill)', rest: 'var(--m-fill-bad)' };
