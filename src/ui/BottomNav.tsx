import { useGame, type Tab } from '@/game/store';
import { buildingAttention, idleCount, isSite } from '@/game/derived';
import { QUESTS } from '@/game/data/quests';

/**
 * «Здания» — и список посёлка, и стройка: отдельной кнопки «Посёлок» больше нет,
 * она дублировала бы этот же список. Остальное здесь — то, что не привязано к месту.
 */
const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'people', icon: '👥', label: 'Племя' },
  { id: 'build', icon: '🏘️', label: 'Здания' },
  { id: 'quests', icon: '📜', label: 'Задания' },
];

export function BottomNav() {
  const sheet = useGame((g) => g.sheet);
  const openTab = useGame((g) => g.openTab);
  const s = useGame((g) => g.s);
  const idle = idleCount(s);
  const building = s.buildings.some(isSite);
  const openQuests = QUESTS.filter((q) => !s.completedQuests.includes(q.id)).length;
  // Здание, стоящее совсем без рабочих, — единственный сигнал, ради которого стоит
  // лезть в список: остальное (свободное место, доступное улучшение) слишком часто.
  const empty = s.buildings.filter((b) => buildingAttention(s, b) === 'idle').length;
  const tab = sheet?.kind === 'tab' ? sheet.tab : null;

  const badge = (id: Tab): number | null => {
    if (id === 'people' && idle > 0 && !building) return idle;
    if (id === 'build') return empty > 0 ? empty : null;
    if (id === 'quests') return openQuests > 0 ? Math.min(openQuests, 3) : null;
    return null;
  };

  return (
    <nav className="bottomnav">
      {TABS.map((t) => {
        const b = badge(t.id);
        return (
          <button
            key={t.id}
            data-tut={`nav-${t.id}`}
            className={tab === t.id ? 'active' : ''}
            onClick={() => openTab(t.id)}
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
