import { useGame } from '@/game/store';
import {
  dayOf,
  dayFraction,
  era,
  ERA_META,
  housingCapacity,
  seasonOf,
  seasonProgress,
  solarPhase,
} from '@/game/derived';
import { SEASON_META } from '@/game/data/seasons';
import { tutorialActive } from '@/game/data/tutorial';
import { useWorld } from '@/world/store';

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
 * он целиком уехал в раздел «Здания» внизу.
 *
 * Отдельной кнопкой справа висит карта мира: это не раздел про посёлок, а выход
 * наружу, к соседям. Пока идёт обучение, её нет — новичку туда рано.
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
  const pop = s.villagers.length;
  const housing = housingCapacity(s);
  const morale = Math.round(s.morale);
  const e = ERA_META[era(s)];
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
        <span className={`cell${pop > housing ? ' warn' : ''}`} title="Население и вместимость жилья">
          <span className="ic">👥</span>
          <b>{pop}</b>
          <i>/{housing}</i>
        </span>
        <span className="sep" />
        <span className={`cell${morale < 35 ? ' warn' : ''}`} title="Мораль племени">
          <span className="ic">{moraleIcon(morale)}</span>
          <b>{morale}</b>
        </span>
        <span className="sep" />
        <span className="cell era" title={e.name}>
          <span className="ic">{e.icon}</span>
          <i>{e.short}</i>
        </span>
      </div>

      {!tutorialActive(s) && (
        <button className="map-btn" onClick={openMap} title="Карта мира: соседи, походы, разведка">
          🗺️ <span>Карта</span>
          {(unread > 0 || marching > 0) && <em>{unread > 0 ? unread : marching}</em>}
        </button>
      )}
    </div>
  );
}
