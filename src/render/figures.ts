// Фигурки — горожане, бойцы и кони — рисуются инстансами. На всю сцену семь
// геометрий-примитивов (конечность, корпус, голова, шапка, древко, пластина,
// щит), а на каждую деталь каждой фигурки — только матрица и цвет. Сколько бы
// людей ни стояло в кадре, вызовов отрисовки одиннадцать: семь на примитивы и
// четыре на теневой проход.
//
// Почему не готовая скелетная модель: она рисуется отдельным вызовом на фигуру
// плюс расчёт костей каждый кадр. Вся дешевизна сцены держится на инстансинге,
// и ради него фигуры лепятся кодом — из примитивов, по обмеренным пропорциям
// (docs/figures.md).
//
// Устройство такое:
// - `Rig` — скелет числами: высоты таза, плеча, шеи, длина руки. Пропорции —
//   доли роста, выведенные из эталона, поэтому крупный и мелкий вид отличаются
//   одним числом роста, а не таблицей смещений;
// - `Slot` — одна деталь: примитив, сустав, к которому она привязана, цвет и
//   покоящееся положение. Набор слотов задаётся один раз при «одевании»
//   (units.ts) и больше не меняется;
// - поза — это углы в суставах (poses.ts). Скиннинга нет: деталь целиком едет
//   за своим суставом, поэтому мах ноги, замах и падение стоят одного поворота.
//
// Агент (villagers.ts, soldiers.ts) мешей не держит: он правит позу своей
// `Figure`, а матрицы всех инстансов раз в кадр пишет пул.
import * as THREE from 'three';
import { INSTANCED } from './materials';

export type PartName = 'limb' | 'body' | 'head' | 'cap' | 'shaft' | 'plate' | 'shield';

export const PARTS: PartName[] = ['limb', 'body', 'head', 'cap', 'shaft', 'plate', 'shield'];

/**
 * Кто отбрасывает тень. Конечности и мелочь — нет: они всё равно лежат в тени
 * собственного корпуса, а каждый тип детали в теневом проходе стоит вызова.
 */
const CASTS: PartName[] = ['body', 'head', 'shield', 'plate'];

/**
 * Суставы. Список закрытый и плоский: у каждого известен родитель, порядок
 * вычисления — сверху вниз по этому же списку.
 */
export type JointId =
  | 'root'
  | 'hips'
  | 'torso'
  | 'head'
  | 'armL'
  | 'armR'
  | 'elbowL' | 'elbowR' | 'handL' | 'handR'
  | 'kneeL' | 'kneeR'
  | 'legL'
  | 'legR'
  | 'neck'
  | 'legFL'
  | 'legFR'
  | 'legBL'
  | 'legBR'
  | 'hockFL' | 'hockFR' | 'hockBL' | 'hockBR'
  | 'tail';

export const JOINTS: JointId[] = [
  'root', 'hips', 'torso', 'head', 'armL', 'armR', 'legL', 'legR',
  'elbowL', 'elbowR', 'handL', 'handR', 'kneeL', 'kneeR',
  'neck', 'legFL', 'legFR', 'legBL', 'legBR', 'tail',
  'hockFL', 'hockFR', 'hockBL', 'hockBR',
];

/** Скелет коня. Ноль у фигуры — пеший. */
export interface MountRig {
  /** Высота спины: по ней садится всадник и от неё считается корпус. */
  backY: number;
  /** Высота бочки от спины вниз. */
  barrelH: number;
  /** Длина корпуса от груди до крупа и его ширина. */
  bodyLen: number;
  bodyW: number;
  /** Верх ноги, разнос по бокам и по длине, длина. */
  legY: number;
  legX: number;
  legZ: number;
  legLen: number;
  /** Основание шеи, её вынос вперёд, длина и наклон. */
  neckY: number;
  neckZ: number;
  neckLen: number;
  neckPitch: number;
  /** Основание хвоста. */
  tailY: number;
  tailZ: number;
}

