// Запечённая анимация бойцов ролика TW (docs/battle_tw.md, раздел 8, решения 2–3; облик и клипы — docs/polish.md, П-5).
//
// Фигуры — те же, что в игре: скелет и детали `render/figures.ts`, одевание `render/units.ts` и `render/beasts.ts`,
// позы `render/poses.ts`. Новое только в том, как их рисовать сотнями. Детали фигуры сливаются в один меш, каждая
// вершина — в системе своего сустава; позы клипов (стоять, шаг, бег, упор, удар, стрельба, гибель, ликование, щит,
// бегство, натиск) один раз считаются на процессоре и кладутся в текстуру матриц суставов — строка на кадр. Вершинный
// шейдер берёт два соседних кадра и смешивает (`crowd.ts`). Суставов — 24 на любую фигуру, поэтому текстура — килобайты
// на вид, а не мегабайты, как у запечённых вершин.
//
// Меш вида — трёх обликов по дальности (`BakedLook.lods`): вблизи — точные формы снаряжения (`gear.ts`: каплевидный
// щит, шлем с наносником, клинок) и круглее тело; средний — прежние примитивы с формами попроще; вдали — без
// предплечий, хвоста и мелочи. Скелет и кадры у всех трёх одни.
//
// Цвет стороны в меш не запекается: детали, одетые «цветом стороны», помечены (`aSide`), и красит их шейдер — золотом
// или красным по фигуре (`side.ts`). Так один меш служит обеим сторонам, и вызовов вдвое меньше. Так же помечены поле
// герба на щитах и груди сюрко (`aPart.zw` — место на гербе) и то, что у бойцов одного вида разное: кожа, волосы,
// шерсть, масть коня (`aPart.x`), и варианты головы и борода (`aPart.y`) — разброс в строю считает шейдер по зерну
// фигуры, без лишних вызовов.
import * as THREE from 'three';
import type { UnitKind } from '@/battle/types';
import { wearOf } from '@/game/battle/faces';
import { hasArmor, hasShield, weaponOf } from '@/game/battle/kinds';
import { BEARD, Figure, JOINTS, forEachPart, partGeometry, type JointId, type PartName, type Slot } from '../figures';
import { MAT_INDEX, SUB, shapeGeometry, type Detail, type Mat } from '../gear';
import { BEAT, poseFigure } from '../poses';
import { FOLK_KINDS, dressMilitia, dressSoldier } from '../units';
import { CANINE_NECK, WOLF_DARK, darker, dressCanine, poseCanine, wolfLook } from '../beasts';
import { FOLK_TINT, PALETTE } from '../palette';
import { CLIPS, type ClipId } from './troupe';

/** Цвет-метка «здесь цвет стороны»: его нет в палитре, и спутать его не с чем. */
const SENTINEL = 0x0f1e2d;
/** Тёмная шерсть волка — тот же цвет стороны, темнее (`beasts.wolfLook`). Множитель в линейном свете. */
const WOLF_DARK_LINEAR = Math.pow(WOLF_DARK, 2.2);
/** Тёмное снаряжения: прорезь топхелма, тетива. */
const DARK = 0x1d1813;
/** Светлая сталь лезвий (`gear.SUB.iron`): клинок, наконечник, секира, умбон. */
const STEEL = 0x9aa0a8;

/** Сколько суставов в строке текстуры: все, что знает фигура. Три тексела на сустав — три строки матрицы. */
export const JOINT_COUNT = JOINTS.length;
export const ROW_TEXELS = JOINT_COUNT * 3;
const JOINT_INDEX = JOINTS.reduce((acc, j, i) => ((acc[j] = i), acc), {} as Record<JointId, number>);

/** Чем вид бьёт и стреляет — позы клипов от оружия: копьё колет, меч рубит, арбалет заряжают. */
export type Weapon = 'spear' | 'bow' | 'xbow' | 'axe' | 'sword' | 'club' | null;

/** Вид бойца в ролике: что надето и как он двигается. Один меш на вид. */
export interface Look {
  key: string;
  face: string;
  kind: UnitKind;
  /** Верхом или зверь: клипы у них свои (рысь, галоп), у пешего — свои. */
  body: 'man' | 'horse' | 'beast';
  weapon: Weapon;
  /** Щит: круглый, ростовой (каплевидный или треугольный у конного) или нет. */
  shield: 'round' | 'tall' | null;
}

