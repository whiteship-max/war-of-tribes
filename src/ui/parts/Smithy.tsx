import type { Building } from '@/game/types';
import { useGame } from '@/game/store';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { EQUIPMENT } from '@/game/data/equipment';
import { canAfford, forgeInfo, workersIn } from '@/game/derived';
import { setForging } from '@/game/sim/actions';

/**
 * Кузница: переключатель «что куём» и ход работы.
 *
 * Предметы — обычные счётчики: ни инвентаря, ни качества, ни износа. Скорость
 * зависит от числа кузнецов, уровня кузницы и таланта — всё это уже сидит
 * в множителе жителя, поэтому здесь просто показываем итог.
 */
export function Smithy({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const info = forgeInfo(s);
  const smiths = workersIn(s, b.id).length;

  return (
    <>
      <h3>
        Что куём <span className="muted">кузнецов: {smiths}</span>
      </h3>

      {info.def ? (
        <div className="card">
          <div className="ico">{info.def.icon}</div>
          <div className="body">
            <div className="title">
              {info.def.name}
              <span className="count">
                {info.blocked ? '—' : info.eta !== null ? `~${info.eta} с` : 'стоит'}
              </span>
            </div>
            <div className="desc">
              {info.blocked ?? `Готово на ${Math.floor((info.work / Math.max(1, info.need)) * 100)}%`}
            </div>
            <div className="progress">
              <div style={{ width: `${Math.min(100, (info.work / Math.max(1, info.need)) * 100)}%` }} />
            </div>
          </div>
          <button className="btn ghost" onClick={() => act((st) => setForging(st, null))} aria-label="Снять наряд">
            ✕
          </button>
        </div>
      ) : (
        <div className="note">Наряда нет. Выбери, что ковать, — кузнецы возьмутся сразу.</div>
      )}

      {EQUIPMENT.map((e) => {
        const have = s.equipment[e.id] ?? 0;
        const afford = canAfford(s, e.cost);
        return (
          <button
            key={e.id}
            className={`card as-row${info.item === e.id ? ' done' : ''}`}
            onClick={() => act((st) => setForging(st, e.id))}
          >
            <div className="ico">{e.icon}</div>
            <div className="body">
              <div className="title">
                {e.name}
                <span className="count">на складе: {have}</span>
              </div>
              <div className="desc">{e.description}</div>
              <div className="cost">
                {RESOURCE_IDS.filter((r) => e.cost[r]).map((r) => (
                  <span key={r} className={s.resources[r] >= (e.cost[r] ?? 0) ? '' : 'no'}>
                    {RESOURCE_META[r].icon} {e.cost[r]}
                  </span>
                ))}
                <span>⏳ {e.work}</span>
                {!afford && <span className="no">не хватает материалов</span>}
              </div>
            </div>
            <span className="attn">{info.item === e.id ? '🔨' : '▸'}</span>
          </button>
        );
      })}
    </>
  );
}
