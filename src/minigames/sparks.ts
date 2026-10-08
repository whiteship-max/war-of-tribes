/**
 * Искры промыслов: горсть частиц на отклик — листья и ягоды из куста, сено из стога, клок шерсти и пыль от стрелы,
 * щепа от ствола (docs/minigames.md, 16.2). Одна куча точек на игру — один вызов отрисовки на все всплески.
 *
 * ЧАСТИЦЫ — КАРТИНКА, А НЕ ПРАВИЛО: игра о них не знает, сцена бросает их на отклик и забывает. Разлёт — свой
 * генератор от номера всплеска, без `Math.random` (его в игре нет нигде; в `minigames/` — тоже): одна и та же горсть
 * выглядит одинаково, и стенду есть что сравнить.
 *
 * Пятно точки — мягкий круг, испечённый один раз (`CanvasTexture`); прозрачность — по возрасту в цвете вершины (RGBA),
 * размер — от дали (`sizeAttenuation`). Имена `three` — только те, что игра уже берёт (`prologue/post.test.ts`).
 */
import * as THREE from 'three';

/** Сколько частиц живёт одновременно: старые уступают новым. */
export const SPARKS = 96;

/** Как бросить горсть. */
export interface Burst {
  /** Цвета: каждая частица берёт свой по кругу. */
  colors: readonly number[];
  /** Сколько частиц. */
  n: number;
  /** Начальная скорость, м/с: разброс — от половины до полной. */
  speed: number;
  /** Насколько вверх, 0..1: 1 — фонтаном, 0 — во все стороны. */
  up: number;
  /** Тяжесть, м/с²: сено и шерсть падают медленно, ягоды — быстро. */
  gravity: number;
  /** Сколько живёт, с. */
  life: number;
  /** Сопротивление воздуха, 1/с: листья тормозят быстро. */
  drag?: number;
}

const _c = new THREE.Color();

/** Мягкий круг: середина плотная, край тает. */
function dotTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Sparks {
  readonly points: THREE.Points;
  private pos = new Float32Array(SPARKS * 3);
  private col = new Float32Array(SPARKS * 4);
  private vel = new Float32Array(SPARKS * 3);
  private age = new Float32Array(SPARKS).fill(1e9);
  private life = new Float32Array(SPARKS).fill(1);
  private grav = new Float32Array(SPARKS);
  private drag = new Float32Array(SPARKS);
  private next = 0;
  private seed = 0x2c1b3c6d;
  private tex: THREE.Texture | null;

  constructor(size = 0.07) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.tex = dotTexture();
    const m = new THREE.PointsMaterial({ size, map: this.tex, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(g, m);
    this.points.name = 'sparks';
    this.points.frustumCulled = false;
    // Пусто — не рисовать вовсе: вызов отрисовки платится только пока есть что показать.
    this.points.visible = false;
  }

  /** Ровное число 0..1 от своего хода — разлёт без случая устройства. */
  private rnd(): number {
    let x = (this.seed = (this.seed + 0x6d2b79f5) | 0);
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }

  /** Бросить горсть из точки. */
  burst(x: number, y: number, z: number, b: Burst): void {
    for (let k = 0; k < b.n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % SPARKS;
      const a = this.rnd() * Math.PI * 2;
      const lift = b.up + (1 - b.up) * (this.rnd() * 2 - 1);
      const flat = Math.sqrt(Math.max(0, 1 - lift * lift));
      const v = b.speed * (0.5 + 0.5 * this.rnd());
      this.pos.set([x, y, z], i * 3);
      this.vel.set([Math.cos(a) * flat * v, lift * v, Math.sin(a) * flat * v], i * 3);
      _c.setHex(b.colors[k % b.colors.length]);
      this.col.set([_c.r, _c.g, _c.b, 1], i * 4);
      this.age[i] = 0;
      this.life[i] = b.life * (0.7 + 0.3 * this.rnd());
      this.grav[i] = b.gravity;
      this.drag[i] = b.drag ?? 0;
    }
    this.points.visible = true;
  }

  /** Кадр: полёт, тяжесть, сопротивление, угасание. Земля — ноль: упавшее лежит, пока не истает. */
  frame(dt: number): void {
    if (!this.points.visible) return;
    let alive = 0;
    for (let i = 0; i < SPARKS; i++) {
      if (this.age[i] >= this.life[i]) {
        if (this.col[i * 4 + 3] !== 0) this.col[i * 4 + 3] = 0;
        continue;
      }
      alive++;
      this.age[i] += dt;
      const d = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] *= d;
      this.vel[j + 2] *= d;
      this.vel[j + 1] = this.vel[j + 1] * d - this.grav[i] * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] = Math.max(0.02, this.pos[j + 1] + this.vel[j + 1] * dt);
      if (this.pos[j + 1] <= 0.02) {
        this.vel[j] *= 0.5;
        this.vel[j + 1] = 0;
        this.vel[j + 2] *= 0.5;
      }
      const k = this.age[i] / this.life[i];
      this.col[i * 4 + 3] = k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.4);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    if (alive === 0) this.points.visible = false;
  }

  /** Сколько частиц сейчас живо — тесту и стенду. */
  get alive(): number {
    let n = 0;
    for (let i = 0; i < SPARKS; i++) if (this.age[i] < this.life[i]) n++;
    return n;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.tex?.dispose();
    this.points.removeFromParent();
  }
}
