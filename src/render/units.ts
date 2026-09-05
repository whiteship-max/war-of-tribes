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
import type { TroopId } from '@/game/types';
import { gearOfTroop } from '@/game/battle/kinds';
import { Figure, addSlot, gripFrame, type MountRig, type Rig } from './figures';
import { FOLK_TINT, PALETTE, TROOP_TINT } from './palette';

/** Рост взрослой фигуры в метрах сцены — тот же, что был у прежних фигурок. */
export const MAN_HEIGHT = 1.05;

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
  shoulder: 0.726,
  wrist: 0.447,
  hip: 0.48,
  ankle: 0.012,
  /** Ширина головы и её глубина — доли от высоты головы. */
  headWide: 0.67,
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
    shoulderX: height * 0.113 * build,
    armLen: at(REF.shoulder) - at(REF.wrist),
    neckY: at(REF.neck),
    straddle: 0,
    seat: 0,
    mount: null,
  };
}

/** Размеры, которые нужны при одевании, но суставам не нужны. */
interface Body {
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

function bodyOf(rig: Rig, build: number): Body {
  const h = rig.height;
  const headH = h / HEADS;
  return {
    rig,
    headH,
    headCenter: h - headH / 2,
    torsoH: rig.neckY - rig.hipY,
    chestW: h * 0.235 * build,
    legLen: rig.hipY - h * REF.ankle,
    legW: h * 0.078 * build,
    armW: h * 0.053 * build,
  };
}

// ---------- Общее тело ----------

/**
 * Голое тело: ноги, руки, корпус, голова. Одежда — это цвета, а не отдельные
 * детали: на боевом масштабе рукав от руки не отличить, а инстанс стоит денег.
 */
function torso(f: Figure, b: Body, cloth: number, legs: number, skin: number): void {
  const { rig } = b;
  addSlot(f, 'limb', 'legL', legs, [0, 0, 0], [b.legW, b.legLen, b.legW * 1.12]);
  addSlot(f, 'limb', 'legR', legs, [0, 0, 0], [b.legW, b.legLen, b.legW * 1.12]);
  // Руки чуть позади линии груди: иначе они висят отдельно от корпуса.
  addSlot(f, 'limb', 'armL', skin, [0, 0, -b.armW * 0.2], [b.armW, rig.armLen, b.armW * 1.08]);
  addSlot(f, 'limb', 'armR', skin, [0, 0, -b.armW * 0.2], [b.armW, rig.armLen, b.armW * 1.08]);
  addSlot(f, 'body', 'torso', cloth, [0, 0, 0], [b.chestW, b.torsoH, b.chestW * 0.68]);
  addSlot(f, 'head', 'head', PALETTE.skin, [0, b.headCenter - rig.neckY, 0], [
    b.headH * REF.headWide,
    b.headH,
    b.headH * REF.headDeep,
  ]);
}

/** Шапка, капюшон или шлем поверх головы. `tall` — во сколько раз выше плоской. */
function headwear(f: Figure, b: Body, color: number, tall: number, drop = 0): void {
  const y = b.headCenter - b.rig.neckY - b.headH * (0.12 + drop);
  addSlot(f, 'cap', 'head', color, [0, y, 0], [b.headH * REF.headWide * 1.06, b.headH * tall, b.headH * REF.headDeep * 1.06]);
}

/** Пояс: тонкая полоса по низу корпуса. Дёшево, а фигура перестаёт быть мешком. */
function belt(f: Figure, b: Body): void {
  addSlot(f, 'plate', 'torso', PALETTE.leather, [0, b.torsoH * 0.14, 0], [b.chestW * 0.84, b.torsoH * 0.1, b.chestW * 0.64]);
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
  const height = [MAN_HEIGHT, MAN_HEIGHT * 0.97, MAN_HEIGHT * 0.94][k];
  const build = [0.96, 1, 0.92][k];
  const cloth = FOLK_TINT[k];
  const rig = humanRig(height, build);
  const b = bodyOf(rig, build);
  f.strip();
  f.rig = rig;

  if (k === 2) {
    // Долгополая одежда: корпус спускается до щиколоток, ног почти не видно.
    // Перевёрнутый корпус расширяется книзу — это и есть подол.
    torso(f, b, cloth, cloth, PALETTE.skin);
    addSlot(f, 'body', 'hips', cloth, [0, b.rig.hipY * 1.02, 0], [b.chestW * 1.34, b.rig.hipY, b.chestW * 0.98], [Math.PI, 0, 0]);
    headwear(f, b, PALETTE.hair, 0.38, 0.04);
    // Ноша за спиной: узел на верёвке — второй заметный признак этого покроя.
    addSlot(f, 'plate', 'torso', PALETTE.barrel, [0, b.torsoH * 0.62, -b.chestW * 0.5], [b.chestW * 0.72, b.torsoH * 0.5, b.chestW * 0.34]);
    return;
  }

  torso(f, b, cloth, PALETTE.leather, PALETTE.skin);
  belt(f, b);
  if (k === 1) {
    // Капюшон: выше и ниже надвинут, чем волосы, — силуэт головы другой.
    headwear(f, b, PALETTE.woodDark, 1.02, 0.16);
    // Посох в руке: третий силуэт у костра — с вертикальной палкой.
    const grip = gripFrame([0, -b.rig.armLen, b.chestW * 0.2], [0, 0, -0.1]);
    addSlot(f, 'shaft', 'armR', PALETTE.stake, [0, -b.rig.hipY * 0.85, 0], [0.028, height * 0.92, 0.028], [0, 0, 0], grip);
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

/** Сложение по виду: латник шире дубинщика — это видно раньше, чем его доспех. */
const BUILD: Record<TroopId, number> = {
  clubman: 0.94,
  spearman: 1,
  archer: 0.95,
  axeman: 1.06,
  swordsman: 1,
  shieldman: 1.06,
  rider: 1,
  legionary: 1.14,
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
    for (const j of ['legL', 'legR'] as const) {
      addSlot(f, 'plate', j, PALETTE.armor, [0, -b.legLen * 0.55, b.legW * 0.36], [b.legW * 1.1, b.legLen * 0.5, b.legW * 0.5]);
    }
  }
}

/** Круглый щит на левой руке. */
function roundShield(f: Figure, b: Body, size: number): void {
  addSlot(f, 'shield', 'armL', PALETTE.woodDark, [0, -b.rig.armLen * 0.82, size * 0.18], [size, size, size * 0.08]);
  addSlot(f, 'plate', 'armL', PALETTE.armor, [0, -b.rig.armLen * 0.82, size * 0.24], [size * 0.24, size * 0.24, size * 0.06]);
}

/**
 * Меч: рукоять, перекрестье, клинок. Клинок поднят наружу под сорок пять
 * градусов — оружие, прижатое к боку, в силуэте не существует, а к камере
 * направленное сокращается в точку. Наружу и вверх видно с любой стороны.
 */
function sword(f: Figure, b: Body, len: number, out: number): void {
  const grip = gripFrame([0, -b.rig.armLen, b.chestW * 0.16], [0.12, 0, out]);
  addSlot(f, 'shaft', 'armR', PALETTE.leather, [0, 0, 0], [0.032, len * 0.2, 0.032], [0, 0, 0], grip);
  addSlot(f, 'plate', 'armR', PALETTE.metal, [0, len * 0.21, 0], [len * 0.32, 0.03, 0.032], [0, 0, 0], grip);
  addSlot(f, 'plate', 'armR', PALETTE.metal, [0, len * 0.22 + len * 0.42, 0], [len * 0.085, len * 0.84, 0.02], [0, 0, 0], grip);
}

/** Одевает бойца этого вида. Всё, что видно на поле, решается здесь. */
export function dressSoldier(f: Figure, troop: TroopId): void {
  const build = BUILD[troop];
  const tier = gearTier(troop);
  const rig = humanRig(MAN_HEIGHT, build);
  const b = bodyOf(rig, build);
  f.strip();
  f.rig = rig;
  const cloth = TROOP_TINT[troop];
  torso(f, b, cloth, PALETTE.leather, PALETTE.skin);
  belt(f, b);
  // Шлем — с первой же ступени снаряжения; дубинщику остаются волосы.
  if (tier >= 1) headwear(f, b, PALETTE.armor, 0.62, 0.06);
  else headwear(f, b, PALETTE.hair, 0.34);

  switch (troop) {
    case 'clubman': {
      // Дубина: короткая и толстая, с тяжёлым концом, отведена вбок почти
      // горизонтально. Самый простой силуэт лестницы — короткий обрубок у пояса,
      // и голова непокрытая: у дубинщика из кузницы нет ничего.
      const len = MAN_HEIGHT * 0.3;
      const grip = gripFrame([0, -rig.armLen, b.chestW * 0.2], [0.28, 0, 1.05]);
      addSlot(f, 'shaft', 'armR', PALETTE.woodDark, [0, 0, 0], [0.05, len, 0.05], [0, 0, 0], grip);
      addSlot(f, 'plate', 'armR', PALETTE.woodDark, [0, len + 0.05, 0], [0.11, 0.13, 0.11], [0, 0, 0], grip);
      break;
    }
    case 'spearman': {
      // Копьё стоит вертикально и уходит на треть роста выше головы: это и есть
      // главный признак копейщика, по нему его не спутать с мечником.
      const len = MAN_HEIGHT * 1.25;
      const grip = gripFrame([0, -rig.armLen - len * 0.28, b.chestW * 0.26], [0, 0, -0.07]);
      addSlot(f, 'shaft', 'armR', PALETTE.woodDark, [0, 0, 0], [0.032, len, 0.032], [0, 0, 0], grip);
      addSlot(f, 'plate', 'armR', PALETTE.metal, [0, len + 0.06, 0], [0.05, 0.16, 0.02], [0, 0, 0], grip);
      break;
    }
    case 'archer': {
      // Лук — два плеча под углом: настоящая дуга стоила бы своей геометрии, а
      // ломаная из двух конечностей в силуэте читается так же. Изгиб сделан
      // вбок, а не вперёд: спереди дуга должна быть видна дугой, иначе лук не
      // отличить от копья. Верх лука ниже макушки — этим он от копья и отличается.
      const half = MAN_HEIGHT * 0.45;
      const bend = 0.34;
      const grip = gripFrame([0, -rig.armLen, b.chestW * 0.34], [0, 0, -0.12]);
      addSlot(f, 'limb', 'armL', PALETTE.woodDark, [0, 0, 0], [0.026, half, 0.034], [0, 0, Math.PI - bend], grip);
      addSlot(f, 'limb', 'armL', PALETTE.woodDark, [0, 0, 0], [0.026, half, 0.034], [0, 0, bend], grip);
      // Колчан наискось за плечом — второй признак, видный со спины.
      addSlot(f, 'plate', 'torso', PALETTE.leather, [-b.chestW * 0.3, b.torsoH * 0.86, -b.chestW * 0.32], [0.08, MAN_HEIGHT * 0.3, 0.08], [0.3, 0, 0.34]);
      // Оперение стрел торчит из колчана над плечом: второй признак лучника.
      addSlot(f, 'plate', 'torso', PALETTE.bone, [-b.chestW * 0.4, b.torsoH * 1.12, -b.chestW * 0.4], [0.05, MAN_HEIGHT * 0.13, 0.05], [0.3, 0, 0.34]);
      break;
    }
    case 'axeman': {
      // Топор держат обухом кверху: топорище вертикально у плеча, тяжёлое лезвие
      // приходится на высоту головы. В силуэте это груз наверху сбоку — ни на
      // копьё (тонкая линия от земли), ни на меч (косая от бедра) не похоже.
      const len = MAN_HEIGHT * 0.72;
      const grip = gripFrame([0, -rig.armLen, b.chestW * 0.2], [0.1, 0, 0.24]);
      addSlot(f, 'shaft', 'armR', PALETTE.woodDark, [0, -len * 0.16, 0], [0.038, len, 0.038], [0, 0, 0], grip);
      addSlot(f, 'plate', 'armR', PALETTE.metal, [-0.06, len * 0.76, 0], [0.13, 0.2, 0.05], [0, 0, -0.1], grip);
      addSlot(f, 'plate', 'armR', PALETTE.metal, [0.03, len * 0.78, 0], [0.06, 0.11, 0.045], [0, 0, 0], grip);
      break;
    }
    case 'swordsman': {
      // Клинок вынесен низко и вперёд: линия идёт от бедра, а не над головой.
      sword(f, b, MAN_HEIGHT * 0.68, 0.62);
      break;
    }
    case 'shieldman': {
      roundShield(f, b, MAN_HEIGHT * 0.4);
      sword(f, b, MAN_HEIGHT * 0.52, 0.5);
      break;
    }
    case 'rider': {
      dressHorse(f, b);
      roundShield(f, b, MAN_HEIGHT * 0.34);
      // Копьё наперевес: почти горизонтально вперёд — так его и держат в седле.
      const len = MAN_HEIGHT * 1.1;
      const grip = gripFrame([0, -rig.armLen, b.chestW * 0.3], [1.16, 0, -0.1]);
      addSlot(f, 'shaft', 'armR', PALETTE.woodDark, [0, -len * 0.3, 0], [0.032, len, 0.032], [0, 0, 0], grip);
      addSlot(f, 'plate', 'armR', PALETTE.metal, [0, len * 0.72, 0], [0.05, 0.15, 0.02], [0, 0, 0], grip);
      break;
    }
    case 'legionary': {
      // Ростовой прямоугольный щит против круглого у щитоносца: это и есть
      // разница ближайшей пары, цветом её не сделать.
      const w = MAN_HEIGHT * 0.3;
      addSlot(f, 'plate', 'armL', PALETTE.paintRed, [0, -rig.armLen * 0.72, w * 0.36], [w, MAN_HEIGHT * 0.52, 0.035]);
      addSlot(f, 'plate', 'armL', PALETTE.armor, [0, -rig.armLen * 0.72, w * 0.42], [w * 0.22, w * 0.22, 0.03]);
      sword(f, b, MAN_HEIGHT * 0.54, 0.42);
      break;
    }
  }
  armorUp(f, b, tier);
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
    bodyLen: height * 0.78,
    bodyW: height * 0.28,
    legY: height * 0.6,
    legX: height * 0.108,
    legZ: height * 0.26,
    legLen: height * 0.595,
    // Шея выходит из бочки, а не стоит на ней: основание ниже верха спины.
    neckY: height * 0.74,
    neckZ: height * 0.3,
    neckLen: height * 0.42,
    neckPitch: 0.6,
    tailY: height * 0.78,
    tailZ: -height * 0.36,
  };
}

/**
 * Конь под фигурой: корпус, шея, голова, четыре ноги, хвост. Отдельной модели
 * у всадника нет — это то же тело, посаженное сверху, поэтому конь и добавляется
 * к фигуре, а не рисуется рядом.
 */
export function dressHorse(f: Figure, b: Body): void {
  const h = b.rig.height;
  const m = mountRig(h);
  f.rig.mount = m;
  // Посадка: таз на седле, колени разведены и вынесены вперёд.
  f.rig.hipY = m.backY + h * 0.05;
  f.rig.hipX = h * 0.09;
  f.rig.straddle = 0.4;
  f.rig.seat = 0.45;

  const coat = PALETTE.horseCoat;
  // Корпус кладётся набок: примитив растёт вверх, а бочка коня лежит. Широкий
  // конец у крупа — так и сложена лошадь.
  addSlot(f, 'body', 'root', coat, [0, m.backY - m.barrelH / 2, m.bodyLen / 2], [m.bodyW, m.bodyLen, m.barrelH], [-Math.PI / 2, 0, 0]);
  // Шея растёт от головы вниз к холке: широкий конец примитива должен быть внизу.
  addSlot(f, 'body', 'neck', coat, [0, m.neckLen, 0], [m.bodyW * 0.72, m.neckLen, m.bodyW * 0.62], [Math.PI, 0, 0]);
  addSlot(f, 'plate', 'neck', PALETTE.horseMane, [0, m.neckLen * 0.5, -m.bodyW * 0.26], [m.bodyW * 0.16, m.neckLen, m.bodyW * 0.3]);
  // Голова собирается в своей системе: ось Y вдоль морды, вперёд и чуть вниз.
  const skull = gripFrame([0, m.neckLen * 0.92, 0], [1.1, 0, 0]);
  addSlot(f, 'head', 'neck', coat, [0, h * 0.11, 0], [h * 0.16, h * 0.28, h * 0.2], [0, 0, 0], skull);
  addSlot(f, 'plate', 'neck', coat, [0, h * 0.25, 0], [h * 0.115, h * 0.14, h * 0.145], [0, 0, 0], skull);
  for (const j of ['legFL', 'legFR', 'legBL', 'legBR'] as const) {
    addSlot(f, 'limb', j, coat, [0, 0, 0], [h * 0.079, m.legLen, h * 0.085]);
  }
  addSlot(f, 'limb', 'tail', PALETTE.horseMane, [0, 0, 0], [h * 0.06, h * 0.34, h * 0.07]);
  addSlot(f, 'plate', 'root', PALETTE.leather, [0, m.backY + h * 0.015, -h * 0.02], [m.bodyW * 1.06, h * 0.045, h * 0.19]);
}

/** Одна лошадь без всадника — стенду, чтобы обмерить и посмотреть отдельно. */
export function dressMount(f: Figure): void {
  const rig = humanRig();
  f.strip();
  f.rig = rig;
  dressHorse(f, bodyOf(rig, 1));
}
