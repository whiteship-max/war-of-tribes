// Окно осады глазами обороняющегося: кто стоит у ворот, чем кончится голод и чем
// ответить. Одно окно вместо разбросанных мест — плашки в углу деревни, карточки
// лагеря и меню полководца: те стали входами в него, а экран вылазки — формой одного
// из его действий.
//
// Главная строка — объявленная участь. По ней осаждённый решает, спасать город или
// махнуть рукой, и стоит она первой после шапки.
//
// С UI-7 (docs/ui_v2.md, 5.6; П4) окно — вкладками «Осада · Ответы · Условия · Ход», строки — таблицами набора; едет в
// куске нового вида, а не в первой загрузке.
//
// Своей арифметики у окна нет ни в одном числе. Срок — мировые часы (`starvesAt`),
// потеря при падении — та же дверь участи, что у падения (`SiegeView.fall`), стороны
// лагеря — та же `throughWorks`, что у боя (`works.campSides`, `works.sortieForecast`),
// удар полководца — план мира (`CampStrike`).
import { useEffect, useMemo, useState } from 'react';
import { useGame } from '@/game/store';
import { SIEGE_FOOD_YIELD, SIEGE_YIELD } from '@/game/constants';
import { useWorld, worldNow } from '@/world/store';
import { awayOf, homeOf } from '@/world/muster';
import { troopTotal } from '@/game/battle/kinds';
import { kindsOf } from '@/game/battle/price';
import { realLeft } from '@/ui/parts/wait';
import { REST_WHY, restLine, wearLine } from '@/ui/parts/restWords';
import { hungerLeft } from '@/ui/parts/hunger';
import { sideReady } from '@/ui/parts/campSide';
import { profileCity } from '@/profile/identity';
import { FATE_META } from '@/world/data/fates';
import { SIDES, SIDE_NAME, WEAK_HINT, campSides, gateBusyText, refusedAtGate, sortieForecast, weakSide } from '@/world/works';
import { NO_GARRISON } from '@/world/siege';
import type { FallForecast, Fate } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { CampStrike } from '@/ui/parts/CampStrike';
import { plural } from '@/ui/parts/plural';
import { num } from '@/game/num';
import { SiegePhases } from '@/ui/parts/SiegePhases';
import { SiegeAnswers } from '@/ui/parts/SiegeAnswers';
import { SiegeParley } from '@/ui/parts/SiegeParley';
import { bondedWord, townsWord } from '@/game/data/order';
import { Table, type Col } from '@/ui/kit/Table';
import { Tabs, type TabDef } from '@/ui/kit/SheetPage';
import { Btn } from '@/ui/kit/Btn';
import './siege.css';

const byLevels = (n: number): string => `до ${n} ${plural(n, 'уровня', 'уровней', 'уровней')}`;
const goodsAndGold = (f: FallForecast): string => `${f.goods} запасов${f.gold > 0 ? ` и ${f.gold} золота` : ''}`;

/** Что потеряет город, если хлеб кончится, — словами окна. Числа приходят из мира. */
export function fallWords(fate: Fate, f: FallForecast): string[] {
  const out: string[] = [];
  if (fate === 'burn') {
    out.push(`сгорит ${goodsAndGold(f)}, в тайнике уцелеет ${f.hidden}.`);
    if (f.scatterPop > 0) out.push(`Разойдутся ${f.scatterPop} ${townsWord(f.scatterPop)}.`);
    if (f.scatterBonded > 0) out.push(`Разбегутся ${f.scatterBonded} ${bondedWord(f.scatterBonded)}.`);
    out.push(`Постройки, кроме тайника, потеряют ${byLevels(f.levels)}, начатая стройка сгорит.`);
  } else {
    out.push(`унесут ${goodsAndGold(f)}, в тайнике уцелеет ${f.hidden}.`);
    const people = [
      f.ledBonded > 0 ? `${f.ledBonded} ${bondedWord(f.ledBonded)}` : '',
      f.ledPop > 0 ? `${f.ledPop} ${townsWord(f.ledPop)}` : '',
    ].filter(Boolean);
    if (people.length > 0) out.push(`Уведут ${people.join(' и ')}.`);
    if (f.buildings > 0) {
      out.push(
        `${f.buildings} ${plural(f.buildings, 'постройка потеряет', 'постройки потеряют', 'построек потеряют')} ${byLevels(f.levels)}.`,
      );
    }
  }
  if (f.routed > 0) out.push(`Разойдутся ${f.routed} ${plural(f.routed, 'боец', 'бойца', 'бойцов')} гарнизона.`);
  return out;
}

type View = 'siege' | 'answers' | 'parley' | 'phases';

