// Жители: простые low-poly фигурки, которые ходят между костром и рабочим местом.
// Мешей у агента нет — он правит позу своей Figure, а рисует всех разом пул
// инстансов (figures.ts).
import * as THREE from 'three';
import type { JobId, Villager } from '@/game/types';
import { Figure, STICK_LENGTH, STICK_RADIUS } from './figures';
import { JOB_TINT, PALETTE } from './palette';
import { groundHeight } from './terrain';

type Mode = 'toWork' | 'work' | 'toHome' | 'rest';

const SPEED = 1.7;

/** У кого в руках орудие: в силуэте оно отличает работника от праздного. */
const WITH_TOOL: JobId[] = ['hunter', 'woodcutter', 'stonecutter', 'miner', 'farmer', 'herder', 'shaman', 'smith'];

export class VillagerAgent {
  readonly figure = new Figure();
  private mode: Mode = 'rest';
  private timer = 1 + Math.random() * 3;
  private target = new THREE.Vector3();
  private workPos: THREE.Vector3 | null = null;
  private wander = 0;
  private walkPhase = Math.random() * 10;
  job: JobId;
  night = false;

  constructor(v: Villager, home: THREE.Vector3) {
    this.job = v.job;
    const f = this.figure;
    f.scale = v.age < 14 ? 0.7 : 1;
    f.colors.stick.setHex(PALETTE.stake);
    this.dress(v.job);
    const a = Math.random() * Math.PI * 2;
    f.position.set(home.x + Math.cos(a) * 1.8, 0, home.z + Math.sin(a) * 1.8);
    this.target.copy(f.position);
  }

  /** Одежда по профессии и орудие в руке. */
  private dress(job: JobId): void {
    this.figure.colors.torso.setHex(JOB_TINT[job]);
    this.figure.stick = WITH_TOOL.includes(job) ? { length: STICK_LENGTH, radius: STICK_RADIUS, tilt: 0.2 } : null;
  }

  /** Назначить рабочее место. wander — радиус блуждания вокруг него. */
  setWork(job: JobId, pos: THREE.Vector3 | null, wander: number): void {
    if (this.job !== job) {
      this.job = job;
      this.dress(job);
    }
    const changed = (pos === null) !== (this.workPos === null) || (pos && this.workPos && pos.distanceTo(this.workPos) > 0.5);
    this.workPos = pos ? pos.clone() : null;
    this.wander = wander;
    if (changed) {
      this.mode = pos ? 'toWork' : 'toHome';
      this.timer = 0;
      this.pickTarget();
    }
  }

  private pickTarget(): void {
    if (this.mode === 'toWork' || this.mode === 'work') {
      if (!this.workPos) return;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * Math.max(0.6, this.wander);
      this.target.set(this.workPos.x + Math.cos(a) * r, 0, this.workPos.z + Math.sin(a) * r);
    } else {
      const a = Math.random() * Math.PI * 2;
      const r = 1.4 + Math.random() * 1.2;
      this.target.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }

  update(dt: number, t: number): void {
    const f = this.figure;
    const p = f.position;
    const wantHome = this.night || !this.workPos;
    if (wantHome && (this.mode === 'toWork' || this.mode === 'work')) {
      this.mode = 'toHome';
      this.pickTarget();
    }
    if (!wantHome && this.mode === 'rest' && this.timer <= 0) {
      this.mode = 'toWork';
      this.pickTarget();
    }

    const dx = this.target.x - p.x;
    const dz = this.target.z - p.z;
    const dist = Math.hypot(dx, dz);
    const moving = (this.mode === 'toWork' || this.mode === 'toHome' || dist > 0.15) && dist > 0.1;

    if (moving) {
      const step = Math.min(dist, SPEED * dt);
      p.x += (dx / dist) * step;
      p.z += (dz / dist) * step;
      f.rotationY = Math.atan2(dx, dz);
      this.walkPhase += dt * 11;
      f.legSwing = Math.sin(this.walkPhase) * 0.5;
      p.y = Math.abs(Math.sin(this.walkPhase)) * 0.04 + groundHeight(p.x, p.z);
      if (dist - step < 0.12) {
        if (this.mode === 'toWork') {
          this.mode = 'work';
          this.timer = 6 + Math.random() * 8;
        } else if (this.mode === 'toHome') {
          this.mode = 'rest';
          this.timer = this.night ? 3 : 4 + Math.random() * 5;
        }
      }
    } else {
      f.legSwing = 0;
      this.timer -= dt;
      if (this.mode === 'work') {
        // Рабочее покачивание.
        const bob = Math.sin(t * 6 + this.walkPhase) * 0.06;
        p.y = Math.max(0, bob) + groundHeight(p.x, p.z);
        f.torsoTilt = Math.sin(t * 6 + this.walkPhase) * 0.12;
        if (this.timer <= 0) {
          if (Math.random() < 0.35 || !this.workPos) {
            this.mode = 'toHome';
          } else {
            this.mode = 'toWork';
          }
          this.pickTarget();
        }
      } else {
        p.y = groundHeight(p.x, p.z);
        f.torsoTilt = 0;
        if (this.mode === 'rest' && this.timer <= 0 && wantHome) {
          // Немного побродить у костра.
          this.pickTarget();
          this.timer = 3 + Math.random() * 5;
        }
      }
    }
  }
}
