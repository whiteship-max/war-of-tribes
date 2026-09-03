import { useGame } from '@/game/store';
import { useWorld } from '@/world/store';
import { ACHIEVEMENTS, QUESTS } from '@/game/data/quests';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { dayOf } from '@/game/derived';

export function QuestsPanel() {
  const s = useGame((g) => g.s);
  const reset = useGame((g) => g.reset);
  const resetWorld = useWorld((g) => g.resetWorld);
  const replayTutorial = useGame((g) => g.replayTutorial);
  const open = QUESTS.filter((q) => !s.completedQuests.includes(q.id)).slice(0, 3);
  const doneCount = s.completedQuests.length;

  return (
    <div className="panel">
      <h2>
        Задания <small>выполнено {doneCount}/{QUESTS.length} · престиж {s.prestige}</small>
      </h2>

      {open.map((q) => {
        const p = q.progress?.(s);
        return (
          <div className="card" key={q.id}>
            <div className="ico">📜</div>
            <div className="body">
              <div className="title">
                {q.title}
                {p && (
                  <span className="count">
                    {p[0]}/{p[1]}
                  </span>
                )}
              </div>
              <div className="desc">{q.description}</div>
              <div className="cost">
                <span style={{ color: 'var(--muted)' }}>Награда:</span>
                {RESOURCE_IDS.filter((r) => q.reward[r]).map((r) => (
                  <span key={r}>
                    {RESOURCE_META[r].icon} {q.reward[r]}
                  </span>
                ))}
              </div>
              {p && (
                <div className="progress">
                  <div style={{ width: `${(p[0] / p[1]) * 100}%` }} />
                </div>
              )}
            </div>
          </div>
        );
      })}
      {open.length === 0 && <div className="desc">Все задания выполнены. Племя продолжает расти!</div>}

      <h3>Достижения</h3>
      <div className="villager-list">
        {ACHIEVEMENTS.map((a) => {
          const ok = a.check(s);
          return (
            <span className="villager-chip" key={a.id} style={{ opacity: ok ? 1 : 0.4 }}>
              {a.icon} {a.title}
            </span>
          );
        })}
      </div>

      <h3>Летопись</h3>
      <div className="log">
        {s.log.slice(0, 25).map((e, i) => (
          <div key={i} className={e.kind}>
            <span style={{ opacity: 0.6 }}>Д{dayOf(e.at)}</span> · {e.text}
          </div>
        ))}
      </div>

      <h3>Служебное</h3>
      <button className="btn ghost wide" onClick={replayTutorial}>
        Пройти обучение заново
      </button>
      <button
        className="btn danger"
        onClick={() => {
          // Новая партия — новый мир: старые соседи и походы к ней отношения не имеют.
          if (confirm('Начать заново? Прогресс будет потерян.')) {
            reset();
            void resetWorld();
          }
        }}
      >
        Начать заново
      </button>
    </div>
  );
}
