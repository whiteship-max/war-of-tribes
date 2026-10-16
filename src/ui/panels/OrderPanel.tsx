// Справка о порядке из строки состояния и из строки тревоги. Все числа — из
// `orderBreakdown` и `mutinyForecast`, оттуда же, откуда их берёт симуляция:
// своей арифметики у панели нет, иначе она однажды покажет не то, что будет.
//
// Порядок устроен так, чтобы его цена стояла до того, как наступит, — как у
// голода под осадой. Поэтому сверху не только число, но и срок ропота, и чем
// кончится мятеж при нынешней страже, и рычаги, которыми это меняют.
//
// Две вкладки (решение владельца 16.10.2026, docs/ui_v2.md, 6.13 и 5.7): **«Надзор»** — кто держит невольников, цена
// мятежа и рычаги; **«Невольники»** — где они стоят, отпуск и продажа (`parts/Bonded`: прежде раздел «Жителей», UI-5).
// Вместе окно было в полтора экрана, каждая вкладка — меньше экрана. Шкала и срок ропота — над вкладками: их видно с
// обеих. Пороги шкалы — словами (`kit/Bar`, Ч12): две риски без подписи были загадкой. Окно едет в куске нового вида
// (`ui/next/index.ts`): оно стоит на наборе `kit`.
import { useState } from 'react';
import { create } from 'zustand';
import { useGame } from '@/game/store';
import { MUTINY_FUSE, MUTINY_SUPPRESS_MORALE, ORDER_UNREST, ORDER_WARN } from '@/game/constants';
import { ORDER_TEXT, clockText } from '@/game/data/order';
import {
  armySize,
  bondedIncoming,
  bondedTotal,
  buildingOfType,
  homeArmy,
  mutinyForecast,
  orderBreakdown,
  orderState,
  unrestLeft,
} from '@/game/derived';
import { realSpanText, waitMinSec } from '../parts/wait';
import { asGame } from '@/game/pace';
import { EVENT_TTL } from '@/game/sim/mail';
import { plural } from '../parts/plural';
import { Icon } from '@/ui/icons/Icon';
import { Bar } from '@/ui/kit/Bar';
import { Tabs, type TabDef } from '@/ui/kit/SheetPage';
import { Table, type Col } from '@/ui/kit/Table';
import { BondedPlaces, BondedRelease } from '../parts/Bonded';
import { dec } from '@/game/num';

const fmt = (n: number): string => (n >= 10 ? String(Math.round(n)) : dec(n, 1));

/** Вкладки окна порядка. */
export type OrderView = 'watch' | 'bonded';

/**
 * Какая вкладка открыта. Живёт, пока жива партия на экране: вернулся в «Порядок» — вкладка та же. Дверь «Невольники» из
 * «Жителей» открывает окно сразу на «Невольниках» (`PeoplePanel`): туда ведёт её слово. Окно читает её один раз, когда
 * открывается, и пишет при смене вкладки.
 */
export const useOrderView = create<{ view: OrderView; set: (v: OrderView) => void }>((set) => ({
  view: 'watch',
  set: (view) => set({ view }),
}));

/** Пороги шкалы — словами: ниже `ORDER_WARN` надзор держит не всех, ниже `ORDER_UNREST` — ропот. */
export const ORDER_MARKS = [
  { at: ORDER_UNREST, label: 'ропот' },
  { at: ORDER_WARN, label: 'надзора мало' },
] as const;

const HOLD_COLS: readonly Col[] = [
  { key: 'who', title: 'Кто держит' },
  { key: 'n', title: 'Надзор', align: 'right', w: '64px' },
];

export function OrderPanel() {
  const s = useGame((g) => g.s);
  const [view, setLocal] = useState<OrderView>(() => useOrderView.getState().view);
  const setView = (v: OrderView): void => {
    setLocal(v);
    useOrderView.getState().set(v);
  };
  const o = orderBreakdown(s);
  const state = orderState(s);
  const left = unrestLeft(s);
  const value = Math.round(o.value);
  const bonded = bondedTotal(s) + bondedIncoming(s);
  const tabs: TabDef<OrderView>[] = [
    { id: 'watch', label: 'Надзор' },
    { id: 'bonded', label: ORDER_TEXT.bondedName, badge: bonded },
  ];

  return (
    <div className="panel">
      <h2>
        {ORDER_TEXT.icon} {ORDER_TEXT.name} <small>{value} из 100</small>
      </h2>
      <Bar
        value={value}
        max={100}
        tone={state === 'unrest' ? 'bad' : state === 'shaky' ? 'warn' : 'good'}
        marks={ORDER_MARKS}
        label={ORDER_TEXT.state[state]}
      />

      {left !== null && (
        <div className="mod total order-clock">
          <span className="ico">{ORDER_TEXT.mutiny.icon}</span>
          <span className="name">
            До мятежа
            <em className="sub">при порядке от {ORDER_UNREST} ропот стихает</em>
          </span>
          <span className="val neg">{clockText(left)}</span>
        </div>
      )}

      <Tabs tabs={tabs} value={view} onChange={setView} />
      {view === 'watch' ? <Watch /> : <Bonded />}
    </div>
  );
}

