import { useGame } from '@/game/store';
import { buildingAttention, buildingOfType, idleCount, isSite } from '@/game/derived';
import { useWorld } from '@/world/store';
import { Icon } from '@/ui/icons/Icon';
import { mailKeys, unreadCount, useSeen } from '@/ui/realm/unread';
import { useRealm } from '@/ui/realm/open';
import { useAlertItems } from '@/ui/alertItems';

/**
 * Низ нового интерфейса (docs/ui_audit.md, 6.0): пять мест — Ратуша · Племя · Карта · Дружина · Вести; карта
 * в середине, под большим пальцем. «Задания» переехали в державу (герб), счётчик «три невыполненных», висевший
 * всю партию, ушёл вместе с ними (3.9: счётчик — только про то, что ждёт действия).
 *
 * Метки обучения те же, что у прежнего низа и шапки (`nav-townhall`, `nav-people`, `nav-map`): шаги обучения
 * лежат в данных игры и ищут кнопку по метке, а не по виду.
 *
 * Мёртвой полосы над низом нет: в новом виде холст для браузера «нажимаемый» (`GameCanvas`, слушатель
 * `click`), и касание у кромки низа достаётся тому, на ком лежит палец, — городу или кнопке, — а не ближайшей
 * кнопке, как прежде (docs/city.md, 12.4).
 */
export function Nav() {
  const s = useGame((g) => g.s);
  const sheet = useGame((g) => g.sheet);
  const mapOpen = useGame((g) => g.mapOpen);
  const openTab = useGame((g) => g.openTab);
  const openTownHall = useGame((g) => g.openTownHall);
  const openMap = useGame((g) => g.openMap);
  const closeMap = useGame((g) => g.closeMap);
  const realm = useRealm((r) => r.open);
  const view = useRealm((r) => r.view);
  const show = useRealm((r) => r.show);
  const hide = useRealm((r) => r.hide);
  const letters = useWorld((w) => w.letters);
  const seen = useSeen((u) => u.seen);
  const alerts = useAlertItems();
  const unread = unreadCount(
    mailKeys(
      s.inbox,
      letters.map((l) => l.id),
    ),
    seen,
  );
  // Счётчик вестей красный, когда среди тревог идёт беда по сроку: набег или мятеж ждут ответа в вестях.
  const urgent = alerts.some((a) => a.raid);
  const idle = idleCount(s);
  const building = s.buildings.some(isSite);
  const empty = s.buildings.filter((b) => buildingAttention(s, b) === 'idle').length;
  const tab = sheet?.kind === 'tab' ? sheet.tab : null;
  const hall = buildingOfType(s, 'town_hall');
  const hallOpen = sheet?.kind === 'building' && hall !== null && sheet.id === hall.id;
  const mailOpen = realm && view === 'decisions';
  // Из карты нижние места ведут в город: шторки и держава живут над городом.
  const home = (then: () => void) => () => {
    if (mapOpen) closeMap();
    then();
  };

  return (
    <nav className="nx-nav">
      <button data-tut="nav-townhall" className={hallOpen ? 'on' : ''} onClick={home(openTownHall)}>
        <span className="nx-ib">
          <Icon name="bld-town_hall" glyph="🏛️" />
          {empty > 0 && <em className="nx-badge">{empty}</em>}
        </span>
        Ратуша
      </button>
      <button data-tut="nav-people" className={tab === 'people' ? 'on' : ''} onClick={home(() => openTab('people'))}>
        <span className="nx-ib">
          <Icon name="nav-people" glyph="👥" />
          {idle > 0 && !building && <em className="nx-badge">{idle > 99 ? '99+' : idle}</em>}
        </span>
        Племя
      </button>
      <button
        data-tut="nav-map"
        className={`nx-main${mapOpen ? ' on' : ''}`}
        onClick={mapOpen ? closeMap : openMap}
        aria-label={mapOpen ? 'Город' : 'Карта'}
      >
        <span className="nx-ib">
          {mapOpen ? <Icon name="ui-home" glyph="🏠" /> : <Icon name="hud-map" glyph="🗺️" />}
        </span>
        {mapOpen ? 'Город' : 'Карта'}
      </button>
      <button className={tab === 'army' ? 'on' : ''} onClick={home(() => openTab('army'))}>
        <span className="nx-ib">
          <Icon name="hud-army" glyph="⚔️" />
        </span>
        Дружина
      </button>
      <button className={mailOpen ? 'on' : ''} onClick={home(() => (mailOpen ? hide() : show('decisions')))}>
        <span className="nx-ib">
          <Icon name="ui-mail" glyph="✉️" />
          {unread > 0 && <em className={`nx-badge${urgent ? ' urgent' : ''}`}>{unread > 9 ? '9+' : unread}</em>}
        </span>
        Вести
      </button>
    </nav>
  );
}
