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
  /**
   * Ставка жалованья вида — во сколько раз с него платят «за силу» больше, чем с дубинщика (`data/upkeep.WAGE_MAN`). Задана
   * рукой, как цена; из неё и снаряжения выводится содержание вида, а из содержания — его вес в бою и мощь в мире
   * (`battle/price`). Прежде поле называлось мощью и весило вид в мире (мощь / 2 — эта ставка); вес у вида теперь один
   * (docs/remeasure.md, пункт 1).
   */
  grade: number;
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
    description: 'Мужик с дубиной. Снаряжения не просит и берёт числом.',
    gear: {},
    cost: { food: 10, wood: 4 },
    work: 15,
    grade: 1,
  },
  {
    id: 'spearman',
    name: 'Копейщики',
    one: 'копейщик',
    icon: '🔱',
    description: 'Держит строй и не пускает врага на площадь.',
    gear: { spear: 1 },
    cost: { food: 14 },
    work: 25,
    grade: 2,
  },
  {
    id: 'archer',
    name: 'Лучники',
    one: 'лучник',
    icon: '🏹',
    description: 'Бьёт со стены, в рукопашную идёт редко.',
    gear: { bow: 1 },
    cost: { food: 14, hides: 2 },
    work: 35,
    grade: 2.5,
  },
  {
    id: 'axeman',
    name: 'Топорники',
    one: 'топорник',
    icon: '🪓',
    description: 'Тяжёлая рука похода. Рубит щиты и ворота.',
    gear: { axe: 1 },
    cost: { food: 18, wood: 4 },
    work: 45,
    grade: 3.5,
  },
  {
    id: 'swordsman',
    name: 'Мечники',
    one: 'мечник',
    icon: '🗡️',
    description: 'Кованый клинок в опытной руке. Дорог, но решает бой.',
    gear: { sword: 1 },
    cost: { food: 22 },
    work: 60,
    grade: 4.5,
  },
  {
    id: 'shieldman',
    name: 'Щитоносцы',
    one: 'щитоносец',
    icon: '🛡️',
    description: 'Меч и щит. О такую стену разбивается набег.',
    gear: { sword: 1, shield: 1 },
    cost: { food: 26 },
    work: 75,
    grade: 6,
  },
  {
    id: 'rider',
    name: 'Всадники',
    one: 'всадник',
    icon: '🐎',
    description: 'Лёгкая конница без доспеха. Режет лучников и догоняет бегущих, о сомкнутые копья разбивается.',
    gear: { spear: 1, shield: 1 },
    cost: { food: 40, wood: 8, hides: 12 },
    work: 90,
    grade: 7,
    mounted: true,
  },
  {
    id: 'knight',
    name: 'Латные всадники',
    one: 'латный всадник',
    icon: '🏇',
    description: 'Тяжёлая конница в доспехе. Ломает строй в лоб и стоит под стрелами, но копья держат и её.',
    gear: { spear: 1, shield: 1, armor: 1 },
    cost: { food: 26, wood: 5, hides: 8 },
    work: 103,
    grade: 7,
    mounted: true,
  },
  {
    id: 'legionary',
    name: 'Латники',
    one: 'латник',
    icon: '🦺',
    description: 'Меч, щит и доспех. Лучший боец на человека, но дороже всех в железе.',
    gear: { sword: 1, shield: 1, armor: 1 },
    cost: { food: 32, iron: 4 },
    work: 100,
    grade: 8,
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