export const lookOf = (face: string, kind: UnitKind): Look => {
  const wear = wearOf(face, kind);
  const body = wear.wear === 'beast' ? 'beast' : kind === 'cavalry' || kind === 'heavy' ? 'horse' : 'man';
  let weapon: Weapon = null;
  let shield: Look['shield'] = null;
  if (wear.wear === 'troop') {
    weapon = weaponOf(wear.troop);
    shield = hasShield(wear.troop) ? (hasArmor(wear.troop) ? 'tall' : 'round') : null;
  } else if (wear.wear === 'folk') weapon = kind === 'archer' ? 'xbow' : 'spear';
  return { key: `${face}:${kind}`, face, kind, body, weapon, shield };
};

/** Клип: сколько длится, сколько кадров, по кругу ли. */
export interface ClipSpec {
  seconds: number;
  frames: number;
  loop: boolean;
  /** Первая строка клипа в блоке вида. */
  start: number;
}

/**
 * Длительности клипов. Шаг, удар — циклы игры (`poses.BEAT`); стойка, упор и щит — период их дыхания; бегство — два
 * шага бега (оглядка через плечо на втором); шаг коня — длиннее шага человека, галоп и натиск — мах коня.
 */
const CLIP_SECONDS: Record<'man' | 'horse' | 'beast', Record<ClipId, number>> = {
  man: { idle: (Math.PI * 2) / 1.7, march: BEAT.walk, run: 0.5, guard: (Math.PI * 2) / 2.1, strike: BEAT.strike, shoot: 3, fall: 0.9, cheer: 1.1, block: (Math.PI * 2) / 2.1, flee: 1, charge: 0.5 },
  horse: { idle: (Math.PI * 2) / 1.7, march: 0.96, run: 0.46, guard: (Math.PI * 2) / 2.1, strike: BEAT.strike, shoot: 3, fall: 0.9, cheer: 1.1, block: (Math.PI * 2) / 2.1, flee: 0.46, charge: 0.42 },
  beast: { idle: (Math.PI * 2) / 0.7, march: (Math.PI * 2) / 13, run: 0.32, guard: (Math.PI * 2) / 3, strike: (Math.PI * 2) / 6, shoot: (Math.PI * 2) / 3, fall: 0.9, cheer: (Math.PI * 2) / 0.7, block: (Math.PI * 2) / 3, flee: 0.32, charge: 0.32 },
};

/** Облики вида по дальности: 0 — вдали, 1 — средний, 2 — вблизи (`gear.Detail`). */
export const LODS: readonly Detail[] = [0, 1, 2];

/** Один вид, запечённый: меши обликов в системе суставов и где его кадры в общей текстуре. */
export interface BakedLook {
  look: Look;
  /** Облики по дальности (`LODS`): вдали, средний, вблизи. */
  lods: [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry];
  /** Сколько треугольников у каждого облика. */
  lodTriangles: [number, number, number];
  clips: Record<ClipId, ClipSpec>;
  /** Строка текстуры, с которой начинается блок вида. */
  base: number;
  rows: number;
}

/** Дальний облик: эти суставы не рисуются вовсе, и детали меньше `FAR_DETAIL` метров — тоже. */
const FAR_DROP: ReadonlySet<JointId> = new Set<JointId>(['elbowL', 'elbowR', 'tail']);
const FAR_DETAIL = 0.12;

/** Одеть фигуру этого вида — со всеми вариантами головы (разброс в строю). Цвет стороны — метка: красит шейдер. */
function dress(f: Figure, look: Look, variant: number): void {
  const wear = wearOf(look.face, look.kind);
  if (wear.wear === 'folk') dressMilitia(f, variant % FOLK_KINDS, look.weapon === 'xbow');
  else if (wear.wear === 'beast') dressCanine(f, wolfLook(SENTINEL));
  else dressSoldier(f, wear.troop, SENTINEL, { variants: true });
}

