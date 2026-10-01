// Кто как выглядит: горожане, восемь видов бойцов и конь. Здесь и только здесь
// написано, из каких деталей собрана фигура; сама сборка (примитивы, суставы,
// инстансы) живёт в figures.ts, движение — в poses.ts.
//
// Пропорции не выдуманы, а обмерены по эталону LowPolySaxonSoldier.fbx —
// вся таблица долей и вывод из неё в docs/figures.md. Правило одно: высоты
// суставов — доли роста, поэтому крупный и мелкий вид отличаются одним числом,
// а не своей таблицей смещений.
//
// Главный критерий — силуэт: на боевом масштабе восемь видов обязаны различаться
// чёрными пятнами без подписей. Поэтому вид опознаётся оружием и щитом, а не
// цветом, и ближайшие пары разведены нарочно: копейщик держит древко высоко над
// головой, мечник — клинок низко и вперёд; у щитоносца круглый щит, у латника —
// ростовой прямоугольный, гребень на шлеме и самый широкий корпус.
import * as THREE from 'three';
import type { TroopId } from '@/game/types';
import { TROOP_BY_ID } from '@/game/data/troops';
import { gearOfTroop, hasArmor, hasShield, weaponOf } from '@/game/battle/kinds';
import { Figure, addSlot, gripFrame, type MountRig, type Rig } from './figures';
import { FOLK_TINT, HERO_TINT, PALETTE } from './palette';

/** Рост взрослой фигуры в метрах сцены — тот же, что был у прежних фигурок. */
export const MAN_HEIGHT = 1.05;

/**
 * Длина копья долей роста. Отсюда её берёт и копьё в руке, и лес древков
 * (`render/battle/mass.ts`): древко в лесу — это оружие бойца, которого не
 * нарисовали, и мерить его надо тем же, чем меряют оружие в руке. Двух длин
 * одного копья быть не должно — иначе лес выходит выше строя без причины.
 */
export const SPEAR_LEN = 1.4;
/** Конный держит копьё наперевес, и оно короче: длинное не удержать одной рукой. */
export const SPEAR_LEN_MOUNTED = 1.1;

/**
 * Голов в росте. Эталон даёт 6.6 — реалистично и на 390 px нечитаемо. Игре нужна
 * голова крупнее, но не мультяшная: 5 — героическая пропорция; у прежних фигурок
 * было 3.5, то есть уже чибик. Ниже четырёх начинается кукла.
 */
const HEADS = 5;

/**
 * Доли роста эталона (docs/figures.md). Ниже подбородка фигура — уменьшенная
 * копия эталона: голова выросла, а рост остался, значит всё остальное ужалось.
 */
const REF = {
  chin: 0.849,
  neck: 0.832,
  shoulder: 0.785,
  wrist: 0.447,
  hip: 0.48,
  ankle: 0.012,
  /** Ширина головы и её глубина — доли от высоты головы. */
  headWide: 0.74,
  headDeep: 0.74,
} as const;

/** Скелет человека заданного роста. `build` — плотность сложения. */
export function humanRig(height = MAN_HEIGHT, build = 1): Rig {
  const headH = height / HEADS;
  const k = (height - headH) / (REF.chin * height);
  const at = (frac: number): number => frac * height * k;
  return {
    height,
    hipY: at(REF.hip),
    hipX: height * 0.046 * build,
    shoulderY: at(REF.shoulder),
    shoulderX: height * 0.105 * build,
    armLen: at(REF.shoulder) - at(REF.wrist),
    legLen: at(REF.hip) - height * REF.ankle,
    neckY: at(REF.neck),
    straddle: 0,
    seat: 0,
    mount: null,
  };
}

/** Размеры, которые нужны при одевании, но суставам не нужны. */
export interface Body {
  rig: Rig;
  headH: number;
  headCenter: number;
  /** Высота корпуса: таз → основание шеи. */
  torsoH: number;
  /** Ширина корпуса вверху (плечи) и внизу — примитив сужается книзу сам. */
  chestW: number;
  legLen: number;
  legW: number;
  armW: number;
}

