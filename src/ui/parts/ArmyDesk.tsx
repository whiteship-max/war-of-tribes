// Части «Дружины» ДР-1 (docs/siege_v2.md, «Решения ДР-1») и ДР-8 (docs/ui_v2.md, «Решения ДР-8»): дух — мораль и дисциплина с
// разбором «что влияет», состав — плитками видов (касание — карточка вида с роспуском, `KindCard`), жалованье — полное или
// минимальное. Своей арифметики нет ни у одной: дух — `sim/spirit`, правила — `game/spiritrules`, жалованье — `sim/upkeep`,
// раненые — `derived`.
import './army.css';
import { useState } from 'react';
import type { GameState, TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { TROOPS, TROOP_BY_ID } from '@/game/data/troops';
import { armyWagesPerDay, woundedStacks } from '@/game/derived';
import { TROOPS_OF_KIND, type TroopStack } from '@/game/battle/kinds';
import { SPIRIT, UNIT_KINDS, spiritMult } from '@/battle';
import { gameSecondsOfMs, asGame } from '@/game/pace';
import { WAGE_MIN_SHARE, WAGE_MODES, payLeftMs, type SpiritAxis, type SpiritLineId, type WageMode } from '@/game/spiritrules';
import { payShare, spiritView, wageMode } from '@/game/sim/spirit';
import { setWageMode, wageModeBlock } from '@/game/sim/upkeep';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';
import type { IconName } from '@/ui/icons/alias';
import { Bar, Table, type Col } from '@/ui/kit';
import { fmtInt } from '@/ui/next/hudTips';
import { dec } from '@/game/num';
import { waitShort } from './wait';
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

/** Вид в составе: сколько бойцов и сколько раненых — лежащих в лазарете и несомых отрядом. */
export interface RosterTile {
  id: TroopId;
  heads: number;
  wounded: number;
}

/**
 * Плитки состава по порядку родов (`UNIT_KINDS`, внутри рода — порядок видов): вид, где есть бойцы или раненые. Числа — из
 * партии (`s.army`) и лазарета (`woundedStacks`), своей арифметики нет.
 */
export function rosterTiles(s: GameState): RosterTile[] {
  const hurt = woundedOf(s);
  return UNIT_KINDS.flatMap((k) => TROOPS_OF_KIND[k])
    .map((id) => ({ id, heads: Math.max(0, s.army[id] ?? 0), wounded: hurt[id] ?? 0 }))
    .filter((t) => t.heads > 0 || t.wounded > 0);
}

/**
 * Состав сеткой плиток (ДР-8, docs/ui_v2.md, «Решения ДР-8»): портрет вида, число бойцов, раненые — малой отметкой, имя.
 * Касание — карточка вида поверх меню (`KindCard`): там числа дома и в походе, жалованье и роспуск. Тело без своего состояния:
 * тест жмёт плитку без браузера (`dr8.test.ts`).
 */
export function RosterTiles({ s, onPick }: { s: GameState; onPick: (t: TroopId) => void }) {
  const tiles = rosterTiles(s);
  if (tiles.length === 0) return <p className="note">Бойцов нет. Нанимают в казармах и конюшне.</p>;
  return (
    <div className="dr-tiles">
      {tiles.map((t) => (
        <button type="button" key={t.id} className="dr-tile" data-troop={t.id} onClick={() => onPick(t.id)} aria-label={`${TROOP_BY_ID[t.id].name}: карточка вида`}>
          <span className="dr-tile-ico">
            <Icon name={iconName('troop', t.id)} />
          </span>
          <b className="dr-tile-n">{fmtInt(t.heads)}</b>
          {t.wounded > 0 && (
            <em className="dr-tile-hurt">
              <Icon name="ui-bandage" />
              {fmtInt(t.wounded)}
            </em>
          )}
          <span className="dr-tile-name">{TROOP_BY_ID[t.id].name}</span>
        </button>
      ))}
    </div>
  );
}

/** Состав партии из стора: плитки и дверь в карточку вида. */
export function Roster({ onPick }: { onPick: (t: TroopId) => void }) {
  const s = useGame((g) => g.s);
  return <RosterTiles s={s} onPick={onPick} />;
}

/** Раненые по видам — лежащие в лазарете и несомые отрядом. */
export function woundedOf(s: GameState): TroopStack {
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
