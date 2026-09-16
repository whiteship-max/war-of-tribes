// План, приказы и резерв. По одному приказу на род войск — не больше: интерфейс
// должен оставаться читаемым, а не превращаться в пульт. Последствия написаны
// словами на самой кнопке, а не в подсказке под ней.
import { useState } from 'react';
import {
  ARCHER_ORDER_NAME,
  CAVALRY_ORDER_NAME,
  INFANTRY_ORDER_NAME,
  KIND_META,
  PLAN_IDS,
  PLAN_META,
  RESERVE_NAME,
  RESERVE_TRIGGERS,
  SPEAR_ORDER_NAME,
  sameTrigger,
  type Orders,
  type Plan,
  type ReserveTrigger,
  type UnitKind,
} from '@/battle';

const ORDER_LIST: Record<UnitKind, Record<string, string>> = {
  spear: SPEAR_ORDER_NAME,
  infantry: INFANTRY_ORDER_NAME,
  archer: ARCHER_ORDER_NAME,
  cavalry: CAVALRY_ORDER_NAME,
};

const PLAN_ICON: Record<Plan, string> = {
  defense: '🛡️',
  assault: '⚔️',
  envelop: '🌙',
  'cavalry-strike': '🐎',
  attrition: '🏹',
  aggressive: '🔥',
};

export function PlanPicker({ value, onChange }: { value: Plan; onChange: (p: Plan) => void }) {
  return (
    <div className="choice">
      {PLAN_IDS.map((id) => (
        <button
          key={id}
          className={`choice-opt${value === id ? ' on' : ''}`}
          data-tut={`plan-${id}`}
          onClick={() => onChange(id)}
        >
          <span className="ico">{PLAN_ICON[id]}</span>
          <b>{PLAN_META[id].name}</b>
          <small>{PLAN_META[id].effect}</small>
        </button>
      ))}
    </div>
  );
}

/**
 * Приказ роду войск. Свёрнут в одну строку: развёрнутый список всех вариантов
 * (`*_ORDERS` в `battle/config.ts`) на каждый из четырёх родов занял бы весь экран, а приказ игрок меняет редко.
 */
function OrderRow({
  kind,
  value,
  onChange,
}: {
  kind: UnitKind;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const list = ORDER_LIST[kind];
  return (
    <div className="bf-order">
      <button className="bf-order-head" onClick={() => setOpen((v) => !v)}>
        <span className="ico">{KIND_META[kind].icon}</span>
        <span className="who">
          {KIND_META[kind].name}
          <i className="talent">{list[value]}</i>
        </span>
        <span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="choice">
          {Object.entries(list).map(([id, name]) => (
            <button
              key={id}
              className={`choice-opt${value === id ? ' on' : ''}`}
              onClick={() => {
                onChange(id);
                setOpen(false);
              }}
            >
              <span className="ico">{value === id ? '●' : '○'}</span>
              <b>{name}</b>
            </button>
          ))}
        </div>
      )}
      {open && <p className="note">{KIND_META[kind].hint}</p>}
    </div>
  );
}

export function OrdersPicker({
  kinds,
  orders,
  onChange,
}: {
  kinds: UnitKind[];
  orders: Orders;
  onChange: (o: Orders) => void;
}) {
  if (kinds.length === 0) return <div className="desc">Сначала возьми кого-нибудь в отряд.</div>;
  return (
    <>
      {kinds.map((k) => (
        <OrderRow
          key={k}
          kind={k}
          value={orders[k]}
          onChange={(v) => onChange({ ...orders, [k]: v } as Orders)}
        />
      ))}
    </>
  );
}

export function ReservePicker({
  value,
  onChange,
}: {
  value: ReserveTrigger;
  onChange: (t: ReserveTrigger) => void;
}) {
  return (
    <div className="choice">
      {RESERVE_TRIGGERS.map((t) => (
        <button
          key={t.kind}
          className={`choice-opt${sameTrigger(value, t) ? ' on' : ''}`}
          onClick={() => onChange({ ...t })}
        >
          <span className="ico">{sameTrigger(value, t) ? '●' : '○'}</span>
          <b>{RESERVE_NAME[t.kind]}</b>
        </button>
      ))}
    </div>
  );
}
