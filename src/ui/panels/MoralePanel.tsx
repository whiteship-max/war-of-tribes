// Справка по счастью из строки состояния. Все слагаемые берутся из `moraleBreakdown` — оттуда же, откуда их берёт
// симуляция: расходиться панели и расчёту негде.
//
// Одной таблицей цели (UI-8, Д13, docs/ui_v2.md, 5.7): прежде налог, пир и обряд стояли дважды — списком «Что добавляет /
// Что отнимает» и ещё раз в «Как складывается цель». Теперь каждое слагаемое — одна строка (`next/morale.moraleRows`), и
// строки складываются в цель на глазах игрока. Сдвиг в день — указ и паёк — таблицей с дверью в «Указы» державы, где их
// меняют (одна копия указов, UI-7). Окно едет в куске нового вида (`ui/next/index.ts`): оно стоит на наборе `kit`.
import { useGame } from '@/game/store';
import { MORALE_GROWTH_ZERO } from '@/game/constants';
import { GATE_MORALE_LOST, GATE_MORALE_WON } from '@/world/data/tuning';
import { decreeOf, moraleOutputMult, policyMoralePerDay, rationOf } from '@/game/derived';
import { moraleGrowthFactor } from '@/game/sim/population';
import { Bar } from '@/ui/kit/Bar';
import { Row } from '@/ui/kit/Row';
import { Table, type Col } from '@/ui/kit/Table';
import { goTo } from '@/ui/kit/nav';
import { WINDOW, sourceWord } from '@/ui/kit/sources';
import { moraleRows } from '@/ui/next/morale';
import { dec } from '@/game/num';

const sign = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n * 10) / 10)}`;
const tone = (n: number): string => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

const named = (icon: string, name: string) => (
  <span className="kit-name">
    <span className="ic">{icon}</span>
    <span className="one-line">{name}</span>
  </span>
);

const EFFECT_COLS: readonly Col[] = [
  { key: 'what', title: 'На что влияет' },
  { key: 'n', title: '', align: 'right', w: '64px' },
];
const TARGET_COLS: readonly Col[] = [
  { key: 'what', title: 'Цель морали' },
  { key: 'n', title: '', align: 'right', w: '64px' },
];
const DRIFT_COLS: readonly Col[] = [
  { key: 'what', title: 'Сдвиг в день' },
  { key: 'n', title: '', align: 'right', w: '64px' },
];

export function MoralePanel() {
  const s = useGame((g) => g.s);
  const { rows, target } = moraleRows(s);
  const morale = Math.round(s.morale);
  const output = moraleOutputMult(s.morale);
  const growth = moraleGrowthFactor(s.morale);
  const decree = decreeOf(s);
  const ration = rationOf(s);
  const drift = policyMoralePerDay(s);
  // Указ и паёк меняют в «Указах» державы — одной копией (UI-7, docs/ui_v2.md, 5.6): строки ведут туда.
  const toDecrees = (): void => goTo(WINDOW.gold);

  return (
    <div className="panel">
      <h2>
        Мораль <small>{morale} из 100</small>
      </h2>
      <Bar
        value={morale}
        max={100}
        tone={s.morale < MORALE_GROWTH_ZERO ? 'bad' : 'good'}
        marks={[{ at: MORALE_GROWTH_ZERO, label: 'жители уходят' }]}
        label={`Идёт к цели ${Math.round(target)}`}
      />

      <Table
        label="На что влияет"
        cols={EFFECT_COLS}
        rows={[
          {
            key: 'output',
            cells: { what: named('⛏️', 'Выработка'), n: <b className={output >= 1 ? 'pos' : 'neg'}>×{dec(output, 2)}</b> },
            tip: () => ({ title: 'Выработка', body: 'Мораль множит выработку каждого двора.' }),
          },
          {
            key: 'growth',
            cells: {
              what: named(growth >= 0 ? '📈' : '📉', growth < 0 ? `Прирост: ниже ${MORALE_GROWTH_ZERO} жители уходят` : 'Прирост'),
              n: <b className={growth >= 0 ? 'pos' : 'neg'}>×{dec(growth, 2)}</b>,
            },
            tip: () => ({ title: 'Прирост', body: `Мораль множит прирост жителей. Ниже ${MORALE_GROWTH_ZERO} жители уходят.` }),
            go: () => goTo(WINDOW.pop),
            goLabel: `Прирост: ${sourceWord(WINDOW.pop)}`,
          },
        ]}
      />

      <Table
        label="Цель морали"
        cols={TARGET_COLS}
        rows={rows.map((l) => ({
          key: l.id,
          cells: { what: named(l.icon, l.name), n: <b className={tone(l.value)}>{sign(l.value)}</b> },
          tip: () => ({ title: l.name, body: l.hint }),
        }))}
        total={{ what: 'Цель', n: <b className="pos">{Math.round(target)}</b> }}
      />

      <Table
        label="Сдвиг в день"
        cols={DRIFT_COLS}
        rows={[
          {
            key: 'decree',
            cells: { what: named(decree.icon, `Указ: ${decree.name.toLowerCase()}`), n: <b className={tone(decree.moralePerDay)}>{sign(decree.moralePerDay)}</b> },
            tip: () => ({ title: decree.name, body: decree.effect }),
            go: toDecrees,
            goLabel: `Указ: ${sourceWord(WINDOW.gold)}`,
          },
          {
            key: 'ration',
            cells: { what: named(ration.icon, `Паёк: ${ration.name.toLowerCase()}`), n: <b className={tone(ration.moralePerDay)}>{sign(ration.moralePerDay)}</b> },
            tip: () => ({ title: ration.name, body: ration.effect }),
            go: toDecrees,
            goLabel: `Паёк: ${sourceWord(WINDOW.gold)}`,
          },
        ]}
        total={{ what: 'Итого в день', n: <b className={tone(drift)}>{sign(drift)}</b> }}
      />

      <Row
        icon={{ name: 'hud-army', glyph: '⚔️' }}
        label="Бои у ворот"
        sub={`отбитый набег +${GATE_MORALE_WON}, проигранный −${GATE_MORALE_LOST} сразу`}
        value={`${s.stats.battlesWon} : ${s.stats.battlesLost}`}
        tip={() => ({ title: 'Бои у ворот', body: `Побед ${s.stats.battlesWon}, поражений ${s.stats.battlesLost}. Каждый бой сдвигает мораль сразу.` })}
      />
    </div>
  );
}