/** Скелет фигуры числами. Всё, что нужно суставам, — и ничего больше. */
export interface Rig {
  /** Полный рост: от земли до макушки. Из него выведены все остальные высоты. */
  height: number;
  /** Высота тазобедренного сустава; у конного — высота посадки. */
  hipY: number;
  /** Разнос ног от оси. */
  hipX: number;
  /** Высота плечевого сустава. */
  shoulderY: number;
  /** Полуразмах плеч. */
  shoulderX: number;
  /** Длина руки: плечо → кисть. */
  armLen: number;
  /** Длина ноги не меняется при посадке на коня. */
  legLen: number;
  /** Основание шеи: вокруг него кивает голова. */
  neckY: number;
  /** Развод коленей: у всадника ноги обнимают бока коня. */
  straddle: number;
  /** Посадка: постоянный вынос обеих ног вперёд. У пешего ноль. */
  seat: number;
  /** Конь под фигурой или ноль. */
  mount: MountRig | null;
}

export const restRig = (): Rig => ({
  height: 1,
  hipY: 0.45,
  hipX: 0.06,
  shoulderY: 0.7,
  shoulderX: 0.13,
  armLen: 0.27,
  legLen: 0.44,
  neckY: 0.78,
  straddle: 0,
  seat: 0,
  mount: null,
});

/** Одна деталь фигуры: примитив на суставе, с покоящимся положением и цветом. */
export interface Slot {
  part: PartName;
  joint: JointId;
  /** Положение детали относительно сустава — считается один раз при одевании. */
  local: THREE.Matrix4;
  color: THREE.Color;
}

/**
 * Поза одной фигурки. Агент правит поля, пул читает их раз в кадр.
 *
 * Углы — радианы, положительный поворот вокруг X наклоняет вперёд (в сторону +z
 * фигуры). Левое и правое — со стороны самой фигуры.
 */
export class Figure {
  readonly position = new THREE.Vector3();
  rotationY = 0;
  /** Общий масштаб фигуры поверх роста из скелета. */
  scale = 1;
  visible = true;

  /** Своё смещение по времени: иначе толпа машет ногами в такт. */
  phase = Math.random() * 100;

  // ---------- поза ----------
  /** Наклон всей фигуры вперёд: падение, рывок. */
  pitch = 0;
  /** Крен всей фигуры вбок: падение набок. */
  roll = 0;
  /** Подъём и присед таза: покачивание при ходьбе. */
  bob = 0;
  /** Наклон корпуса вперёд. */
  torsoTilt = 0;
  /** Разворот плеч: замах идёт корпусом, а не одной рукой. */
  torsoTwist = 0;
  /** Кивок головы. */
  headNod = 0;
  /** Мах ног: левая на +swing, правая на −swing. */
  legSwing = 0;
  /** Переступ коня — свой: у всадника ноги в стременах не машут. */
  gait = 0;
  /** Рука с оружием: замах назад — минус, удар вперёд — плюс. */
  armMain = 0;
  /** Свободная рука (или со щитом). */
  armOff = 0;
  /** Развод рук в стороны от корпуса. */
  armSpread = 0.06;
  /** Сгиб локтей и коленей: положительное колено уходит назад. */
  elbowMain = 0;
  elbowOff = 0;
  kneeL = 0;
  kneeR = 0;
  /** Доля падения, 0..1. Двигает её тот, кто роняет, — поза только читает. */
  down = 0;

  /** Скелет и детали — их ставит «одевание» (units.ts). */
  rig: Rig = restRig();
  readonly slots: Slot[] = [];

  /** Сколько инстансов каждого примитива просит эта фигура. */
  readonly counts: Record<PartName, number> = { limb: 0, body: 0, head: 0, cap: 0, shaft: 0, plate: 0, shield: 0 };

  /** Снимает всё надетое: фигура одевается заново. */
  strip(): void {
    this.slots.length = 0;
    for (const p of PARTS) this.counts[p] = 0;
  }
}

// ---------- Примитивы ----------
//
// Все единичного размера, поэтому масштаб слота — это прямо размер детали в
// метрах сцены. Опорная точка выбрана так, чтобы поворот в суставе был правдой:
// конечность висит из сустава, корпус растёт вверх, голова вертится вокруг себя.

/** Шестигранник ставится плоской гранью вперёд: у корпуса должна быть грудь, а не киль. */
const FLAT6 = Math.PI / 6;

