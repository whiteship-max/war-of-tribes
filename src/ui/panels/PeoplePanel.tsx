// Окно «Жители» (UI-5, docs/ui_v2.md, 5.4). Прежде — набор полос без цели: свободные руки, прирост тремя полосами (вторая
// копия окна «Прирост»), дружина карточками (вторая копия «Дружины»), невольники с отпуском и «кто чем занят». Теперь в нём
// то, ради чего его открывают, — двумя вкладками (окно — один экран, docs/ui_v2.md, 2.1):
//
// - «Сводка» — одна таблица: люди, жильё, прирост, мораль, оборона. Касание строки — разбор числа (те же подсказки, что у
//   верха), «›» — к источнику: окно числа или постройка, которая его делает. Ниже — строки-ссылки на то, что не про
//   жителей: «Дружина» и «Невольники» (их окна — «Дружина» и «Порядок»).
// - «Работы» — свободные руки и места работы: каждая постройка с местами — сколько жителей на местах и сколько мест
//   свободно; касание строки открывает постройку, где людей ставят. «Кто чем занят» прежнего окна — те же строки.
//
// Счётчик низа «Жители» — свободные руки, пока нет стройки (`next/Nav`); с ним окно открывается на «Работах» — там, где
// их ставят. Числа и разборы — `next/people.ts` (чистые функции, тест — `people.test.ts`). Окно едет в куске нового вида
// (`ui/next/index.ts`): оно стоит на наборе `kit` и подсказках верха.
import { useState } from 'react';
import { useGame } from '@/game/store';
import { ORDER_TEXT } from '@/game/data/order';
import {
  armyPower,
  armySize,
  bondedIncoming,
  bondedTotal,
  buildingTitle,
  currentSite,
  housingCapacity,
  idleCount,
  orderValue,
  recruitsQueued,
} from '@/game/derived';
import { Icon } from '@/ui/icons/Icon';
import { Table, type Col } from '@/ui/kit/Table';
import { Row } from '@/ui/kit/Row';
import { Tabs, type TabDef } from '@/ui/kit/SheetPage';
import { goTo } from '@/ui/kit/nav';
import { WINDOW, sourceWord } from '@/ui/kit/sources';
import { fmtInt, type TipGo } from '@/ui/next/hudTips';
import { idleTip, summaryLines, workplaces } from '@/ui/next/people';
import { count } from '../parts/plural';
import { useOrderView } from './OrderPanel';
import '@/ui/next/people.css';
import type { IconName } from '@/ui/icons/alias';
import { iconName } from '@/ui/icons/registry';

type View = 'sum' | 'work';

/** Имя строки таблицы: значок, имя и строка пояснения 11 px. */
function Name({ icon, label, sub }: { icon: IconName; label: string; sub: string }) {
  return (
    <span className="pp-name">
      <span className="kit-ico">
        <Icon name={icon} />
      </span>
      <span>
        <b>{label}</b>
        {sub && <small>{sub}</small>}
      </span>
    </span>
  );
}

const SUM_COLS: readonly Col[] = [
  { key: 'what', title: 'Показатель' },
  { key: 'now', title: 'Сейчас', align: 'right', w: '64px' },
];

const WORK_COLS: readonly Col[] = [
  { key: 'what', title: 'Постройка' },
  { key: 'people', title: 'Люди', align: 'right', w: '44px' },
  { key: 'free', title: 'Мест', align: 'right', w: '44px' },
];

