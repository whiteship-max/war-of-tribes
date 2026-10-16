// Тактическая камера ролика TW (docs/battle_tw.md, раздел 5): общий вид по умолчанию, дальше — у игрока.
//
// Модель — четыре числа (цель на земле, расстояние, азимут, наклон) с границами и сглаживанием; положение камеры
// выводится из них, как у деревни (`Scene.place`). Палец: один — вести по земле один к одному; два — щипок к середине
// между пальцами, поворот вокруг неё и наклон, если пальцы идут вместе вверх-вниз. Мышь: левая — вести, правая (или с
// Shift) — повернуть и наклонить, колесо — приблизить к курсору шагом `WHEEL_STEP`. «Тап или уже ведение» решает
// общий судья жеста (`Gesture.panning`, src/gestures.ts) — второго разбора жеста нет.
//
// Поворот — сознательное отличие от деревни (решение 7): там его нет, потому что щипок и поворот живут на одном
// движении пальцев. Здесь жест защёлкивается за тем, что сдвинулось первым: угол на `TWIST_LOCK` раньше, чем
// расстояние на `PINCH_LOCK`, — поворот (и приближение вместе с ним); иначе — щипок без поворота до отпускания.
import * as THREE from 'three';
import { Gesture, WHEEL_STEP } from '@/gestures';

/** Положение камеры: куда смотрит, с какого расстояния, с какой стороны и под каким углом. */
export interface CamState {
  tx: number;
  tz: number;
  dist: number;
  /** Азимут: 0 — камера за нашей армией (на −Z) и смотрит на +Z. */
  yaw: number;
  /** Наклон к горизонту, радианы. */
  pitch: number;
}

/** Прямоугольник, внутри которого держится цель камеры. */
export interface CamBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minDist: number;
  maxDist: number;
}

const DEG = Math.PI / 180;
/** Наклон: от низкого (видна глубина строя) до почти отвесного. */
export const PITCH_MIN = 22 * DEG;
export const PITCH_MAX = 72 * DEG;
/** Общий вид — наклон и поле зрения по вертикали. */
export const OVERVIEW_PITCH = 48 * DEG;
export const FOV = 42;
/** Половина пути до желаемого — за столько секунд: плавно, но без вязкости. */
const HALF_LIFE = 0.08;
/** Инерция ведения гаснет за столько секунд вдвое. */
const GLIDE_HALF = 0.22;
/** Защёлка двухпальцевого жеста: поворот — по углу, щипок — по доле расстояния, наклон — по общему ходу. */
const TWIST_LOCK = 10 * DEG;
const PINCH_LOCK = 0.1;
const TILT_LOCK = 26;
/** Наклон на пиксель хода двух пальцев и правой кнопки мыши; поворот мышью — на пиксель. */
const TILT_PER_PX = 0.0045;
const YAW_PER_PX = 0.008;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Положение камеры в мире из четырёх чисел. */
export function cameraPosition(s: CamState, groundY: number, out: THREE.Vector3): THREE.Vector3 {
  const flat = s.dist * Math.cos(s.pitch);
  return out.set(s.tx - Math.sin(s.yaw) * flat, groundY + s.dist * Math.sin(s.pitch), s.tz - Math.cos(s.yaw) * flat);
}

/** Держать состояние в границах: цель — внутри поля, расстояние и наклон — в своих пределах. */
export function clampState(s: CamState, b: CamBounds): CamState {
  s.tx = clamp(s.tx, b.minX, b.maxX);
  s.tz = clamp(s.tz, b.minZ, b.maxZ);
  s.dist = clamp(s.dist, b.minDist, b.maxDist);
  s.pitch = clamp(s.pitch, PITCH_MIN, PITCH_MAX);
  s.yaw = wrap(s.yaw);
  return s;
}

/**
 * Общий вид на прямоугольник: цель — его середина, расстояние — чтобы ширина влезла в узкую сторону экрана (в
 * портрете она горизонтальная), а глубина — в высоту кадра под этим наклоном.
 */