export function bodyOf(rig: Rig, build: number): Body {
  const h = rig.height;
  const headH = h / HEADS;
  return {
    rig,
    headH,
    headCenter: h - headH / 2,
    torsoH: rig.neckY - rig.hipY,
    chestW: h * 0.235 * build,
    legLen: rig.legLen,
    legW: h * 0.078 * build,
    armW: h * 0.053 * build,
  };
}

// ---------- Общее тело ----------

/**
 * Голое тело: ноги, руки, корпус, голова. Одежда — это цвета, а не отдельные
 * детали: на боевом масштабе рукав от руки не отличить, а инстанс стоит денег.
 */
export function torso(f: Figure, b: Body, cloth: number, legs: number, skin: number): void {
  const { rig } = b;
  for (const [upper, lower] of [['legL', 'kneeL'], ['legR', 'kneeR']] as const) {
    addSlot(f, 'limb', upper, legs, [0, 0, 0], [b.legW, b.legLen * 0.51, b.legW * 1.12]);
    addSlot(f, 'limb', lower, legs, [0, 0, b.legW * 0.08], [b.legW * 0.78, b.legLen * 0.5, b.legW * 1.05]);
  }
  // Руки чуть позади линии груди: иначе они висят отдельно от корпуса.
  for (const [upper, lower] of [['armL', 'elbowL'], ['armR', 'elbowR']] as const) {
    addSlot(f, 'limb', upper, cloth, [0, 0, 0], [b.armW * 1.3, rig.armLen * 0.53, b.armW * 1.2]);
    addSlot(f, 'limb', lower, skin, [0, 0, 0], [b.armW, rig.armLen * 0.5, b.armW * 1.08]);
  }
  addSlot(f, 'body', 'torso', cloth, [0, 0, 0], [b.chestW, b.torsoH, b.chestW * 0.68]);
  addSlot(f, 'head', 'head', PALETTE.skin, [0, b.headCenter - rig.neckY, 0], [
    b.headH * REF.headWide,
    b.headH,
    b.headH * REF.headDeep,
  ]);
}

/** Шапка, капюшон или шлем поверх головы. `tall` — во сколько раз выше плоской. */
export function headwear(f: Figure, b: Body, color: number, tall: number, drop = 0): void {
  // Основание конуса лежит на верхней части головы: низкая посадка
  // прятала конус внутри черепа и оставляла макушку снаружи.
  const y = b.headCenter - b.rig.neckY + b.headH * (0.35 - drop);
  addSlot(f, 'cap', 'head', color, [0, y, 0], [b.headH * REF.headWide * 1.06, b.headH * tall, b.headH * REF.headDeep * 1.06]);
}

/** Шея заменяет отдельный пояс: сохраняем число деталей и соединяем голову с грудью. */
export function neck(f: Figure, b: Body): void {
  addSlot(f, 'shaft', 'head', PALETTE.skin, [0, -b.headH * 0.13, 0], [b.headH * 0.38, b.headH * 0.4, b.headH * 0.4]);
}

/** Старые координаты хвата заданы от плеча; переносим их к подвижной кисти. */
function attachHands(f: Figure, start: number, armLen: number): void {
  const shift = new THREE.Matrix4().makeTranslation(0, armLen, 0);
  for (let i = start; i < f.slots.length; i++) {
    const slot = f.slots[i];
    if (slot.joint !== 'armL' && slot.joint !== 'armR') continue;
    slot.joint = slot.joint === 'armL' ? 'handL' : 'handR';
    slot.local.premultiply(shift);
  }
}

// ---------- Горожане ----------

/** Сколько покроев у костра. Ролей у жителей нет, различаются только видом. */
export const FOLK_KINDS = 3;

/**
 * Горожанин одного из трёх покроев. Толпа у костра не должна выглядеть
 * штампованной, а различать их по работе не за что: население — число.
 */
