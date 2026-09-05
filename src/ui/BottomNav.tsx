import { useGame, type Tab } from '@/game/store';
import { buildingAttention, buildingOfType, idleCount, isSite } from '@/game/derived';
import { QUESTS } from '@/game/data/quests';

/**
 * Нижняя навигация. Стройка живёт в ратуше, поэтому раздела «Здания» здесь нет:
 * одно и то же дело не должно делаться в двух местах. Но и без пути к ратуше
 * нельзя — на 390 px пальцем по крыше не попасть, — поэтому у неё здесь своя
 * кнопка. Это единственное здание в навигации, и причина одна: через него идёт
 * вся стройка посёлка.
 */
const TABS: { id: Tab | 'townhall'; icon: string; label: string }[] = [
  { id: 'people', icon: '👥', label: 'Племя' },
  { id: 'townhall', icon: '🏛️', label: 'Ратуша' },
  { id: 'quests', icon: '📜', label: 'Задания' },
];

export function BottomNav() {
  const sheet = useGame((g) => g.sheet);
  const openTab = useGame((g) => g.openTab);
  const openTownHall = useGame((g) => g.openTownHall);
  const s = useGame((g) => g.s);
  const idle = idleCount(s);
  const building = s.buildings.some(isSite);
  const openQuests = QUESTS.filter((q) => !s.completedQuests.includes(q.id)).length;
  // Здание, стоящее совсем без рабочих, — единственный сигнал, ради которого стоит
  // лезть в список: остальное (свободное место, доступное улучшение) слишком часто.
  const empty = s.buildings.filter((b) => buildingAttention(s, b) === 'idle').length;
  const tab = sheet?.kind === 'tab' ? sheet.tab : null;
  const hall = buildingOfType(s, 'town_hall');
  const hallOpen = sheet?.kind === 'building' && hall !== null && sheet.id === hall.id;

  const badge = (id: Tab | 'townhall'): number | null => {
    if (id === 'people' && idle > 0 && !building) return idle;
    if (id === 'townhall') return empty > 0 ? empty : null;
    if (id === 'quests') return openQuests > 0 ? Math.min(openQuests, 3) : null;
    return null;
  };

  return (
    <nav className="bottomnav">
      {TABS.map((t) => {
        const b = badge(t.id);
        const active = t.id === 'townhall' ? hallOpen : tab === t.id;
        return (
          <button
            key={t.id}
            data-tut={`nav-${t.id}`}
            className={active ? 'active' : ''}
            onClick={() => (t.id === 'townhall' ? openTownHall() : openTab(t.id as Tab))}
          >
            <span className="ico">{t.icon}</span>
            <span>{t.label}</span>
            {b !== null && <span className="badge">{b}</span>}
          </button>
        );
      })}
    </nav>
  );
}
