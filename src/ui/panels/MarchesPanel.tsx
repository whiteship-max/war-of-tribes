// Три фигуры, свои походы и отчёты. Отсюда фигуру и отряд отзывают, здесь же
// видно, кто идёт на нас.
//
// Список фигур стоит первым нарочно: армия ходит только с полководцем, и вопрос
// «где он сейчас» на этом экране главный.
import { useEffect } from 'react';
import { useGame } from '@/game/store';
import { figurePosition, incomingMarches, ownMarches, useWorld, worldNow } from '@/world/store';
import { troopTotal } from '@/game/battle/kinds';
import { formatCoord, formatLeft, secondsLeft } from '@/world/geo';
import { MISSION_BY_ID } from '@/world/data/meta';
import { UNITS } from '@/world/data/units';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import type { Loot, MarchView, Report, ReportKind, UnitStack } from '@/world/types';

/** Иконка отчёта: набег, разведка, поддержка или оборона дома. */
const REPORT_ICON: Record<ReportKind, string> = {
  raid: '⚔️',
  scout: '👣',
  support: '🤝',
  defense: '🏠',
};

const PHASE: Record<MarchView['phase'], string> = {
  out: 'идёт к цели',
  stay: 'стоит в поддержке',
  back: 'возвращается',
};

const unitsText = (units: UnitStack): string =>
  UNITS.filter((u) => (units[u.id] ?? 0) > 0)
    .map((u) => `${u.icon} ${units[u.id]}`)
    .join(' · ') || '—';

/** Добыча строкой. Золото из замка идёт тем же списком, но своим значком. */
const lootText = (loot: Loot | null): string => {
  if (!loot) return '';
  const parts = RESOURCE_IDS.filter((r) => loot[r]).map(
    (r) => `${RESOURCE_META[r].icon} ${Math.abs(loot[r] as number)}`,
  );
  if (loot.gold) parts.push(`💰 ${Math.abs(loot.gold)}`);
  return parts.join(' · ');
};

function ReportCard({ r }: { r: Report }) {
  const openReport = useGame((g) => g.openReport);
  const icon = REPORT_ICON[r.kind];
  return (
    <button className={`card as-row report${r.won ? '' : ' lost'}`} onClick={() => openReport(r.id)}>
      <div className="ico">{icon}</div>
      <div className="body">
        <div className="title">
          {r.title}
          {!r.read && <span className="count new">новое</span>}
        </div>
        <div className="desc">{r.text}</div>
        <div className="cost">
          <span className="work">{r.battle ? 'разбор боя →' : 'подробности →'}</span>
        </div>
      </div>
    </button>
  );
}

export function MarchesPanel() {
  const marches = useWorld((g) => g.marches);
  const openChase = useWorld((g) => g.openChase);
  const reports = useWorld((g) => g.reports);
  const recall = useWorld((g) => g.recall);
  const loadReports = useWorld((g) => g.loadReports);
  const markRead = useWorld((g) => g.markRead);
  const select = useWorld((g) => g.select);
  const figures = useWorld((g) => g.figures);
  const recallFigure = useWorld((g) => g.recallFigure);
  const showToast = useGame((g) => g.showToast);

  useEffect(() => {
    void loadReports().then(() => void markRead());
  }, [loadReports, markRead]);

  const own = ownMarches(marches);
  const incoming = incomingMarches(marches);

  return (
    <div className="panel">
      <h2>
        Походы <small>{own.length > 0 ? `в пути ${own.length}` : 'все дома'}</small>
      </h2>

      <h3>Фигуры</h3>
      {figures.map((f) => {
        const at = figurePosition(f, worldNow());
        const cell = { x: Math.round(at.x), y: Math.round(at.y) };
        const men = troopTotal(f.troops);
        const where =
          f.phase === 'down'
            ? `выбыл, вернётся через ${formatLeft(secondsLeft(f.downUntil, worldNow()))}`
            : f.phase === 'moving'
              ? `в пути · ${formatLeft(secondsLeft(f.arriveAt, worldNow()))}`
              : f.atHome
                ? 'дома'
                : (f.atName ?? 'в поле');
        return (
          <div className={`card${f.phase === 'down' ? ' lost' : ''}`} key={f.id}>
            <div className="ico">{f.icon}</div>
            <div className="body">
              <div className="title">
                {f.name}
                {men > 0 && <span className="count">дружина {men}</span>}
              </div>
              <div className="desc">
                {where}
                {men > 0 ? ' · войско при нём, дома его нет' : ''}
                {/* Наблюдение — единственный живой обзор за кругом деревни, и
                    видно оно должно быть там же, где остальные состояния фигур. */}
                {f.watching ? ' · 👁️ смотрит: приказы не отдаются' : ''}
              </div>
              <div className="cost">
                {f.phase !== 'down' && (
                  <button className="mini text" onClick={() => void select(cell)}>
                    {formatCoord(cell)}
                  </button>
                )}
                {f.phase !== 'down' && !f.atHome && (
                  <button
                    className="mini text"
                    onClick={() => {
                      void recallFigure(f.id).then((err) => err && showToast(err));
                    }}
                  >
                    Домой
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {incoming.length > 0 && (
        <>
          <h3>Идут на нас</h3>
          {incoming.map((m) => (
            <div className="card danger" key={m.id}>
              <div className="ico">⚠️</div>
              <div className="body">
                <div className="title">
                  {m.fromName}
                  <span className="count">{formatLeft(secondsLeft(m.arriveAt, worldNow()))}</span>
                </div>
                <div className="desc">
                  Чужой отряд идёт к нам от {formatCoord(m.from)}. Успей вернуть своих или встретить.
                </div>
                <div className="cost">
                  {/* Встретить их можно и в поле: точку встречи покажут до приказа. */}
                  <button className="mini text" onClick={() => void openChase(m)}>
                    🎖️ Перехватить в поле
                  </button>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {own.length === 0 ? (
        <div className="desc">Никто никуда не идёт. Открой карту и выбери цель.</div>
      ) : (
        own.map((m) => {
          // У возвращающегося отряда интересно место, откуда он идёт; отозванный
          // стоит между клетками — координату округляем.
          const at =
            m.phase === 'back'
              ? { x: Math.round(m.from.x), y: Math.round(m.from.y) }
              : { x: m.to.x, y: m.to.y };
          return (
          <div className="card" key={m.id}>
            <div className="ico">{MISSION_BY_ID[m.mission].icon}</div>
            <div className="body">
              <div className="title">
                {m.toName}
                <span className="count">{formatLeft(secondsLeft(m.arriveAt, worldNow()))}</span>
              </div>
              <div className="desc">
                {PHASE[m.phase]} · {unitsText(m.units)}
                {m.loot ? ` · везут ${lootText(m.loot)}` : ''}
              </div>
              <div className="cost">
                <button className="mini text" onClick={() => void select(at)}>
                  {formatCoord(at)}
                </button>
                {m.recallable && (
                  <button className="mini text" onClick={() => void recall(m.id)}>
                    Отозвать
                  </button>
                )}
              </div>
            </div>
          </div>
          );
        })
      )}

      <h3>Отчёты</h3>
      {reports.length === 0 ? (
        <div className="desc">Отчётов пока нет.</div>
      ) : (
        reports.map((r) => <ReportCard key={r.id} r={r} />)
      )}
    </div>
  );
}
