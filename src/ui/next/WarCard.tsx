// Поход на город живого игрока — блок карточки чужого города (docs/pvp.md).
//
// Бой здесь не считается и не предсказывается: его считает сервер в минуту прихода, тем же ядром, что бой
// с логовом. Карточка говорит три вещи — можно ли выступить и почему нет, сколько идти, что с войной сейчас
// — и отдаёт приказ. Недоступное показано и объяснено, а не спрятано (правило меню приказов).
import { useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { FATE_DEFAULT } from '@/world/spoils';
import type { Fate, SettlementCard } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { FatePick } from '@/ui/parts/FatePick';
import { count } from '@/ui/parts/plural';
import { realLeft } from '@/ui/parts/wait';
import { hungerLeft } from '@/ui/parts/hunger';
import { EnergyPrice } from '@/ui/parts/Energy';

const left = (at: number, now: number): string => realLeft(Math.max(0, (at - now) / 1000));

export function WarCard({ card }: { card: SettlementCard }) {
  const warMarch = useWorld((g) => g.warMarch);
  const assault = useWorld((g) => g.assault);
  const recallFigure = useWorld((g) => g.recallFigure);
  const showToast = useGame((g) => g.showToast);
  const openCamp = useGame((g) => g.openCamp);
  const openSiege = useGame((g) => g.openSiege);
  const [fate, setFate] = useState<Fate>(FATE_DEFAULT);
  const [busy, setBusy] = useState(false);
  const war = card.war;
  if (!war) return null;
  const now = worldNow();

  // Штурм с ходу — тот же приказ «Дойти и ударить», что у логова (`assault`); осада — поход лагерем.
  const go = async (mode: 'storm' | 'siege'): Promise<void> => {
    setBusy(true);
    const err = mode === 'storm' ? await assault(card.id, fate) : await warMarch(card.id, mode, fate);
    setBusy(false);
    showToast(err ?? `Отряд вышел на ${card.name}. В пути ${realLeft(war.walkMs / 1000)}.`);
  };
  const recall = async (): Promise<void> => {
    setBusy(true);
    const err = await recallFigure('general');
    setBusy(false);
    showToast(err ?? 'Отряд поворачивает домой.');
  };

  return (
    <div className="nx-war">
      <h3>Война</h3>
      {war.theirs && (
        <>
          <p className="nx-tnote bad">
            {war.theirs.phase === 'march'
              ? `Их отряд идёт на наш город. У стен будет через ${left(war.theirs.arriveAt, now)}.`
              : 'Их лагерь стоит под нашими стенами.'}
          </p>
          {war.theirs.phase === 'camp' && (
            <button className="nx-cact" onClick={openSiege}>
              <Icon name="ui-target" glyph="⛺" />
              Открыть осаду
            </button>
          )}
        </>
      )}

      {war.ours ? (
        <>
          {war.ours.phase === 'march' && (
            <>
              <p className="nx-tnote">
                Наш отряд идёт {war.ours.mode === 'storm' ? 'на штурм с ходу' : 'в осаду'}. У стен через {left(war.ours.arriveAt, now)}. Бой
                будет в минуту прихода, даже если ты не в игре.
              </p>
              <button className="nx-cact" disabled={busy} onClick={() => void recall()}>
                <Icon name="ui-time" glyph="↩️" />
                Отозвать поход
              </button>
            </>
          )}
          {war.ours.phase === 'camp' && (
            <>
              <p className="nx-tnote">
                Наш лагерь стоит под стенами.
                {war.ours.starvesAt !== undefined ? ` Хлеба в городе на ${hungerLeft(war.ours.starvesAt, now)}.` : ''}
              </p>
              <button className="nx-cact" onClick={openCamp}>
                <Icon name="ui-target" glyph="⛺" />
                Открыть лагерь
              </button>
            </>
          )}
          {war.ours.phase === 'back' && (
            <p className="nx-tnote">Отряд возвращается. Дома через {left(war.ours.backAt ?? now, now)}.</p>
          )}
        </>
      ) : (
        <>
          <p className="nx-tnote">
            Полководец ведёт {count(war.men, 'бойца', 'бойцов', 'бойцов')} из своего города, в пути {realLeft(war.walkMs / 1000)}. Бой
            будет в минуту прихода. Хозяин города увидит отряд сразу.
          </p>
          {!war.can && war.reason && <p className="nx-tnote bad">{war.reason}</p>}
          {/* Штурм дороже осады: открыт поход вообще, а на штурм энергии не хватает — причина своей строкой. */}
          {war.can && war.energy?.storm.block && <p className="nx-tnote bad">Штурм: {war.energy.storm.block}</p>}
          <FatePick options={card.fates} value={fate} onChange={setFate} />
          <div className="nx-cacts">
            <button className="nx-go nx-cgo" disabled={busy || !war.can || Boolean(war.energy?.storm.block)} onClick={() => void go('storm')}>
              Дойти и ударить · {count(war.men, 'боец', 'бойца', 'бойцов')}
              {war.energy && <EnergyPrice price={war.energy.storm.price} />}
            </button>
            <button className="nx-cact" disabled={busy || !war.can} onClick={() => void go('siege')}>
              <Icon name="ui-target" glyph="⛺" />
              Осадить
              {war.energy && <EnergyPrice price={war.energy.siege.price} />}
            </button>
          </div>
          {/* Хватит ли после осады на штурм из лагеря — до выхода: в лагере энергия не копится (siege_audit, 9). */}
          {war.can && war.campStorm && <p className="nx-tnote">{war.campStorm}</p>}
          <p className="nx-tnote">Штурм с ходу решается одним боем у стены в минуту прихода. Осада ставит лагерь под стенами, и город голодает, пока не сдастся или не разобьёт лагерь.</p>
          <p className="nx-tnote">Полководец тратит энергию в дороге, по дням пути. У стен она не уходит, дома копится снова.</p>
        </>
      )}
    </div>
  );
}
