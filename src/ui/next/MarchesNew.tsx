// «Походы» нового интерфейса (docs/ui_audit.md, 6.2 и 13): свои люди, кто идёт на нас, свои отряды в пути и
// донесения — строками 56 с одним действием справа. Строка человека касанием открывает его карточку; координата —
// касанием по строке состояния (камера на клетку); «на карте» — человек в руку.
//
// Своих чисел и слов о мире нет: где человек и когда вернётся — `figurePosition`, `secondsLeft` и `realLeft`, как в
// прежнем списке (`panels/MarchesPanel`); мораль отряда — `restLine` (`parts/restWords`), отказ перехвата из лагеря —
// `siege.CHASE_FROM_CAMP`. Прежний список остаётся у прежнего вида.
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { figurePosition, marchesOnUs, ownMarches, useWorld, worldNow } from '@/world/store';
import { troopTotal } from '@/game/battle/kinds';
import { postureOf } from '@/world/muster';
import { formatCoord, secondsLeft } from '@/world/geo';
import { CHASE_FROM_CAMP } from '@/world/siege';
import { MISSION_BY_ID } from '@/world/data/meta';
import type { FigureId, FigureView, MarchView, Report, ReportKind } from '@/world/types';
import { agentLevel, personName, yearsOf, yearsWord } from '@/game/sim/agents';
import { hireWhere } from '@/game/sim/hire';
import { Icon } from '@/ui/icons/Icon';
import { AgentCard } from '@/ui/parts/AgentCard';
import { restLine } from '@/ui/parts/restWords';
import { count } from '@/ui/parts/plural';
import { lootText, unitsText } from '@/ui/parts/reportWords';
import { realLeft } from '@/ui/parts/wait';

/** Значок донесения по его виду: набег, разведка, поддержка, оборона дома. */
export const REPORT_ART: Record<ReportKind, { name: string; glyph: string }> = {
  raid: { name: 'ui-banner', glyph: '⚔️' },
  scout: { name: 'fig-scout', glyph: '👣' },
  support: { name: 'deal-trade', glyph: '🤝' },
  defense: { name: 'ui-home', glyph: '🏠' },
};

const PHASE: Record<MarchView['phase'], string> = {
  out: 'к цели',
  stay: 'стоит в поддержке',
  back: 'обратно',
};

/**
 * Где человек — одной строкой. Те же состояния и слова, что у прежнего списка: задержан и выбыл — разные вещи
 * (`FIGURE_DOWN`, `SPY_HELD`), пустое место говорит, где нанять (`hireWhere`).
 */
export function whereWords(f: FigureView, now: number, hire: string): string {
  if (f.place === 'vacant') return `${f.gone === 'retired' ? 'ушёл на покой' : 'погиб'} · нанять ${hire}`;
  if (f.place === 'down')
    return f.held ? `задержан, отпустят через ${realLeft(secondsLeft(f.downUntil, now))}` : `разбит, вернётся через ${realLeft(secondsLeft(f.downUntil, now))}`;
  if (f.held && f.busyUntil > now) return `задержан, отпустят через ${realLeft(secondsLeft(f.busyUntil, now))} · ${f.atName ?? 'у чужих ворот'}`;
  if (f.retiring) return 'дожил до покоя: идёт домой';
  if (f.place === 'city') return 'укрылся в городе';
  if (f.phase === 'moving') return `в пути · ${realLeft(secondsLeft(f.arriveAt, now))}`;
  return f.atHome ? 'дома' : (f.atName ?? 'в поле');
}

