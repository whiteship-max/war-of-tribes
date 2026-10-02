// Запечённая анимация бойцов ролика TW (docs/battle_tw.md, раздел 8, решения 2–3).
//
// Фигуры — те же, что в игре: скелет и детали `render/figures.ts`, одевание `render/units.ts` и `render/beasts.ts`,
// позы `render/poses.ts`. Новое только в том, как их рисовать сотнями. Детали фигуры сливаются в один меш, каждая
// вершина — в системе своего сустава; позы клипов (стоять, шаг, бег, упор, удар, стрельба, гибель) один раз
// считаются на процессоре и кладутся в текстуру матриц суставов — строка на кадр. Вершинный шейдер берёт два
// соседних кадра и смешивает (`crowd.ts`). Суставов — 24 на любую фигуру, поэтому текстура — килобайты на вид, а
// не мегабайты, как у запечённых вершин.
//
// Цвет стороны в меш не запекается: детали, одетые «цветом стороны», помечены (`aSide`), и красит их шейдер — синим
// или красным по фигуре. Так один меш служит обеим сторонам, и вызовов вдвое меньше.
import * as THREE from 'three';
import type { UnitKind } from '@/battle/types';
import { wearOf } from '@/game/battle/faces';
import { Figure, JOINTS, forEachPart, partGeometry, type JointId, type PartName } from '../figures';
import { BEAT, poseFigure } from '../poses';
import { FOLK_KINDS, dressSoldier, dressVillager } from '../units';
import { WOLF_DARK, darker, dressCanine, poseCanine, wolfLook } from '../beasts';
import { FOLK_TINT, PALETTE } from '../palette';
import { CLIPS, type ClipId } from './plan';

/** Цвет-метка «здесь цвет стороны»: его нет в палитре, и спутать его не с чем. */
const SENTINEL = 0x0f1e2d;
/** Тёмная шерсть волка — тот же цвет стороны, темнее (`beasts.wolfLook`). Множитель в линейном свете. */
const WOLF_DARK_LINEAR = Math.pow(WOLF_DARK, 2.2);

/** Сколько суставов в строке текстуры: все, что знает фигура. Три тексела на сустав — три строки матрицы. */
export const JOINT_COUNT = JOINTS.length;
export const ROW_TEXELS = JOINT_COUNT * 3;
const JOINT_INDEX = JOINTS.reduce((acc, j, i) => ((acc[j] = i), acc), {} as Record<JointId, number>);

/** Вид бойца в ролике: что надето и как он двигается. Один меш на вид. */
export interface Look {
  key: string;
  face: string;
  kind: UnitKind;
  /** Верхом или зверь: клипы у них свои (рысь, галоп), у пешего — свои. */
  body: 'man' | 'horse' | 'beast';
}

export const lookOf = (face: string, kind: UnitKind): Look => {
  const wear = wearOf(face, kind);
  const body = wear.wear === 'beast' ? 'beast' : kind === 'cavalry' || kind === 'heavy' ? 'horse' : 'man';
  return { key: `${face}:${kind}`, face, kind, body };
};

/** Клип: сколько длится, сколько кадров, по кругу ли. */
export interface ClipSpec {
  seconds: number;
  frames: number;
  loop: boolean;
  /** Первая строка клипа в блоке вида. */
  start: number;
}

/** Длительности клипов. Шаг, удар — циклы игры (`poses.BEAT`); стойка и упор — период их дыхания. */
const CLIP_SECONDS: Record<'man' | 'horse' | 'beast', Record<ClipId, number>> = {
  man: { idle: (Math.PI * 2) / 1.7, march: BEAT.walk, run: 0.5, guard: (Math.PI * 2) / 2.1, strike: BEAT.strike, shoot: 3, fall: 0.9 },
  horse: { idle: (Math.PI * 2) / 1.7, march: BEAT.walk, run: 0.46, guard: (Math.PI * 2) / 2.1, strike: BEAT.strike, shoot: 3, fall: 0.9 },
  beast: { idle: (Math.PI * 2) / 0.7, march: (Math.PI * 2) / 13, run: 0.32, guard: (Math.PI * 2) / 3, strike: (Math.PI * 2) / 6, shoot: (Math.PI * 2) / 3, fall: 0.9 },
};

/** Один вид, запечённый: меш в системе суставов и где его кадры в общей текстуре. */
export interface BakedLook {
  look: Look;
  geometry: THREE.BufferGeometry;
  clips: Record<ClipId, ClipSpec>;
  /** Строка текстуры, с которой начинается блок вида. */
  base: number;
  rows: number;
  /** Сколько треугольников в меше вида. */
  triangles: number;
}