export function dressVillager(f: Figure, kind: number): void {
  const k = ((kind % FOLK_KINDS) + FOLK_KINDS) % FOLK_KINDS;
  // Рост и сложение у покроев разные: одежда одеждой, но толпа не должна быть
  // одним человеком в трёх рубахах.
  const height = MAN_HEIGHT * [1, 0.93, 0.89][k];
  const build = [0.94, 1.08, 0.92][k];
  const cloth = FOLK_TINT[k];
  const rig = humanRig(height, build);
  const b = bodyOf(rig, build);
  f.strip();
  f.rig = rig;

  if (k === 2) {
    // Долгополая одежда: корпус спускается до щиколоток, ног почти не видно.
    // Перевёрнутый корпус расширяется книзу — это и есть подол.
    torso(f, b, cloth, cloth, PALETTE.skin);
    neck(f, b);
    addSlot(f, 'body', 'hips', cloth, [0, b.rig.hipY * 0.02, 0], [b.chestW * 1.34, b.rig.hipY, b.chestW * 0.98], [Math.PI, 0, 0]);
    headwear(f, b, PALETTE.hair, 0.38, 0.04);
    // Ноша за спиной: узел на верёвке — второй заметный признак этого покроя.
    addSlot(f, 'plate', 'torso', PALETTE.barrel, [0, b.torsoH * 0.62, -b.chestW * 0.5], [b.chestW * 0.72, b.torsoH * 0.5, b.chestW * 0.34]);
    return;
  }

  torso(f, b, cloth, PALETTE.leather, PALETTE.skin);
  neck(f, b);
  if (k === 1) {
    // Капюшон: выше и ниже надвинут, чем волосы, — силуэт головы другой.
    headwear(f, b, PALETTE.woodDark, 1.02, 0.16);
    // Посох в руке: третий силуэт у костра — с вертикальной палкой.
    const grip = gripFrame([0, -b.rig.armLen, b.chestW * 0.2], [0, 0, -0.1]);
    addSlot(f, 'shaft', 'armR', PALETTE.stake, [0, -b.rig.hipY * 0.85, 0], [0.028, height * 0.92, 0.028], [0, 0, 0], grip);
    attachHands(f, f.slots.length - 1, rig.armLen);
  } else {
    headwear(f, b, PALETTE.hair, 0.34);
  }
}

// ---------- Бойцы ----------

/**
 * Ступень снаряжения из кузницы, 0..3 — число предметов на бойце. Считает её
 * `gearOfTroop`: правило записано один раз, и фигура следует за ним.
 */
export const gearTier = (troop: TroopId): number => gearOfTroop(troop);

/**
 * Рост и сложение по виду. Оружие с полуоборота может уйти за корпус, а рост
 * и ширина видны всегда — поэтому лестница различается ещё и сложением:
 * дубинщик — мужик поменьше, латник — крупный человек в железе.
 */
const SIZE: Record<TroopId, { height: number; build: number }> = {
  clubman: { height: 0.95, build: 0.92 },
  spearman: { height: 1, build: 1 },
  archer: { height: 0.98, build: 0.93 },
  axeman: { height: 1.02, build: 1.08 },
  swordsman: { height: 1, build: 1 },
  shieldman: { height: 1, build: 1.08 },
  rider: { height: 1, build: 1 },
  knight: { height: 1.03, build: 1.12 },
  legionary: { height: 1.05, build: 1.16 },
};

/**
 * Доспех по ступени снаряжения. Кузница обязана читаться на поле, а не только
 * в цифрах на карточке, поэтому каждая ступень добавляет заметное железо:
 * 1 — шлем, 2 — кираса и наплечники, 3 — гребень на шлеме и поножи.
 */
