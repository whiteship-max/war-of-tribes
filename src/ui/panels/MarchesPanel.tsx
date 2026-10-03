// Четыре фигуры, свои походы и отчёты. Отсюда фигуру и отряд отзывают, здесь же
// видно, кто идёт на нас.
//
// Список фигур стоит первым нарочно: армия ходит только с полководцем, и вопрос
// «где он сейчас» на этом экране главный. Это и **единственный** список агентов
// на карте: угол агентов в правом низу убран как вторая кнопка под то же дело, и
// всё, что умел только он, переехало сюда — поставить камеру на агента и взять
// его в руку («На карте»). Без этого разведчик, ушедший за поводок деревни,
// оставался бы без приказов: тапнуть его на карте нельзя, пока камера до него
// не дотянется, а дотянуться она может только от него самого.
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { figurePosition, marchesOnUs, ownMarches, useWorld, worldNow } from '@/world/store';
import { troopTotal } from '@/game/battle/kinds';
import { postureOf } from '@/world/muster';
import { formatCoord, secondsLeft } from '@/world/geo';
import { CHASE_FROM_CAMP } from '@/world/siege';
import { realLeft } from '@/ui/parts/wait';
import { restLine } from '@/ui/parts/restWords';
import { MISSION_BY_ID } from '@/world/data/meta';
import type { MarchView, Report, ReportKind } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { AgentCard } from '@/ui/parts/AgentCard';
import { count } from '@/ui/parts/plural';
import { lootText, unitsText } from '@/ui/parts/reportWords';
import { agentLevel, personName, yearsOf, yearsWord } from '@/game/sim/agents';
import { hireWhere } from '@/game/sim/hire';
import type { FigureId } from '@/world/types';

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
  const homeId = useWorld((g) => g.info?.homeId);
  const openChase = useWorld((g) => g.openChase);
  const reports = useWorld((g) => g.reports);
  const recall = useWorld((g) => g.recall);
  const loadReports = useWorld((g) => g.loadReports);
  const markRead = useWorld((g) => g.markRead);
  const select = useWorld((g) => g.select);
  const figures = useWorld((g) => g.figures);
  const recallFigure = useWorld((g) => g.recallFigure);
  const shelter = useWorld((g) => g.shelter);
  const setAnchor = useWorld((g) => g.setAnchor);
  const pickFigure = useWorld((g) => g.pick);
  const showToast = useGame((g) => g.showToast);
  const closeSheet = useGame((g) => g.closeSheet);
  const s = useGame((g) => g.s);
  // Карточка агента — страница этой же панели, как вторая страница заданий: снаружи
  // на неё ничего не ведёт, и закрытая шторка открывается снова на списке.
  const [card, setCard] = useState<FigureId | null>(null);

  useEffect(() => {
    void loadReports().then(() => void markRead());
  }, [loadReports, markRead]);

  const own = ownMarches(marches);
  const incoming = marchesOnUs(marches, homeId);
  // Полководец в лагере осады — перехвата нет: мир откажет той же строкой (`LocalWorld.chaseBlock`), и кнопка гаснет
  // до нажатия, а не ведёт в меню к встрече, которой не будет.
  const inCamp = (figures.find((f) => f.id === 'general')?.besieging ?? null) !== null;
  if (card) return <AgentCard id={card} onBack={() => setCard(null)} />;

  return (
    <div className="panel">
      <h2>
        Походы <small>{own.length > 0 ? `в пути ${own.length}` : 'все дома'}</small>
      </h2>

      <h3>Люди</h3>
      {figures.map((f) => {
        const at = figurePosition(f, worldNow());
        const cell = { x: Math.round(at.x), y: Math.round(at.y) };
        const men = troopTotal(f.troops);
        // Задержан и выбыл — разные вещи, и говорить «выбыл» о пойманном, которого через
        // `FIGURE_DOWN` отпустят (лазутчика — через `SPY_HELD`), значит врать игроку.
        // Слова — те же, что у «Походов» нового вида (`next/MarchesNew.whereWords`).
        const where =
          f.place === 'vacant'
            ? `${f.gone === 'retired' ? 'ушёл на покой' : 'погиб'} · нанять ${hireWhere(s, f.id)}`
            : f.place === 'down'
            ? f.held
              ? `задержан, отпустят через ${realLeft(secondsLeft(f.downUntil, worldNow()))}`
              : `разбит, вернётся через ${realLeft(secondsLeft(f.downUntil, worldNow()))}`
            : f.held && f.busyUntil > worldNow()
              ? `задержан у ${f.atName ?? 'чужих ворот'}, отпустят через ${realLeft(secondsLeft(f.busyUntil, worldNow()))}`
            : f.retiring
              ? 'дожил до покоя: идёт домой'
            : f.place === 'city'
              ? 'укрылся в городе'
              : f.phase === 'moving'
                ? `в пути · ${realLeft(secondsLeft(f.arriveAt, worldNow()))}`
                : f.atHome
                  ? 'дома'
                  : (f.atName ?? 'в поле');
        return (
          <div className={`card${f.phase === 'down' ? ' lost' : ''}`} key={f.id}>
            <div className="ico" role="button" onClick={() => setCard(f.id)}>
              <Icon name={`fig-${f.id}`} glyph={f.icon} />
            </div>
            <div className="body">
              {/* Тело строки ведёт в карточку агента; кнопки ниже остаются кнопками строки. */}
              <div className="title" role="button" onClick={() => setCard(f.id)}>
                {f.name}
                {f.place !== 'vacant' && s.agents[f.id].name ? ` ${personName(s, f.id)}` : ''}
                {f.place !== 'vacant' && <span className="count">ур. {agentLevel(s, f.id)} · {yearsWord(yearsOf(s, f.id))} ›</span>}
                {men > 0 && <span className="count">{count(men, 'боец', 'бойца', 'бойцов')}</span>}
              </div>
              <div className="desc">
                {where}
                {men > 0 ? (postureOf(f) === 'stands' ? ' · в гарнизоне' : ' · отряд при нём') : ''}
                {/* Наблюдение — единственный живой обзор за кругом деревни, и
                    видно оно должно быть там же, где остальные состояния фигур. */}
                {f.watching ? ' · смотрит' : ''}
              </div>
              <div className="cost">
                {f.place !== 'down' && f.place !== 'vacant' && (
                  <button className="mini text" onClick={() => void select(cell)}>
                    {formatCoord(cell)}
                  </button>
                )}
                {/* Камера на агента и агент в руку — то, что умел только угол
                    агентов. Шторка закрывается: взяв агента, смотрят на землю. */}
                {f.place === 'map' && (
                  <button
                    className="mini text"
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
                    className="mini text"
                    onClick={() => {
                      void shelter(f.id, false).then((err) =>
                        showToast(err ?? `${f.name} вышел из города.`),
                      );
                    }}
                  >
                    Выйти
                  </button>
                )}
                {f.place === 'map' && !f.atHome && (
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
                  <span className="count">{realLeft(secondsLeft(m.arriveAt, worldNow()))}</span>
                </div>
                {/* Мораль отряда между боями (14.31) — живые данные: мир отдаёт её только в живом обзоре. */}
                {m.rest && <div className="desc">{restLine(m.rest, 'Отряд дрался', worldNow())}</div>}
                {m.onCamp ? (
                  // Выручка идёт на полководца, который стоит лагерем: перехватывать некому, отряд и есть цель. Лагерь у него один.
                  <div className="desc">Идут на наш лагерь.</div>
                ) : (
                  <>
                    <div className="desc">Идут от {formatCoord(m.from)}.</div>
                    <div className="cost">
                      {/* Встретить их можно и в поле: точку встречи покажут до приказа. */}
                      <button className="mini text" disabled={inCamp} onClick={() => void openChase(m)}>
                        Перехватить
                      </button>
                    </div>
                    {inCamp && <div className="desc">{CHASE_FROM_CAMP}</div>}
                  </>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {own.length === 0 ? (
        <div className="desc">Походов нет. Выбери цель на карте.</div>
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
                <span className="count">{realLeft(secondsLeft(m.arriveAt, worldNow()))}</span>
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

      <h3>Донесения</h3>
      {reports.length === 0 ? (
        <div className="desc">Донесений нет.</div>
      ) : (
        reports.map((r) => <ReportCard key={r.id} r={r} />)
      )}
    </div>
  );
}