/** Одеть фигуру этого вида. Цвет стороны — метка: красит шейдер. */
function dress(f: Figure, look: Look, variant: number): void {
  const wear = wearOf(look.face, look.kind);
  if (wear.wear === 'folk') dressVillager(f, variant % FOLK_KINDS);
  else if (wear.wear === 'beast') dressCanine(f, wolfLook(SENTINEL));
  else dressSoldier(f, wear.troop, SENTINEL);
}

/** Насколько деталь — цвет стороны: 0 — нет (своё дерево, железо, кожа), 1 — да, меньше — темнее него. */
function sideOf(color: number, look: Look, part: PartName): number {
  if (color === SENTINEL) return 1;
  if (color === darker(SENTINEL, WOLF_DARK)) return WOLF_DARK_LINEAR;
  // Гребень латника одет красным всегда (`units.armorUp`); в бою он — сторона, иначе синий отряд нёс бы чужой цвет.
  if (color === PALETTE.paintRed && part === 'plate') return 1;
  // Ополчение одето жителями (`dressVillager`): рубаха — цвет стороны, иначе по кадру не видно, чьи они.
  if (wearOf(look.face, look.kind).wear === 'folk' && FOLK_TINT.includes(color)) return 1;
  return 0;
}

/** Поза клипа на секунде `t` (с начала клипа). Фигура уже одета. */
function poseClip(f: Figure, look: Look, clip: ClipId, t: number, seconds: number): number {
  f.phase = 0;
  if (look.body === 'beast') {
    switch (clip) {
      case 'idle':
        return poseCanine(f, 'stand', t);
      case 'march':
        return poseCanine(f, 'trot', t);
      case 'run': {
        const drop = poseCanine(f, 'trot', t * (((Math.PI * 2) / 13) / seconds));
        f.pitch += 0.05;
        return drop;
      }
      case 'guard':
      case 'shoot':
        return poseCanine(f, 'crouch', t);
      case 'strike':
        return poseCanine(f, 'lunge', t);
      case 'fall':
        return poseCanine(f, 'fall', t, Math.min(1, t / seconds));
    }
  }
  switch (clip) {
    case 'idle':
      poseFigure(f, 'stand', t);
      break;
    case 'march':
      poseFigure(f, 'walk', t);
      break;
    case 'run': {
      // Бег — шаг, разогнанный и размашистый: наклон вперёд, длинный мах ног, руки работают. У коня — галоп.
      poseFigure(f, 'walk', t * (BEAT.walk / seconds));
      f.legSwing *= 1.45;
      f.kneeL *= 1.5;
      f.kneeR *= 1.5;
      f.torsoTilt = 0.3;
      f.bob *= 2.2;
      f.armOff *= 1.4;
      f.gait *= 1.5;
      if (f.rig.mount) f.pitch = 0.07 * Math.sin((t / seconds) * Math.PI * 2);
      break;
    }
    case 'guard':
      poseFigure(f, 'guard', t);
      break;
    case 'strike':
      poseFigure(f, 'strike', t);
      break;
    case 'shoot': {
      // Залп навесом: лук вскинут вперёд и вверх, тетива к подбородку, срыв на `SHOOT_RELEASE` цикла (plan.ts),
      // потом рука за новой стрелой. Стрельба массы — навесом, поэтому лук смотрит в небо, а не в лоб.
      poseFigure(f, 'stand', t);
      const u = t / seconds;
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
      break;
    }
    case 'fall':
      f.down = Math.min(1, t / seconds);
      poseFigure(f, 'fall', t);
      break;
  }
  return 0;
}

const _joint = new THREE.Matrix4();

/**
 * Запечь виды боя: меш на вид и общая текстура суставов. `fps` — кадров клипа в секунду (уровень качества,
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
    const geometry = mergeSlots(f, look);
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
    for (const clip of CLIPS) {
      const c = clips[clip];
      for (let i = 0; i < c.frames; i++) {
        const t = c.loop ? (i / c.frames) * c.seconds : (i / (c.frames - 1)) * c.seconds;
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
    const index = geometry.getIndex();
    baked.push({ look, geometry, clips, base, rows, triangles: (index ? index.count : geometry.attributes.position.count) / 3 });
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

/** Детали фигуры — в одну геометрию: вершина в системе своего сустава, цвет, номер сустава, доля цвета стороны. */
function mergeSlots(f: Figure, look: Look): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const joint: number[] = [];
  const side: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  for (const slot of f.slots) {
    const g = partGeometry(slot.part);
    g.applyMatrix4(slot.local);
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const off = pos.length / 3;
    const s = sideOf(slot.color.getHex(), look, slot.part);
    c.copy(slot.color);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      if (s > 0) col.push(1, 1, 1);
      else col.push(c.r, c.g, c.b);
      joint.push(JOINT_INDEX[slot.joint]);
      side.push(s);
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