function geometryOf(part: PartName): THREE.BufferGeometry {
  switch (part) {
    case 'limb':
      // Висит из сустава вниз: рука от плеча, нога от таза, нога коня от корпуса.
      return new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0);
    case 'body':
      // Кверху шире: плечи должны быть шире таза. Растёт вверх от опоры.
      return new THREE.CylinderGeometry(0.5, 0.39, 1, 6, 1, false, FLAT6).translate(0, 0.5, 0);
    case 'head':
      return new THREE.SphereGeometry(0.5, 6, 4, FLAT6);
    case 'cap':
      // Шапка, капюшон, шлем: конус от основания вверх.
      return new THREE.ConeGeometry(0.5, 1, 6, 1, false, FLAT6).translate(0, 0.5, 0);
    case 'shaft':
      // Древко: без донцев — их всё равно закрывает рука и наконечник.
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 4, 1, true).translate(0, 0.5, 0);
    case 'plate':
      // Пластина: клинок, лезвие топора, кираса, колчан, щит-каплевидка, морда коня.
      return new THREE.BoxGeometry(1, 1, 1);
    case 'shield':
      // Круглый щит: диск лицом вперёд, по местным осям — ширина, высота, толщина.
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 8).rotateX(Math.PI / 2);
  }
}

// ---------- Одевание ----------

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * Вешает деталь на сустав. `pos` — смещение от сустава, `size` — размер детали,
 * `rot` — её собственный поворот (Эйлер XYZ).
 */
export function addSlot(
  f: Figure,
  part: PartName,
  joint: JointId,
  color: number,
  pos: readonly [number, number, number],
  size: readonly [number, number, number],
  rot: readonly [number, number, number] = [0, 0, 0],
  frame: THREE.Matrix4 | null = null,
): Slot {
  _p.set(pos[0], pos[1], pos[2]);
  _e.set(rot[0], rot[1], rot[2]);
  _q.setFromEuler(_e);
  _s.set(size[0], size[1], size[2]);
  const local = new THREE.Matrix4().compose(_p, _q, _s);
  // Оружие собирается в системе хвата: у всех его частей одна ось, и наклон
  // клинка правится одним числом, а не пересчётом каждой детали.
  if (frame) local.premultiply(frame);
  const slot: Slot = {
    part,
    joint,
    local,
    color: new THREE.Color(color),
  };
  f.slots.push(slot);
  f.counts[part]++;
  return slot;
}

