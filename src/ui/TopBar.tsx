import { useGame } from '@/game/store';
import { armySize, dayOf, dayFraction, housingCapacity, seasonOf, seasonProgress, solarPhase } from '@/game/derived';
import { SEASON_META } from '@/game/data/seasons';
import { useWorld } from '@/world/store';
import { ProfileButton } from './ProfileButton';

/** Время суток по фазе солнца — зимой она сдвинута, и «ночь» наступает раньше. */
function daypart(solar: number): { icon: string; name: string } {
  if (solar < 0.08) return { icon: '🌅', name: 'утро' };
  if (solar < 0.42) return { icon: '☀️', name: 'день' };
  if (solar < 0.58) return { icon: '🌇', name: 'вечер' };
  return { icon: '🌙', name: 'ночь' };
}

const moraleIcon = (m: number): string => (m >= 70 ? '😊' : m >= 40 ? '😐' : '😟');

/**
 * Верхняя строка состояния. Ресурсов здесь нет: их полный список живёт на складе,
 * а цену стройки видно рядом с самой стройкой. Списка построек здесь тоже нет —
 * он целиком уехал в ратушу, на вкладку «Стройка».
 *
 * Справа — дружина: армия теперь центр игры, и её численность видна всегда.
 *
 * Под строкой — свой ряд на две кнопки: слева профиль (лицо и имя), справа карта
 * мира. Карта — не раздел про посёлок, а выход наружу, к соседям, и обучение
 * ведёт к ней последним шагом. Профиль стоит в этом же ряду, а не третьей
 * строкой сверху: на 390 px каждая лишняя полоса отъедает у сцены сорок пикселей,
 * а левый край под шапкой аппки всё равно пуст.
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
  const part = daypart(solarPhase(dayFraction(s.time), season));
  const pop = s.pop;
  const housing = housingCapacity(s);
  const morale = Math.round(s.morale);
  const army = armySize(s);
  const tab = sheet?.kind === 'tab' ? sheet.tab : null;

  return (
    <div className="topbar">
      <div className="hud-bar">
        <span className="cell" title={`День ${day}, ${part.name}`}>
          <span className="ic">{part.icon}</span>
          <b>{day}</b>
          <i>{part.name}</i>
        </span>
        <span className="sep" />
        <button
          className={`cell season season-${season}${tab === 'season' ? ' active' : ''}`}
          onClick={() => openTab('season')}
          title={`${meta.name}: ${meta.hint} Нажми, чтобы увидеть множители.`}
        >
          <span className="ic">{meta.icon}</span>
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
          <span className="ic">👥</span>
          <b>{pop}</b>
          <i>/{housing}</i>
        </button>
        <span className="sep" />
        <button
          className={`cell tap${morale < 35 ? ' warn' : ''}${tab === 'morale' ? ' active' : ''}`}
          onClick={() => openTab('morale')}
          title="Мораль племени. Нажми, чтобы увидеть, что её поднимает и что тянет вниз."
        >
          <span className="ic">{moraleIcon(morale)}</span>
          <b>{morale}</b>
        </button>
        <span className="sep" />
        <button
          className={`cell tap army${tab === 'army' ? ' active' : ''}`}
          onClick={() => openTab('army')}
          title="Дружина. Нажми, чтобы увидеть состав, кольцо контрров и карточки войск."
        >
          <span className="ic">⚔️</span>
          <b>{army}</b>
          <i>дружина</i>
        </button>
      </div>

      <div className="top-row">
        <ProfileButton />
        <button className="map-btn" data-tut="nav-map" onClick={openMap} title="Карта мира: соседи, походы, разведка">
          🗺️ <span>Карта</span>
          {(unread > 0 || marching > 0) && <em>{unread > 0 ? unread : marching}</em>}
        </button>
      </div>
    </div>
  );
}
