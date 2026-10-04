// Окно «Промыслы» нового интерфейса (docs/minigames.md, раздел 3): энергия в шапке, по строке на игру — что даст «до N»,
// цена в энергии и куда идти. Та же строка стоит в окне двора, которому игра соответствует (навес собирателей, загон):
// игра у своего двора.
//
// Своих чисел нет (правило 18): энергия, срок и «до N» — дверь `sim/minigames` (`energyShown`, `energyReadyIn`,
// `minigameHaul` при полном счёте), сроки — `realSpanText`. Энергия — сутками игрока (`ui/trades.energyNow`).
import { useEffect } from 'react';
import { useGame } from '@/game/store';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { ENERGY_MAX, MINIGAME_BY_ID, MINIGAME_COST, MINIGAMES, type MinigameId } from '@/game/data/minigames';
import { canPlay, energyFullIn, energyReadyIn, energyShown, minigameHaul } from '@/game/sim/minigames';
import { Icon } from '@/ui/icons/Icon';
import { realSpanText } from '@/ui/parts/wait';
import { energyNow, useTrades } from '@/ui/trades';
import { fmtInt } from './hudTips';

/** Строка игры: значок, имя, «до N» значками запасов, цена в энергии и кнопка — или почему нельзя. */
export function TradeLine({ id }: { id: MinigameId }) {
  const s = useGame((g) => g.s);
  const play = useTrades((t) => t.play);
  const now = energyNow();
  const def = MINIGAME_BY_ID[id];
  const top = minigameHaul(s, id, 1);
  const ready = canPlay(s, now);
  return (
    <div className="nx-trade">
      <span className="nx-bico">
        <Icon name={`mini-${id}`} glyph={def.glyph} />
      </span>
      <div className="nx-trade-body">
        <b>{def.name}</b>
        <span className="nx-trade-haul">
          до
          {RESOURCE_IDS.filter((r) => top[r]).map((r) => (
            <span key={r} className="nx-trade-res" aria-label={RESOURCE_META[r].name}>
              <Icon name={`res-${r}`} glyph={RESOURCE_META[r].icon} />
              {fmtInt(top[r] ?? 0)}
            </span>
          ))}
          <span className="nx-trade-res nx-trade-cost" aria-label="Энергия">
            <Icon name="ui-energy" glyph="✋" />
            {MINIGAME_COST}
          </span>
        </span>
        {!ready && <small className="nx-why">Хватит через {realSpanText(Math.ceil(energyReadyIn(s, now) / 1000))}</small>}
      </div>
      <button className="nx-go nx-trade-go" disabled={!ready} onClick={() => play(id)}>
        {def.go}
      </button>
    </div>
  );
}

/** Окно «Промыслы»: шапка с энергией и строки игр. Встаёт вместо шторки и державы (`ui/trades.show`). */
export function Trades() {
  const s = useGame((g) => g.s);
  const sheet = useGame((g) => g.sheet);
  const mapOpen = useGame((g) => g.mapOpen);
  const hide = useTrades((t) => t.hide);
  const now = energyNow();
  const energy = energyShown(s, now);
  const full = energyFullIn(s, now);

  // Открылась шторка постройки или карта — окно уступает: два окна разом не стоят.
  useEffect(() => {
    if (sheet !== null || mapOpen) hide();
  }, [sheet, mapOpen, hide]);

  return (
    <div className="panel nx-bpanel">
      <div className="nx-bhead">
        <span className="nx-bico">
          <Icon name="ui-energy" glyph="✋" />
        </span>
        <div className="nx-btitle">
          <b className="one-line">Промыслы</b>
          <span className="nx-blvl">
            Энергия {energy} из {ENERGY_MAX}
            <i className="nx-bbar">
              <i style={{ width: `${Math.round((energy / ENERGY_MAX) * 100)}%` }} />
            </i>
          </span>
        </div>
        <button className="nx-bclose" onClick={hide} aria-label="Закрыть">
          <Icon name="ui-close" glyph="✕" />
        </button>
      </div>
      {MINIGAMES.map((g) => (
        <TradeLine key={g.id} id={g.id} />
      ))}
      <small className="nx-gain">{full > 0 ? `Полная через ${realSpanText(Math.ceil(full / 1000))}` : 'Запас полон'}</small>
    </div>
  );
}
