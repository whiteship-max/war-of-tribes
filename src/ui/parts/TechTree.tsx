import { useState } from 'react';
import { useGame } from '@/game/store';
import { BRANCH_META, TECHS, TECH_BY_ID } from '@/game/data/techs';
import { canAfford, hasKnowledgeHouse, hasTech, researchRate } from '@/game/derived';
import { cancelResearch, startResearch } from '@/game/sim/actions';
import type { TechBranch } from '@/game/types';
import { Cost } from './Cost';

const BRANCHES: TechBranch[] = ['craft', 'settlement', 'war', 'society'];

/**
 * Дерево технологий. Живёт в хранилище знаний, а пока его не построили — у костра,
 * где скорость вдвое ниже. Исследования не заперты за зданием, которое само стоит исследований.
 */
export function TechTree() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const [branch, setBranch] = useState<TechBranch>('craft');
  const rate = researchRate(s);
  const current = s.research ? TECH_BY_ID[s.research.techId] : null;
  const atCampfire = !hasKnowledgeHouse(s);

  return (
    <>
      <h3>
        Исследования <span className="muted">{rate.toFixed(1)}/с</span>
      </h3>
      {atCampfire && (
        <p className="note">Знание передают у костра из уст в уста — вполсилы. Хранилище знаний снимет этот штраф.</p>
      )}

      {current && s.research && (
        <div className="card">
          <div className="ico">{current.icon}</div>
          <div className="body">
            <div className="title">
              {current.name}
              <span className="count">~{Math.ceil((current.work - s.research.work) / Math.max(0.01, rate))} с</span>
            </div>
            <div className="progress good">
              <div style={{ width: `${Math.floor((s.research.work / current.work) * 100)}%` }} />
            </div>
          </div>
          <button className="btn ghost" onClick={() => act(cancelResearch)} aria-label="Отменить исследование">
            ✕
          </button>
        </div>
      )}

      <div className="tabs" style={{ marginTop: 10 }}>
        {BRANCHES.map((b) => (
          <button key={b} className={branch === b ? 'active' : ''} onClick={() => setBranch(b)}>
            {BRANCH_META[b].icon} {BRANCH_META[b].name}
          </button>
        ))}
      </div>

      {TECHS.filter((t) => t.branch === branch).map((t) => {
        const done = hasTech(s, t.id);
        const inProgress = s.research?.techId === t.id;
        const reqOk = t.requires.every((r) => hasTech(s, r));
        const afford = canAfford(s, t.cost);
        const busy = s.research !== null;
        const missing = t.requires.filter((r) => !hasTech(s, r)).map((r) => TECH_BY_ID[r].name);
        return (
          <div className={`card ${done ? 'done' : reqOk ? '' : 'locked'}`} key={t.id}>
            <div className="ico">{t.icon}</div>
            <div className="body">
              <div className="title">
                {t.name}
                {done && <span className="count">✓ изучено</span>}
                {inProgress && <span className="count">⏳ изучается</span>}
              </div>
              <div className="desc">{reqOk || done ? t.description : `Нужно: ${missing.join(', ')}`}</div>
              {!done && <Cost cost={t.cost} work={t.work} />}
            </div>
            {!done && !inProgress && (
              <button className="btn" disabled={!reqOk || !afford || busy} onClick={() => act((st) => startResearch(st, t.id))}>
                Изучить
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
