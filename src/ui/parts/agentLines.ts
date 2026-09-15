// Слова карточки агента — без React, чтобы их можно было проверить тестом.
//
// Каждое число здесь — замер тем кодом, которым считает игра (`world/agents`),
// а не пересказ таблицы: кружок, который съел потолок морали, называется так, как
// есть. Разметка карточки (`AgentCard.tsx`) только раскладывает эти строки.
import { KIND_META, type UnitKind } from '@/battle';
import { MAX_AGENT_LEVEL } from '@/game/data/agents';
import { onslaughtAt, sightBonusAt, stealthAt } from '@/game/sim/agents';
import type { TroopStack } from '@/game/battle/kinds';
import { onslaughtRows, revealSight, slipShare, type OnslaughtRow } from '@/world/agents';
import { PERIL_FAR } from '@/world/data/tuning';
import { perilOf, perilShare, perilText, routPeril, veilAt, type PerilCase } from '@/world/peril';
import type { FigureId } from '@/world/types';
import { count } from './plural';

/** Прибавка по родам словами: «копья +6, конница ничего». */
const rowsText = (rows: OnslaughtRow[]): string =>
  rows.map((r) => `${KIND_META[r.kind].name.toLowerCase()} ${r.got > 0 ? `+${r.got}` : 'ничего'}`).join(', ');

export interface OnslaughtLines {
  /** Что натиск даёт сейчас, словами. */
  now: string;
  /** Как это легло на нынешнюю дружину. null — дружины нет или уровень первый. */
  troops: string | null;
  /** Что даст следующий кружок. null — кружков пять или дружины нет. */
  next: string | null;
  /** Часть натиска съел потолок морали — сейчас или на следующем кружке. */
  capped: boolean;
  /** Роды, которым следующий кружок не прибавит ничего. */
  deadKinds: UnitKind[];
}

export function onslaughtLines(level: number, troops: TroopStack, mountGear: number, fervour: number): OnslaughtLines {
  const now = onslaughtAt(level);
  const has = Object.values(troops).some((n) => (n ?? 0) > 0);
  const rows = has && level > 1 ? onslaughtRows(troops, mountGear, fervour, onslaughtAt(1), now) : [];
  const next =
    has && level < MAX_AGENT_LEVEL ? onslaughtRows(troops, mountGear, fervour, now, onslaughtAt(level + 1)) : [];
  const rite = fervour > 0 ? ` Обряд храма даёт ещё +${fervour}, и потолок морали у них общий.` : '';

  let troopsLine: string | null = null;
  if (level > 1 && !has) troopsLine = 'Дружины при нём нет: сколько из этого съест потолок морали, скажет дружина.';
  else if (rows.length > 0) {
    troopsLine = rows.every((r) => r.got === 0)
      ? 'Нынешней дружине натиск не прибавляет ничего: её мораль и так упирается в потолок.'
      : `Нынешней дружине: ${rowsText(rows)}.${rows.some((r) => r.got < r.full) ? ' Остальное съел потолок морали.' : ''}`;
  }

  let nextLine: string | null = null;
  if (next.length > 0) {
    nextLine = next.every((r) => r.got === 0)
      ? 'Следующий кружок этой дружине ничего не прибавит: потолок морали.'
      : `Следующий кружок: ${rowsText(next)}${next.some((r) => r.got < r.full) ? ' — дальше потолок морали' : ''}.`;
  }

  return {
    now:
      (level <= 1
        ? 'На первом уровне натиск ничего не прибавляет: это полководец, каким он был всегда.'
        : `К стойкости в боях, которые он ведёт: +${now}. В оборону деревни и в вылазку не идёт — их ведёт гарнизон.`) + rite,
    troops: troopsLine,
    next: nextLine,
    capped: rows.some((r) => r.got < r.full) || next.some((r) => r.got < r.full),
    deadKinds: next.filter((r) => r.got === 0).map((r) => r.kind),
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