/**
 * Насколько деталь — цвет стороны: 0 — нет (своё дерево, железо, кожа), 1 — да, меньше — темнее него. Гребень латника и
 * флажок копья — тоже цвет стороны (`units`), отдельного правила у них нет.
 */
function sideOf(color: number, look: Look): number {
  if (color === SENTINEL) return 1;
  if (color === darker(SENTINEL, WOLF_DARK)) return WOLF_DARK_LINEAR;
  // Ополчение одето жителями (`dressVillager`): рубаха — цвет стороны, иначе по кадру не видно, чьи они.
  if (wearOf(look.face, look.kind).wear === 'folk' && FOLK_TINT.includes(color)) return 1;
  return 0;
}

/** Класс разброса детали: задан одеванием или узнаётся по краске (кожа, волосы, ремни, железо). */
function matOf(slot: Slot): Mat {
  if (slot.mat) return slot.mat;
  switch (slot.color.getHex()) {
    case PALETTE.skin:
      return 'skin';
    case PALETTE.hair:
      return 'hair';
    case PALETTE.leather:
      return 'leather';
    case PALETTE.metal:
    case PALETTE.armor:
      return 'metal';
    default:
      return 'fixed';
  }
}

const TAU = Math.PI * 2;
const ease = (x: number): number => {
  const k = x < 0 ? 0 : x > 1 ? 1 : x;
  return k * k * (3 - 2 * k);
};
/** Доля `u` внутри отрезка [a, b], сглаженная. */
const span = (u: number, a: number, b: number): number => ease((u - a) / (b - a));

/** Миг срыва — доля цикла выстрела (`tw/plan.SHOOT_RELEASE`: стрела и болт уходят в мгновение залпа). */
const RELEASE = 0.63;

/**
 * Копьё наперевес в пешем строю: плечо `arm`, локоть `elbow`, и кисть перехватывает древко так, чтобы оно смотрело вперёд
 * под углом `aim` от отвеса (π/2 — ровно вперёд). Угол древка — плечо, минус локоть, плюс кисть (`figures.poseJoints`).
 */
function levelSpear(f: Figure, arm: number, elbow: number, aim: number): void {
  f.armMain = arm;
  f.elbowMain = elbow;
  f.wristMain = aim - arm + elbow;
}

