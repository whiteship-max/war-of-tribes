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
