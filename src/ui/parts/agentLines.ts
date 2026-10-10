// Слова карточки агента — без React, чтобы их можно было проверить тестом.
//
// Каждое число здесь — замер тем кодом, которым считает игра (`world/agents`),
// а не пересказ таблицы: что даёт отметка полководца, меряет функция ядра боя.
// Разметка карточки (`AgentCard.tsx`) только раскладывает эти строки.
import { PIP_IDS, PIP_NAME, pipPhases, type PipId, type Pips } from '@/battle';
import { MAX_AGENT_LEVEL } from '@/game/data/agents';
import { sightBonusAt, stealthAt } from '@/game/sim/agents';
import { pipRows, revealSight, slipShare } from '@/world/agents';
import { PERIL_FAR } from '@/world/data/tuning';
import { perilOf, perilShare, perilText, routPeril, veilAt, type PerilCase } from '@/world/peril';
import type { FigureId } from '@/world/types';
import { count } from './plural';
import { num } from '@/game/num';

export interface PipLines {
  /** Что такое отметки и где они работают, словами. */
  now: string;
  /** По строке на каждую отметку, которая есть: сколько, что даёт замером, в каких фазах. */
  rows: string[];
  /** Куда ляжет следующий кружок. null — кружков пять. */
  next: string | null;
  /** Сколько из кружков — воинская традиция Статуи, словами. null — Статуя кружков не даёт. */
  tradition: string | null;
}

/** Куда ляжет кружок — винительный падеж имён отметок (`PIP_NAME`): «в обстрел», «в сшибку». */
const INTO: Record<PipId, string> = { fire: 'обстрел', shock: 'сшибку', melee: 'сечу', maneuver: 'манёвр' };

/** Доля словами: «+6,7 %». */
const pct = (x: number): string => `+${num(x * 100, 1)} %`;

/**
 * Отметки полководца словами. `level` — уровень, с которого они считаются (`sim/agents.pipLevel`: свои кружки и кружки
 * воинской традиции Статуи), `pips` — нынешние (`sim/agents.pipsOf`), `next` — на следующем уровне (`pipsAt` того же
 * человека): склонность — бросок от сида и номера человека, и куда ляжет следующий кружок, известно заранее. `tradition` —
 * сколько кружков сверх своих дала Статуя (`derived.tradition` под потолком). Что даёт отметка, — замер функцией ядра (`world/agents.pipRows`).
 */
export function pipLines(level: number, pips: Pips, next: Pips | null, tradition = 0): PipLines {
  const rows = pipRows(pips)
    .filter((r) => r.n > 0)
    .map((r) =>
      r.crossing
        ? `${PIP_NAME[r.pip]} ${r.n}: снимает переправу, если у врага манёвр ниже. Урон ${pct(r.gain)} в каждой фазе.`
        : `${PIP_NAME[r.pip]} ${r.n}: урон ${pct(r.gain)} · ${pipPhases(r.pip)}.`,
    );
  let nextLine: string | null = null;
  if (next && level < MAX_AGENT_LEVEL) {
    const grown = PIP_IDS.find((p) => (next[p] ?? 0) > (pips[p] ?? 0));
    if (grown) nextLine = `Следующая отметка ляжет в ${INTO[grown]}.`;
  }
  return {
    now:
      level <= 1
        ? 'Отметок ещё нет.'
        : 'Отметка прибавляет урон в своей фазе, в походе и у своих стен.',
    rows,
    next: nextLine,
    tradition:
      tradition > 0
        ? `Статуя даёт ${count(tradition, 'отметку', 'отметки', 'отметок')}.`
        : null,
  };
}

export function sightLine(level: number): string {
  const now = revealSight('scout', sightBonusAt(level));
  const next = level < MAX_AGENT_LEVEL ? revealSight('scout', sightBonusAt(level + 1)) : null;
  return (
    `Открывает землю на ${count(now, 'клетку', 'клетки', 'клеток')} вокруг себя` +
    (next !== null && next > now ? `, на ур. ${level + 1} на ${next}` : '') +
    '.'
  );
}

export function stealthLine(level: number): string {
  const now = Math.round(slipShare(stealthAt(level)) * 100);
  const next = level < MAX_AGENT_LEVEL ? Math.round(slipShare(stealthAt(level + 1)) * 100) : null;
  return (
    (now > 0
      ? `Незамеченными проходят ${now} % провалов.`
      : 'Каждый провал замечают.') +
    (next !== null ? ` На ур. ${level + 1} будет ${next} %.` : '')
  );
}

/**
 * Обстановка ровно посередине каждого множителя: полуспелая цель, утро, весна, одна
 * отметка в памяти, полпути до дальнего края. Карточка меряет на ней не риск дела —
 * его покажет меню приказа, — а то, **во сколько раз** уровень двигает гибель.
 */
const MIDDLE: PerilCase = { veil: 1, ripeness: 0.5, villageTime: 0, visits: 1, distance: PERIL_FAR / 2 };

/**
 * Гибель агента словами — замером тех же функций, что решают исход (`world/peril`).
 * Точного числа карточка не называет: оно зависит от цели, часа и времени года и стоит
 * в меню приказа перед каждым делом.
 */
export function deathLine(id: FigureId, level: number): string {
  if (id === 'diplomat') return 'На деле не гибнет, его могут только схватить.';
  if (id === 'general') {
    const near = perilText(perilShare(routPeril(0)));
    const far = perilText(perilShare(routPeril(PERIL_FAR)));
    return `Гибнет, если его отряд перебьют до последнего. Риск у ворот ${near}, в ${count(PERIL_FAR, 'клетке', 'клетках', 'клетках')} от дома ${far}.`;
  }
  if (id === 'scout') {
    return 'Гибнет только там, где стоят часовые. Риск виден перед приказом.';
  }
  const now = perilShare(perilOf({ ...MIDDLE, veil: veilAt(level) }));
  const base = perilShare(perilOf({ ...MIDDLE, veil: veilAt(1) }));
  const times = base > 0 ? Math.round((base / now) * 10) / 10 : 1;
  return level <= 1
    ? `Риск гибели виден перед приказом. Скрытность снижает его с ур. ${level + 1}.`
    : `Риск гибели виден перед приказом. Скрытность снижает его в ${num(times, 2)} раза.`;
}