/** Поза клипа на секунде `t` (с начала клипа). Фигура уже одета. Возвращает, на сколько фигура опущена. */
function poseClip(f: Figure, look: Look, clip: ClipId, t: number, seconds: number): number {
  f.phase = 0;
  const u = t / seconds;
  if (look.body === 'beast') {
    switch (clip) {
      case 'idle':
      case 'cheer':
        return poseCanine(f, 'stand', t);
      case 'march':
        return poseCanine(f, 'trot', t);
      case 'run':
      case 'flee':
      case 'charge': {
        // Бег стаи — низом: рысь, разогнанная в мах, корпус ниже, шея вытянута вперёд, ход шире.
        const drop = poseCanine(f, 'trot', t * (((Math.PI * 2) / 13) / seconds));
        f.gait = Math.max(-1, Math.min(1, f.gait * 1.4));
        f.pitch -= 0.03;
        if (f.rig.mount) f.rig.mount.neckPitch = CANINE_NECK + 0.62;
        return drop + (f.rig.mount ? f.rig.mount.legLen * 0.16 : 0);
      }
      case 'guard':
      case 'shoot':
      case 'block':
        return poseCanine(f, 'crouch', t);
      case 'strike':
        return poseCanine(f, 'lunge', t);
      case 'fall':
        return poseCanine(f, 'fall', t, Math.min(1, t / seconds));
    }
  }
  const horse = f.rig.mount;
  const neck = 0.45;
  let drop = 0;
  switch (clip) {
    case 'idle':
      poseFigure(f, 'stand', t);
      if (horse) horse.neckPitch = neck + 0.05 * Math.sin(u * TAU);
      break;
    case 'march':
      poseFigure(f, 'walk', t);
      if (horse) {
        // Шаг коня в четыре такта: каждая нога своей фазой (`figures.HOOF_GAITS`), голова кивает дважды за цикл.
        f.hoofMode = 1;
        f.hoofPhase = u;
        horse.neckPitch = neck + 0.07 * Math.sin(u * TAU * 2);
        f.torsoTilt = 0.04;
        f.legSwing = 0;
        f.bob = 0.008 * Math.sin(u * TAU * 2);
      }
      break;
    case 'run':
    case 'charge':
    case 'flee': {
      if (horse) {
        // Галоп: ноги по фазам маха, корпус качается вперёд-назад, шея качает в такт, всадник привстаёт в стременах.
        poseFigure(f, 'stand', t);
        f.hoofMode = 2;
        f.hoofPhase = u;
        const w = u * TAU;
        f.pitch = 0.075 * Math.sin(w + 0.6);
        horse.neckPitch = neck - 0.08 + 0.14 * Math.sin(w + 2.2);
        drop = 0.025 * horse.legLen * (1 - Math.cos(w * 2));
        f.torsoTilt = 0.22 + 0.06 * Math.sin(w * 2);
        f.bob = 0.012 * Math.sin(w * 2);
        f.headNod = -0.12;
        if (clip === 'charge') {
          // Натиск: копьё опущено наперевес и прижато к боку, всадник прильнул к шее, щит вперёд.
          f.torsoTilt = 0.36;
          f.armMain = look.weapon === 'spear' ? 0.42 : -2.2;
          f.elbowMain = look.weapon === 'spear' ? 0.25 : 0.3;
          f.armOff = -0.55;
          f.elbowOff = 0.6;
          f.armSpread = 0.12;
        } else if (clip === 'flee') {
          // Бегство верхом: пригнулся, оглядывается через плечо, копьё вскинуто назад.
          f.torsoTilt = 0.4;
          f.headTurn = 0.9 * Math.max(0, Math.sin(w));
          f.armMain = 0.6;
        } else {
          f.armMain = -0.2 + 0.1 * Math.sin(w);
          f.armOff = -0.3;
        }
        break;
      }
      // Бег — шаг, разогнанный и размашистый: наклон вперёд, длинный мах ног, руки работают.
      const strides = clip === 'flee' ? 2 : 1;
      poseFigure(f, 'walk', t * ((BEAT.walk * strides) / seconds));
      f.legSwing *= 1.45;
      f.kneeL *= 1.5;
      f.kneeR *= 1.5;
      f.torsoTilt = 0.3;
      f.bob *= 2.2;
      f.armOff *= 1.4;
      if (clip === 'charge') {
        // Бег на сшибку: оружие вперёд — копьё ежом, клинок и топор вскинуты, щит перед грудью.
        f.armOff = -0.75;
        f.elbowOff = 0.6;
        if (look.weapon === 'spear') levelSpear(f, -0.4, 1.25, 1.45);
        else if (look.weapon !== 'bow' && look.weapon !== 'xbow') {
          f.armMain = -2.3;
          f.elbowMain = 0.4;
        }
      } else if (clip === 'flee') {
        // Бегство: корпус вперёд, руки болтаются шире, на втором шаге — оглядка через плечо.
        const w = u * TAU;
        f.torsoTilt = 0.48;
        f.armMain *= 2.4;
        f.armOff *= 1.8;
        f.armSpread = 0.22;
        f.headTurn = 1.1 * Math.max(0, Math.sin(w - 0.4));
        f.headNod = -0.1;
        f.torsoTwist = 0.35 * Math.max(0, Math.sin(w - 0.4));
        // Копьё бегущий не бросает, а несёт: древко отклонено назад, руки машут — оно не крутится.
        if (look.weapon === 'spear') f.wristMain = -0.5 - f.armMain + f.elbowMain;
      }
      break;
    }
    case 'guard':
      poseFigure(f, 'guard', t);
      if (look.weapon === 'spear' && !horse) {
        // Копейщики в упоре — ёж: копьё перехвачено остриём вперёд и опущено на уровень груди.
        levelSpear(f, -0.35 + 0.03 * Math.sin(u * TAU), 1.25, 1.4);
        f.armSpread = 0.1;
      }
      break;
    case 'strike':
      if (look.weapon === 'spear' && !horse) {
        // Укол копьём: от груди вперёд на всю руку и назад; копьё всё время почти ровно, корпус подаётся за ним.
        poseFigure(f, 'guard', t);
        const thrust = u < 0.42 ? 0 : u < 0.55 ? span(u, 0.42, 0.55) : 1 - span(u, 0.62, 1);
        // Рука от груди вперёд на всю длину, кисть держит копьё ровно — остриё вперёд и чуть вниз.
        levelSpear(f, -0.25 - 1.0 * thrust, 1.4 - 1.1 * thrust, 1.5 + 0.08 * thrust);
        f.torsoTilt = 0.12 + 0.18 * thrust;
        f.torsoTwist = 0.2 - 0.3 * thrust;
        f.legSwing = 0.12 + 0.2 * thrust;
        f.kneeL = 0.12 + 0.25 * thrust;
      } else poseFigure(f, 'strike', t);
      break;
    case 'shoot':
      if (look.weapon === 'xbow') {
        // Арбалет: натянуть, наклонясь (нос к земле), вскинуть к плечу, целиться, спуск в миг залпа, опустить.
        poseFigure(f, 'stand', t);
        const up = u < 0.18 ? 0 : u < 0.32 ? span(u, 0.18, 0.32) : u < 0.7 ? 1 : 1 - span(u, 0.7, 0.86);
        const pull = u < 0.18 ? Math.sin((u / 0.18) * Math.PI) : u > 0.86 ? Math.sin(((u - 0.86) / 0.14) * Math.PI * 0.5) : 0;
        const kick = u > RELEASE && u < RELEASE + 0.06 ? Math.sin(((u - RELEASE) / 0.06) * Math.PI) : 0;
        f.armMain = -1.5 * up + 0.12 * kick;
        f.elbowMain = 0.12 + 0.1 * (1 - up);
        f.armOff = -1.25 * up - 0.3 * pull;
        f.elbowOff = 0.7 * up + 0.8 * pull;
        f.armSpread = 0.08;
        f.torsoTilt = 0.6 * (1 - up) * Math.max(pull, 0.3) + 0.04 * up;
        f.torsoTwist = 0.25 * up;
        f.headNod = 0.12 * up - 0.1 * kick;
        f.kneeL = 0.35 * pull;
        f.kneeR = 0.15 * pull;
        break;
      }
      if (look.weapon !== 'bow') {
        poseFigure(f, 'guard', t);
        break;
      }
      {
        // Залп навесом: лук вскинут вперёд и вверх, тетива к подбородку, срыв на `RELEASE` цикла, потом рука за новой
        // стрелой. Стрельба массы — навесом, поэтому лук смотрит в небо, а не в лоб.
        poseFigure(f, 'stand', t);
        const raise = u < 0.2 ? u / 0.2 : u < 0.66 ? 1 : u < 0.82 ? 1 - (u - 0.66) / 0.16 : 0;
        const e = raise * raise * (3 - 2 * raise);
        const draw = u < 0.2 ? 0 : u < 0.62 ? (u - 0.2) / 0.42 : u < 0.64 ? 1 - (u - 0.62) / 0.02 : 0;
        f.armOff = -0.2 - 1.9 * e;
        f.armSpread = 0.1;
        f.elbowOff = 0.1;
        f.armMain = -0.3 - 1.6 * e;
        f.elbowMain = 0.4 + 1.5 * e * draw;
        f.torsoTwist = 0.35 * e;
        f.torsoTilt = -0.06 * e;
        f.headNod = -0.12 * e;
      }
      break;
    case 'block': {
      // Щит вверх: под стрелами и камнями. С круглым — щит над головой и лицом, присел; с ростовым — присел за ним;
      // без щита — пригнулся, руки над головой.
      poseFigure(f, 'guard', t);
      const breath = Math.sin(u * TAU);
      f.kneeL = 0.42;
      f.kneeR = 0.36;
      f.legSwing = 0.18;
      f.bob = -0.045 + breath * 0.004;
      f.headNod = 0.22;
      if (look.shield === 'round') {
        f.armOff = -1.75 + breath * 0.03;
        f.elbowOff = 0.55;
        f.armSpread = 0.05;
        f.torsoTilt = 0.22;
        f.armMain = 0.1;
        f.elbowMain = 0.3;
      } else if (look.shield === 'tall') {
        f.armOff = -0.42;
        f.elbowOff = 0.3;
        f.torsoTilt = 0.32;
        f.armMain = 0.15;
      } else {
        f.armOff = -2.5;
        f.armMain = -2.5;
        f.elbowOff = 1.3;
        f.elbowMain = 1.3;
        f.armSpread = 0.3;
        f.torsoTilt = 0.38;
        // Копьё в поднятых руках — древком над головой, а не остриём в землю.
        if (look.weapon === 'spear') f.wristMain = 1.45 - f.armMain + f.elbowMain;
      }
      if (horse) {
        f.kneeL = 0.7;
        f.kneeR = 0.7;
        f.legSwing = 0;
        f.bob = 0;
      }
      break;
    }
    case 'fall':
      f.down = Math.min(1, t / seconds);
      poseFigure(f, 'fall', t);
      break;
    case 'cheer': {
      // Победа: оружие вскинуто над головой и качается в такт крику, вторая рука — вполвысоты, корпус чуть назад.
      poseFigure(f, 'stand', t);
      const pulse = 0.5 + 0.5 * Math.sin(u * TAU);
      f.armMain = -2.45 - 0.4 * pulse;
      f.elbowMain = 0.15 + 0.25 * (1 - pulse);
      f.armOff = -0.9 - 0.3 * pulse;
      f.armSpread = 0.22;
      f.elbowOff = 0.5;
      f.torsoTilt = -0.06 - 0.04 * pulse;
      f.headNod = -0.18;
      f.bob = 0.012 * pulse;
      // Копьё над головой — остриём вверх: кисть перехватывает древко (у пешего; конный держит наперевес).
      if (look.weapon === 'spear' && !horse) f.wristMain = 0.25 - f.armMain + f.elbowMain;
      if (horse) horse.neckPitch = neck - 0.1 * pulse;
      break;
    }
  }
  return drop;
}

