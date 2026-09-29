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
const pct = (x: number): string => `+${String(Math.round(x * 1000) / 10).replace('.', ',')} %`;

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
        ? `${PIP_NAME[r.pip]} ${r.n}: снимает с его войска переправу, когда он нападает, а у противника манёвр ниже — урон в каждой фазе в среднем ${pct(r.gain)}; у логова манёвра нет.`
        : `${PIP_NAME[r.pip]} ${r.n}: урон его войска в среднем ${pct(r.gain)} — ${pipPhases(r.pip)}.`,
    );
  let nextLine: string | null = null;
  if (next && level < MAX_AGENT_LEVEL) {
    const grown = PIP_IDS.find((p) => (next[p] ?? 0) > (pips[p] ?? 0));
    if (grown) nextLine = `Следующий кружок ляжет в ${INTO[grown]}: такой у него склад.`;
  }
  return {
    now:
      level <= 1
        ? 'На первом уровне отметок нет: кость у его войска такая же, как у любого.'
        : 'Каждая отметка прибавляет урон его войска в своей фазе — в боях, которые он ведёт, и у своих стен, пока его дружина стоит у ворот. Манёвр фаз не держит — он снимает переправу. Исхода боя отметка одна не решает.',
    rows,
    next: nextLine,
    tradition:
      tradition > 0
        ? `Из его кружков ${count(tradition, 'кружок', 'кружка', 'кружков')} — воинская традиция: её даёт Статуя, и полководец растёт с неё, а не с первого кружка.`
        : null,
  };
}

export function sightLine(level: number): string {
  const now = revealSight('scout', sightBonusAt(level));
  const base = revealSight('scout', sightBonusAt(1));
  const next = level < MAX_AGENT_LEVEL ? revealSight('scout', sightBonusAt(level + 1)) : null;
  return (
    `Открывает землю на ${count(now, 'клетку', 'клетки', 'клеток')} вокруг себя` +
    (now > base ? ` (на первом уровне — ${base})` : '') +
    (next !== null ? `, со следующим кружком — ${next}` : '') +
    '. Живого обзора не даёт: за этим лазутчик.'
  );
}

export function stealthLine(level: number): string {
  const now = Math.round(slipShare(stealthAt(level)) * 100);
  const next = level < MAX_AGENT_LEVEL ? Math.round(slipShare(stealthAt(level + 1)) * 100) : null;
  return (
    (now > 0
      ? `Из провалов ${now} % проходят незамеченными: не держат, дома не горюют, цель лишь насторожится.`
      : 'Каждый провал замечают: задержат и запомнят.') +
    (next !== null ? ` Со следующим кружком — ${next} %.` : '') +
    ' Шанс дела не меняется: им владеет Дозор.'
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
  if (id === 'diplomat') return 'На деле не гибнет: во враждебном дворе его хватают, а не убивают; уходит только на покой.';
  if (id === 'general') {
    const near = perilText(perilShare(routPeril(0)));
    const far = perilText(perilShare(routPeril(PERIL_FAR)));
    return `Гибнет, только если его дружину перебьют до последнего: у своих ворот — ${near}, в ${count(PERIL_FAR, 'клетке', 'клетках', 'клетках')} от дома — ${far}. Шанс проиграть бой не показывается нигде.`;
  }
  if (id === 'scout') {
    return 'Гибнет только у поселений с часовыми — там же его и хватают; своего рычага против гибели у разведчика нет, кроме выбора цели. Риск стоит в «Вести сюда».';
  }
  const now = perilShare(perilOf({ ...MIDDLE, veil: veilAt(level) }));
  const base = perilShare(perilOf({ ...MIDDLE, veil: veilAt(1) }));
  const times = base > 0 ? Math.round((base / now) * 10) / 10 : 1;
  return level <= 1
    ? 'Гибнет на деле — риск стоит в меню приказа. Скрытность со вторым кружком начнёт его снижать.'
    : `Гибнет на деле — риск стоит в меню приказа; скрытность уже режет его в ${String(times).replace('.', ',')} раза против первого кружка. Дозор гибели не касается: он владеет шансом дела.`;
}
