// Меню державы — полноэкранное, из девяти разделов, по устройству Europa
// Universalis IV, перерисованное под телефон (docs/realm.md). Открывается гербом
// слева сверху.
//
// Своего счёта здесь нет ни строки, и своих экранов тоже: каждый наполненный
// раздел — те же компоненты, что стоят у зданий и в справках строки состояния.
// Экран у решения один, входов к нему может быть несколько (docs/handbook/ui.md,
// «Диегетический интерфейс»): указы — одни на игру (`RealmTabs.DecreesNew`; вкладка ратуши, их вторая копия, снята
// в UI-7), состав войска, жалованье, дух и роспуск — один `ArmyPanel` (ДР-1).
//
// Правило, что куда: **то, что относится к державе целиком, — здесь; то, что
// игрок делает, стоя у здания, — у здания.** Заказать улучшение можно и отсюда,
// потому что строительство — список всей державы, и это тот же `TownBuild`, что
// в ратуше. А заказ найма остаётся у казарм и конюшни: здесь на них дверь.
//
// Меню едет своим куском (`lazy` в `App`): игрок, ни разу его не открывший, не
// платит за него ни байта на старте.
import { useEffect, useRef } from 'react';
import { useGame } from '@/game/store';
import { buildingOfType, woundedStacks } from '@/game/derived';
import { troopTotal } from '@/game/battle/kinds';
import { TownBuild } from '../parts/TownBuild';
import { RealmFaith } from '../parts/Temple';
import { ArmyPanel } from '../panels/ArmyPanel';
import { ProfilePanel } from '../panels/ProfilePanel';
import { Mail } from './Mail';
import { RulerTab } from './Ruler';
import { TechTab } from './Tech';
import { StabilityTab } from './Stability';
import { useRealm, type RealmView } from './open';
import { REALM_TABS, type RealmTab } from './tabs';
import { QuestsPanel } from '../panels/QuestsPanel';
import { RealmNew } from './RealmNew';
import { DecreesNew } from './RealmTabs';
import { Icon } from '@/ui/icons/Icon';

/**
 * Летопись событиями — советнику покоев (Г-10, `ui/chambers/Chambers`): покои берут её ленивым импортом этого куска, а не
 * своим, — иначе она ушла бы в отдельный общий кусок, и карта зависимостей первой загрузки выросла бы на его строку.
 */
export { chronEvents } from './annals';

/** Меню державы (`RealmNew`); прежний вид удалён вместе с прежним интерфейсом (docs/ui_audit.md, 16). */
export function RealmMenu() {
  return <RealmNew />;
}

/**
 * Кнопка внутри раздела может вести в здание, справку или на карту — туда, что живёт под меню. Ушёл туда —
 * меню уступает место, а не закрывает собой открытое. Первое значение пропускается: с ним меню и открыли.
 */
export function useRealmYield(): void {
  const hide = useRealm((r) => r.hide);
  const sheet = useGame((g) => g.sheet);
  const mapOpen = useGame((g) => g.mapOpen);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (sheet !== null || mapOpen) hide();
  }, [sheet, mapOpen, hide]);
}

/** Раздел меню по виду — общий для всех входов (`RealmNew`). */
export function Section({ view }: { view: RealmView }) {
  if (view === 'settings') return <ProfilePanel />;
  if (view === 'quests') return <QuestsPanel />;
  switch (view) {
    case 'lineage':
      return <RulerTab />;
    case 'government':
      return <DecreesNew />;
    case 'building':
      return (
        <div className="panel">
          <TownBuild />
        </div>
      );
    case 'faith':
      return (
        <div className="panel">
          <RealmFaith />
        </div>
      );
    case 'army':
      return <Army />;
    case 'tech':
      return <TechTab />;
    case 'decisions':
      return <Mail />;
    case 'stability':
      return <StabilityTab />;
    default:
      return <Closed tab={view} />;
  }
}

/** Закрытый раздел: значок и имя, без текста — невыпущенное не обещает ни срока, ни чисел (docs/ui_audit.md, 4.1). */
function Closed({ tab }: { tab: RealmTab }) {
  const def = REALM_TABS.find((t) => t.id === tab)!;
  return (
    <div className="panel realm-closed">
      <div className="big"><Icon name={def.icon} /></div>
      <h3>{def.name}</h3>
    </div>
  );
}

/**
 * Армия: состав и где стоит (та же справка, что по ячейке дружины), жалованье
 * (тот же `Upkeep`, что в «Дружине»), лазарет и двери к найму — нанимают у
 * казарм и конюшни, а не здесь.
 */
function Army() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const infirmary = buildingOfType(s, 'infirmary');
  const wounded = troopTotal(woundedStacks(s).lying);
  return (
    <>
      {/* Жалованье, дух, роспуск и двери к найму — в самой «Дружине» (ДР-1). */}
      <ArmyPanel />
      <div className="panel">
        <h3>
          Лазарет <span className="muted">раненых {wounded}</span>
        </h3>
        {infirmary && (
          <button className="btn ghost wide" onClick={() => openBuilding(infirmary.id)}>
            В лазарет
          </button>
        )}
        {/* Формаций нет: нынешний бой — таблица множителей, и любая формация в нём свелась бы к поиску максимума.
            Раздел встанет здесь с новым боем (docs/realm.md, раздел 2.8); невыпущенное не показывается (docs/ui_audit.md, 4.1). */}
      </div>
    </>
  );
}
