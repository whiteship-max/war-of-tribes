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
import { BEARD, Figure, addSlot, gripFrame, type MountRig, type Rig, type Slot } from './figures';
import type { Mat, Shape } from './gear';
import { FOLK_TINT, PALETTE } from './palette';
import { sidePaint } from '@/side';

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
export function headwear(f: Figure, b: Body, color: number, tall: number, drop = 0): Slot {
  // Основание конуса лежит на верхней части головы: низкая посадка
  // прятала конус внутри черепа и оставляла макушку снаружи.
  const y = b.headCenter - b.rig.neckY + b.headH * (0.35 - drop);
  return addSlot(f, 'cap', 'head', color, [0, y, 0], [b.headH * REF.headWide * 1.06, b.headH * tall, b.headH * REF.headDeep * 1.06]);
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
 * Краски снаряжения около 1200 года (docs/polish.md, П-5): кольчуга — серое железо, поддоспешник — небелёный лён,
 * шоссы — некрашеная шерсть (у каждого бойца свой оттенок — шейдер толпы, `Mat` «hose»). Ни одной — в цвет чужой
 * стороны (`side.test.ts`).
 */
export const GEAR_COLOR = {
  mail: PALETTE.armor,
  linen: PALETTE.cloth,
  hose: 0x6c5a46,
  hood: 0x77684f,
} as const;

/**
 * Головной убор по виду и ступени: вариант первый — тот, что видят пул посёлка, обмер силуэта и тесты; остальные —
 * разброс в строю ролика (`DressOpts.variants`). Ступень 0 — без железа (волосы, капюшон, валяная шапка); 1–2 — шлем с
 * наносником, сегментный, шапель; 3 — топхелм с гребнем цвета стороны.
 */
function helmsOf(troop: TroopId, tier: number): Shape[] {
  if (tier === 0) return ['hair', 'hood', 'felt'];
  if (tier >= 3) return troop === 'knight' ? ['great'] : ['great', 'kettle'];
  if (weaponOf(troop) === 'bow') return ['kettle', 'spangen'];
  if (weaponOf(troop) === 'sword' && !hasShield(troop)) return ['nasal', 'kettle'];
  return ['nasal', 'spangen'];
}

/** Как одевать фигуру: с разбросом в строю (все варианты головы и борода — их выберет шейдер толпы) или одной фигурой. */
export interface DressOpts {
  variants?: boolean;
}

/** Покрасить детали тела на суставах: шоссы, кольчужные рукава. */
function paint(f: Figure, joints: readonly string[], color: number, mat: Mat): void {
  for (const s of f.slots) {
    if (s.part !== 'limb' || !joints.includes(s.joint)) continue;
    s.color.setHex(color);
    s.mat = mat;
  }
}

/** Голова: уборы по вариантам и борода. Первый убор — основной: у пула и в тестах только он. */
function dressHead(f: Figure, b: Body, troop: TroopId, tier: number, cloth: number, opts: DressOpts): void {
  const helms = helmsOf(troop, tier);
  const shown = opts.variants ? helms : helms.slice(0, 1);
  shown.forEach((shape, k) => {
    const variant = shown.length > 1 ? 10 * shown.length + k + 1 : 0;
    const iron = shape === 'nasal' || shape === 'spangen' || shape === 'kettle' || shape === 'great';
    const color = iron ? PALETTE.armor : shape === 'hair' ? PALETTE.hair : GEAR_COLOR.hood;
    const mat: Mat = iron ? 'metal' : shape === 'hair' ? 'hair' : 'hose';
    let slot: Slot;
    if (shape === 'great') {
      // Топхелм — от подбородка до макушки, шире головы: основание кольца — у подбородка.
      const base = b.headCenter - b.rig.neckY - b.headH * 0.6;
      slot = addSlot(f, 'cap', 'head', color, [0, base, 0], [b.headH * 0.8, b.headH * 1.14, b.headH * 0.8]);
      slot.shape = shape;
      slot.mat = mat;
      slot.variant = variant;
      // Гребень: веер на макушке, цвет стороны (решение владельца 03.10.2026, `side.ts`) — ступень 3 видна издалека.
      const crest = addSlot(f, 'plate', 'head', cloth, [0, base + b.headH * 1.14 + b.headH * 0.16, -b.headH * 0.04], [b.headH * 0.1, b.headH * 0.36, b.headH * 0.72]);
      crest.variant = variant;
      return;
    }
    if (shape === 'hood') {
      // Капюшон с оплечьем: основание кольца — на уровне лба, оплечье спускается на плечи.
      slot = headwear(f, b, color, 0.95, 0.18);
      slot.shape = shape;
      slot.mat = mat;
      slot.variant = variant;
      return;
    }
    if (shape === 'hair') slot = headwear(f, b, color, 0.42, 0.06);
    else if (shape === 'felt') slot = headwear(f, b, color, 0.5, 0.05);
    else if (shape === 'kettle') slot = headwear(f, b, color, 0.5, 0.02);
    else if (shape === 'spangen') slot = headwear(f, b, color, 0.56, 0.05);
    else slot = headwear(f, b, color, 0.62, 0.06);
    slot.shape = shape;
    slot.mat = mat;
    slot.variant = variant;
  });
  if (opts.variants && tier < 3) {
    // Борода — у части бойцов; у топорника гуще.
    const beard = addSlot(f, 'head', 'head', PALETTE.hair, [0, b.headCenter - b.rig.neckY - b.headH * 0.42, b.headH * 0.2], [
      b.headH * 0.5,
      b.headH * (troop === 'axeman' ? 0.42 : 0.3),
      b.headH * 0.36,
    ]);
    beard.shape = 'beard';
    beard.mat = 'hair';
    beard.variant = BEARD;
    beard.lod = 2;
  }
}

/**
 * Одежда и доспех по ступени снаряжения. Кузница обязана читаться на поле, а не только в цифрах на карточке: 0 — рубаха
 * до середины бедра; 1 — шлем и стёганый поддоспешник с льняными рукавами; 2 — кольчуга (рукава до кисти, подол чуть
 * выше колена) под сюрко цвета стороны с гербом на груди; 3 — ещё кольчужные шоссы и поножи. Сюрко, рубаха и щит — цвет
 * стороны (`side.ts`): сторона читается и у бойца в чужих красках герба.
 */
function dressBody(f: Figure, b: Body, tier: number, cloth: number): void {
  const { rig } = b;
  // Шоссы — у всех, кроме ступени 3: у той кольчужные.
  paint(f, ['legL', 'legR', 'kneeL', 'kneeR'], tier >= 3 ? GEAR_COLOR.mail : GEAR_COLOR.hose, tier >= 3 ? 'metal' : 'hose');
  if (tier === 1) paint(f, ['elbowL', 'elbowR'], GEAR_COLOR.linen, 'fixed');
  if (tier >= 2) paint(f, ['armL', 'armR', 'elbowL', 'elbowR'], GEAR_COLOR.mail, 'metal');
  // Подол: рубахи — до середины бедра, кольчуги — чуть выше колена (голень открыта: у латника её закрывает ростовой
  // щит, и по этому он отличается от щитоносца, `units.test.ts`), сюрко поверх неё короче и шире.
  const waist = rig.hipY * 0.02 + b.torsoH * 0.08;
  const hem = (k: number): number => b.legLen * k + waist;
  if (tier >= 2) {
    const mail = addSlot(f, 'body', 'hips', GEAR_COLOR.mail, [0, waist, 0], [b.chestW * 0.98, hem(0.46), b.chestW * 0.74], [Math.PI, 0, 0]);
    mail.shape = 'skirt';
    mail.mat = 'metal';
    // Вдали подол кольчуги под сюрко не виден: с дальнего облика — только сюрко цвета стороны.
    mail.lod = 1;
    const coat = addSlot(f, 'body', 'hips', cloth, [0, waist + 0.004, 0], [b.chestW * 1.06, hem(0.38), b.chestW * 0.8], [Math.PI, 0, 0]);
    coat.shape = 'skirt';
    // Грудь сюрко с гербом — там, где у прежних латников была кираса: позади плоскости щита (`articulation.test.ts`).
    const chest = addSlot(f, 'plate', 'torso', cloth, [0, b.torsoH * 0.6, b.chestW * 0.3], [b.chestW * 0.84, b.torsoH * 0.56, b.chestW * 0.3]);
    chest.shape = 'chest';
    chest.lod = 1;
  } else {
    const tunic = addSlot(f, 'body', 'hips', cloth, [0, waist, 0], [b.chestW * 1.0, hem(tier === 0 ? 0.36 : 0.3), b.chestW * 0.76], [Math.PI, 0, 0]);
    tunic.shape = 'skirt';
  }
  if (tier >= 3) {
    // Поножи поверх кольчужных шосс.
    for (const j of ['kneeL', 'kneeR'] as const) {
      addSlot(f, 'plate', j, PALETTE.armor, [0, -b.legLen * 0.25, b.legW * 0.45], [b.legW, b.legLen * 0.48, b.legW * 0.5]).mat = 'metal';
    }
  }
}

/**
 * Круглый щит на левой руке: доска с гербом стороны в ободе цвета стороны и железный умбон (`gear.round`). Обод —
 * самая заметная плоскость бойца, и по нему сторона читается раньше, чем по рубахе.
 */
function roundShield(f: Figure, b: Body, size: number, cloth: number): void {
  // Просвет до груди нужен и при отведённом назад предплечье в шаге.
  const front = b.chestW * 0.8;
  // Доска выгнута (`gear.round`) в той же глубине слота, что прежний диск: изнанка у края — на прежнем месте.
  addSlot(f, 'shield', 'armL', cloth, [0, -b.rig.armLen * 0.56, front], [size, size, size * 0.08]).shape = 'round';
}

/**
 * Меч: рукоять, перекрестье, клинок. Клинок вынесен наружу — оружие,
 * прижатое к боку, в силуэте не существует, а к камере
 * направленное сокращается в точку. Наружу и вверх видно с любой стороны.
 */
function sword(f: Figure, b: Body, len: number, out: number): void {
  const grip = gripFrame([0, -b.rig.armLen, b.chestW * 0.16], [0.12, 0, out]);
  addSlot(f, 'shaft', 'armR', PALETTE.leather, [0, 0, 0], [0.032, len * 0.2, 0.032], [0, 0, 0], grip).mat = 'leather';
  addSlot(f, 'plate', 'armR', PALETTE.metal, [0, len * 0.21, 0], [len * 0.36, 0.032, 0.034], [0, 0, 0], grip).mat = 'metal';
  const blade = addSlot(f, 'plate', 'armR', PALETTE.metal, [0, len * 0.22 + len * 0.42, 0], [len * 0.11, len * 0.84, 0.022], [0, 0, 0], grip);
  blade.shape = 'blade';
  blade.mat = 'metal';
}

/**
 * Ростовой щит: от голени до плеча. Его носит тот, кто в доспехе: пеший латник — каплевидный (норманнский), латный
 * всадник — треугольный, короче. У остальных щит круглый и заметно выше голени — на этом держится разница ближайшей
 * пары, щитоносца и латника.
 */
function tallShield(f: Figure, b: Body, h: number, cloth: number, mounted: boolean): void {
  const w = h * (mounted ? 0.3 : 0.32);
  const tall = h * (mounted ? 0.46 : 0.66);
  const front = b.chestW * 0.8;
  const depth = 0.1;
  addSlot(f, 'plate', 'armL', cloth, [0, -b.rig.armLen * (mounted ? 0.62 : 0.9), front + depth * 0.3], [w, tall, depth]).shape = mounted ? 'heater' : 'kite';
}

/** Одевает бойца этого вида. Всё, что видно на поле, решается здесь. Цвет стороны — свой, если не сказано иначе. */
export function dressSoldier(f: Figure, troop: TroopId, cloth: number = sidePaint(true), opts: DressOpts = {}): void {
  const { height: tall, build } = SIZE[troop];
  const h = MAN_HEIGHT * tall;
  const tier = gearTier(troop);
  const rig = humanRig(h, build);
  const b = bodyOf(rig, build);
  f.strip();
  f.rig = rig;
  torso(f, b, cloth, PALETTE.leather, PALETTE.skin);
  neck(f, b);
  dressHead(f, b, troop, tier, cloth, opts);

  // Что в руках и есть ли щит — не таблица по видам, а следствие снаряжения
  // из data/troops.ts: тот же конфиг, из которого карточка вида берёт список
  // предметов на ковку. Правка `gear` в конфиге меняет и текст карточки, и то,
  // что видно на поле, — двух описаний одного бойца в игре быть не должно.
  const shield = hasShield(troop);
  const heavy = hasArmor(troop);
  const mounted = TROOP_BY_ID[troop].mounted === true;

  if (mounted) {
    dressHorse(f, b, heavy ? cloth : null);
    if (!heavy) saddleCloth(f, cloth);
  }
  const heldStart = f.slots.length;

  // Щит: ростовой у того, кто в доспехе, круглый у остальных. Это и разводит
  // ближайшую пару — щитоносца и латника, — а цветом её было бы не развести.
  if (shield) {
    if (heavy) tallShield(f, b, h, cloth, mounted);
    else roundShield(f, b, h * (mounted ? 0.34 : 0.43), cloth);
  }

  switch (weaponOf(troop)) {
    case 'club': {
      // Дубина: короткая и толстая, с тяжёлым концом, отведена вбок почти
      // горизонтально. Самый простой силуэт лестницы — короткий обрубок у пояса.
      const len = h * 0.36;
      const grip = gripFrame([0, -rig.armLen, b.chestW * 0.2], [0.28, 0, 1.05]);
      const club = addSlot(f, 'shaft', 'armR', PALETTE.woodDark, [0, 0, 0], [0.085, len, 0.085], [0, 0, 0], grip);
      club.shape = 'club';
      club.mat = 'leather';
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
      addSlot(f, 'shaft', 'armR', PALETTE.woodDark, [0, drop, 0], [0.032, len, 0.032], [0, 0, 0], grip).mat = 'leather';
      // Наконечник — лист с ромбом в сечении (`gear.leaf`), у пула — конус.
      const head = addSlot(f, 'cap', 'armR', PALETTE.metal, [0, len + drop - 0.02, 0], [0.065, 0.2, 0.035], [0, 0, 0], grip);
      head.shape = 'leaf';
      head.mat = 'metal';
      if (mounted && heavy) {
        // Флажок цвета стороны у острия копья латного всадника: латная конница читается издалека.
        addSlot(f, 'plate', 'armR', cloth, [0.12, len + drop - 0.24, 0], [0.24, 0.13, 0.012], [0, 0, 0], grip).shape = 'pennon';
      }
      break;
    }
    case 'bow': {
      // Лук — дуга с тетивой (`gear.bow`), у пула — плашка той же величины. Изгиб сделан вбок, а не вперёд: спереди
      // дуга должна быть видна дугой, иначе лук не отличить от копья. Верх лука ниже макушки — этим он от копья и
      // отличается.
      const grip = gripFrame([0, -rig.armLen + h * 0.11, b.chestW * 0.34], [0, 0, -0.12]);
      const bow = addSlot(f, 'plate', 'armL', PALETTE.woodDark, [-h * 0.1, 0, 0], [h * 0.2, h * 0.86, 0.03], [0, 0, Math.PI], grip);
      bow.shape = 'bow';
      bow.mat = 'leather';
      // Колчан наискось за плечом — второй признак, видный со спины.
      addSlot(f, 'plate', 'torso', PALETTE.leather, [-b.chestW * 0.3, b.torsoH * 0.86, -b.chestW * 0.32], [0.08, h * 0.3, 0.08], [0.3, 0, 0.34]).mat = 'leather';
      // Оперение стрел торчит из колчана над плечом: второй признак лучника.
      addSlot(f, 'plate', 'torso', PALETTE.bone, [-b.chestW * 0.4, b.torsoH * 1.12, -b.chestW * 0.4], [0.05, h * 0.13, 0.05], [0.3, 0, 0.34]).lod = 1;
      break;
    }
    case 'axe': {
      // Датская секира на длинном топорище вынесена вперёд и вбок: широкое лезвие с бородой не прячется за грудью с
      // полуоборота. Копьё остаётся вертикалью, меч — низкой косой.
      const len = h * 0.94;
      const grip = gripFrame([0, -rig.armLen, b.chestW * 0.32], [0.65, 0, -0.42]);
      addSlot(f, 'shaft', 'armR', PALETTE.woodDark, [0, -len * 0.16, 0], [0.04, len, 0.04], [0, 0, 0], grip).mat = 'leather';
      const head = addSlot(f, 'plate', 'armR', PALETTE.metal, [0.11, len * 0.74, 0], [0.26, 0.26, 0.05], [0, 0, 0.1], grip);
      head.shape = 'axe';
      head.mat = 'metal';
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
  dressBody(f, b, tier, cloth);
}

/**
 * Ополчение: житель одного из трёх покроев (`dressVillager`) с оружием из городского арсенала — стрелки на стене с
 * арбалетом (город около 1200 года держит их в башнях), пешие — с копьём. Рубаха — цвет стороны (`FOLK_TINT` красит
 * шейдер толпы). Снаряжения в кузнице у ополчения нет: шлема нет и у них.
 */
export function dressMilitia(f: Figure, kind: number, shooter: boolean): void {
  dressVillager(f, kind);
  const rig = f.rig;
  const h = rig.height;
  const b = bodyOf(rig, 1);
  const start = f.slots.length;
  if (shooter) {
    // Арбалет в правой руке, носом от плеча: опущенная рука несёт его носом вниз, вскинутая — вперёд (`reel/bake`).
    const grip = gripFrame([0, -rig.armLen, b.chestW * 0.22], [Math.PI, 0, 0]);
    // Ложе от плеча вперёд: кисть — у его середины, приклад — у плеча, когда рука вскинута.
    const xbow = addSlot(f, 'plate', 'armR', PALETTE.woodDark, [0, h * 0.02, 0], [h * 0.4, h * 0.55, 0.06], [0, 0, 0], grip);
    xbow.shape = 'crossbow';
    xbow.mat = 'leather';
  } else {
    const len = h * 1.25;
    const grip = gripFrame([0, -rig.armLen - len * 0.28, b.chestW * 0.26], [0, 0, -0.07]);
    addSlot(f, 'shaft', 'armR', PALETTE.woodDark, [0, 0, 0], [0.03, len, 0.03], [0, 0, 0], grip).mat = 'leather';
    const head = addSlot(f, 'cap', 'armR', PALETTE.metal, [0, len - 0.02, 0], [0.06, 0.17, 0.032], [0, 0, 0], grip);
    head.shape = 'leaf';
    head.mat = 'metal';
  }
  attachHands(f, start, rig.armLen);
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
 * Конь под фигурой: корпус, шея, голова, четыре ноги с копытами, хвост. Отдельной модели
 * у всадника нет — это то же тело, посаженное сверху, поэтому конь и добавляется
 * к фигуре, а не рисуется рядом.
 *
 * `caparison` — цвет попоны, `null` — без неё. Попона у коня того, кто в доспехе: латного
 * всадника иначе не отличить от лёгкого — оба в шлеме, с копьём наперевес и на том же коне, а
 * круглый щит против ростового с полуоборота прячется за корпус. Попона закрывает бочку и
 * верх ног с любой стороны, красится стороной, как всё на бойце, и несёт герб на боках.
 * Масть и грива у каждого коня свои (шейдер толпы, `Mat` «horse», «mane»).
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
  const horse = (s: Slot, mat: Mat = 'horse'): Slot => ((s.mat = mat), s);
  // Тот же гранёный шар, что у головы: округлые грудь и круп вместо бруса.
  horse(addSlot(f, 'head', 'root', coat, [0, m.backY - m.barrelH / 2, 0], [m.bodyW, m.barrelH, m.bodyLen]));
  // Шея растёт от головы вниз к холке: широкий конец примитива должен быть внизу.
  horse(addSlot(f, 'body', 'neck', coat, [0, m.neckLen * 0.98, 0], [m.bodyW * 0.66, m.neckLen * 1.12, m.bodyW * 0.86], [Math.PI, 0, 0]));
  horse(addSlot(f, 'limb', 'neck', PALETTE.horseMane, [0, m.neckLen, -m.bodyW * 0.30], [m.bodyW * 0.12, m.neckLen, m.bodyW * 0.18], [-0.07, 0, 0]), 'mane').lod = 1;
  // Голова собирается в своей системе: ось Y вдоль морды, вперёд и чуть вниз.
  const skull = gripFrame([0, m.neckLen * 0.98, 0], [1.65, 0, 0]);
  // Одна сужающаяся к морде масса вместо шара с приставленным коробом.
  horse(addSlot(f, 'body', 'neck', coat, [0, h * 0.24, 0], [h * 0.18, h * 0.31, h * 0.22], [Math.PI, 0, 0], skull));
  for (const side of [-1, 1]) {
    horse(addSlot(f, 'cap', 'neck', coat, [side * h * 0.052, m.neckLen + h * 0.02, -h * 0.04], [h * 0.065, h * 0.14, h * 0.07], [-0.2, 0, -side * 0.18])).lod = 1;
  }
  for (const [upper, lower, hind] of [
    ['legFL', 'hockFL', false], ['legFR', 'hockFR', false],
    ['legBL', 'hockBL', true], ['legBR', 'hockBR', true],
  ] as const) {
    horse(addSlot(f, 'limb', upper, coat, [0, 0, 0], [h * (hind ? 0.105 : 0.075), m.legLen * 0.46, h * (hind ? 0.13 : 0.085)]));
    horse(addSlot(f, 'limb', lower, coat, [0, 0, h * 0.008], [h * 0.043, m.legLen * 0.56, h * 0.06]));
    // Копыто — тёмное, чуть шире бабки: у бегущего коня ноги читаются копытами.
    const hoof = addSlot(f, 'limb', lower, PALETTE.horseMane, [0, 0, h * 0.008], [h * 0.05, m.legLen * 0.56, h * 0.066]);
    hoof.shape = 'hoof';
    hoof.lod = 2;
  }
  horse(addSlot(f, 'limb', 'tail', PALETTE.horseMane, [0, 0, 0], [h * 0.06, h * 0.34, h * 0.07]), 'mane');
  const saddle = addSlot(f, 'plate', 'root', PALETTE.leather, [0, m.backY + h * 0.015, -h * 0.02], [m.bodyW * 1.06, h * 0.045, h * 0.19]);
  saddle.mat = 'leather';
  saddle.lod = 1;
  if (caparison !== null) {
    const cap = addSlot(f, 'plate', 'root', caparison, [0, m.backY - m.barrelH / 2 - h * 0.1, 0], [m.bodyW * 1.14, m.barrelH + h * 0.24, m.bodyLen * 1.12]);
    cap.shape = 'caparison';
  }
}

/**
 * Чепрак лёгкого коня: попона под седлом до середины боков, цвет стороны и герб — у кого нет латной попоны
 * (`dressHorse`). Та же форма, что попона (`gear.caparison`), короче и выше.
 */
function saddleCloth(f: Figure, cloth: number): void {
  const m = f.rig.mount!;
  const h = f.rig.height;
  addSlot(f, 'plate', 'root', cloth, [0, m.backY - h * 0.1, -h * 0.03], [m.bodyW * 1.12, h * 0.24, h * 0.46]).shape = 'caparison';
}

/** Одна лошадь без всадника — стенду, чтобы обмерить и посмотреть отдельно. */
export function dressMount(f: Figure): void {
  const rig = humanRig();
  f.strip();
  f.rig = rig;
  dressHorse(f, bodyOf(rig, 1));
}
