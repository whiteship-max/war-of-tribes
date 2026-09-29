// Мост между девятью видами бойцов племени и пятью родами полевого боя.
// Ядро (`src/battle/`) про племя не знает и знать не должно — отображение живёт
// здесь. Обратная зависимость запрещена: отсюда в ядро только типы.
import type { EquipmentId, TroopId } from '../types';
import { TROOP_BY_ID, TROOP_IDS, type TroopDef } from '../data/troops';
import { KIND_PROFILE, UNIT_KINDS, type Profile, type UnitKind } from '@/battle';

/**
 * Каким родом вид выходит в поле — **выводится из его снаряжения**, а не из таблицы рядом.
 * Лук — лучники; верхом — конница, и класс её решает доспех (в доспехе — тяжёлая); одно
 * копьё и больше ничего — копья; всё остальное — пехота.
 *
 * Правило, а не список: заведи вид с луком — он станет лучником сам. Рукописная таблица
 * рядом с `TroopDef.gear` была бы второй правдой о том же бойце (docs/stable.md, раздел 1).
 */
export function kindOfTroop(def: TroopDef): UnitKind {
  if (def.gear.bow) return 'archer';
  if (def.mounted) return def.gear.armor ? 'heavy' : 'cavalry';
  const items = Object.entries(def.gear).filter(([, n]) => (n ?? 0) > 0);
  if (items.length === 1 && items[0][0] === 'spear') return 'spear';
  return 'infantry';
}

/**
 * Показатели вида в бою — показатели его рода (`KIND_PROFILE`), и только они: вещи своих показателей не дают, в бой они
 * идут через цену вида и его вес (слово владельца по 14.35, путь П2; `game/battle/price`). Одна дверь на карточку, мощь
 * профиля и отчёты.
 */
export const profileOfTroop = (troop: TroopId): Profile => KIND_PROFILE[kindOfTroop(TROOP_BY_ID[troop])];

/** Кто из племени каким родом выходит в поле. Все пять родов закрыты. */
export const KIND_OF: Record<TroopId, UnitKind> = Object.fromEntries(
  TROOP_IDS.map((id) => [id, kindOfTroop(TROOP_BY_ID[id])]),
) as Record<TroopId, UnitKind>;

/** Виды племени, выходящие этим родом, — в порядке списка казарм. */
export const TROOPS_OF_KIND: Record<UnitKind, TroopId[]> = UNIT_KINDS.reduce(
  (acc, k) => {
    acc[k] = TROOP_IDS.filter((id) => KIND_OF[id] === k);
    return acc;
  },
  {} as Record<UnitKind, TroopId[]>,
);

/** Роды, которые племя вообще способно выставить: пустые в интерфейсе не показываются. */
export const OWN_KINDS: UnitKind[] = UNIT_KINDS.filter((k) => TROOPS_OF_KIND[k].length > 0);

/**
 * Мощь мира на одного человека в поле. Дубинщик (power 2) — единица измерения: мощь логова, отряда набега и ополчения
 * переводится в людей этим делителем (`garrison.menOfPower`, `bridge.militiaMen`), а обратно — мощь дома складывается из
 * мощи видов (`troopPower`, `defense()`).
 *
 * **Весов у вида два, и путать их нельзя** (слово владельца по 14.35, путь П2; долг — docs/battle_eu4.md, 14.35): в бою вид
 * весит столько, сколько стоит (`price.battleWeight`: содержание вида к содержанию дубинщика), а в хозяйстве и мире — по
 * мощи (`powerWeight`: жалованье с бойца строя, места лазарета, мощь логова и дома). Свести их — при перемере мира.
 */
export const BATTLE_MAN = 2;

/**
 * Вес вида по мощи: мощь / `BATTLE_MAN`, дубинщик — один, латник — восемь. Им меряется хозяйство — жалованье с бойца
 * строя (`derived.wageOf`), — а в бою вид весит по цене (`price.battleWeight`).
 */
export const powerWeight = (troop: TroopId): number => TROOP_BY_ID[troop].power / BATTLE_MAN;

/** Сколько кого в племени. Отдельный тип, чтобы не таскать полный `Army` с нулями. */
export type TroopStack = Partial<Record<TroopId, number>>;

