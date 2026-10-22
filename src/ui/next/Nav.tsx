import { useGame } from '@/game/store';
import { buildingAttention, idleCount, isSite } from '@/game/derived';
import { useWorld } from '@/world/store';
import { Icon } from '@/ui/icons/Icon';
import { mailKeys, unreadCount, useSeen, rivalKeys } from '@/ui/realm/unread';
import { useRealm } from '@/ui/realm/open';
import { useAlertItems } from '@/ui/alertItems';
import { useChambers } from '@/ui/chambers/open';

/**
 * Низ нового интерфейса (docs/ui_audit.md, 6.0): пять мест — Здания · Жители · Карта · Дружина · Вести; карта
 * в середине, под большим пальцем. «Задания» переехали в державу (герб), счётчик «три невыполненных», висевший
 * всю партию, ушёл вместе с ними (3.9: счётчик — только про то, что ждёт действия). «Здания» (РТ-1) встали на место
 * «Ратуши»: сетка всех построек, улучшения и очередь стройки — здесь, а ратуша — своё здание со своими разделами (совет).
 *
 * Шаги обучения лежат в данных игры и ищут кнопку по метке (`nav-buildings`, `nav-people`, `nav-map`), а не по виду.
 *
 * Мёртвой полосы над низом нет: в новом виде холст для браузера «нажимаемый» (`GameCanvas`, слушатель
 * `click`), и касание у кромки низа достаётся тому, на ком лежит палец, — городу или кнопке, — а не ближайшей
 * кнопке, как прежде (docs/city.md, 12.4).
 */
/** В покоях правителя (docs/city_v3.md, Г-4) низа города нет: у покоев свой слой (`ui/chambers`). */
export function Nav() {
  const inside = useChambers((c) => c.open);
  return inside ? null : <CityNav />;
}

function CityNav() {
  const s = useGame((g) => g.s);
  const sheet = useGame((g) => g.sheet);
  const mapOpen = useGame((g) => g.mapOpen);
  const openTab = useGame((g) => g.openTab);
  const openMap = useGame((g) => g.openMap);
  const closeMap = useGame((g) => g.closeMap);
  const realm = useRealm((r) => r.open);
  const view = useRealm((r) => r.view);
  const show = useRealm((r) => r.show);
  const hide = useRealm((r) => r.hide);
  const letters = useWorld((w) => w.letters);
  const rivals = useWorld((w) => w.rivals);
  const seen = useSeen((u) => u.seen);
  const alerts = useAlertItems();
  const unread = unreadCount(
    mailKeys(
      s.inbox,
      letters.map((l) => l.id),
      rivalKeys(rivals, true),
    ),
    seen,
  );
  // Счётчик вестей красный, когда среди тревог идёт беда по сроку: набег или мятеж ждут ответа в вестях.
  const urgent = alerts.some((a) => a.raid);
  const idle = idleCount(s);
  const building = s.buildings.some(isSite);
  const empty = s.buildings.filter((b) => buildingAttention(s, b) === 'idle').length;
  const tab = sheet?.kind === 'tab' ? sheet.tab : null;
  const mailOpen = realm && view === 'decisions';
  // Из карты нижние места ведут в город: шторки и держава живут над городом.
  const home = (then: () => void) => () => {
    if (mapOpen) closeMap();
    then();
  };

  return (
    <nav className="nx-nav">
      <button data-tut="nav-buildings" className={tab === 'buildings' ? 'on' : ''} onClick={home(() => openTab('buildings'))}>
        <span className="nx-ib">
          <Icon name="nav-buildings" />
          {empty > 0 && <em className="nx-badge">{empty}</em>}
        </span>
        Здания
      </button>
      <button data-tut="nav-people" className={tab === 'people' ? 'on' : ''} onClick={home(() => openTab('people'))}>
        <span className="nx-ib">
          <Icon name="nav-people" />
          {idle > 0 && !building && <em className="nx-badge">{idle > 9 ? '9+' : idle}</em>}
        </span>
        Жители
      </button>
      <button
        data-tut="nav-map"
        className={`nx-main${mapOpen ? ' on' : ''}`}
        onClick={mapOpen ? closeMap : openMap}
        aria-label={mapOpen ? 'Город' : 'Карта'}
      >
        <span className="nx-ib">
          {mapOpen ? <Icon name="ui-home" /> : <Icon name="hud-map" />}
        </span>
        {mapOpen ? 'Город' : 'Карта'}
      </button>
      <button data-tut="nav-army" className={tab === 'army' ? 'on' : ''} onClick={home(() => openTab('army'))}>
        <span className="nx-ib">
          <Icon name="hud-army" />
        </span>
        Дружина
      </button>
      <button data-tut="nav-mail" className={mailOpen ? 'on' : ''} onClick={home(() => (mailOpen ? hide() : show('decisions')))}>
        <span className="nx-ib">
          <Icon name="ui-mail" />
          {unread > 0 && <em className={`nx-badge${urgent ? ' urgent' : ''}`}>{unread > 9 ? '9+' : unread}</em>}
        </span>
        Вести
      </button>
    </nav>
  );
}