const _joint = new THREE.Matrix4();
const _size = new THREE.Vector3();

/**
 * Запечь виды боя: меши обликов на вид и общая текстура суставов. `fps` — кадров клипа в секунду (уровень качества,
 * `TW_SPEC.bakeFps`); между кадрами шейдер смешивает.
 */
export function bakeLooks(looks: readonly Look[], fps: number): { baked: BakedLook[]; texture: BoneTexture } {
  const baked: BakedLook[] = [];
  const blocks: Float32Array[] = [];
  let base = 0;
  for (const look of looks) {
    const f = new Figure();
    f.phase = 0;
    dress(f, look, hashKey(look.key));
    const lods = LODS.map((d) => mergeSlots(f, look, d)) as BakedLook['lods'];
    const secs = CLIP_SECONDS[look.body];
    const clips = {} as Record<ClipId, ClipSpec>;
    let rows = 0;
    for (const clip of CLIPS) {
      const loop = clip !== 'fall';
      const frames = Math.max(2, Math.round(secs[clip] * fps)) + (loop ? 0 : 1);
      clips[clip] = { seconds: secs[clip], frames, loop, start: rows };
      rows += frames;
    }
    const data = new Float32Array(rows * ROW_TEXELS * 4);
    // Обратные матрицы деталей: сустав = мир детали × её покой⁻¹. Матрица сустава — вращение и перенос, поэтому
    // нормаль в шейдере крутится той же матрицей без обратной-транспонированной.
    const inverse = f.slots.map((s) => new THREE.Matrix4().copy(s.local).invert());
    const neck = look.body === 'horse' ? f.rig.mount?.neckPitch : undefined;
    for (const clip of CLIPS) {
      const c = clips[clip];
      for (let i = 0; i < c.frames; i++) {
        const t = c.loop ? (i / c.frames) * c.seconds : (i / (c.frames - 1)) * c.seconds;
        // Наклон шеи коня — поле скелета, клип его качает: каждый кадр — от покоя.
        if (f.rig.mount && neck !== undefined) f.rig.mount.neckPitch = neck;
        const drop = poseClip(f, look, clip, t, c.seconds);
        f.position.set(0, -drop, 0);
        const row = c.start + i;
        const seen = new Set<number>();
        let k = 0;
        forEachPart(f, (slot, m) => {
          const j = JOINT_INDEX[slot.joint];
          const idx = k++;
          if (seen.has(j)) return;
          seen.add(j);
          _joint.multiplyMatrices(m, inverse[idx]);
          const e = _joint.elements;
          const o = (row * ROW_TEXELS + j * 3) * 4;
          // Три строки матрицы 3×4: (m00 m01 m02 m03), (m10 …), (m20 …). Элементы three — по столбцам.
          data.set([e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]], o);
        });
      }
    }
    blocks.push(data);
    const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.attributes.position.count) / 3;
    baked.push({ look, lods, lodTriangles: [tris(lods[0]), tris(lods[1]), tris(lods[2])], clips, base, rows });
    base += rows;
  }
  const all = new Float32Array(base * ROW_TEXELS * 4);
  let at = 0;
  for (const b of blocks) {
    all.set(b, at);
    at += b.length;
  }
  return { baked, texture: new BoneTexture(all, ROW_TEXELS, Math.max(1, base)) };
}