export function MarchesNew() {
  const s = useGame((g) => g.s);
  const showToast = useGame((g) => g.showToast);
  const closeSheet = useGame((g) => g.closeSheet);
  const openReport = useGame((g) => g.openReport);
  const marches = useWorld((g) => g.marches);
  const homeId = useWorld((g) => g.info?.homeId);
  const reports = useWorld((g) => g.reports);
  const figures = useWorld((g) => g.figures);
  const openChase = useWorld((g) => g.openChase);
  const recall = useWorld((g) => g.recall);
  const loadReports = useWorld((g) => g.loadReports);
  const markRead = useWorld((g) => g.markRead);
  const select = useWorld((g) => g.select);
  const recallFigure = useWorld((g) => g.recallFigure);
  const shelter = useWorld((g) => g.shelter);
  const setAnchor = useWorld((g) => g.setAnchor);
  const pickFigure = useWorld((g) => g.pick);
  // Карточка человека — страница этой же шторки, как в прежнем списке: закрытая шторка открывается на списке.
  const [card, setCard] = useState<FigureId | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    void loadReports().then(() => void markRead());
  }, [loadReports, markRead]);
  // Сроки идут сами: замерший счётчик читается как сломанный экран.
  useEffect(() => {
    const t = setInterval(() => tick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (card) return <AgentCard id={card} onBack={() => setCard(null)} />;

  const now = worldNow();
  const own = ownMarches(marches);
  const incoming = marchesOnUs(marches, homeId);
  // Полководец в лагере осады — перехвата нет: мир откажет той же строкой (`LocalWorld.chaseBlock`).
  const inCamp = (figures.find((f) => f.id === 'general')?.besieging ?? null) !== null;

  return (
    <div className="panel nx-bpanel nx-marches">
      <div className="nx-bhead">
        <span className="nx-bico">
          <Icon name="ui-banner" glyph="⚔️" />
        </span>
        <div className="nx-btitle">
          <b>Походы</b>
          <span className="nx-blvl">{own.length > 0 ? `в пути ${own.length}` : 'все дома'}</span>
        </div>
        <button className="nx-bclose" onClick={closeSheet} aria-label="Закрыть">
          <Icon name="ui-close" glyph="✕" />
        </button>
      </div>

      {incoming.length > 0 && (
        <>
          <h3>Идут на нас</h3>
          {incoming.map((m) => (
            <div className="nx-mrow danger" key={m.id}>
              <span className="nx-mico">
                <Icon name="alert-raid" glyph="⚠️" />
              </span>
              <span className="nx-lbody">
                <b className="one-line">{m.fromName}</b>
                <small>
                  {m.onCamp ? 'на наш лагерь' : `от ${formatCoord(m.from)}`}
                  {m.rest ? ` · ${restLine(m.rest, 'Отряд дрался', now)}` : ''}
                </small>
                {!m.onCamp && inCamp && <small className="bad">{CHASE_FROM_CAMP}</small>}
              </span>
              <span className="nx-mright">
                <em className="nx-due bad">{realLeft(secondsLeft(m.arriveAt, now))}</em>
                {!m.onCamp && (
                  <button className="nx-act" disabled={inCamp} onClick={() => void openChase(m)}>
                    Перехватить
                  </button>
                )}
              </span>
            </div>
          ))}
        </>
      )}

      <h3>Люди</h3>
      {figures.map((f) => {
        const at = figurePosition(f, now);
        const cell = { x: Math.round(at.x), y: Math.round(at.y) };
        const men = troopTotal(f.troops);
        const named = f.place !== 'vacant' && s.agents[f.id].name;
        return (
          <div className={`nx-mrow${f.place === 'down' ? ' down' : ''}${f.place === 'vacant' ? ' vacant' : ''}`} key={f.id}>
            <button className="nx-mico" onClick={() => setCard(f.id)} aria-label={`${f.name}: карточка`}>
              <Icon name={`fig-${f.id}`} glyph={f.icon} />
            </button>
            <button className="nx-lbody nx-mtap" onClick={() => (f.place === 'down' || f.place === 'vacant' ? setCard(f.id) : void select(cell))}>
              <b className="one-line">
                {f.name}
                {named ? ` ${personName(s, f.id)}` : ''}
              </b>
              <small>
                {f.place !== 'vacant' ? `ур. ${agentLevel(s, f.id)} · ${yearsWord(yearsOf(s, f.id))} · ` : ''}
                {whereWords(f, now, hireWhere(s, f.id))}
                {men > 0 ? ` · ${count(men, 'боец', 'бойца', 'бойцов')}${postureOf(f) === 'stands' ? ' · в гарнизоне' : ''}` : ''}
                {f.watching ? ' · смотрит' : ''}
              </small>
            </button>
            <span className="nx-mright">
              {f.place === 'map' && !f.atHome && (
                <button className="nx-ico44" onClick={() => void recallFigure(f.id).then((err) => err && showToast(err))} aria-label={`${f.name}: домой`}>
                  <Icon name="ui-home" glyph="🏠" />
                </button>
              )}
              {f.place === 'map' && (
                <button
                  className="nx-act"
                  onClick={() => {
                    setAnchor(f.id);
                    pickFigure(f.id);
                    closeSheet();
                  }}
                >
                  На карте
                </button>
              )}
              {f.place === 'city' && (
                <button
                  className="nx-act"
                  onClick={() => void shelter(f.id, false).then((err) => showToast(err ?? `${f.name} вышел из города.`))}
                >
                  Выйти
                </button>
              )}
            </span>
          </div>
        );
      })}

      <h3>В пути</h3>
      {own.length === 0 && <p className="nx-tnote">Походов нет. Выбери цель на карте.</p>}
      {own.map((m) => {
        // У возвращающегося интересно место, откуда он идёт; отозванный стоит между клетками.
        const at = m.phase === 'back' ? { x: Math.round(m.from.x), y: Math.round(m.from.y) } : { x: m.to.x, y: m.to.y };
        return (
          <div className="nx-mrow" key={m.id}>
            <span className="nx-mico">
              <Icon name={m.mission === 'scout' ? 'fig-scout' : 'ui-banner'} glyph={MISSION_BY_ID[m.mission].icon} />
            </span>
            <button className="nx-lbody nx-mtap" onClick={() => void select(at)}>
              <b className="one-line">{m.toName}</b>
              <small>
                {PHASE[m.phase]} · {unitsText(m.units)}
                {m.loot ? ` · везут ${lootText(m.loot)}` : ''}
              </small>
            </button>
            <span className="nx-mright">
              <em className="nx-due">{realLeft(secondsLeft(m.arriveAt, now))}</em>
              {m.recallable && (
                <button className="nx-act" onClick={() => void recall(m.id)}>
                  Отозвать
                </button>
              )}
            </span>
          </div>
        );
      })}

      <h3>Донесения</h3>
      {reports.length === 0 && <p className="nx-tnote">Донесений нет.</p>}
      {reports.map((r) => (
        <ReportRow key={r.id} r={r} onOpen={() => openReport(r.id)} />
      ))}
    </div>
  );
}

/** Строка донесения: значок вида, исход, где; «новое» — точкой 8 px (3.8). */
function ReportRow({ r, onOpen }: { r: Report; onOpen: () => void }) {
  const art = REPORT_ART[r.kind];
  return (
    <button className={`nx-mrow nx-rrow${r.won ? '' : ' lost'}`} onClick={onOpen}>
      <span className="nx-mico">
        <Icon name={art.name} glyph={art.glyph} />
      </span>
      <span className="nx-lbody">
        <b className="one-line">{r.title}</b>
        <small className="one-line">{r.text}</small>
      </span>
      {!r.read && <span className="nx-new" aria-label="новое" />}
      <span className="nx-chev">›</span>
    </button>
  );
}
