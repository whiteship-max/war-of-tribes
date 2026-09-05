import type { ReactNode } from 'react';
import type { ResourceId } from '@/game/types';
import { useGame } from '@/game/store';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';

interface Props {
  cost: Partial<Record<ResourceId, number>>;
  /** Работа строителей — показываем рядом с ценой. */
  work?: number;
  /** Оценка времени в секундах при нынешнем числе строителей. null — строить некому. */
  eta?: number | null;
  /**
   * Ещё одна ячейка в том же ряду — например, спрос уровня на людей в списке
   * построек ратуши. Отдельной строкой она заняла бы место, а смысл у неё
   * ровно тот же: во что обойдётся уровень.
   */
  extra?: ReactNode;
}

/**
 * Цена с текущим запасом ровно тех ресурсов, которые в ней участвуют.
 * Полный список ресурсов живёт только на складе — здесь ровно то, что нужно решению.
 */
export function Cost({ cost, work, eta, extra }: Props) {
  const s = useGame((g) => g.s);
  const items = RESOURCE_IDS.filter((r) => cost[r]);
  if (items.length === 0 && work === undefined) return null;
  return (
    <div className="cost">
      {items.map((r) => {
        const need = cost[r] as number;
        const have = Math.floor(s.resources[r]);
        return (
          <span key={r} className={have >= need ? '' : 'no'} title={RESOURCE_META[r].name}>
            {RESOURCE_META[r].icon} {need}
            <i className="have">из {have}</i>
          </span>
        );
      })}
      {work !== undefined && (
        <span className="work">⏱ {eta === undefined ? work : eta === null ? 'нет строителей' : `~${eta} с`}</span>
      )}
      {extra}
    </div>
  );
}
