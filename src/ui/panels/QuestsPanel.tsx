import { useState } from 'react';
import { SpareSave } from '../parts/Sync';
import { useGame } from '@/game/store';
import { useWorld } from '@/world/store';
import { ACHIEVEMENTS, QUESTS, questsDone } from '@/game/data/quests';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { Chronicle } from '../parts/Chronicle';
import { DailyPage } from '../parts/daily/DailyPage';
import { SceneDoctor } from '../parts/SceneDoctor';
import { TouchDoctor } from '../parts/TouchDoctor';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';
import { CHEAT_MARK } from '@/cheats';

/**
 * «Задания» — две страницы.
 *
 * Первая — то, ради чего сюда заходят: задания племени, достижения, летопись и
 * служебное. Вторая — то, что делается раз в сутки и раз навсегда: задание дня,
 * подписки, приглашение. Смешать их в один список нельзя — ежедневка утонула бы
 * под летописью, а служебные кнопки оказались бы посреди социальных ссылок.
 *
 * Страница живёт местным состоянием, а не стором, в отличие от вкладок ратуши:
 * туда ведут ссылки из справки о морали, а сюда снаружи не ведёт ничего. Заодно
 * это и правильное поведение — шторка закрывается, память умирает вместе с ней,
 * и «Задания» всегда открываются на заданиях.
 */
export function QuestsPanel() {
  const s = useGame((g) => g.s);
  const [page, setPage] = useState<'quests' | 'daily'>('quests');
  const doneCount = questsDone(s);

  return (
    <div className="panel">
      <h2>
        Задания <small>выполнено {doneCount}/{QUESTS.length} · престиж {s.prestige}</small>
      </h2>

      <div className="tabs">
        <button className={page === 'quests' ? 'active' : ''} onClick={() => setPage('quests')}>
          <Icon name="ui-scroll" glyph="📜" /> Задания
        </button>
        <button className={page === 'daily' ? 'active' : ''} onClick={() => setPage('daily')}>
          <Icon name="ui-target" glyph="🎯" /> Каждый день
        </button>
      </div>

      {page === 'quests' ? <QuestList /> : <DailyPage />}
    </div>
  );
}

function QuestList() {
  const s = useGame((g) => g.s);
  const reset = useGame((g) => g.reset);
  const resetWorld = useWorld((g) => g.resetWorld);
  const replayTutorial = useGame((g) => g.replayTutorial);
  const open = QUESTS.filter((q) => !s.completedQuests.includes(q.id)).slice(0, 3);

  return (
    <>
      {open.map((q) => {
        const p = q.progress?.(s);
        return (
          <div className="card" key={q.id}>
            <div className="ico"><Icon name="ui-scroll" glyph="📜" /></div>
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
              <Icon name={iconName('ach', a.id)} glyph={a.icon} /> {a.title}
            </span>
          );
        })}
      </div>

      <Chronicle />

      <h3>Служебное</h3>
      {/* Метка партии, где применяли коды. Стоит здесь, а не только в летописи:
          летопись живёт месяц и старую строку выбрасывает, а метка — навсегда
          (`src/cheats.ts`). Непомеченная партия не показывает ничего: пустая
          строка «кодов не было» была бы шумом в каждой честной партии. */}
      {s.cheated && <div className="desc cheat-mark">{CHEAT_MARK}</div>}
      <button className="btn ghost wide" onClick={replayTutorial}>
        Пройти обучение заново
      </button>
      {/* Прибор, а не кнопка починки: жалоба на пропавшую диораму нестабильна, и
          без журнала с телефона любая правка казалась бы помогшей. */}
      <SceneDoctor />
      {/* Тот же прибор, но про палец: жалоба «тап срабатывает иногда» без
          журнала с телефона остаётся ощущением, а не фактом. */}
      <TouchDoctor />
      {/* Показывается только когда отклонённая партия есть. Ради неё выбор при
          расхождении и не страшен: ошибиться можно, потерять — нет. */}
      <SpareSave />
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
    </>
  );
}
