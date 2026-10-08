// Лазутчик против города живого игрока — блок карточки чужого города (docs/spy_pvp.md).
//
// Исход здесь не считается и не предсказывается: шанс и гибель посчитал сервер (меню приходит с него, чужого слепка у
// клиента нет), он же посчитает дело в минуту прихода. Карточка говорит, что с нашим лазутчиком у этого города, что он
// разведал, и по нажатию показывает дела с двумя числами — удастся и гибель — и ценой в энергии. Недоступное показано и
// объяснено, а не спрятано (правило меню приказов).
import { useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { perilText } from '@/world/peril';
import { RIVAL_DEED_BY_ID } from '@/world/data/spy';
import type { RivalDeedId, RivalMenu, SettlementCard } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { realLeft, realSpanText } from '@/ui/parts/wait';
import { EnergyPrice } from '@/ui/parts/Energy';

const left = (at: number, now: number): string => realLeft(Math.max(0, (at - now) / 1000));

export function SpyRival({ card }: { card: SettlementCard }) {
  const spyMenu = useWorld((g) => g.spyMenu);
  const spyRival = useWorld((g) => g.spyRival);
  const showToast = useGame((g) => g.showToast);
  const [menu, setMenu] = useState<RivalMenu | null>(null);
  const [busy, setBusy] = useState(false);
  const spy = card.spy;
  if (!spy) return null;
  const now = worldNow();

  const look = async (): Promise<void> => {
    setBusy(true);
    setMenu(await spyMenu(card.id));
    setBusy(false);
  };
  const go = async (deed: RivalDeedId): Promise<void> => {
    if (!menu) return;
    setBusy(true);
    const err = await spyRival(card.id, deed, menu.at);
    setBusy(false);
    setMenu(null);
    showToast(err ?? `Лазутчик ушёл к ${card.name}: ${RIVAL_DEED_BY_ID[deed].name.toLowerCase()}. В пути ${realLeft(spy.walkMs / 1000)}.`);
  };

  const ours = spy.ours;
  return (
    <div className="nx-war">
      <h3>Лазутчик</h3>
      {spy.intel && (
        <p className="nx-tnote">
          Разведано {left(now, spy.intel.at)} назад: дома {spy.intel.home} бойцов, всего войска {spy.intel.army}, ополчения{' '}
          {spy.intel.militia} (стрелков {spy.intel.archers}), жителей {spy.intel.pop}.
        </p>
      )}
      {ours ? (
        <p className="nx-tnote">
          {ours.phase === 'go'
            ? `Лазутчик идёт сюда: ${RIVAL_DEED_BY_ID[ours.deed].name.toLowerCase()}. Дойдёт через ${left(ours.arriveAt, now)}; дело посчитается в минуту прихода, даже если ты не в игре.`
            : ours.phase === 'held'
              ? `Лазутчика схватили и держат. Отпустят через ${left(ours.releaseAt ?? now, now)}.`
              : `Лазутчик идёт домой. Дома через ${left(ours.backAt ?? now, now)}.`}
        </p>
      ) : spy.reason ? (
        <p className="nx-tnote bad">{spy.reason}</p>
      ) : !menu ? (
        <>
          <p className="nx-tnote">Дорога — {realLeft(spy.walkMs / 1000)}. Шанс и гибель посчитает сервер: он знает стражу и Дозор этого города.</p>
          <button className="nx-cact" disabled={busy} onClick={() => void look()}>
            <Icon name="spy-probe" glyph="🕵️" />
            Тайные дела
          </button>
        </>
      ) : menu.error ? (
        <p className="nx-tnote bad">{menu.error}</p>
      ) : (
        <>
          {menu.options.map((o) => (
            <div key={o.deed} className="nx-spyrow">
              <button className="nx-cact" disabled={busy || !o.can} onClick={() => void go(o.deed)} title={o.description}>
                <Icon name={`spy-${o.deed}`} glyph={o.icon} />
                {o.name}
                <EnergyPrice price={o.energy.price} />
              </button>
              <p className="nx-tnote">
                <span className="good">удастся {Math.round(o.chance * 100)}%</span> · <span className="bad">гибель {perilText(o.peril)}</span> ·{' '}
                <span className="bad">при провале схватят на {realSpanText(o.held)}</span>
                {o.why.length > 0 ? ` · ${o.why.join(', ')}` : ''}
              </p>
              {o.reason && <p className="nx-tnote bad">{o.reason}</p>}
            </div>
          ))}
          <p className="nx-tnote">
            Поджог, кражу и смуту хозяин города увидит, но чей лазутчик — узнает, только если его схватят. Разведку не заметит.
          </p>
        </>
      )}
    </div>
  );
}
