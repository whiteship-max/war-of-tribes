import type { ReactNode } from 'react';
import type { ResourceId } from '@/game/types';
import { useGame } from '@/game/store';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { Icon } from '@/ui/icons/Icon';

/** Чем можно расплатиться: склад плюс казна. Золото — не ресурс, но цена бывает и в нём. */
export type Price = Partial<Record<ResourceId | 'gold', number>>;

interface Props {
  cost: Price;
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
 *
 * **Это единственная форма, какой в игре говорят «нужно столько, а есть
 * столько».** Она стоит у стройки — и она же у письма с данью, у выкупа, у
 * приказа дипломата и у события с обменом. Второй такой формы заводить нельзя:
 * игрок узнаёт её с одного взгляда, а два разных способа сказать одно и то же
 * он читает как два разных смысла.
 *
 * Два места правило пока не соблюдают: ковка (`Smithy.tsx`) и наём
 * (`Recruit.tsx` — казармы и конюшня) рисуют цену своей строкой без «из N». Это долг пачки-уборки,
 * а не образец.
 *
 * Не хватает — ячейка краснеет (`.no`), и по этой же нехватке гаснет кнопка
 * рядом. Одно и то же число: показанный запас берётся из `s`, и проверка
 * «хватает ли» считается по нему же, а не по похожему.
 */
export function Cost({ cost, work, eta, extra }: Props) {
  const s = useGame((g) => g.s);
  const items = RESOURCE_IDS.filter((r) => cost[r]);
  const gold = cost.gold ?? 0;
  if (items.length === 0 && gold <= 0 && work === undefined) return null;
  return (
    <div className="cost">
      {items.map((r) => {
        const need = cost[r] as number;
        const have = Math.floor(s.resources[r]);
        return (
          <span key={r} className={have >= need ? '' : 'no'} title={RESOURCE_META[r].name}>
            <Icon name={`res-${r}`} glyph={RESOURCE_META[r].icon} /> {need}
            <i className="have">из {have}</i>
          </span>
        );
      })}
      {gold > 0 && (
        <span className={Math.floor(s.gold) >= gold ? '' : 'no'} title="Золото">
          <Icon name="res-gold" glyph="💰" /> {gold}
          <i className="have">из {Math.floor(s.gold)}</i>
        </span>
      )}
      {work !== undefined && (
        <span className="work">
          <Icon name="ui-time" glyph="⏱" /> {eta === undefined ? work : eta === null ? 'нет строителей' : `~${eta} с`}</span>
      )}
      {extra}
    </div>
  );
}