/** Своя мелочь вида — покрой ополчения — от ключа вида, а не от случая. */
function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Геометрия примитива на уровне детализации: вблизи — круглее (больше граней), вдали — грубее. */
function primitive(part: PartName, detail: Detail): THREE.BufferGeometry {
  if (detail === 1) return partGeometry(part);
  const flat = (n: number): number => Math.PI / n;
  if (detail === 2) {
    switch (part) {
      case 'limb':
        // Конечность — шестигранная, к низу тоньше: рука и нога круглые, а не брус.
        return new THREE.CylinderGeometry(0.56, 0.47, 1, 6, 1, false, flat(6)).translate(0, -0.5, 0);
      case 'body':
        return new THREE.CylinderGeometry(0.5, 0.39, 1, 8, 1, false, flat(8)).translate(0, 0.5, 0);
      case 'head':
        return new THREE.SphereGeometry(0.5, 8, 6, flat(8));
      case 'cap':
        return new THREE.ConeGeometry(0.5, 1, 8, 1, false, flat(8)).translate(0, 0.5, 0);
      case 'shaft':
        return new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, true).translate(0, 0.5, 0);
      case 'shield':
        return new THREE.CylinderGeometry(0.5, 0.5, 1, 12).rotateX(Math.PI / 2);
      default:
        return partGeometry(part);
    }
  }
  switch (part) {
    case 'head':
      return new THREE.SphereGeometry(0.5, 5, 3, flat(5));
    case 'body':
      return new THREE.CylinderGeometry(0.5, 0.39, 1, 5, 1, false, flat(5)).translate(0, 0.5, 0);
    case 'cap':
      return new THREE.ConeGeometry(0.5, 1, 4, 1, false, flat(4)).translate(0, 0.5, 0);
    case 'shaft':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 1, true).translate(0, 0.5, 0);
    default:
      return partGeometry(part);
  }
}

