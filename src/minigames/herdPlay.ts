/**
 * «Скот» в сцене: загон, стог, стадо и охапка в руках (docs/minigames.md, раздел 6).
 *
 * Правило — в `herd.ts`: где бредёт животное, решает зерно и секунда игры; кто сколько съел — кормёжка. Здесь только
 * то, что видно: идущее качается туловищем, наевшееся ложится, над голодным — сколько охапок ему ещё нужно.
 */
import * as THREE from 'three';
import type { Surfaces } from '@/prologue/surface';
import { Shade } from '@/prologue/models';
import type { Blocker } from '@/prologue/glade';
import { BEASTS, Feed, HAY, LAMB_WORTH, PEN_R, herdBonusMax, herdOf, roamAt, roamSpeed, roamYaw, type Herd } from './herd';
import { BACK, LEGS, armful, beast, hayMesh, penMesh } from './models';
import type { Tally, Target } from './rules';
import type { Play } from './stage';
import { Sparks } from './sparks';
import { armfulArms, viewMaterial } from './hands';
import { fieldSound, type FieldSound } from './miniSound';

/** Сено в горсти: соломенное, светлое и выгоревшее — как у стога (`models.hayMesh`). */
const HAY_BITS = [0xd8b860, 0xc9a24a, 0xe8d08a, 0xb89440];

/** Где охапка в кадре: внизу посередине, чуть справа, — в руках. */
const ARMFUL_AT = { x: 0.1, y: -0.5, z: -0.78 };

