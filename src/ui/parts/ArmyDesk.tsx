// Части «Дружины» ДР-1 (docs/siege_v2.md, «Решения ДР-1»): дух — мораль и дисциплина с разбором «что влияет», состав по родам,
// жалованье — полное или минимальное — и роспуск с подтверждением. Своей арифметики нет ни у одной: дух — `sim/spirit`, правила
// — `game/spiritrules`, жалованье и роспуск — `sim/upkeep`, строй — `game/battle/price.kindsOf`, раненые — `derived`.
import './army.css';
import { useState } from 'react';
import type { GameState, TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { TROOPS, TROOP_BY_ID } from '@/game/data/troops';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { armyWagesPerDay, wageOf, woundedStacks } from '@/game/derived';
import { kindsOf } from '@/game/battle/price';
import { TROOPS_OF_KIND, troopTotal, type TroopStack } from '@/game/battle/kinds';
import { KIND_META, SPIRIT, UNIT_KINDS, spiritMult } from '@/battle';
import { gameSecondsOfMs, asGame } from '@/game/pace';
import { WAGE_MIN_SHARE, WAGE_MODES, payLeftMs, type SpiritAxis, type SpiritLineId, type WageMode } from '@/game/spiritrules';
import { payShare, spiritView, wageMode } from '@/game/sim/spirit';
import { dismissCheck, dismissReturns, dismissSoldiers, setWageMode, wageModeBlock } from '@/game/sim/upkeep';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';
import type { IconName } from '@/ui/icons/alias';
import { Bar, Btn, Row, Table, type Col } from '@/ui/kit';
import { fmtInt } from '@/ui/next/hudTips';
import { dec } from '@/game/num';
import { waitShort } from './wait';
import { count } from './plural';
import { signed } from './signed';
import { LINE_HELP, LINE_WORD, SPIRIT_HELP, WAGE_WORD, wageLine } from './spiritWords';

/** Срок настоящего времени словами — той же дверью, что все сроки (`ui/parts/wait`). */
const realLeft = (ms: number): string | null => (ms > 1000 ? waitShort(asGame(gameSecondsOfMs(ms))) : null);

/** Тон шкалы: ниже нейтрали боя — беда, у верха — благо. */
const toneOf = (v: number): 'bad' | 'good' | 'accent' => (v < SPIRIT.even - 15 ? 'bad' : v >= SPIRIT.even + 10 ? 'good' : 'accent');

/** Множитель боя словами: «×0,97». */
const times = (k: number): string => `×${dec(k, 2)}`;

// ---------- Дух ----------

/** Мораль и дисциплина: две полосы с потолком, строка жалованья, что это даёт в бою и разбор «что влияет». */
export function SpiritCard() {
  const s = useGame((g) => g.s);
  const [open, setOpen] = useState(false);
  const v = spiritView(s);
  const mode = wageMode(s);
  const share = payShare(s);
  return (
    <section className="dr-spirit" aria-label="Дух дружины">
      <Scale icon="ui-banner" name="Мораль" axis={v.morale} help={SPIRIT_HELP.morale} />
      <Scale icon="bat-spears-held" name="Дисциплина" axis={v.discipline} help={SPIRIT_HELP.discipline} />
      <p className={`dr-wage-line${mode === 'min' ? ' bad' : ''}`}>{wageLine(mode, share, realLeft(payLeftMs(mode, share)))}</p>
      <p className="dr-battle">
        В бою: стойкость <b>{times(spiritMult(v.morale.value, SPIRIT.morale))}</b>, удар <b>{times(spiritMult(v.discipline.value, SPIRIT.discipline))}</b>
      </p>
      <button type="button" className="dr-why" aria-expanded={open} onClick={() => setOpen(!open)}>
        Что влияет <Icon name={open ? 'ui-up' : 'ui-down'} />
      </button>
      {open && <SpiritLines morale={v.morale} discipline={v.discipline} />}
    </section>
  );
}

function Scale({ icon, name, axis, help }: { icon: IconName; name: string; axis: SpiritAxis; help: { title: string; body: string } }) {
  const value = Math.round(axis.value);
  const ceil = Math.round(axis.ceil);
  return (
    <div className="dr-scale">
      <Icon name={icon} />
      <Bar
        value={axis.value}
        max={100}
        label={name}
        text={ceil > value ? `${value} · потолок ${ceil}` : `${value}`}
        tone={toneOf(axis.value)}
        marks={[{ at: SPIRIT.even, label: 'ровно' }]}
        tip={() => ({ title: `${help.title} · ${value} из 100`, body: help.body })}
      />
    </div>
  );
}

const LINE_COLS: readonly Col[] = [
  { key: 'what', title: 'Что влияет' },
  { key: 'm', title: 'Мораль', align: 'right', w: '64px' },
  { key: 'd', title: 'Дисциплина', align: 'right', w: '84px' },
];

/** Строки обеих шкал одной таблицей: имя строки — и её доля в морали и в дисциплине. */
function SpiritLines({ morale, discipline }: { morale: SpiritAxis; discipline: SpiritAxis }) {
  const ids: SpiritLineId[] = [];
  const of = (a: SpiritAxis, id: SpiritLineId): number | null => a.lines.find((l) => l.id === id)?.value ?? null;
  // Строка, что по обеим шкалам меньше половины очка, — не причина на экране: «0» красным только путает (сразу после смены
  // жалованья доля ещё не сдвинулась). Основа — всегда.
  const shown = (id: SpiritLineId): boolean => id === 'base' || [of(morale, id), of(discipline, id)].some((v) => v !== null && Math.abs(v) >= 0.5);
  for (const l of [...morale.lines, ...discipline.lines]) if (!ids.includes(l.id) && shown(l.id)) ids.push(l.id);
  const cell = (v: number | null, base: boolean) =>
    v === null ? <span className="muted">—</span> : <span className={base ? '' : v < 0 ? 'neg' : 'pos'}>{base ? fmtInt(Math.round(v)) : signed(v, 0)}</span>;
  const rows = ids.map((id) => ({
    key: id,
    cells: {
      what: (
        <span className="kit-name">
          <span className="ic">
            <Icon name={LINE_WORD[id].icon} />
          </span>
          <span className="one-line">{LINE_WORD[id].name}</span>
        </span>
      ),
      m: cell(of(morale, id), id === 'base'),
      d: cell(of(discipline, id), id === 'base'),
    },
    tip: () => ({ title: LINE_WORD[id].name, body: LINE_HELP[id] }),
  }));
  return (
    <Table
      label="Что влияет на мораль и дисциплину"
      cols={LINE_COLS}
      rows={rows}
      total={{ what: 'Итого', m: <b>{fmtInt(Math.round(morale.value))}</b>, d: <b>{fmtInt(Math.round(discipline.value))}</b> }}
    />
  );
}

// ---------- Состав ----------

/**
 * Полки по родам: сколько бойцов и каких видов, живая сила в строю и раненые. Виды здесь — подписи, а не двери: дверь в карточку
 * вида одна — строка раскладки ниже (`Muster`) и значки видов, которых нет.
 */
export function Roster() {
  const s = useGame((g) => g.s);
  const hurt = woundedOf(s);
  const rows = UNIT_KINDS.map((k) => {
    const ids = TROOPS_OF_KIND[k];
    const stack: TroopStack = {};
    for (const id of ids) if ((s.army[id] ?? 0) > 0) stack[id] = s.army[id];
    const heads = troopTotal(stack);
    const wounded = ids.reduce((n, id) => n + (hurt[id] ?? 0), 0);
    return { k, ids, heads, men: kindsOf(stack)[k], wounded };
  }).filter((r) => r.heads > 0 || r.wounded > 0);
  if (rows.length === 0) return <p className="note">Бойцов нет. Нанимают в казармах и конюшне.</p>;
  const heads = rows.reduce((n, r) => n + r.heads, 0);
  const men = rows.reduce((n, r) => n + r.men, 0);
  const wounded = rows.reduce((n, r) => n + r.wounded, 0);
  return (
    <div className="dr-roster">
      {rows.map((r) => (
        <div className="dr-regiment" key={r.k}>
          <div className="dr-reg-head">
            <Icon name={KIND_META[r.k].icon as IconName} />
            <b>{KIND_META[r.k].name}</b>
            <span>
              {count(r.heads, 'боец', 'бойца', 'бойцов')}
              <small> · в строю {fmtInt(Math.round(r.men))}</small>
            </span>
          </div>
          <div className="dr-reg-kinds">
            {r.ids
              .filter((id) => (s.army[id] ?? 0) > 0 || (hurt[id] ?? 0) > 0)
              .map((id) => (
                <span key={id} className="dr-kind">
                  <Icon name={iconName('troop', id)} />
                  <span>{TROOP_BY_ID[id].name}</span>
                  <b>{fmtInt(s.army[id] ?? 0)}</b>
                  {(hurt[id] ?? 0) > 0 && (
                    <em title="в лазарете">
                      <Icon name="ui-bandage" />
                      {fmtInt(hurt[id] ?? 0)}
                    </em>
                  )}
                </span>
              ))}
          </div>
        </div>
      ))}
      <p className="dr-total">
        Всего {count(heads, 'боец', 'бойца', 'бойцов')}, в строю {fmtInt(Math.round(men))}
        {wounded > 0 ? `, в лазарете ${fmtInt(wounded)}` : ''}.
      </p>
    </div>
  );
}

/** Раненые по видам — лежащие в лазарете и несомые отрядом. */
function woundedOf(s: GameState): TroopStack {
  const w = woundedStacks(s);
  const out: TroopStack = {};
  for (const t of TROOPS) {
    const n = (w.lying[t.id] ?? 0) + (w.carried[t.id] ?? 0);
    if (n > 0) out[t.id] = n;
  }
  return out;
}

// ---------- Жалованье ----------

/** Полное или минимальное: цена в день у каждого и что будет с духом. Минимальное — двумя касаниями. */
export function WageChoice() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const mode = wageMode(s);
  const full = armyWagesPerDay({ ...s, pay: { ...s.pay, wage: undefined } });
  const costOf = (m: WageMode): number => full * (m === 'min' ? WAGE_MIN_SHARE : 1);
  return (
    <div className="dr-wage" role="radiogroup" aria-label="Жалованье дружине">
      {WAGE_MODES.map((m) => (
        <WageOption key={m} m={m} on={mode === m} cost={costOf(m)} pick={() => act((st) => setWageMode(st, m))} why={wageModeBlock(s, m)} />
      ))}
    </div>
  );
}