/** Сводка: пять чисел с разбором и дверью; ниже — то, что не про жителей, строками-ссылками в их окна. */
function Summary({ go }: { go: TipGo }) {
  const s = useGame((g) => g.s);
  const lines = summaryLines(s, go);
  const army = armySize(s);
  const training = recruitsQueued(s);
  const bonded = bondedTotal(s);
  const incoming = bondedIncoming(s);
  const armySub =
    army > 0
      ? `${count(army, 'боец', 'бойца', 'бойцов')} · мощь ${fmtInt(Math.round(armyPower(s)))}${training > 0 ? ` · учатся ${fmtInt(training)}` : ''}`
      : training > 0
        ? `учатся ${fmtInt(training)}`
        : 'бойцов нет — их нанимают в казармах';
  const bondedSub =
    bonded > 0
      ? `порядок ${Math.round(orderValue(s))}${incoming > 0 ? ` · ведут ещё ${fmtInt(incoming)}` : ''}`
      : incoming > 0
        ? `ведут торговцы ${fmtInt(incoming)}`
        : 'нет — их приводят на рынок торговцы';
  return (
    <>
      <Table
        label="Сводка"
        cols={SUM_COLS}
        rows={lines.map((l) => ({
          key: l.key,
          cells: {
            what: <Name icon={l.icon} label={l.label} sub={l.sub} />,
            now: <b className={`pp-val${l.tone ? ` ${l.tone}` : ''}`}>{l.value}</b>,
          },
          tip: l.tip,
          go: () => goTo(l.to),
          goLabel: `${l.label}: ${sourceWord(l.to)}`,
        }))}
      />
      <h3>В своих окнах</h3>
      <Row
        icon={'hud-army'}
        label="Дружина"
        sub={armySub}
        value={fmtInt(army)}
        go={() => goTo(WINDOW.army)}
        goLabel={sourceWord(WINDOW.army)}
      />
      <Row
        icon={'hud-order'}
        label={ORDER_TEXT.bondedName}
        sub={bondedSub}
        value={fmtInt(bonded)}
        go={() => {
          // Слово строки — «Невольники»: окно «Порядка» открывается на их вкладке (UI-8, docs/ui_v2.md, 6.13).
          useOrderView.getState().set('bonded');
          goTo(WINDOW.order);
        }}
        goLabel={sourceWord(WINDOW.order)}
      />
    </>
  );
}

/** Работы: свободные руки и места — куда их поставить. */
function Work() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const idle = idleCount(s);
  const site = currentSite(s);
  const places = workplaces(s);
  return (
    <>
      <Row
        icon={'ui-hammer'}
        label="Свободные руки"
        sub={site ? `строят: ${buildingTitle(s, site.type)} до ур. ${site.level + 1}` : 'без стройки отдыхают на площади'}
        value={fmtInt(idle)}
        tone={idle > 0 && !site ? 'warn' : undefined}
        tip={() => idleTip(s)}
      />
      <Table
        label="Места работы"
        cols={WORK_COLS}
        rows={places.map((p) => ({
          key: p.key,
          cells: {
            what: <Name icon={iconName('bld', p.type)} label={p.name} sub={p.sub} />,
            people: fmtInt(p.people),
            free: p.free === null ? '∞' : p.free > 0 ? <b className="pp-free">{fmtInt(p.free)}</b> : '—',
          },
          go: p.id !== null ? () => openBuilding(p.id!) : undefined,
          goLabel: `${p.name}: поставить людей`,
        }))}
        empty="Мест работы нет."
      />
      <div className="note">Людей ставят в окне постройки: строка ведёт туда. На площади — вольный сбор вполсилы, без предела мест.</div>
    </>
  );
}

export function PeoplePanel() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const idle = idleCount(s);
  const site = currentSite(s);
  // С тем же счётчиком, что у низа, окно открывается там, где руки ставят; без него — на сводке.
  const [view, setView] = useState<View>(() => (idle > 0 && !site ? 'work' : 'sum'));
  const go: TipGo = {
    tab: (t) => goTo({ kind: 'tab', tab: t }),
    building: openBuilding,
    realm: (v) => goTo({ kind: 'realm', view: v }),
    to: goTo,
  };
  const tabs: readonly TabDef<View>[] = [
    { id: 'sum', label: 'Сводка' },
    { id: 'work', label: 'Работы', badge: site ? 0 : idle },
  ];
  return (
    <div className="panel pp">
      <h2>
        Жители{' '}
        <small>
          {fmtInt(s.pop)} из {fmtInt(housingCapacity(s))}
        </small>
      </h2>
      <Tabs tabs={tabs} value={view} onChange={setView} />
      {view === 'sum' ? <Summary go={go} /> : <Work />}
    </div>
  );
}