function armorUp(f: Figure, b: Body, tier: number): void {
  const { rig } = b;
  if (tier >= 2) {
    addSlot(f, 'plate', 'torso', PALETTE.armor, [0, b.torsoH * 0.6, b.chestW * 0.3], [b.chestW * 0.84, b.torsoH * 0.56, b.chestW * 0.3]);
    for (const s of [1, -1]) {
      addSlot(f, 'plate', 'torso', PALETTE.armor, [s * rig.shoulderX, rig.shoulderY - rig.hipY + b.armW * 0.1, 0], [
        b.armW * 2.1,
        b.armW * 1.1,
        b.armW * 2.3,
      ]);
    }
  }
  if (tier >= 3) {
    // Гребень: продольный плавник на шлеме. В силуэте он и отличает латника.
    addSlot(f, 'plate', 'head', PALETTE.paintRed, [0, b.headCenter - rig.neckY + b.headH * 0.72, 0], [
      b.headH * 0.15,
      b.headH * 0.62,
      b.headH * 1.08,
    ]);
    for (const j of ['kneeL', 'kneeR'] as const) {
      addSlot(f, 'plate', j, PALETTE.armor, [0, -b.legLen * 0.25, b.legW * 0.45], [b.legW, b.legLen * 0.48, b.legW * 0.5]);
    }
  }
}

/**
 * Круглый щит на левой руке. Поле щита красится цветом стороны, а не деревом:
 * на поле боя щит — самая большая плоскость бойца, и по ней сторона читается
 * раньше, чем по рубахе. Цвет у бойца один на всех деталях.
 */
function roundShield(f: Figure, b: Body, size: number, cloth: number): void {
  // Просвет до кирасы нужен и при отведённом назад предплечье в шаге.
  const front = b.chestW * 0.8;
  addSlot(f, 'shield', 'armL', cloth, [0, -b.rig.armLen * 0.56, front], [size, size, size * 0.08]);
  addSlot(f, 'plate', 'armL', PALETTE.armor, [0, -b.rig.armLen * 0.56, front + size * 0.06], [size * 0.24, size * 0.24, size * 0.06]);
}

/**
 * Меч: рукоять, перекрестье, клинок. Клинок вынесен наружу — оружие,
 * прижатое к боку, в силуэте не существует, а к камере
 * направленное сокращается в точку. Наружу и вверх видно с любой стороны.
 */
function sword(f: Figure, b: Body, len: number, out: number): void {
  const grip = gripFrame([0, -b.rig.armLen, b.chestW * 0.16], [0.12, 0, out]);
  addSlot(f, 'shaft', 'armR', PALETTE.leather, [0, 0, 0], [0.032, len * 0.2, 0.032], [0, 0, 0], grip);
  addSlot(f, 'plate', 'armR', PALETTE.metal, [0, len * 0.21, 0], [len * 0.32, 0.03, 0.032], [0, 0, 0], grip);
  addSlot(f, 'plate', 'armR', PALETTE.metal, [0, len * 0.22 + len * 0.42, 0], [len * 0.105, len * 0.84, 0.025], [0, 0, 0], grip);
}

/**
 * Ростовой прямоугольный щит: от голени до плеча. Его носит тот, кто в доспехе;
 * у остальных щит круглый и заметно выше — на этом держится разница ближайшей
 * пары, щитоносца и латника.
 */
function towerShield(f: Figure, b: Body, h: number, cloth: number): void {
  const w = h * 0.31;
  const front = b.chestW * 0.8;
  addSlot(f, 'plate', 'armL', cloth, [0, -b.rig.armLen * 0.9, front], [w, h * 0.66, 0.035]);
  addSlot(f, 'plate', 'armL', PALETTE.armor, [0, -b.rig.armLen * 0.9, front + 0.022], [w * 0.22, w * 0.22, 0.03]);
}