function WageOption({ m, on, cost, pick, why }: { m: WageMode; on: boolean; cost: number; pick: () => void; why: string | null }) {
  const [armed, setArmed] = useState(false);
  const label = `${WAGE_WORD[m].name}: ${fmtInt(Math.round(cost))} золота в день`;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-label={label}
      className={`dr-wage-opt${on ? ' on' : ''}${armed ? ' armed' : ''}`}
      onClick={() => {
        if (on || why) return;
        // Урезать жалованье — двумя касаниями (дух пойдёт вниз); вернуть полное — одним.
        if (m === 'min' && !armed) return setArmed(true);
        setArmed(false);
        pick();
      }}
      onBlur={() => setArmed(false)}
    >
      <b>{WAGE_WORD[m].name}</b>
      <span className="dr-wage-cost">
        <Icon name="res-gold" /> {fmtInt(Math.round(cost))} <small>в день</small>
      </span>
      <small>{armed ? 'Коснись ещё раз — урезать' : WAGE_WORD[m].sub}</small>
    </button>
  );
}

// ---------- Роспуск ----------

/** Роспуск по видам: кто дома, сколько, что вернётся и что снимет с жалованья. Подтверждение — вторым касанием. */
export function Dismiss() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const [pick, setPick] = useState<Partial<Record<TroopId, number>>>({});
  const kinds = TROOPS.filter((d) => (s.army[d.id] ?? 0) > 0);
  if (kinds.length === 0) return null;
  return (
    <div className="dr-dismiss">
      <p className="note">Распущенные станут жителями, снаряжение вернётся на склад. Плата за найм и учения пропадает. Распускают только тех, кто дома.</p>
      {kinds.map((d) => {
        const n = Math.max(1, pick[d.id] ?? 1);
        const check = dismissCheck(s, d.id, n);
        const set = (v: number): void => setPick((c) => ({ ...c, [d.id]: Math.max(1, Math.min(Math.max(1, check.max), v)) }));
        const back = dismissReturns(d.id, Math.min(n, check.max));
        const gear = Object.entries(back.gear)
          .map(([id, k]) => `${EQUIPMENT_BY_ID[id as keyof typeof EQUIPMENT_BY_ID]?.name.toLowerCase() ?? id} ${fmtInt(k ?? 0)}`)
          .join(', ');
        return (
          <div className="dr-dis-row" key={d.id}>
            <Row
              icon={iconName('troop', d.id)}
              label={d.name}
              sub={check.max > 0 ? `дома ${fmtInt(check.max)} из ${fmtInt(s.army[d.id] ?? 0)}` : 'все в походе'}
              tip={() => ({ title: d.name, body: `Жалованье одного — ${dec(wageOf(s, d.id), 1)} золота в день при полном.` })}
            />
            {check.max > 0 && (
              <div className="dr-dis-act">
                <div className="stepper">
                  <button type="button" disabled={n <= 1} onClick={() => set(n - 1)} aria-label="Меньше">
                    −
                  </button>
                  <span className="n dr-n">{n}</span>
                  <button type="button" disabled={n >= check.max} onClick={() => set(n + 1)} aria-label="Больше">
                    +
                  </button>
                </div>
                <Btn
                  confirm
                  why={check.blocked ?? undefined}
                  sub={`жителей +${fmtInt(back.people)}${gear ? `, на склад: ${gear}` : ''}; жалованье −${fmtInt(Math.round(check.saves))} в день`}
                  onClick={() => act((st) => dismissSoldiers(st, d.id, n))}
                >
                  Распустить {n}
                </Btn>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
