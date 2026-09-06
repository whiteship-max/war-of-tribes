// Приказы лазутчика и кому какой приказ принадлежит.
//
// Форма строки та же, что у приказов дипломата (`data/diplomacy.ts`): цена,
// время и шанс приезжают в меню числами, а не пересчитываются в разметке.
// Второго вида меню заводить нельзя — иначе следующая фигура принесёт третий.
import type { FigureId, OrderActionId, SpyActionId } from '../types';
import { DIPLO_ACTIONS } from './diplomacy';
import { SPY_BUSY } from './tuning';

export interface SpyActionDef {
  id: SpyActionId;
  name: string;
  icon: string;
  description: string;
  /** Что означает показанный шанс. */
  chanceLabel: string;
  /** Сколько лазутчик занят после **удачного** дела, мс. Провал держит дольше. */
  busy: number;
}

export const SPY_ACTIONS: SpyActionDef[] = [
  {
    id: 'probe',
    name: 'Выведать войско',
    icon: '🔍',
    description:
      'Сосчитать чужую дружину на глаз и из чужих разговоров. Донесение придёт вилкой и будет стареть.',
    chanceLabel: 'удастся',
    busy: SPY_BUSY,
  },
  {
    id: 'revolt',
    name: 'Поддержать повстанцев',
    icon: '🔥',
    description:
      'Сговориться с недовольными. Пока идёт бунт, поселение не растёт, запасы не копятся, а гарнизон слаб — это окно для удара.',
    chanceLabel: 'удастся',
    busy: SPY_BUSY,
  },
];

export const SPY_ACTION_BY_ID: Record<SpyActionId, SpyActionDef> = Object.fromEntries(
  SPY_ACTIONS.map((a) => [a.id, a]),
) as Record<SpyActionId, SpyActionDef>;

/**
 * Кто отдаёт какой приказ. Таблица одна на всех: по ней меню собирает строки
 * для выбранного агента, а мир проверяет, что приказ отдаёт тот, кому он
 * принадлежит. Развести это по двум местам значит однажды разойтись.
 */
export const ORDER_AGENT: Record<OrderActionId, FigureId> = {
  ...(Object.fromEntries(DIPLO_ACTIONS.map((a) => [a.id, 'diplomat' as FigureId])) as Record<
    OrderActionId,
    FigureId
  >),
  ...(Object.fromEntries(SPY_ACTIONS.map((a) => [a.id, 'spy' as FigureId])) as Record<
    OrderActionId,
    FigureId
  >),
};

/** Строки меню для агента: у разведчика и полководца своих приказов пока нет. */
export function actionsOf(agent: FigureId): { id: OrderActionId; name: string; icon: string; description: string; chanceLabel: string; busy: number }[] {
  if (agent === 'diplomat') return DIPLO_ACTIONS;
  if (agent === 'spy') return SPY_ACTIONS;
  return [];
}
