// Шкала энергии агента: карточка агента и полководца, меню приказов (docs/agent_energy.md). Числа — от мира
// (`FigureView.energy`), слова — `energyWords`; значок — ладонь, как у энергии промыслов: один смысл — один значок.
import type { EnergyView } from '@/world/energy';
import { worldNow } from '@/world/store';
import { Icon } from '@/ui/icons/Icon';
import { tipAt } from '@/ui/next/tip';
import { ENERGY_TIP, energyCount, energyLine } from './energyWords';

/** Мало — пятая часть запаса и меньше: столько стоит один бой. */
const LOW = 0.2;

export function EnergyBar({ energy, spent }: { energy: EnergyView; spent: boolean }) {
  const share = Math.max(0, Math.min(1, energy.value / energy.max));
  return (
    <button className="nx-energy" onClick={(e) => tipAt(e.currentTarget, { title: 'Энергия', body: ENERGY_TIP })}>
      <span className="nx-energy-top">
        <Icon name="ui-energy" />
        <b>Энергия {energyCount(energy)}</b>
      </span>
      <span className={`progress${share <= LOW || spent ? ' low' : ' good'}`}>
        <span style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      <small className={spent ? 'bad' : ''}>{energyLine(energy, spent, worldNow())}</small>
    </button>
  );
}

/** Цена дела фишкой строки приказа: ладонь, число и слово — «✋ 20» без подписи не читалось ценой (Ч15, UI-7). */
export function EnergyPrice({ price }: { price: number }) {
  return (
    <span className="nx-eprice">
      <Icon name="ui-energy" /> {price} <small>энергии</small>
    </span>
  );
}
