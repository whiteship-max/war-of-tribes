// Снаряжение: то, что кузнецы куют, а казармы тратят на новобранцев.
//
// Предметы — обычные счётчики, как ресурсы: ни инвентаря, ни качества, ни износа.
// Лежат отдельным полем `s.equipment`, а не в `Resources`, по двум причинам:
// вместимость склада на них не распространяется (иначе полный склад молча
// остановил бы кузницу), и набег соседа их не уносит — армию нельзя обезоружить
// одним чужим отрядом. Видны они всё равно на складе, отдельным разделом.
import type { EquipmentId, ResourceId } from '../types';

export interface EquipmentDef {
  id: EquipmentId;
  name: string;
  /** Единственное число — для строк вида «нужен 1 меч». */
  one: string;
  icon: string;
  description: string;
  /** Ресурсы на один предмет. */
  cost: Partial<Record<ResourceId, number>>;
  /**
   * Работа кузнецов на один предмет. Числа сотенные: у горна помещается немного
   * народу (`slotsPerLevel` кузницы в `data/buildings.ts`), зато уровень поднимает и число
   * мест, и выработку каждого, так что дружина в сотни бойцов одевается за
   * разумное время, а первое копьё куётся на глазах.
   */
  work: number;
}

export const EQUIPMENT: EquipmentDef[] = [
  {
    id: 'spear',
    name: 'Копья',
    one: 'копьё',
    icon: '🔱',
    description: 'Ясеневое древко и железный наконечник. С него начинается любая кузница.',
    cost: { wood: 4, stone: 3 },
    work: 50,
  },
  {
    id: 'bow',
    name: 'Луки',
    one: 'лук',
    icon: '🏹',
    description: 'Тис и жила, наконечники калят в горне на угле. Бьёт дальше копья.',
    cost: { wood: 6, charcoal: 3 },
    work: 75,
  },
  {
    id: 'axe',
    name: 'Топоры',
    one: 'топор',
    icon: '🪓',
    description: 'Боевой топор. Тяжелее копья и прощает меньше промахов.',
    cost: { wood: 5, copper: 3 },
    work: 112,
  },
  {
    id: 'shield',
    name: 'Щиты',
    one: 'щит',
    icon: '🛡️',
    description: 'Доски и бычья кожа. С ним строй держится.',
    cost: { wood: 6, hides: 4 },
    work: 100,
  },
  {
    id: 'sword',
    name: 'Мечи',
    one: 'меч',
    icon: '🗡️',
    description: 'Сталь, перекованная не раз. Стоит как добрый конь.',
    cost: { copper: 8, iron: 4 },
    work: 175,
  },
  {
    id: 'armor',
    name: 'Доспехи',
    one: 'доспех',
    icon: '🦺',
    description: 'Пластины на кожаной основе. Латника берут не всякой стрелой.',
    cost: { iron: 10, hides: 6 },
    work: 275,
  },
];

export const EQUIPMENT_BY_ID: Record<EquipmentId, EquipmentDef> = Object.fromEntries(
  EQUIPMENT.map((e) => [e.id, e]),
) as Record<EquipmentId, EquipmentDef>;

export const EQUIPMENT_IDS: EquipmentId[] = EQUIPMENT.map((e) => e.id);

export const emptyEquipment = (): Record<EquipmentId, number> => ({
  spear: 0,
  bow: 0,
  axe: 0,
  shield: 0,
  sword: 0,
  armor: 0,
});