/** Одевает бойца этого вида. Всё, что видно на поле, решается здесь. */
export function dressSoldier(f: Figure, troop: TroopId, cloth: number = PALETTE.paintBlue): void {
  const { height: tall, build } = SIZE[troop];
  const h = MAN_HEIGHT * tall;
  const tier = gearTier(troop);
  const rig = humanRig(h, build);
  const b = bodyOf(rig, build);
  f.strip();
  f.rig = rig;
  torso(f, b, cloth, PALETTE.leather, PALETTE.skin);
  neck(f, b);
  // Шлем — с первой же ступени снаряжения; дубинщику остаются волосы.
  if (tier >= 1) headwear(f, b, PALETTE.armor, 0.62, 0.06);
  else headwear(f, b, PALETTE.hair, 0.34);

  // Что в руках и есть ли щит — не таблица по видам, а следствие снаряжения
  // из data/troops.ts: тот же конфиг, из которого карточка вида берёт список
  // предметов на ковку. Правка `gear` в конфиге меняет и текст карточки, и то,
  // что видно на поле, — двух описаний одного бойца в игре быть не должно.
  const shield = hasShield(troop);
  const heavy = hasArmor(troop);
  const mounted = TROOP_BY_ID[troop].mounted === true;

  if (mounted) dressHorse(f, b, heavy ? cloth : null);
  const heldStart = f.slots.length;

  // Щит: ростовой у того, кто в доспехе, круглый у остальных. Это и разводит
  // ближайшую пару — щитоносца и латника, — а цветом её было бы не развести.
  if (shield) {
    if (heavy) towerShield(f, b, h, cloth);
    else roundShield(f, b, h * (mounted ? 0.34 : 0.43), cloth);
  }

  switch (weaponOf(troop)) {
    case 'club': {
      // Дубина: короткая и толстая, с тяжёлым концом, отведена вбок почти
      // горизонтально. Самый простой силуэт лестницы — короткий обрубок у пояса.
      const len = h * 0.3;
      const grip = gripFrame([0, -rig.armLen, b.chestW * 0.2], [0.28, 0, 1.05]);
      addSlot(f, 'shaft', 'armR', PALETTE.woodDark, [0, 0, 0], [0.05, len, 0.05], [0, 0, 0], grip);
      addSlot(f, 'plate', 'armR', PALETTE.woodDark, [0, len + 0.05, 0], [0.11, 0.13, 0.11], [0, 0, 0], grip);
      break;
    }
    case 'spear': {
      // Пеший держит копьё вертикально — оно уходит на треть роста выше головы,
      // и по этому копейщика не спутать с мечником. Конный берёт наперевес.
      const len = h * (mounted ? SPEAR_LEN_MOUNTED : SPEAR_LEN);
      const grip = mounted
        ? gripFrame([0, -rig.armLen, b.chestW * 0.3], [1.16, 0, -0.1])
        : gripFrame([0, -rig.armLen - len * 0.28, b.chestW * 0.26], [0, 0, -0.07]);
      const drop = mounted ? -len * 0.3 : 0;
      addSlot(f, 'shaft', 'armR', PALETTE.woodDark, [0, drop, 0], [0.032, len, 0.032], [0, 0, 0], grip);
      // Существующий конус даёт остриё, а не прямоугольный обрубок.
      addSlot(f, 'cap', 'armR', PALETTE.metal, [0, len + drop - 0.02, 0], [0.065, 0.18, 0.035], [0, 0, 0], grip);
      break;
    }
    case 'bow': {
      // Лук — два плеча под углом: настоящая дуга стоила бы своей геометрии, а
      // ломаная из двух конечностей в силуэте читается так же. Изгиб сделан
      // вбок, а не вперёд: спереди дуга должна быть видна дугой, иначе лук не
      // отличить от копья. Верх лука ниже макушки — этим он от копья и отличается.
      const half = h * 0.5;
      const bend = 0.5;
      const grip = gripFrame([0, -rig.armLen + h * 0.11, b.chestW * 0.34], [0, 0, -0.12]);
      addSlot(f, 'limb', 'armL', PALETTE.woodDark, [0, 0, 0], [0.026, half, 0.034], [0, 0, Math.PI - bend], grip);
      addSlot(f, 'limb', 'armL', PALETTE.woodDark, [0, 0, 0], [0.026, half, 0.034], [0, 0, bend], grip);
      // Колчан наискось за плечом — второй признак, видный со спины.
      addSlot(f, 'plate', 'torso', PALETTE.leather, [-b.chestW * 0.3, b.torsoH * 0.86, -b.chestW * 0.32], [0.08, h * 0.3, 0.08], [0.3, 0, 0.34]);
      // Оперение стрел торчит из колчана над плечом: второй признак лучника.
      addSlot(f, 'plate', 'torso', PALETTE.bone, [-b.chestW * 0.4, b.torsoH * 1.12, -b.chestW * 0.4], [0.05, h * 0.13, 0.05], [0.3, 0, 0.34]);
      break;
    }
    case 'axe': {
      // Длинный топор вынесен вперёд и вбок: широкое лезвие не прячется
      // за грудью с полуоборота. Копьё остаётся вертикалью, меч — низкой косой.
      const len = h * 0.94;
      const grip = gripFrame([0, -rig.armLen, b.chestW * 0.32], [0.65, 0, -0.42]);
      addSlot(f, 'shaft', 'armR', PALETTE.woodDark, [0, -len * 0.16, 0], [0.04, len, 0.04], [0, 0, 0], grip);
      addSlot(f, 'plate', 'armR', PALETTE.metal, [0.095, len * 0.76, 0], [0.23, 0.18, 0.055], [0, 0, 0.1], grip);
      addSlot(f, 'plate', 'armR', PALETTE.metal, [-0.03, len * 0.78, 0], [0.06, 0.12, 0.045], [0, 0, 0], grip);
      break;
    }
    case 'sword': {
      // Со щитом клинок короткий и почти прижат, без щита — вынесен низко и
      // вперёд, линией от бедра. Иначе мечника не отличить от щитоносца со спины.
      if (shield) sword(f, b, h * (heavy ? 0.54 : 0.42), heavy ? 0.42 : 0.3);
      else sword(f, b, h * 0.72, 1.02);
      break;
    }
  }
  attachHands(f, heldStart, rig.armLen);
  armorUp(f, b, tier);
}