/** «Надзор»: цена мятежа, кто держит невольников, рычаги. */
function Watch() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const openMap = useGame((g) => g.openMap);
  const o = orderBreakdown(s);
  const f = mutinyForecast(s);
  const tavern = buildingOfType(s, 'tavern');
  const barracks = buildingOfType(s, 'barracks');
  const home = homeArmy(s);
  const all = armySize(s);

  return (
    <>
      {o.bonded > 0 && (
        <>
          <h3>Если начнётся мятеж</h3>
          {/* Цена — до того, как наступит. Словами из одного места с тревогой и окном. */}
          <div className={`note${f.holds ? '' : ' bad'}`}>
            {ORDER_TEXT.price({ holds: f.holds, bonded: f.bonded, flee: f.flee, leave: f.leave })}
          </div>
          <div className="mod">
            <span className="ico">⚔️</span>
            <span className="name">
              Стража дома
              <em className="sub">
                мощь {Math.round(f.power)}, подавит до {f.crush}{' '}
                {plural(f.crush, 'невольника', 'невольников', 'невольников')}, мораль −{MUTINY_SUPPRESS_MORALE}
              </em>
            </span>
            <span className="val">{f.guards}</span>
          </div>
          <div className="note">
            {ORDER_TEXT.mutiny.rule(waitMinSec(asGame(MUTINY_FUSE)), realSpanText(EVENT_TTL / 1000))}
          </div>
        </>
      )}

      {/* Кто держит невольников — таблицей: строка — слагаемое надзора, касание — что это; итог — против невольников. */}
      <h3>Кто держит невольников</h3>
      <Table
        label="Кто держит невольников"
        cols={HOLD_COLS}
        rows={o.lines.map((l) => ({
          key: l.id,
          cells: {
            who: (
              <span className="kit-name">
                <span className="ic">{l.icon}</span>
                <span className="one-line">{l.name}</span>
              </span>
            ),
            n: <b className="pos">{fmt(l.value)}</b>,
          },
          tip: () => ({ title: l.name, body: l.hint }),
        }))}
        total={{
          who: `Надзор ${Math.floor(o.hold)} — держит ${ORDER_TEXT.bondedName.toLowerCase()}`,
          n: <b className={o.bonded > o.hold ? 'neg' : ''}>{o.bonded}</b>,
        }}
      />

      <h3>Что делать</h3>
      {home < all ? (
        <>
          <button className="btn ghost wide" onClick={openMap}>
            <Icon name="hud-army" glyph="⚔️" /> Вернуть домой
          </button>
          <div className="note">Дома {home} из {all}</div>
        </>
      ) : (
        <div className="note">Вся дружина дома.</div>
      )}
      {barracks && (
        <button className="btn ghost wide" onClick={() => openBuilding(barracks.id)}>
          <Icon name="bld-barracks" glyph="🛡️" /> Нанять
        </button>
      )}
      {tavern && (
        <button className="btn ghost wide" onClick={() => openBuilding(tavern.id)}>
          <Icon name="bld-tavern" glyph="🍺" /> Устроить пир
        </button>
      )}
      <div className="note">{ORDER_TEXT.notMorale}</div>
    </>
  );
}

/** «Невольники»: где стоят, отпуск и продажа — одно дело, одно место. */
function Bonded() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const market = buildingOfType(s, 'market');
  return (
    <>
      <BondedPlaces />
      {bondedTotal(s) > 0 && (
        <>
          <h3>Что делать</h3>
          <BondedRelease />
          {market && (
            <button className="btn ghost wide" onClick={() => openBuilding(market.id)}>
              <Icon name="bld-market" glyph="🛒" /> Продать
            </button>
          )}
        </>
      )}
    </>
  );
}