export function overview(box: { minX: number; maxX: number; minZ: number; maxZ: number }, aspect: number, yaw = 0, pitch = OVERVIEW_PITCH): CamState {
  const vHalf = (FOV / 2) * DEG;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const w = box.maxX - box.minX;
  const d = box.maxZ - box.minZ;
  const across = Math.abs(Math.cos(yaw)) * w + Math.abs(Math.sin(yaw)) * d;
  const along = Math.abs(Math.sin(yaw)) * w + Math.abs(Math.cos(yaw)) * d;
  // Ближний край прямоугольника ближе цели, и перспектива делает его шире: ширина меряется на нём, а не на цели
  // (тест «общий вид влезает в портрет» поймал вылет ближних углов за край экрана).
  const byW = (across / 2) / Math.tan(hHalf) + (along / 2) * Math.cos(pitch);
  // Глубина, видимая под наклоном, сжата синусом; запас — на дальний край, который перспектива уменьшает.
  const byD = ((along / 2) * Math.sin(pitch)) / Math.tan(vHalf) + (along / 2) * Math.cos(pitch);
  return { tx: (box.minX + box.maxX) / 2, tz: (box.minZ + box.maxZ) / 2, dist: Math.max(byW, byD) * 1.08, yaw, pitch };
}

/** Указатель на холсте: где и с каких координат. */
interface Pointer {
  x: number;
  y: number;
}