/** Система хвата: начало у кисти, ось Y — вдоль оружия. */
export function gripFrame(
  pos: readonly [number, number, number],
  rot: readonly [number, number, number],
): THREE.Matrix4 {
  _p.set(pos[0], pos[1], pos[2]);
  _e.set(rot[0], rot[1], rot[2]);
  _q.setFromEuler(_e);
  _s.set(1, 1, 1);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

// ---------- Пул ----------

/** Шаг роста ёмкости: пересобирать инстансы на каждой фигурке дорого. */
const GROW_STEP = 64;

/** Суставы одного кадра: считаются заново на каждую фигуру, память не растёт. */
const POSE: Record<JointId, THREE.Matrix4> = JOINTS.reduce(
  (acc, id) => {
    acc[id] = new THREE.Matrix4();
    return acc;
  },
  {} as Record<JointId, THREE.Matrix4>,
);

/** Локальная матрица сустава — одна на все вычисления кадра. */
const _joint = new THREE.Matrix4();

function jointLocal(x: number, y: number, z: number, rx: number, ry = 0, rz = 0): THREE.Matrix4 {
  _p.set(x, y, z);
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _s.set(1, 1, 1);
  return _joint.compose(_p, _q, _s);
}

const put = (out: JointId, parent: JointId, x: number, y: number, z: number, rx: number, ry = 0, rz = 0): void => {
  POSE[out].multiplyMatrices(POSE[parent], jointLocal(x, y, z, rx, ry, rz));
};

/**
 * Считает матрицы суставов фигуры. Порядок жёсткий: родитель раньше ребёнка.
 * Конские суставы считаются только у конных — пешему они не стоят ничего.
 */
function poseJoints(f: Figure): void {
  const r = f.rig;
  _p.copy(f.position);
  // YXZ: сперва разворот по земле, потом наклон вперёд и крен — падение читается верно.
  _e.set(f.pitch, f.rotationY, f.roll, 'YXZ');
  _q.setFromEuler(_e);
  _s.setScalar(f.scale);
  POSE.root.compose(_p, _q, _s);

  const m = r.mount;
  if (m) {
    put('neck', 'root', 0, m.neckY, m.neckZ, m.neckPitch);
    // Хвост висит вниз и назад; своё смещение по времени — чтобы кони не были близнецами.
    put('tail', 'root', 0, m.tailY, m.tailZ, 0.55 + Math.sin(f.phase) * 0.12);
    // Ноги коня переступают в противофазе по диагоналям — рысь, а не прыжки.
    const gait = f.gait;
    put('legFL', 'root', m.legX, m.legY, m.legZ, gait);
    put('legFR', 'root', -m.legX, m.legY, m.legZ, -gait);
    put('legBL', 'root', m.legX, m.legY, -m.legZ, -0.18 - gait);
    put('legBR', 'root', -m.legX, m.legY, -m.legZ, -0.18 + gait);
    put('hockFL', 'legFL', 0, -m.legLen * 0.44, 0, -Math.max(0, gait) * 1.2);
    put('hockFR', 'legFR', 0, -m.legLen * 0.44, 0, -Math.max(0, -gait) * 1.2);
    put('hockBL', 'legBL', 0, -m.legLen * 0.44, 0, 0.32 + Math.max(0, -gait));
    put('hockBR', 'legBR', 0, -m.legLen * 0.44, 0, 0.32 + Math.max(0, gait));
  }

  put('hips', 'root', 0, r.hipY + f.bob, 0, 0);
  put('torso', 'hips', 0, 0, 0, f.torsoTilt, f.torsoTwist);
  put('head', 'torso', 0, r.neckY - r.hipY, 0, f.headNod);
  // Поворот вокруг +Z уводит висящую конечность в сторону +x, поэтому левая
  // (она стоит на +x) разводится плюсом, правая — минусом.
  put('armL', 'torso', r.shoulderX, r.shoulderY - r.hipY, 0, f.armOff, 0, f.armSpread);
  put('armR', 'torso', -r.shoulderX, r.shoulderY - r.hipY, 0, f.armMain, 0, -f.armSpread);
  put('legL', 'hips', r.hipX, 0, 0, r.seat + f.legSwing, 0, r.straddle);
  put('legR', 'hips', -r.hipX, 0, 0, r.seat - f.legSwing, 0, -r.straddle);
  const halfArm = r.armLen * 0.5;
  put('elbowL', 'armL', 0, -halfArm, 0, -f.elbowOff);
  put('elbowR', 'armR', 0, -halfArm, 0, -f.elbowMain);
  put('handL', 'elbowL', 0, -halfArm, 0, 0);
  put('handR', 'elbowR', 0, -halfArm, 0, 0);
  const thigh = r.legLen * 0.5;
  put('kneeL', 'legL', 0, -thigh, 0, f.kneeL);
  put('kneeR', 'legR', 0, -thigh, 0, f.kneeR);
}

/** Матрица детали — одна на весь обход, наружу она не отдаётся. */
const _part = new THREE.Matrix4();

/**
 * Обходит детали фигуры в её нынешней позе, отдавая мировую матрицу каждой.
 * Ею пользуется и пул (пишет инстансы), и обмер силуэта: считать позу дважды
 * по-разному — верный способ развести показ и проверку.
 */
export function forEachPart(f: Figure, cb: (slot: Slot, m: THREE.Matrix4) => void): void {
  poseJoints(f);
  for (const slot of f.slots) {
    _part.multiplyMatrices(POSE[slot.joint], slot.local);
    cb(slot, _part);
  }
}

/**
 * Местная коробка примитива: у висящей конечности опора наверху, у корпуса,
 * шапки и древка — внизу, у остальных посередине.
 */
const PART_BOX: Record<PartName, readonly [number, number]> = {
  limb: [-1, 0],
  body: [0, 1],
  head: [-0.5, 0.5],
  cap: [0, 1],
  shaft: [0, 1],
  plate: [-0.5, 0.5],
  shield: [-0.5, 0.5],
};

const _corner = new THREE.Vector3();

/** Габариты фигуры в её нынешней позе — по ним стенд раскладывает ряд. */
export function figureBox(f: Figure, out = new THREE.Box3()): THREE.Box3 {
  out.makeEmpty();
  forEachPart(f, (slot, m) => {
    const [lo, hi] = PART_BOX[slot.part];
    for (let i = 0; i < 8; i++) {
      _corner.set(
        (i & 1) - 0.5,
        (i >> 1) & 1 ? hi : lo,
        ((i >> 2) & 1) - 0.5,
      ).applyMatrix4(m);
      out.expandByPoint(_corner);
    }
  });
  return out;
}

/**
 * Все фигурки сцены. Инстансы пишутся плотно: сколько деталей реально видно,
 * столько и уходит в отрисовку. Пустых мест в буфере нет — вырожденный
 * треугольник ничего не рисует, но вершинный конвейер за него платит.
 */
export class FigurePool {
  readonly group = new THREE.Group();
  private meshes = {} as Record<PartName, THREE.InstancedMesh>;
  private geometries = {} as Record<PartName, THREE.BufferGeometry>;
  private figures: Figure[] = [];
  private capacity = {} as Record<PartName, number>;
  private need = { limb: 0, body: 0, head: 0, cap: 0, shaft: 0, plate: 0, shield: 0 } as Record<PartName, number>;

  constructor() {
    this.group.name = 'figures';
    for (const part of PARTS) {
      this.geometries[part] = geometryOf(part);
      this.capacity[part] = 0;
      this.grow(part, GROW_STEP);
    }
  }

  add(f: Figure): void {
    if (this.figures.includes(f)) return;
    this.figures.push(f);
    this.fit();
  }

  remove(f: Figure): void {
    const i = this.figures.indexOf(f);
    if (i >= 0) this.figures.splice(i, 1);
  }

  get size(): number {
    return this.figures.length;
  }

  /** Пересчитать потребность: зовётся после переодевания уже добавленной фигуры. */
  fit(): void {
    for (const part of PARTS) this.need[part] = 0;
    for (const f of this.figures) for (const part of PARTS) this.need[part] += f.counts[part];
    for (const part of PARTS) {
      if (this.need[part] > this.capacity[part]) {
        this.grow(part, Math.ceil(this.need[part] / GROW_STEP) * GROW_STEP);
      }
    }
  }

  /** Сколько инстансов заказано под каждый примитив — по нему считается бюджет. */
  demand(): Record<PartName, number> {
    return { ...this.need };
  }

  private grow(part: PartName, capacity: number): void {
    const old = this.meshes[part];
    if (old) {
      this.group.remove(old);
      old.dispose();
    }
    const mesh = new THREE.InstancedMesh(this.geometries[part], INSTANCED, capacity);
    mesh.name = part;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = CASTS.includes(part);
    // Люди ходят по всему кадру; сфера по геометрии одной детали культуру только испортит.
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.meshes[part] = mesh;
    this.group.add(mesh);
    this.capacity[part] = capacity;
  }

  /** Курсоры записи кадра: сколько инстансов каждого примитива уже занято. */
  private at = { limb: 0, body: 0, head: 0, cap: 0, shaft: 0, plate: 0, shield: 0 } as Record<PartName, number>;

  /** Пишется по детали за раз — замыкание одно на всю жизнь пула, мусора нет. */
  private write = (slot: Slot, m: THREE.Matrix4): void => {
    const i = this.at[slot.part];
    if (i >= this.capacity[slot.part]) return;
    this.at[slot.part] = i + 1;
    const mesh = this.meshes[slot.part];
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, slot.color);
  };

  /** Пишет матрицы и цвета всех фигурок. Зовётся раз в кадр после update агентов. */
  update(): void {
    for (const part of PARTS) this.at[part] = 0;
    for (const f of this.figures) if (f.visible) forEachPart(f, this.write);
    for (const part of PARTS) {
      const mesh = this.meshes[part];
      mesh.count = this.at[part];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