/** Значок «сколько ещё»: охапки точками на тёмной плашке. Печётся один раз на число. */
function needCanvas(n: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const g = c.getContext('2d');
  if (!g) return c;
  const w = 24 + n * 30;
  const x0 = (128 - w) / 2;
  g.fillStyle = 'rgba(28, 24, 20, 0.78)';
  // Пилюля дугами, а не `roundRect`: его нет в старых вебвью.
  g.beginPath();
  g.arc(x0 + 18, 24, 18, Math.PI / 2, (Math.PI * 3) / 2);
  g.arc(x0 + w - 18, 24, 18, -Math.PI / 2, Math.PI / 2);
  g.closePath();
  g.fill();
  for (let i = 0; i < n; i++) {
    g.fillStyle = '#e0b860';
    g.beginPath();
    g.arc(x0 + 27 + i * 30, 24, 10, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

export class HerdPlay implements Play {
  /** Утро позже, чем у ягод: солнце выше леса, загон на свету. */
  readonly solar = 0.17;
  /** У стога сбоку от него, лицом к овечьей куче: стадо в кадре с первой секунды, стог взгляду не мешает. */
  readonly start: { x: number; z: number; yaw: number };
  /** Изнутри к жердям ближе не подойти. */
  readonly roam = PEN_R - 0.45;
  /** Загон с жердями. */
  readonly shadowHalf = PEN_R + 1;
  readonly herd: Herd;
  private feed: Feed;
  private bodies: THREE.Group[] = [];
  private marks: THREE.Sprite[] = [];
  private needTex: THREE.Texture[] = [];
  /** Охапка в руках: копна сена и руки под ней — вещь взгляда, висит на камере. */
  private hands: THREE.Group | null = null;
  private armfulMesh: THREE.Mesh | null = null;
  private arms: THREE.Mesh | null = null;
  private sway = 0;
  private sparks = new Sparks(0.055);
  private sound: FieldSound | null = null;

  /** Отклики, случившиеся сами: ягнёнок в загоне — на «Начать». */
  private notes: string[] = [];

  constructor(seed: number) {
    // Редкий ягнёнок — раз в три выхода (`herd.LAMB_P`).
    this.herd = herdOf(seed, { rare: true });
    this.feed = new Feed(this.herd);
    const flock = roamAt(this.herd, this.herd.beasts[0], 0);
    const a = Math.atan2(flock.z, flock.x) + Math.PI / 2;
    const x = Math.cos(a) * (HAY.r + 1.1);
    const z = Math.sin(a) * (HAY.r + 1.1);
    this.start = { x, z, yaw: Math.atan2(-(flock.x - x), -(flock.z - z)) };
  }

  build(scene: THREE.Scene, surfaces: Surfaces, shade: Shade, camera: THREE.Camera): void {
    scene.add(surfaces.adopt(penMesh()), surfaces.adopt(hayMesh()));
    shade.add(HAY.x, HAY.z, HAY.r * 1.5, HAY.r * 1.5);
    const browser = typeof document !== 'undefined';
    if (browser) for (let n = 1; n <= 3; n++) this.needTex.push(new THREE.CanvasTexture(needCanvas(n)));
    for (const b of this.herd.beasts) {
      const g = surfaces.adopt(beast(b.kind));
      // Пятно тени едет с животным: без тени у ног оно висит над травой.
      const blob = new Shade();
      const r = BEASTS[b.kind].r;
      blob.add(0, 0, r * 1.1, r * 1.9, 0, -0.012);
      g.add(blob.mesh());
      scene.add(g);
      this.bodies.push(g);
      // Без страницы (счёт бюджета в тесте) холста нет — значок встаёт без рисунка, но встаёт: вызов тот же.
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.needTex[BEASTS[b.kind].need - 1] ?? null, depthWrite: false, fog: false, toneMapped: false }));
      s.scale.set(0.62, 0.23, 1);
      s.position.y = BACK[b.kind] + 0.55;
      g.add(s);
      this.marks.push(s);
    }
    // Охапку несут руками: кисти в перчатках снизу у её краёв, рукава уходят к нижним углам кадра (`hands.ts`).
    const carry = new THREE.Group();
    carry.name = 'carry';
    this.armfulMesh = armful();
    this.armfulMesh.scale.setScalar(0.7);
    this.arms = new THREE.Mesh(armfulArms(), viewMaterial());
    this.arms.name = 'arms';
    this.arms.castShadow = false;
    for (const o of [this.armfulMesh, this.arms]) {
      o.frustumCulled = false;
      carry.add(o);
    }
    carry.position.set(ARMFUL_AT.x, ARMFUL_AT.y, ARMFUL_AT.z);
    carry.visible = false;
    camera.add(carry);
    this.hands = carry;
    scene.add(this.sparks.points);
    this.frame(0, 0, 0);
  }

  begin(): void {
    this.sound ??= fieldSound();
    this.sound.arm();
    if (this.herd.beasts.some((b) => b.kind === 'lamb')) this.notes.push('В загоне ягнёнок — накорми и его');
  }

  say(): string {
    return this.notes.shift() ?? '';
  }

  rest(): string {
    return this.feed.carrying ? 'Накормить' : 'Взять охапку';
  }

  tick(): void {
    this.sound?.tick();
  }

  blockers(t: number): Blocker[] {
    const out: Blocker[] = [{ x: HAY.x, z: HAY.z, r: HAY.r }];
    this.herd.beasts.forEach((b, i) => {
      const p = this.feed.at(i, t);
      out.push({ x: p.x, z: p.z, r: BEASTS[b.kind].r * 0.8 });
    });
    return out;
  }

  /** Без охапки трогать можно только стог; с охапкой — только голодных. */
  targets(t: number): Target[] {
    if (!this.feed.carrying) return [{ id: -1, x: HAY.x, z: HAY.z, r: HAY.r, verb: 'Взять охапку' }];
    const out: Target[] = [];
    this.herd.beasts.forEach((b, i) => {
      if (this.feed.sated(i)) return;
      const p = this.feed.at(i, t);
      out.push({ id: i, x: p.x, z: p.z, r: BEASTS[b.kind].r, verb: `Накормить ${BEASTS[b.kind].name}` });
    });
    return out;
  }

  tap(target: Target, t: number): string {
    if (target.id < 0) {
      if (!this.feed.take()) return '';
      this.sound?.take();
      // Охапка из стога: сено летит с его бока, к человеку.
      this.sparks.burst(HAY.x, HAY.r * 0.9, HAY.z, { colors: HAY_BITS, n: 14, speed: 1.6, up: 0.6, gravity: 2.4, life: 1.3, drag: 2.2 });
      return 'Охапка в руках';
    }
    const b = this.herd.beasts[target.id];
    if (!b || !this.feed.feed(target.id, t)) return '';
    const left = BEASTS[b.kind].need - this.feed.given[target.id];
    this.sound?.feed(b.kind, left <= 0);
    if (b.kind === 'lamb') return `Ягнёнок сыт · сверху +${LAMB_WORTH}`;
    // Сено у морды: где животное стоит в эту секунду, на высоте спины.
    const p = this.feed.at(target.id, t);
    this.sparks.burst(p.x, BACK[b.kind] * 0.75, p.z, { colors: HAY_BITS, n: 10, speed: 1.1, up: 0.7, gravity: 2.4, life: 1.1, drag: 2.2 });
    return left > 0 ? `Ещё ${left}` : 'Сыта';
  }

  frame(t: number, dt: number, walking: number): void {
    this.herd.beasts.forEach((b, i) => {
      const g = this.bodies[i];
      if (!g) return;
      const sated = this.feed.sated(i);
      const at = this.feed.fedAt[i] ?? t;
      const p = this.feed.at(i, t);
      g.position.set(p.x, 0, p.z);
      g.rotation.y = roamYaw(this.herd, b, at);
      const torso = g.children[0];
      const legs = g.children[1];
      if (sated) {
        // Наелось — легло: туловище опускается на длину ног, ноги уходят под него.
        torso.position.y = -LEGS[b.kind] * 0.82;
        legs.visible = false;
      } else {
        const v = Math.min(1, roamSpeed(this.herd, b, t) / 0.8);
        torso.position.y = Math.abs(Math.sin(t * 7 + i)) * 0.03 * v;
        torso.rotation.z = Math.sin(t * 7 + i) * 0.03 * v;
        legs.visible = true;
      }
      const mark = this.marks[i];
      if (mark) {
        const left = BEASTS[b.kind].need - this.feed.given[i];
        mark.visible = !sated && left > 0;
        if (mark.visible) {
          const tex = this.needTex[left - 1] ?? null;
          const mat = mark.material;
          if (mat.map !== tex) {
            mat.map = tex;
            mat.needsUpdate = true;
          }
        }
      }
    });
    this.sparks.frame(dt);
    const h = this.hands;
    if (h) {
      h.visible = this.feed.carrying;
      this.sway += dt * 9 * walking;
      h.position.y = ARMFUL_AT.y - Math.abs(Math.sin(this.sway * 0.5)) * 0.02 * walking;
      h.position.x = ARMFUL_AT.x + Math.sin(this.sway * 0.5) * 0.014 * walking;
    }
  }

  tally(): Tally {
    return { got: this.feed.got, total: this.herd.total, bonus: this.feed.bonus, bonusMax: herdBonusMax(this.herd) };
  }

  dispose(): void {
    this.sparks.dispose();
    for (const s of this.marks) s.material.dispose();
    for (const tex of this.needTex) tex.dispose();
    this.hands?.removeFromParent();
    this.armfulMesh?.geometry.dispose();
    this.arms?.geometry.dispose();
    (this.arms?.material as THREE.Material | undefined)?.dispose();
  }
}