export class TacticalCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** Где камера сейчас и куда идёт. */
  readonly now: CamState;
  readonly goal: CamState;
  bounds: CamBounds;
  /** Камера ведёт себя сама (общий вид на живые отряды), пока её не тронули. */
  auto = true;
  /** Высота земли под целью: камера не уходит под холм. */
  groundY = 0;
  private gesture = new Gesture();
  private pointers = new Map<number, Pointer>();
  private two: { span: number; angle: number; midX: number; midY: number; mode: 'free' | 'pinch' | 'twist' | 'tilt'; startSpan: number; startAngle: number; startMidY: number } | null = null;
  private drag: { x: number; y: number; button: number; shift: boolean } | null = null;
  private glide = { x: 0, z: 0 };
  private lastMove = { x: 0, z: 0, t: 0 };
  private near = new THREE.Vector3();
  private hitA = new THREE.Vector3();
  private hitB = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private off: (() => void) | null = null;
  /** Игрок взял камеру — один раз: дальше общий вид возвращает только кнопка. */
  onTake: (() => void) | null = null;

  constructor(start: CamState, bounds: CamBounds) {
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 2400);
    this.now = { ...start };
    this.goal = { ...start };
    this.bounds = bounds;
    this.apply();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Куда хочет общий вид (из режиссуры): камера идёт туда, пока её не тронули. */
  follow(target: CamState): void {
    if (!this.auto) return;
    Object.assign(this.goal, target);
    clampState(this.goal, this.bounds);
  }

  /** Вернуть общий вид: камера снова своя. */
  release(): void {
    this.auto = true;
  }

  /** Сразу встать в желаемое — для снимка стенда: кадр без догоняния. */
  snap(): void {
    Object.assign(this.now, this.goal);
    this.apply();
  }

  private take(): void {
    if (!this.auto) return;
    this.auto = false;
    this.onTake?.();
  }

  /** Шаг сглаживания: к желаемому — экспонентой, после ведения — инерцией. */
  update(dt: number): void {
    const k = 1 - Math.pow(0.5, dt / HALF_LIFE);
    if (this.pointers.size === 0 && !this.drag) {
      this.goal.tx += this.glide.x * dt;
      this.goal.tz += this.glide.z * dt;
      const g = Math.pow(0.5, dt / GLIDE_HALF);
      this.glide.x *= g;
      this.glide.z *= g;
    }
    clampState(this.goal, this.bounds);
    this.now.tx += (this.goal.tx - this.now.tx) * k;
    this.now.tz += (this.goal.tz - this.now.tz) * k;
    this.now.dist += (this.goal.dist - this.now.dist) * k;
    this.now.pitch += (this.goal.pitch - this.now.pitch) * k;
    this.now.yaw = wrap(this.now.yaw + wrap(this.goal.yaw - this.now.yaw) * k);
    this.apply();
  }

  private apply(): void {
    cameraPosition(this.now, this.groundY, this.pos);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.now.tx, this.groundY, this.now.tz);
  }

  /**
   * Точка земли (плоскость под целью) под точкой экрана. Луч — через `unproject`, без рейкастера: рейкаста по сцене у
   * ролика нет, ему нужна только плоскость.
   */
  private groundAt(el: HTMLElement, x: number, y: number, out: THREE.Vector3): THREE.Vector3 | null {
    const r = el.getBoundingClientRect();
    const nx = ((x - r.left) / r.width) * 2 - 1;
    const ny = -((y - r.top) / r.height) * 2 + 1;
    this.camera.updateMatrixWorld();
    this.near.set(nx, ny, -1).unproject(this.camera);
    out.set(nx, ny, 1).unproject(this.camera).sub(this.near);
    if (Math.abs(out.y) < 1e-6) return null;
    const k = (this.groundY - this.near.y) / out.y;
    if (k < 0) return null;
    return out.multiplyScalar(k).add(this.near);
  }

  /**
   * Сдвинуть цель так, чтобы точка земли под `from` встала под `to`: ведение один к одному. Считается по нынешней
   * камере и сразу ставит её туда же — иначе сглаживание отставало бы от пальца.
   */
  private panScreen(el: HTMLElement, fx: number, fy: number, x: number, y: number, now: number): void {
    const a = this.groundAt(el, fx, fy, this.hitA);
    const b = this.groundAt(el, x, y, this.hitB);
    if (!a || !b) return;
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    this.goal.tx += dx;
    this.goal.tz += dz;
    this.now.tx += dx;
    this.now.tz += dz;
    const dt = Math.max(1, now - this.lastMove.t) / 1000;
    this.glide.x = dx / dt;
    this.glide.z = dz / dt;
    this.lastMove.t = now;
    this.apply();
  }

  /** Приблизить в `k` раз к точке экрана: земля под ней остаётся на месте. */
  private zoomAt(el: HTMLElement, x: number, y: number, k: number): void {
    const p = this.groundAt(el, x, y, this.hitA);
    const before = this.goal.dist;
    this.goal.dist = clamp(this.goal.dist * k, this.bounds.minDist, this.bounds.maxDist);
    const real = this.goal.dist / before;
    if (p) {
      this.goal.tx += (p.x - this.goal.tx) * (1 - real);
      this.goal.tz += (p.z - this.goal.tz) * (1 - real);
    }
  }

  /** Повесить ввод на холст. Снимается `detach`. */
  attach(el: HTMLElement): void {
    const now = (): number => performance.now();
    const down = (e: PointerEvent): void => {
      // Кнопки слоя ролика — не поле: нажатие на них камеру не ведёт.
      if ((e.target as HTMLElement | null)?.closest?.('button')) return;
      el.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.gesture.down(e.pointerId, e.clientX, e.clientY, now());
      this.glide.x = 0;
      this.glide.z = 0;
      if (e.pointerType === 'mouse') this.drag = { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey };
      if (this.pointers.size === 2) this.startTwo();
      else this.two = null;
    };
    const move = (e: PointerEvent): void => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const t = now();
      this.gesture.move(e.pointerId, e.clientX, e.clientY, t);
      if (this.pointers.size === 2 && this.two) {
        p.x = e.clientX;
        p.y = e.clientY;
        this.moveTwo(el);
        return;
      }
      if (this.drag && (this.drag.button === 2 || this.drag.button === 1 || this.drag.shift)) {
        // Правая кнопка мыши (или с Shift): поворот по горизонтали, наклон по вертикали.
        this.take();
        this.goal.yaw -= (e.clientX - this.drag.x) * YAW_PER_PX;
        this.goal.pitch = clamp(this.goal.pitch + (e.clientY - this.drag.y) * TILT_PER_PX, PITCH_MIN, PITCH_MAX);
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        p.x = e.clientX;
        p.y = e.clientY;
        return;
      }
      if (this.pointers.size === 1 && this.gesture.panning(t)) {
        this.take();
        this.panScreen(el, p.x, p.y, e.clientX, e.clientY, t);
      }
      p.x = e.clientX;
      p.y = e.clientY;
    };
    const up = (e: PointerEvent): void => {
      this.gesture.up(e.pointerId, now());
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.two = null;
      if (this.pointers.size === 0) this.drag = null;
      // Отпустили второй палец: первый ведёт дальше с того места, где он сейчас.
      if (now() - this.lastMove.t > 80) {
        this.glide.x = 0;
        this.glide.z = 0;
      }
    };
    const cancel = (e: PointerEvent): void => {
      this.gesture.cancel(e.pointerId);
      this.pointers.delete(e.pointerId);
      this.two = null;
      this.drag = null;
    };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      this.take();
      // Читается только знак: браузеры отдают величину то в пикселях, то в строках.
      this.zoomAt(el, e.clientX, e.clientY, e.deltaY > 0 ? WHEEL_STEP : 1 / WHEEL_STEP);
    };
    const menu = (e: Event): void => e.preventDefault();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', menu);
    this.off = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('contextmenu', menu);
    };
  }

  detach(): void {
    this.off?.();
    this.off = null;
  }

  private pair(): [Pointer, Pointer] {
    const [a, b] = [...this.pointers.values()];
    return [a, b];
  }

  private startTwo(): void {
    const [a, b] = this.pair();
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    this.two = { span, angle, midX, midY, mode: 'free', startSpan: span, startAngle: angle, startMidY: midY };
  }

  /** Два пальца: защёлка по тому, что сдвинулось первым, потом — щипок, поворот или наклон. */
  private moveTwo(el: HTMLElement): void {
    const two = this.two!;
    const [a, b] = this.pair();
    const span = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    if (two.mode === 'free') {
      const turned = Math.abs(wrap(angle - two.startAngle));
      const pinched = Math.abs(span / two.startSpan - 1);
      const tilted = Math.abs(midY - two.startMidY);
      if (turned > TWIST_LOCK) two.mode = 'twist';
      else if (pinched > PINCH_LOCK) two.mode = 'pinch';
      else if (tilted > TILT_LOCK && pinched < PINCH_LOCK / 2) two.mode = 'tilt';
      // Защёлкнулись — жест засчитывается с начала, а не с порога: иначе поворот на 45° давал бы 35°.
      if (two.mode !== 'free') {
        two.span = two.startSpan;
        two.angle = two.startAngle;
        two.midY = two.startMidY;
      }
    }
    if (two.mode !== 'free') this.take();
    if (two.mode === 'pinch' || two.mode === 'twist') {
      // Земля под серединой пальцев едет за ней, и к ней же идёт наезд — как на карте.
      this.panScreen(el, two.midX, two.midY, midX, midY, performance.now());
      this.zoomAt(el, midX, midY, two.span / span);
    }
    // Поле крутится за пальцами: повернули пальцы по часовой — по часовой повернулась и земля под ними.
    if (two.mode === 'twist') this.goal.yaw += wrap(angle - two.angle);
    if (two.mode === 'tilt') this.goal.pitch = clamp(this.goal.pitch + (midY - two.midY) * TILT_PER_PX, PITCH_MIN, PITCH_MAX);
    two.span = span;
    two.angle = angle;
    two.midX = midX;
    two.midY = midY;
  }
}