/**
 * Детали фигуры — в одну геометрию: вершина в системе своего сустава, цвет, номер сустава, доля цвета стороны и
 * `aPart` — класс разброса, вариант, место на гербе. `detail` — облик (`LODS`): вдали — без предплечий, хвоста и мелочи,
 * один вариант головы и без бороды.
 */
function mergeSlots(f: Figure, look: Look, detail: Detail): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const joint: number[] = [];
  const side: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  // Сталь клинков, наконечников и умбонов — светлее железа ковки: на поле блестит.
  const metal = new THREE.Color(STEEL);
  const dark = new THREE.Color(DARK);
  const wood = new THREE.Color(PALETTE.woodDark);
  for (const slot of f.slots) {
    const v = slot.variant ?? 0;
    if ((slot.lod ?? 0) > detail) continue;
    // Варианты головы и борода — только вблизи: дальше разброс видно красками (кожа, волосы, шерсть, масть — шейдер), а
    // вершины лишнего шлема стоили бы каждому бойцу. Не вблизи — первый вариант, у всех.
    if (detail < 2 && v !== 0 && (v === BEARD || v % 10 !== 1)) continue;
    const variant = detail < 2 ? 0 : v;
    const g = slot.shape ? shapeGeometry(slot.shape, detail) : primitive(slot.part, detail);
    g.applyMatrix4(slot.local);
    if (detail === 0) {
      g.computeBoundingBox();
      const size = g.boundingBox!.getSize(_size);
      if (FAR_DROP.has(slot.joint) || Math.max(size.x, size.y, size.z) < FAR_DETAIL) {
        g.dispose();
        continue;
      }
    }
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const subs = g.getAttribute('sub');
    const uvs = slot.shape ? g.getAttribute('uv') : null;
    const off = pos.length / 3;
    const own = sideOf(slot.color.getHex(), look);
    const ownMat = MAT_INDEX[matOf(slot)];
    c.copy(slot.color);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      const sub = subs ? subs.getX(i) : SUB.own;
      let s = own;
      let m = ownMat;
      let cu = -1;
      let cv = -1;
      if (sub === SUB.iron) {
        col.push(metal.r, metal.g, metal.b);
        s = 0;
        m = MAT_INDEX.metal;
      } else if (sub === SUB.dark) {
        col.push(dark.r, dark.g, dark.b);
        s = 0;
        m = MAT_INDEX.fixed;
      } else if (sub === SUB.wood) {
        col.push(wood.r, wood.g, wood.b);
        s = 0;
        m = MAT_INDEX.leather;
      } else {
        // Поле герба — поверх цвета детали (цвет стороны): без текстуры (облик вдали) щит — цвета стороны.
        if (sub === SUB.coat && uvs) {
          cu = uvs.getX(i);
          cv = uvs.getY(i);
        }
        if (s > 0) col.push(1, 1, 1);
        else col.push(c.r, c.g, c.b);
      }
      joint.push(JOINT_INDEX[slot.joint]);
      side.push(s);
      part.push(m, variant, cu, cv);
    }
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + off);
    else for (let i = 0; i < p.count; i++) idx.push(i + off);
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aJoint', new THREE.Float32BufferAttribute(joint, 1));
  geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 4));
  geo.setIndex(idx);
  return geo;
}

