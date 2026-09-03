// Войска. Лестница повторяет военную ветку технологий: каждый следующий боец
// требует того снаряжения, которое открывает следующая технология.
//
// Боец — это не житель со «профессией воин», а единица в счётчике `s.army`.
// Цена найма: ресурсы + снаряжение + один свободный житель + время в казармах.
import type { EquipmentId, ResourceId, TechId, TroopId } from '../types';

export interface TroopDef {
  id: TroopId;
  name: string;
  /** Единственное число — для строк вида «1 копейщик». */
  one: string;
  icon: string;
  description: string;
  /** Снаряжение на одного бойца. Пусто — дубинщику хватает палки. */
  gear: Partial<Record<EquipmentId, number>>;
  /** Ресурсы на одного бойца: припас в дорогу. */
  cost: Partial<Record<ResourceId, number>>;
  /** Работа казарм на одного бойца. */
  work: number;
  /** Вклад в мощь армии и в оборону поселения. */
  power: number;
  /** Технология, после которой боец появляется в списке. Пусто — доступен сразу. */
  requiresTech?: TechId;
}

/** От слабого к сильному. В этом же порядке боец идёт в список казарм. */
export const TROOPS: TroopDef[] = [
  {
    id: 'clubman',
    name: 'Дубинщики',
    one: 'дубинщик',
    icon: '🪃',
    description: 'Мужик с дубиной. Снаряжения не просит, но и стоит немного.',
    gear: {},
    cost: { food: 10, wood: 4 },
    work: 15,
    power: 2,
  },
  {
    id: 'spearman',
    name: 'Копейщики',
    one: 'копейщик',
    icon: '🔱',
    description: 'Держит строй и не пускает чужих на площадь.',
    gear: { spear: 1 },
    cost: { food: 14 },
    work: 25,
    power: 4,
    requiresTech: 'spears',
  },
  {
    id: 'archer',
    name: 'Лучники',
    one: 'лучник',
    icon: '🏹',
    description: 'Бьёт с частокола, до рукопашной дело доводит редко.',
    gear: { bow: 1 },
    cost: { food: 14, hides: 2 },
    work: 35,
    power: 5,
    requiresTech: 'bows',
  },
  {
    id: 'axeman',
    name: 'Топорники',
    one: 'топорник',
    icon: '🪓',
    description: 'Тяжёлая рука набега: рубит и щиты, и ворота.',
    gear: { axe: 1 },
    cost: { food: 18, wood: 4 },
    work: 45,
    power: 7,
    requiresTech: 'axes',
  },
  {
    id: 'swordsman',
    name: 'Мечники',
    one: 'мечник',
    icon: '🗡️',
    description: 'Кованый клинок в опытной руке. Дорого и решительно.',
    gear: { sword: 1 },
    cost: { food: 22 },
    work: 60,
    power: 9,
    requiresTech: 'swords',
  },
  {
    id: 'shieldman',
    name: 'Щитоносцы',
    one: 'щитоносец',
    icon: '🛡️',
    description: 'Меч и щит: стена, о которую разбивается набег.',
    gear: { sword: 1, shield: 1 },
    cost: { food: 26 },
    work: 75,
    power: 12,
    requiresTech: 'shields',
  },
  {
    id: 'legionary',
    name: 'Латники',
    one: 'латник',
    icon: '🦺',
    description: 'Меч, щит и доспех. Дружина раннего государства.',
    gear: { sword: 1, shield: 1, armor: 1 },
    cost: { food: 32, iron: 4 },
    work: 100,
    power: 16,
    requiresTech: 'armor',
  },
];

export const TROOP_BY_ID: Record<TroopId, TroopDef> = Object.fromEntries(
  TROOPS.map((t) => [t.id, t]),
) as Record<TroopId, TroopDef>;

export const TROOP_IDS: TroopId[] = TROOPS.map((t) => t.id);

export const emptyArmy = (): Record<TroopId, number> => ({
  clubman: 0,
  spearman: 0,
  archer: 0,
  axeman: 0,
  swordsman: 0,
  shieldman: 0,
  legionary: 0,
});