/**
 * Герой племени. Одевается тем же `dressSoldier` и по тому же виду бойца, что и
 * дружина: второго набора правил о том, как выглядит боец, в игре быть не должно.
 * Своего у героя ровно две вещи — рост и плащ за спиной, и обе не про снаряжение.
 * Сменил род в Статуе — сменился и силуэт на площади.
 */
export function dressHero(f: Figure, troop: TroopId): void {
  dressSoldier(f, troop);
  const { height: tall, build } = SIZE[troop];
  const b = bodyOf(humanRig(MAN_HEIGHT * tall, build), build);
  // Две сплюснутые шестигранные массы дают складки и расширяющийся подол.
  // Подол отклоняется отдельно от плеч; скиннинга и отдельного материала нет.
  f.hasCape = true;
  addSlot(f, 'body', 'cape', HERO_TINT.cloak, [0, 0.02, 0], [b.chestW * 1.1, b.torsoH * 0.6, b.chestW * 0.24], [Math.PI, 0, 0]);
  addSlot(f, 'body', 'capeHem', HERO_TINT.cloak, [0, 0.015, 0], [b.chestW * 1.5, b.torsoH * 0.95, b.chestW * 0.32], [Math.PI, 0, 0]);
}

// ---------- Конь ----------

/**
 * Скелет коня. Числа — доли роста человека: 1.05 в сцене — это 1.79 м эталона,
 * значит верховая лошадь в холке 1.55 м — это 0.91, спина под седлом — 0.83.
 * Конь считается от всадника, а не сам по себе: он и нужен только под ним.
 */
export function mountRig(height = MAN_HEIGHT): MountRig {
  return {
    backY: height * 0.82,
    barrelH: height * 0.36,
    bodyLen: height * 0.94,
    bodyW: height * 0.38,
    legY: height * 0.67,
    legX: height * 0.115,
    legZ: height * 0.32,
    legLen: height * 0.665,
    // Шея выходит из бочки, а не стоит на ней: основание ниже верха спины.
    neckY: height * 0.70,
    neckZ: height * 0.34,
    neckLen: height * 0.43,
    neckPitch: 0.45,
    tailY: height * 0.70,
    tailZ: -height * 0.35,
  };
}

/**
 * Конь под фигурой: корпус, шея, голова, четыре ноги, хвост. Отдельной модели
 * у всадника нет — это то же тело, посаженное сверху, поэтому конь и добавляется
 * к фигуре, а не рисуется рядом.
 *
 * `caparison` — цвет попоны, `null` — без неё. Попона у коня того, кто в доспехе: латного
 * всадника иначе не отличить от лёгкого — оба в шлеме, с копьём наперевес и на том же коне, а
 * круглый щит против ростового с полуоборота прячется за корпус. Попона закрывает бочку и
 * верх ног с любой стороны и красится стороной, как всё на бойце.
 */
