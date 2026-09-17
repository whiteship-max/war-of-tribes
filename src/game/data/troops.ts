// Войска. Все виды доступны с первого дня: никакой лестницы открытия нет, выбор
// между ними — тактический и экономический. Дешёвый боец стоит мало снаряжения
// и учится быстро, дорогой — сильнее на человека, а людей в посёлке немного.
//
// Боец — это не житель со «профессией воин», а единица в счётчике `s.army`.
// Цена найма: ресурсы + снаряжение + один свободный житель + время в казармах.
//
// Роды боя закрыты все четыре: копья, пехота, лучники и конница (всадник).
// Без конного вида у игрока были бы мертвы угол кольца «конница бьёт лучников»,
// план «кавалерийский удар», кавалерийские приказы и перехват обхода резервом —
// а у чужих гарнизонов конница есть, и кольцо работало бы в одну сторону.
import type { EquipmentId, ResourceId, TroopId } from '../types';

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
  /**
   * Конный вид. От этого зависит экономика конницы — конюшня ускоряет его учения
   * и даёт ему ступень снаряжения (см. derived.recruitRate и bridge). В бою род
   * определяет `battle/kinds.KIND_OF`, а не этот флаг: там своя таблица.
   */
  mounted?: boolean;
}

/** От дешёвого к дорогому — это порядок списка в казармах, а не порядок открытия. */
export const TROOPS: TroopDef[] = [
  {
    id: 'clubman',
    name: 'Дубинщики',
    one: 'дубинщик',
    icon: '🪃',
    description: 'Мужик с дубиной. Снаряжения не просит, но и стоит немного — дешёвая масса.',
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
  },
  {
    id: 'rider',
    name: 'Всадники',
    one: 'всадник',
    icon: '🐎',
    description: 'Лёгкая конница: доспеха нет, зато есть скорость. Режет лучников, заходит во фланг и догоняет бегущих, но строй в лоб не ломает и разбивается о сомкнутые копья. Нанимают в конюшне.',
    gear: { spear: 1, shield: 1 },
    cost: { food: 40, wood: 8, hides: 12 },
    work: 90,
    power: 14,
    mounted: true,
  },
  {
    id: 'knight',
    name: 'Латные всадники',
    one: 'латный всадник',
    icon: '🏇',
    description: 'Тяжёлая конница: тот же конь под доспехом. Ломает строй в лоб и стоит под стрелами, но манёвра у неё нет, и сомкнутые копья держат её так же. Конюшня открывает её с четвёртого уровня.',
    gear: { spear: 1, shield: 1, armor: 1 },
    cost: { food: 26, wood: 5, hides: 8 },
    work: 103,
    power: 14,
    mounted: true,
  },
  {
    id: 'legionary',
    name: 'Латники',
    one: 'латник',
    icon: '🦺',
    description: 'Меч, щит и доспех. Лучший боец на человека — и самый дорогой в железе.',
    gear: { sword: 1, shield: 1, armor: 1 },
    cost: { food: 32, iron: 4 },
    work: 100,
    power: 16,
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
  rider: 0,
  knight: 0,
  legionary: 0,
});
