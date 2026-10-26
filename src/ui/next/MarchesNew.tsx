// «Походы» нового интерфейса (docs/ui_audit.md, 6.2 и 13; UI-7 — docs/ui_v2.md, 5.6, П10): кто идёт на нас, свои люди,
// свои отряды в пути и донесения — таблицами: имя с пояснением, числа столбцами (уровень, бойцы, энергия), действия —
// значками 44 справа. Касание имени человека открывает его карточку; «Послать» — человек в руку и карта: дальше цель,
// дело и подтверждение (Р-4, docs/AGENTS.md, раздел 16 — свободной ходьбы нет); донесений видно восемь свежих, остальные —
// по «Ещё N».
//
// Своих чисел и слов о мире нет: где человек и когда вернётся — `figurePosition`, `secondsLeft` и `realLeft`, как в
// прежнем списке (`panels/MarchesPanel`); мораль отряда — `restLine` (`parts/restWords`), отказ перехвата из лагеря —
// `siege.CHASE_FROM_CAMP`. Прежний список остаётся у прежнего вида.
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { marchesOnUs, ownMarches, useWorld, worldNow } from '@/world/store';
import { troopTotal } from '@/game/battle/kinds';
import { postureOf } from '@/world/muster';
import { formatCoord, secondsLeft } from '@/world/geo';
import { CHASE_FROM_CAMP } from '@/world/siege';
import { takingLine } from '@/world/raidwords';
import { GAIT_META } from '@/world/gait';
import type { FigureId, FigureView, MarchView, ReportKind } from '@/world/types';
import { agentLevel, personName, yearsOf, yearsWord } from '@/game/sim/agents';
import { hireWhere } from '@/game/sim/hire';
import { Icon } from '@/ui/icons/Icon';
import { AgentCard } from '@/ui/parts/AgentCard';
import { restLine } from '@/ui/parts/restWords';
import { lootText, unitsText } from '@/ui/parts/reportWords';
import { realLeft } from '@/ui/parts/wait';
import { Table, type Col } from '@/ui/kit/Table';
import type { IconName } from '@/ui/icons/alias';
import { iconName } from '@/ui/icons/registry';

/** Значок донесения по его виду: набег, разведка, поддержка, оборона дома. */
export const REPORT_ART: Record<ReportKind, IconName> = {
  raid: 'ui-banner',
  scout: 'fig-scout',
  support: 'deal-trade',
  defense: 'ui-home',
};

/** Донесений видно сразу — свежие; остальные — по «Ещё N» (находка карты экранов: «донесения без предела», UI-7). */
export const REPORTS_SHOWN = 8;

