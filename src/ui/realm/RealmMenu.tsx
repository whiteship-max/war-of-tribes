// Меню державы — полноэкранное, из девяти разделов, по устройству Europa
// Universalis IV, перерисованное под телефон (docs/realm.md). Открывается гербом
// слева сверху.
//
// Своего счёта здесь нет ни строки, и своих экранов тоже: каждый наполненный
// раздел — те же компоненты, что стоят у зданий и в справках строки состояния.
// Экран у решения один, входов к нему может быть несколько (CLAUDE.md,
// «Диегетический интерфейс»): налог в меню и налог в ратуше — один `Manage`,
// состав войска — один `ArmyPanel`, жалованье — один `Upkeep`.
//
// Правило, что куда: **то, что относится к державе целиком, — здесь; то, что
// игрок делает, стоя у здания, — у здания.** Заказать улучшение можно и отсюда,
// потому что строительство — список всей державы, и это тот же `TownBuild`, что
// в ратуше. А заказ найма остаётся у казарм и конюшни: здесь на них дверь.
//
// Меню едет своим куском (`lazy` в `App`): игрок, ни разу его не открывший, не
// платит за него ни байта на старте.
import { useEffect, useRef, useState } from 'react';
import { useGame } from '@/game/store';
import { buildingOfType, woundedStacks } from '@/game/derived';
import { troopTotal } from '@/game/battle/kinds';
import { profileCity, profileName } from '@/profile/identity';
import { Manage } from '../parts/TownHall';
import { TownBuild } from '../parts/TownBuild';
import { RealmFaith } from '../parts/Temple';
import { Upkeep } from '../parts/Barracks';
import { Bonded } from '../panels/PeoplePanel';
import { OrderPanel } from '../panels/OrderPanel';
import { ArmyPanel } from '../panels/ArmyPanel';
import { ProfilePanel } from '../panels/ProfilePanel';
import { CoatArt } from './Coat';
import { Mail } from './Mail';
import { RulerTab } from './Ruler';
import { TechTab } from './Tech';
import { useRealm, type RealmView } from './open';
import { mailKeys, unreadCount, useSeen } from './unread';
import { useWorld } from '@/world/store';
import { REALM_TABS, type RealmTab } from './tabs';

