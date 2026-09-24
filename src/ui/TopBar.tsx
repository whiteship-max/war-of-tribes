import { useGame } from '@/game/store';
import {
  armySize,
  bondedTotal,
  dayOf,
  dayFraction,
  housingCapacity,
  orderValue,
  seasonOf,
  seasonProgress,
  solarPhase,
} from '@/game/derived';
import { ORDER_WARN } from '@/game/constants';
import { ORDER_TEXT } from '@/game/data/order';
import { SEASON_META } from '@/game/data/seasons';
import { useWorld } from '@/world/store';
import { CoatButton } from './realm/Coat';
import { ResourceBar } from './ResourceBar';
import { Icon } from '@/ui/icons/Icon';
import { daypartOf, iconName, moodOf } from '@/ui/icons/registry';
import { CHEATS_ON } from '@/cheats';
import { SpeedButton } from './SpeedButton';


/**
 * Верхняя строка состояния. Списка построек здесь нет — он целиком уехал в
 * ратушу, на вкладку «Стройка».
 *
 * Порядок строк: **день и сезон сверху, полоска ресурсов под ними**. Ряд, где
 * стоит день, — это «когда я и что вокруг», и читается он первым; запасы — ответ
 * на «хватит ли», и спрашивают его вторым, уже приняв, что зима.
 *
 * Порядок при этом ничего не отнял у полоски ресурсов, и это главное, что здесь
 * можно сломать. Её нельзя закрывать окнами — решения, требующие отдать добро,
 * приходят модалками, из-под которых на склад не зайти, — и держится это правило
 * теперь **слоем, а не местом в столбце**: у `.res-bar` свой `z-index` выше
 * затемнения, а у остальных строк шапки — ниже. Раньше держалось наоборот, вырезом
 * в затемнении по верхней кромке экрана, и потому работало только пока полоска
 * стояла первой. Разбор — в комментариях `ResourceBar` и `styles.css`.
 *
 * Справа в строке дня — дружина: армия теперь центр игры, и её численность видна
 * всегда.
 *
 * Под строками — свой ряд на две кнопки: слева герб державы (вход в меню
 * управления, docs/realm.md; профиль с настройками — внутри меню, за
 * шестерёнкой), справа карта мира (**один значок, без слова**). Карта — не
 * раздел про посёлок, а выход наружу, к соседям, и обучение ведёт к ней
 * последним шагом. Герб стоит в этом же ряду, а не третьей строкой сверху: на
 * 390 px каждая лишняя полоса отъедает у сцены сорок пикселей, а левый край под
 * шапкой аппки всё равно пуст. Освободившееся от подписей место не занято
 * ничем — под ним сцена.
 */