export function dressHorse(f: Figure, b: Body, caparison: number | null = null): void {
  const h = b.rig.height;
  const m = mountRig(h);
  f.rig.mount = m;
  // Посадка: таз на седле, колени разведены и вынесены вперёд.
  const lift = m.backY + h * 0.05 - f.rig.hipY;
  f.rig.hipY += lift;
  // Суставы туловища вычисляются как разность высот: переносим весь
  // верх тела вместе с тазом, сохраняя длины плеча и шеи относительно него.
  f.rig.shoulderY += lift;
  f.rig.neckY += lift;
  f.rig.hipX = h * 0.09;
  f.rig.straddle = 0.4;
  f.rig.seat = 0.45;

  const coat = PALETTE.horseCoat;
  // Тот же гранёный шар, что у головы: округлые грудь и круп вместо бруса.
  addSlot(f, 'head', 'root', coat, [0, m.backY - m.barrelH / 2, 0], [m.bodyW, m.barrelH, m.bodyLen]);
  // Шея растёт от головы вниз к холке: широкий конец примитива должен быть внизу.
  addSlot(f, 'body', 'neck', coat, [0, m.neckLen * 0.98, 0], [m.bodyW * 0.66, m.neckLen * 1.12, m.bodyW * 0.86], [Math.PI, 0, 0]);
  addSlot(f, 'limb', 'neck', PALETTE.horseMane, [0, m.neckLen, -m.bodyW * 0.30], [m.bodyW * 0.12, m.neckLen, m.bodyW * 0.18], [-0.07, 0, 0]);
  // Голова собирается в своей системе: ось Y вдоль морды, вперёд и чуть вниз.
  const skull = gripFrame([0, m.neckLen * 0.98, 0], [1.65, 0, 0]);
  // Одна сужающаяся к морде масса вместо шара с приставленным коробом.
  addSlot(f, 'body', 'neck', coat, [0, h * 0.24, 0], [h * 0.18, h * 0.31, h * 0.22], [Math.PI, 0, 0], skull);
  for (const side of [-1, 1]) {
    addSlot(f, 'cap', 'neck', coat, [side * h * 0.052, m.neckLen + h * 0.02, -h * 0.04], [h * 0.065, h * 0.14, h * 0.07], [-0.2, 0, -side * 0.18]);
  }
  for (const [upper, lower, hind] of [
    ['legFL', 'hockFL', false], ['legFR', 'hockFR', false],
    ['legBL', 'hockBL', true], ['legBR', 'hockBR', true],
  ] as const) {
    addSlot(f, 'limb', upper, coat, [0, 0, 0], [h * (hind ? 0.105 : 0.075), m.legLen * 0.46, h * (hind ? 0.13 : 0.085)]);
    addSlot(f, 'limb', lower, coat, [0, 0, h * 0.008], [h * 0.043, m.legLen * 0.56, h * 0.06]);
  }
  addSlot(f, 'limb', 'tail', PALETTE.horseMane, [0, 0, 0], [h * 0.06, h * 0.34, h * 0.07]);
  addSlot(f, 'plate', 'root', PALETTE.leather, [0, m.backY + h * 0.015, -h * 0.02], [m.bodyW * 1.06, h * 0.045, h * 0.19]);
  if (caparison !== null) {
    addSlot(f, 'plate', 'root', caparison, [0, m.backY - m.barrelH / 2 - h * 0.1, 0], [m.bodyW * 1.14, m.barrelH + h * 0.24, m.bodyLen * 1.08]);
  }
}

/** Одна лошадь без всадника — стенду, чтобы обмерить и посмотреть отдельно. */
export function dressMount(f: Figure): void {
  const rig = humanRig();
  f.strip();
  f.rig = rig;
  dressHorse(f, bodyOf(rig, 1));
}