export const troopTotal = (t: TroopStack): number =>
  TROOP_IDS.reduce((n, id) => n + Math.max(0, t[id] ?? 0), 0);

/**
 * Мощь состава — сумма мощи каждого бойца (`TroopDef.power`): шкала мира, та же, которой набег переводится в людей
 * (`garrison.menOfPower`). В бою вид весит по цене (`price.battleWeight`) — это второй вес, и долг их свести записан.
 * Мощь всего войска, тех, кто дома, дружины и лагеря считается этой дверью, а не средним на число: латник, ушедший в
 * поле, уносит мощь латника, а не мощь среднего бойца.
 */
export const troopPower = (t: TroopStack): number =>
  TROOP_IDS.reduce((n, id) => n + Math.max(0, t[id] ?? 0) * TROOP_BY_ID[id].power, 0);

/**
 * Ступень снаряжения вида — число предметов кузницы на бойце: дубинщику хватает палки (0), латнику нужны меч, щит и доспех
 * (3). В бою ступень своего не даёт — ни морали, ни показателей (путь П2): вещи идут туда через цену вида. Читают её
 * жалованье за снаряжение (`derived.wageGear`) и показ — фигура и ролик, чем одет боец.
 */
export const gearOfTroop = (troop: TroopId): number => Object.values(TROOP_BY_ID[troop].gear).reduce((n, v) => n + (v ?? 0), 0);

/**
 * Что боец держит в руках. Выводится из его снаряжения (`TroopDef.gear` в
 * data/troops.ts), а не задаётся второй таблицей: снаряжение — единственное
 * место, где записано, чем вооружён вид, и всё остальное следует за ним.
 * Из этого же поля карточка вида берёт список предметов на ковку, а фигура в
 * сцене — что вложить в руку. Пусто в `gear` — значит из кузницы на бойце нет
 * ничего, и в руках у него дубина.
 */
export type WeaponKind = 'club' | 'spear' | 'bow' | 'axe' | 'sword';

/**
 * Порядок разбора: если предметов несколько, главным считается тот, что выше.
 * Щит и доспех оружием не считаются — они разбираются отдельно.
 */
const WEAPON_BY_GEAR: [EquipmentId, WeaponKind][] = [
  ['bow', 'bow'],
  ['axe', 'axe'],
  ['sword', 'sword'],
  ['spear', 'spear'],
];

export function weaponOf(troop: TroopId): WeaponKind {
  const gear = TROOP_BY_ID[troop].gear;
  for (const [item, weapon] of WEAPON_BY_GEAR) if (gear[item]) return weapon;
  return 'club';
}

/** Есть ли у вида щит. Тот же конфиг, что и у карточки. */
export const hasShield = (troop: TroopId): boolean => (TROOP_BY_ID[troop].gear.shield ?? 0) > 0;

/** Есть ли у вида доспех. По нему различаются щитоносец и латник. */
export const hasArmor = (troop: TroopId): boolean => (TROOP_BY_ID[troop].gear.armor ?? 0) > 0;

/** Ступень снаряжения рода в составе — средняя по головам: по ней показ одевает чужой отряд (`faces.troopsOfKinds`). */
export function gearOf(t: TroopStack): Partial<Record<UnitKind, number>> {
  const out: Partial<Record<UnitKind, number>> = {};
  for (const k of UNIT_KINDS) {
    let men = 0;
    let sum = 0;
    for (const id of TROOPS_OF_KIND[k]) {
      const n = Math.max(0, t[id] ?? 0);
      if (n <= 0) continue;
      men += n;
      sum += n * gearOfTroop(id);
    }
    if (men > 0) out[k] = Math.round(sum / men);
  }
  return out;
}

/** Вычитает потери из состава. Отрицательных остатков не бывает. */
export function troopsAfter(t: TroopStack, lost: TroopStack): TroopStack {
  const out: TroopStack = {};
  for (const id of TROOP_IDS) {
    const n = Math.max(0, (t[id] ?? 0) - (lost[id] ?? 0));
    if (n > 0) out[id] = n;
  }
  return out;
}