export function TopBar() {
  const s = useGame((g) => g.s);
  const sheet = useGame((g) => g.sheet);
  const openTab = useGame((g) => g.openTab);
  const openMap = useGame((g) => g.openMap);
  const unread = useWorld((g) => g.unread);
  const marching = useWorld((g) => g.marches.length);
  const day = dayOf(s.time);
  const season = seasonOf(s.time);
  const meta = SEASON_META[season];
  // Время суток и ступень морали выбираются порогами, и пороги эти — общие
  // с «Племенем»: они лежат в накладной значков, а не переписаны здесь.
  const part = daypartOf(solarPhase(dayFraction(s.time), season));
  const mood = moodOf(Math.round(s.morale));
  const pop = s.pop;
  const housing = housingCapacity(s);
  const morale = Math.round(s.morale);
  const army = armySize(s);
  const tab = sheet?.kind === 'tab' ? sheet.tab : null;
  // Порядок стоит в строке только пока есть невольники: без них держать некого,
  // порядок всегда сто, и ячейка с вечной сотней отъедала бы место у дружины.
  const order = bondedTotal(s) > 0 ? Math.round(orderValue(s)) : null;

  return (
    <div className="topbar">
      {/* С ячейкой порядка строка тесная: на 360 px шестая ячейка съела бы подпись
          сезона. Поэтому пока она стоит, подписи дня и дружины прячутся — значок
          дня и число дружины говорят то же самое, а сезон остаётся словом. */}
      <div className={`hud-bar${order !== null ? ' with-order' : ''}`}>
        <span className="cell" title={`День ${day}, ${part.label}`}>
          <span className="ic">
            <Icon name={part.name} glyph={part.glyph} />
          </span>
          <b>{day}</b>
          <i>{part.label}</i>
        </span>
        <span className="sep" />
        <button
          className={`cell season season-${season}${tab === 'season' ? ' active' : ''}`}
          onClick={() => openTab('season')}
          title={`${meta.name}: ${meta.hint} Нажми, чтобы увидеть множители.`}
        >
          <span className="ic">
            <Icon name={iconName('season', season)} glyph={meta.icon} />
          </span>
          <i>{meta.name}</i>
          <span className="season-bar">
            <span style={{ width: `${Math.round(seasonProgress(s.time) * 100)}%` }} />
          </span>
        </button>
        <span className="sep" />
        <button
          className={`cell tap${pop > housing ? ' warn' : ''}${tab === 'pop' ? ' active' : ''}`}
          onClick={() => openTab('pop')}
          title="Население и жильё. Нажми, чтобы увидеть, как считается прирост."
        >
          <span className="ic">
            <Icon name="hud-pop" glyph="👥" />
          </span>
          <b>{pop}</b>
          <i>/{housing}</i>
        </button>
        <span className="sep" />
        <button
          className={`cell tap${morale < 35 ? ' warn' : ''}${tab === 'morale' ? ' active' : ''}`}
          onClick={() => openTab('morale')}
          title="Мораль племени. Нажми, чтобы увидеть, что её поднимает и что тянет вниз."
        >
          <span className="ic">
            <Icon name={mood.name} glyph={mood.glyph} />
          </span>
          <b>{morale}</b>
        </button>
        {order !== null && (
          <>
            <span className="sep" />
            <button
              className={`cell tap order${order < ORDER_WARN ? ' warn' : ''}${tab === 'order' ? ' active' : ''}`}
              onClick={() => openTab('order')}
              title="Порядок в городе: удержит ли власть невольников. Нажми, чтобы увидеть, кто их держит и что будет при мятеже."
            >
              <span className="ic">
                <Icon name="hud-order" glyph={ORDER_TEXT.icon} />
              </span>
              <b>{order}</b>
            </button>
          </>
        )}
        <span className="sep" />
        <button
          className={`cell tap army${tab === 'army' ? ' active' : ''}`}
          onClick={() => openTab('army')}
          title="Дружина. Нажми, чтобы увидеть состав, кольцо контрров и карточки войск."
        >
          <span className="ic">
            <Icon name="hud-army" glyph="⚔️" />
          </span>
          <b>{army}</b>
          <i>дружина</i>
        </button>
      </div>

      <ResourceBar />

      <div className="top-row">
        <CoatButton />
        {/* Скорость проверки — у правого края, рядом с картой; только под выключателем кодов. */}
        {CHEATS_ON && <SpeedButton className="map-btn" />}
        {/* Кнопка карты — один значок без слова. Слово «Карта» рядом с картой
            ничего не добавляло, а место отъедало; палец при этом не страдает:
            кнопка квадратная в `--tap` (44 px), то есть ровно наша цель, а
            счётчик непрочитанного стоит в углу, как стоял. */}
        <button
          className="map-btn"
          data-tut="nav-map"
          onClick={openMap}
          title="Карта мира: соседи, походы, разведка"
          aria-label="Карта мира"
        >
          <Icon name="hud-map" glyph="🗺️" />
          {(unread > 0 || marching > 0) && <em>{unread > 0 ? unread : marching}</em>}
        </button>
      </div>
    </div>
  );
}