/** Столбцы «Хлеб и оборона» и «Лагерь у ворот» (UI-7, docs/ui_v2.md, 5.6): строки `.mod` — таблицами набора. */
const HOLD_COLS: readonly Col[] = [
  { key: 'what', title: 'Хлеб и оборона' },
  { key: 'v', title: 'Сейчас', align: 'right', w: '96px' },
];
const SIDE_COLS: readonly Col[] = [
  { key: 'side', title: 'Лагерь у ворот' },
  { key: 'pass', title: 'Пройдут', align: 'right', w: '112px' },
];

export function SiegePanel() {
  const s = useGame((g) => g.s);
  const openSortie = useGame((g) => g.openSortie);
  const siege = useWorld((g) => g.siege);
  const homeId = useWorld((g) => g.info?.homeId ?? null);
  const marches = useWorld((g) => g.marches);
  const figures = useWorld((g) => g.figures);
  const home = useMemo(() => homeOf(s.army, awayOf(marches, figures)), [s, marches, figures]);
  const [view, setView] = useState<View>('siege');
  const [, retick] = useState(0);

  // Часы голода и рогатки идут сами: замерший отсчёт читается как сломанный экран.
  useEffect(() => {
    if (!siege) return;
    const t = setInterval(() => retick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [siege]);

  if (!siege) {
    return (
      <div className="panel">
        <div className="bhead">
          <div className="ico"><Icon name="stage-camp" /></div>
          <div className="body">
            <div className="name">Осады нет</div>
            <div className="lvl">под стенами никого</div>
          </div>
        </div>
        <p className="note">Город снова ест.</p>
      </div>
    );
  }

  const now = worldNow();
  const meta = FATE_META[siege.fate];
  // Третий ответ на осаду: башня бьёт по лагерю, не выходя за стены. Числа — из мира.
  const fire = siege.fire;
  const sides = campSides(siege, now);
  const weak = weakSide(siege.since, now, siege.wood);
  // Весь гарнизон через фронт — сколько пробьётся, если выйти сейчас.
  const all = sortieForecast(siege, kindsOf(home), now).now;
  const garrisonMen = troopTotal(home);
  const sortieBlock =
    garrisonMen === 0 ? 'В гарнизоне никого' : refusedAtGate(all) ? gateBusyText(all.waitMs) : null;
  // Вкладки (П4: окно осады было длиннейшим в игре — 2,3 экрана на стенде): осада и главное действие — первой; ответы,
  // переговоры («Условия»: дань и сдача) и ход фаз — своими, если мир их прислал. Предложение, ждущее ответа, — счётчиком.
  const tabs: TabDef<View>[] = [
    { id: 'siege', label: 'Осада' },
    ...(siege.answers ? [{ id: 'answers' as const, label: 'Ответы' }] : []),
    ...(siege.parley ? [{ id: 'parley' as const, label: 'Условия', badge: siege.parley.incoming ? 1 : 0 }] : []),
    ...(siege.phases ? [{ id: 'phases' as const, label: 'Ход' }] : []),
  ];
  const shown = tabs.some((t) => t.id === view) ? view : 'siege';

  return (
    <div className="panel sg">
      <div className="bhead">
        <div className="ico">
          <Icon name="letter-siege" />
        </div>
        <div className="body">
          <div className="name one-line">«{profileCity(s.profile)}» в осаде</div>
          <div className="lvl">
            «{siege.byName}» у ворот · в лагере {siege.campMen} {plural(siege.campMen, 'боец', 'бойца', 'бойцов')}
          </div>
        </div>
      </div>
      {tabs.length > 1 && <Tabs tabs={tabs} value={shown} onChange={setView} />}

      {shown === 'siege' && (
        <>
          {/* Главная строка окна: что с городом сделают, если его доедят. */}
          <div className="card danger">
            <div className="ico"><Icon name={meta.icon} /></div>
            <div className="body">
              <div className="title">Объявлено: {meta.name.toLowerCase()}</div>
              <div className="desc">Кончится хлеб — {fallWords(siege.fate, siege.fall).join(' ')} Случится и без тебя.</div>
            </div>
          </div>

          <Table
            label="Хлеб и оборона"
            cols={HOLD_COLS}
            rows={[
              {
                key: 'food',
                tip: () => ({
                  title: `Своей еды хватит на ${hungerLeft(siege.starvesAt, now)}`,
                  body: `Гарнизон ${siege.garrison} тоже ест. В осаде хлеб ${SIEGE_FOOD_YIELD === 0 ? 'не идёт' : `×${SIEGE_FOOD_YIELD}`}, прочее −${Math.round((1 - SIEGE_YIELD) * 100)}%.`,
                }),
                cells: { what: 'Своей еды хватит на', v: <b className="bad">{hungerLeft(siege.starvesAt, now)}</b> },
              },
              // Хлеб в городе — остаток окна осады, тот же, что решит голод (docs/siege_v2.md, 21.1): склад выше не держит.
              ...(siege.bread !== undefined
                ? [
                    {
                      key: 'bread',
                      tip: () => ({
                        title: `Хлеба в городе ${num(siege.bread ?? 0)}`,
                        body: `Было ${num(siege.foodAtStart)}, когда встал лагерь. Голод — когда хлеба не останется: тогда город падёт, и в обоз хлеба не положат.`,
                      }),
                      cells: { what: 'Хлеба в городе', v: num(siege.bread) },
                    },
                  ]
                : []),
              { key: 'garrison', cells: { what: 'Гарнизон ест с городом', v: `${siege.garrison} ${plural(siege.garrison, 'боец', 'бойца', 'бойцов')}` } },
              { key: 'walls', cells: { what: 'Стены', v: `ур. ${siege.palisade}` } },
              ...(fire
                ? [
                    {
                      key: 'fire',
                      tip: () => ({
                        title: 'Башня бьёт по лагерю',
                        body: fire.slow > 0 ? `Рогатки со стороны города растут медленнее на ${Math.round(fire.slow * 100)}%.` : undefined,
                      }),
                      cells: {
                        what: 'Башня бьёт по лагерю',
                        v: <span className="good">{`${Math.round(fire.thin * 100)}% из ${Math.round(fire.cap * 100)}%`}</span>,
                      },
                    },
                  ]
                : []),
            ]}
          />

          <Table
            label="Лагерь у ворот"
            cols={SIDE_COLS}
            rows={SIDES.map((side) => {
              const t = sides[side];
              return {
                key: side,
                cells: {
                  side: (
                    <span className="kit-two">
                      <b className="one-line">{SIDE_NAME[side]}</b>
                      <small className="one-line">{sideReady(t, now)}</small>
                    </span>
                  ),
                  pass: t.room >= 1 ? `${t.room < Infinity ? t.room : 'все'}` : `через ${realLeft(t.waitMs / 1000)}`,
                },
              };
            })}
          />
          <p className="note">
            Кто не пройдёт, встанет у рогаток.
            {weak ? ` ${WEAK_HINT[weak]}` : ''}
          </p>
          {/* Дела полководца в лагере (world/siegecraft): лагерь укреплён, город обстреливают — словами мира. */}
          {siege.craftNote && <p className="note warn">{siege.craftNote}</p>}
          {siege.machineNote && <p className="note warn">{siege.machineNote}</p>}
          {/* Мораль между боями (14.31): уставший лагерь бить лучше сейчас, уставшему гарнизону — дать отдохнуть. */}
          {siege.campRest && <p className="note">{restLine(siege.campRest, 'Лагерь дрался', now)} Бей, пока не отдохнул.</p>}
          {siege.garrisonRest && (
            <p className="note warn">
              {restLine(siege.garrisonRest, 'Гарнизон дрался', now)} {REST_WHY}
            </p>
          )}
          {/* Износ осады (дни под стенами и залпы лагеря) — тем числом, с которым гарнизон идёт в бой у мира и у сервера войны. */}
          {siege.wear !== undefined && <p className="note warn">{wearLine(siege.wear)}</p>}

          <h3>Что делать</h3>
          <Btn kind="main" wide why={sortieBlock} onClick={() => openSortie()}>
            Вылазка{garrisonMen > 0 ? ` · ${all.passed} из ${all.went}` : ''}
          </Btn>
          {/* Пустой гарнизон: в осаде новобранцев не набрать — в казармы окно не зовёт, а говорит, что есть (siege_audit, 1). */}
          {garrisonMen === 0 && <p className="note">{NO_GARRISON}</p>}
          {homeId && <CampStrike target={homeId} />}
          <p className="note">Разбитый лагерь снимает осаду, и город снова ест.</p>
        </>
      )}

      {/* Ответы осаждённого (docs/siege_v2.md, раздел 5): починка, паёк, вылазка на машину, выручка, наказы, сдача. */}
      {shown === 'answers' && <SiegeAnswers siege={siege} now={now} />}
      {/* Переговоры у стен (docs/siege_v2.md, раздел 7): дань за снятие, ответ на условия, наказ — числа из мира. */}
      {shown === 'parley' && siege.parley && <SiegeParley view={siege.parley} fate={siege.fate} now={now} defend={siege.answers?.defend} />}
      {/* Ход осады фазами (world/siegeroll): тот же журнал, что у осаждающего, и поправки следующей фазы. */}
      {shown === 'phases' && siege.phases && <SiegePhases phases={siege.phases} now={now} />}
    </div>
  );
}