// Столбцы таблиц (UI-7, docs/ui_v2.md, 5.6; П10): числа человека — столбцами, а не строкой 11 px через точки.
const PEOPLE_COLS: readonly Col[] = [
  { key: 'who', title: 'Человек' },
  { key: 'lvl', title: 'Ур.', align: 'right', w: '28px' },
  { key: 'men', title: 'Бойц.', align: 'right', w: '40px' },
  { key: 'en', title: 'Эн.', align: 'right', w: '32px' },
  { key: 'act', title: '', align: 'right', w: '92px' },
];
const INCOMING_COLS: readonly Col[] = [
  { key: 'who', title: 'Кто' },
  { key: 'left', title: 'Дойдут', align: 'right', w: '72px' },
  { key: 'act', title: '', align: 'right', w: '44px' },
];
const MARCH_COLS: readonly Col[] = [
  { key: 'who', title: 'Куда' },
  { key: 'left', title: 'Через', align: 'right', w: '72px' },
  { key: 'act', title: '', align: 'right', w: '44px' },
];
const REPORT_COLS: readonly Col[] = [{ key: 'what', title: 'Донесение' }];

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
  // Режим марша полководца (ДР-2) — словом при пути и в поле: «налегке», «с обозом»; обычный — без слова.
  const gait = f.march && f.march.gait !== 'normal' && !f.atHome ? ` · ${GAIT_META[f.march.gait].short}` : '';
  if (f.march && f.march.haltUntil > now) return `стоит, обоз собирают · ${realLeft(secondsLeft(f.march.haltUntil, now))}${gait}`;
  if (f.phase === 'moving') return `в пути · ${realLeft(secondsLeft(f.arriveAt, now))}${gait}`;
  return f.atHome ? 'дома' : `${f.atName ?? 'в поле'}${gait}`;
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
  const openMap = useGame((g) => g.openMap);
  const recallFigure = useWorld((g) => g.recallFigure);
  const shelter = useWorld((g) => g.shelter);
  const setAnchor = useWorld((g) => g.setAnchor);
  const pickFigure = useWorld((g) => g.pick);
  // Карточка человека — страница этой же шторки, как в прежнем списке: закрытая шторка открывается на списке.
  const [card, setCard] = useState<FigureId | null>(null);
  const [all, setAll] = useState(false);
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
  // Чужие отряды, уводящие наших после прорыва (АУ-8, п. 5): догнать можно до самого их двора.
  const taking = marches.filter((m) => m.hostile && m.phase === 'back' && (m.taking ?? 0) > 0).sort((a, b) => a.arriveAt - b.arriveAt);
  // Полководец в лагере осады — перехвата нет: мир откажет той же строкой (`LocalWorld.chaseBlock`).
  const inCamp = (figures.find((f) => f.id === 'general')?.besieging ?? null) !== null;

  return (
    <div className="panel nx-bpanel nx-marches">
      <div className="nx-bhead">
        <span className="nx-bico">
          <Icon name="ui-banner" />
        </span>
        <div className="nx-btitle">
          <b>Походы</b>
          <span className="nx-blvl">{own.length > 0 ? `в пути ${own.length}` : 'все дома'}</span>
        </div>
        <button className="nx-bclose" onClick={closeSheet} aria-label="Закрыть">
          <Icon name="ui-close" />
        </button>
      </div>

      {incoming.length > 0 && (
        <>
          <h3>Идут на нас</h3>
          <Table
            label="Идут на нас"
            cols={INCOMING_COLS}
            rows={incoming.map((m) => ({
              key: m.id,
              cells: {
                who: (
                  <Two
                    top={m.fromName}
                    sub={[m.onCamp ? 'на наш лагерь' : `от ${formatCoord(m.from)}`, m.rest ? restLine(m.rest, 'Отряд дрался', now) : ''].filter(Boolean).join(' · ')}
                  />
                ),
                left: <b className="bad">{realLeft(secondsLeft(m.arriveAt, now))}</b>,
                act: m.onCamp ? null : (
                  <button
                    type="button"
                    className="nx-ico44"
                    disabled={inCamp}
                    onClick={() => void openChase(m)}
                    aria-label={inCamp ? `Перехватить: ${CHASE_FROM_CAMP}` : `Перехватить: ${m.fromName}`}
                  >
                    <Icon name="ui-target" />
                  </button>
                ),
              },
            }))}
          />
          {inCamp && incoming.some((m) => !m.onCamp) && <p className="nx-tnote bad">{CHASE_FROM_CAMP}</p>}
        </>
      )}

      {taking.length > 0 && (
        <>
          <h3>Уводят наших</h3>
          <Table
            label="Уводят наших"
            cols={INCOMING_COLS}
            rows={taking.map((m) => ({
              key: m.id,
              cells: {
                // У идущего домой «куда» — их двор (`turnHome` переставил имена): кто уводит — оттуда.
                who: <Two top={m.toName} sub={takingLine(m, now)} />,
                left: <b className="bad">{realLeft(secondsLeft(m.arriveAt, now))}</b>,
                act: (
                  <button
                    type="button"
                    className="nx-ico44"
                    disabled={inCamp}
                    onClick={() => void openChase(m)}
                    aria-label={inCamp ? `Догнать: ${CHASE_FROM_CAMP}` : `Догнать: ${m.toName}`}
                  >
                    <Icon name="ui-target" />
                  </button>
                ),
              },
            }))}
          />
          <p className="nx-tnote">Догнать и разбить — свои вернутся домой. Дойдут — пленных будут держать до выкупа.</p>
        </>
      )}

      <h3>Люди</h3>
      <p className="nx-tnote">Послать человека: «Послать», цель на карте, дело и «Отправить». Сделав дело, он сам вернётся домой.</p>
      <Table
        label="Люди"
        cols={PEOPLE_COLS}
        rows={figures.map((f) => {
          const men = troopTotal(f.troops);
          const named = f.place !== 'vacant' && s.agents[f.id].name;
          const where = [
            whereWords(f, now, hireWhere(s, f.id)),
            men > 0 && postureOf(f) === 'stands' ? 'в гарнизоне' : '',
            f.watching ? 'смотрит' : '',
            f.spent ? 'выбился из сил' : '',
            f.place !== 'vacant' ? yearsWord(yearsOf(s, f.id)) : '',
          ]
            .filter(Boolean)
            .join(' · ');
          return {
            key: f.id,
            dim: f.place === 'down' || f.place === 'vacant',
            cells: {
              who: (
                <button type="button" className="mr-who" onClick={() => setCard(f.id)} aria-label={`${f.name}: карточка`}>
                  <Icon name={iconName('fig', f.id)} />
                  <Two top={`${f.name}${named ? ` ${personName(s, f.id)}` : ''}`} sub={where} />
                </button>
              ),
              lvl: f.place !== 'vacant' ? agentLevel(s, f.id) : '—',
              men: men > 0 ? men : '—',
              // Энергия числом двери (docs/agent_energy.md): шкала и сроки — в карточке человека.
              en: f.energy ? f.energy.value : '—',
              act: (
                <span className="mr-acts">
                  {f.place === 'map' && !f.atHome && (
                    <button type="button" className="nx-ico44" onClick={() => void recallFigure(f.id).then((err) => err && showToast(err))} aria-label={`${f.name}: домой`}>
                      <Icon name="ui-home" />
                    </button>
                  )}
                  {(f.place === 'map' || f.place === 'city') && (
                    <button
                      type="button"
                      className="nx-ico44"
                      aria-label={`${f.name}: послать`}
                      onClick={() => {
                        // Человек в руку, камера к нему: следующее касание — цель на карте, потом дело и «Отправить».
                        closeSheet();
                        openMap();
                        setAnchor(f.id);
                        pickFigure(f.id);
                        showToast(`${f.name}: нажми цель на карте — город, логово или отряд.`);
                      }}
                    >
                      <Icon name="ui-target" />
                    </button>
                  )}
                  {f.place === 'city' && (
                    <button
                      type="button"
                      className="nx-ico44"
                      aria-label={`${f.name}: выйти из города`}
                      onClick={() => void shelter(f.id, false).then((err) => showToast(err ?? `${f.name} вышел из города.`))}
                    >
                      <Icon name="maze-door" />
                    </button>
                  )}
                </span>
              ),
            },
          };
        })}
      />

      <h3>В пути</h3>
      <Table
        label="В пути"
        cols={MARCH_COLS}
        empty="Походов нет. Выбери цель на карте."
        rows={own.map((m) => {
          // У возвращающегося интересно место, откуда он идёт; отозванный стоит между клетками.
          const at = m.phase === 'back' ? { x: Math.round(m.from.x), y: Math.round(m.from.y) } : { x: m.to.x, y: m.to.y };
          return {
            key: m.id,
            cells: {
              who: (
                <button type="button" className="mr-who" onClick={() => void select(at)} aria-label={`${m.toName}: на карте`}>
                  <Icon name={m.mission === 'scout' ? 'fig-scout' : 'ui-banner'} />
                  <Two top={m.toName} sub={`${PHASE[m.phase]} · ${unitsText(m.units)}${m.loot ? ` · везут ${lootText(m.loot)}` : ''}`} />
                </button>
              ),
              left: <b>{realLeft(secondsLeft(m.arriveAt, now))}</b>,
              act: m.recallable ? (
                <button type="button" className="nx-ico44" onClick={() => void recall(m.id)} aria-label={`Отозвать: ${m.toName}`}>
                  <Icon name="ui-home" />
                </button>
              ) : null,
            },
          };
        })}
      />

      <h3>
        Донесения {reports.length > REPORTS_SHOWN && <span className="muted">последние {all ? reports.length : REPORTS_SHOWN} из {reports.length}</span>}
      </h3>
      <Table
        label="Донесения"
        cols={REPORT_COLS}
        empty="Донесений нет."
        rows={(all ? reports : reports.slice(0, REPORTS_SHOWN)).map((r) => {
          const art = REPORT_ART[r.kind];
          return {
            key: r.id,
            go: () => openReport(r.id),
            goLabel: r.title,
            cells: {
              what: (
                <span className={`kit-name${r.won ? '' : ' lost'}`}>
                  <Icon name={art} />
                  <Two top={r.title} sub={r.text} />
                  {!r.read && <i className="nx-new" aria-label="новое" />}
                </span>
              ),
            },
          };
        })}
      />
      {reports.length > REPORTS_SHOWN && (
        <button className="btn ghost wide" onClick={() => setAll(!all)}>
          {all ? 'Свернуть' : `Ещё ${reports.length - REPORTS_SHOWN}`}
        </button>
      )}
    </div>
  );
}

/** Две строки ячейки: имя и пояснение 11 px. */
function Two({ top, sub }: { top: string; sub: string }) {
  return (
    <span className="kit-two">
      <b className="one-line">{top}</b>
      {sub && <small className="one-line">{sub}</small>}
    </span>
  );
}