export function RealmMenu() {
  const view = useRealm((r) => r.view);
  const go = useRealm((r) => r.go);
  const hide = useRealm((r) => r.hide);
  const s = useGame((g) => g.s);
  const sheet = useGame((g) => g.sheet);
  const mapOpen = useGame((g) => g.mapOpen);
  const letters = useWorld((w) => w.letters);
  const seen = useSeen((u) => u.seen);
  // Тот же счётчик, что на гербе: сколько ждущего ответа ещё не открывали.
  const unread = unreadCount(
    mailKeys(
      s.inbox,
      letters.map((l) => l.id),
    ),
    seen,
  );
  const [top, setTop] = useState(0);
  const body = useRef<HTMLDivElement>(null);

  // Меню стоит под полоской ресурсов, а не поверх неё: полоску не закрывает ни
  // одно окно (CLAUDE.md, «Диегетический интерфейс»). Высота шапки у разных
  // экранов разная, поэтому край берётся у самой полоски, а не числом.
  useEffect(() => {
    const bar = document.querySelector('.res-bar');
    setTop(bar ? Math.ceil(bar.getBoundingClientRect().bottom) : 0);
  }, []);

  // Кнопка внутри раздела может вести в здание, справку или на карту — туда,
  // что живёт под меню. Ушёл туда — меню уступает место, а не закрывает собой
  // открытое. Первое значение пропускается: с ним меню и открыли.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (sheet !== null || mapOpen) hide();
  }, [sheet, mapOpen, hide]);

  // Новый раздел читается с начала, а не с того места, где листали прежний, а
  // его вкладка видна в ленте: девять вкладок на 375 px не помещаются.
  useEffect(() => {
    body.current?.scrollTo(0, 0);
    document.querySelector('.realm-tabs .active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [view]);

  return (
    <div className="realm" style={{ top }} role="dialog" aria-label="Держава">
      <div className="realm-head">
        <CoatArt size={40} />
        <div className="realm-title">
          <b className="one-line">{profileCity(s.profile)}</b>
          <i className="one-line">{profileName(s.profile)}</i>
        </div>
        <button
          className={`realm-gear${view === 'settings' ? ' active' : ''}`}
          onClick={() => go('settings')}
          aria-label="Профиль и настройки"
          title="Профиль и настройки: имя, город, лицо, музыка, где лежит прогресс"
        >
          ⚙️
        </button>
        <button className="realm-close" onClick={hide} aria-label="Закрыть">
          ✕
        </button>
      </div>
      <div className="tabs realm-tabs">
        {REALM_TABS.map((t) => (
          <button
            key={t.id}
            className={`${view === t.id ? 'active' : ''}${t.built ? '' : ' closed'}`}
            onClick={() => go(t.id)}
          >
            {t.icon} {t.name}
            {t.id === 'decisions' && unread > 0 && <span className="tab-count">{unread}</span>}
          </button>
        ))}
      </div>
      <div className="realm-body" ref={body}>
        <Section view={view} />
      </div>
    </div>
  );
}

function Section({ view }: { view: RealmView }) {
  if (view === 'settings') return <ProfilePanel />;
  switch (view) {
    case 'lineage':
      return <RulerTab />;
    case 'government':
      return <Government />;
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
    default:
      return <Closed tab={view} />;
  }
}

/** Закрытый раздел: без обещаний, сроков и выдуманных чисел — только правда. */
function Closed({ tab }: { tab: RealmTab }) {
  const def = REALM_TABS.find((t) => t.id === tab)!;
  return (
    <div className="panel realm-closed">
      <div className="big">{def.icon}</div>
      <h3>{def.name}</h3>
      <div className="note">Ещё не построено.</div>
    </div>
  );
}

/**
 * Правительство: указ, рацион, налог и казна (тот же `Manage`, что во вкладке
 * «Управление» ратуши), порядок с тревогой, ропотом, мятежом и стражей (та же
 * справка, что по ячейке порядка) и невольники (тот же раздел, что в «Племени»).
 */
function Government() {
  const s = useGame((g) => g.s);
  const hall = buildingOfType(s, 'town_hall');
  return (
    <>
      {hall && (
        <div className="panel">
          <Manage b={hall} />
        </div>
      )}
      <OrderPanel />
      <div className="panel">
        <Bonded />
      </div>
    </>
  );
}

/**
 * Армия: состав и где стоит (та же справка, что по ячейке дружины), жалованье
 * (тот же `Upkeep`, что в казармах), лазарет и двери к найму — нанимают у
 * казарм и конюшни, а не здесь. Ниже — место под формации.
 */
function Army() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const stable = buildingOfType(s, 'stable');
  const infirmary = buildingOfType(s, 'infirmary');
  const wounded = troopTotal(woundedStacks(s).lying);
  return (
    <>
      <ArmyPanel />
      <div className="panel">
        {stable && (
          <button className="btn ghost wide" onClick={() => openBuilding(stable.id)}>
            🐎 В конюшню — нанять конницу
          </button>
        )}
        <Upkeep />
        <h3>
          Лазарет <span className="muted">раненых {wounded}</span>
        </h3>
        {infirmary && (
          <button className="btn ghost wide" onClick={() => openBuilding(infirmary.id)}>
            🩹 В лазарет — места, сроки, кто встанет
          </button>
        )}
        {/* Место, а не механика: нынешний бой — таблица множителей, и любая
            формация в нём свелась бы к поиску максимума. Формации заработают
            с новым боем (docs/realm.md, раздел 2.8). */}
        <h3>Формации</h3>
        <div className="note realm-slot">Ещё не построено.</div>
      </div>
    </>
  );
}