/**
 * Текстура матриц суставов. Своим классом поверх `Texture`, как слои города (`city/tex.ts`, `LayerTexture`): имя
 * `DataTexture` в куске three первой загрузки не нужно, а загрузчику хватает признака `isDataTexture`.
 */
export class BoneTexture extends THREE.Texture {
  readonly isDataTexture = true;
  constructor(data: Float32Array, width: number, height: number) {
    super();
    this.image = { data, width, height } as unknown as HTMLImageElement;
    // Константы three — числами (`RGBAFormat` 1023, `FloatType` 1015, `NearestFilter` 1003), как жёсткая тень у
    // сцены (`Scene`, `shadowMap.type = 0`): имя, нужное одному ленивому куску, тянуло бы байты в кусок three первой
    // загрузки (docs/battle_tw.md, раздел 7).
    this.format = 1023 as THREE.PixelFormat;
    this.type = 1015 as THREE.TextureDataType;
    this.magFilter = 1003 as THREE.MagnificationTextureFilter;
    this.minFilter = 1003 as THREE.MinificationTextureFilter;
    this.generateMipmaps = false;
    this.flipY = false;
    this.unpackAlignment = 1;
    this.needsUpdate = true;
  }

  /** Байт в памяти видеокарты: по ним считается бюджет текстур. */
  get bytes(): number {
    const img = this.image as unknown as { data: Float32Array };
    return img.data.byteLength;
  }
}

/**
 * Кадр клипа для фигуры: две строки текстуры и доля смешивания. Клип по кругу — по модулю, гибель — до последнего
 * кадра и там остаётся (павший лежит).
 */
export function frameRows(b: BakedLook, clip: ClipId, time: number, out: { a: number; b: number; w: number }): void {
  const c = b.clips[clip];
  let f: number;
  if (c.loop) {
    const u = time / c.seconds;
    f = (u - Math.floor(u)) * c.frames;
  } else f = Math.min(1, Math.max(0, time / c.seconds)) * (c.frames - 1);
  const i = Math.floor(f);
  const j = c.loop ? (i + 1) % c.frames : Math.min(i + 1, c.frames - 1);
  out.a = b.base + c.start + Math.min(i, c.frames - 1);
  out.b = b.base + c.start + j;
  out.w = f - i;
}
