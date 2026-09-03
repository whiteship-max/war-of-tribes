// Жители: простые low-poly фигурки, которые ходят между костром и рабочим местом.
import * as THREE from 'three';
import type { JobId, Villager } from '@/game/types';

const SKIN = new THREE.MeshLambertMaterial({ color: 0xd9a77a, flatShading: true });
const HAIR = new THREE.MeshLambertMaterial({ color: 0x3a2618, flatShading: true });
const STICK = new THREE.MeshLambertMaterial({ color: 0x6b4426, flatShading: true });

const JOB_COLORS: Record<JobId, number> = {
  idle: 0xb59a76,
  gatherer: 0x7fae5a,
  hunter: 0x8a5a3a,
  woodcutter: 0xc2803a,
  stonecutter: 0x8f8a80,
  miner: 0x6f6a62,
  farmer: 0xd0b45a,
  herder: 0xa8b06a,
  crafter: 0x5f7ea6,
  smith: 0x8a6a4a,
  scholar: 0x9a8ac0,
  shaman: 0x7a4fa0,
};

const tunicMats = new Map<JobId, THREE.MeshLambertMaterial>();
const tunic = (job: JobId): THREE.MeshLambertMaterial => {
  let m = tunicMats.get(job);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: JOB_COLORS[job], flatShading: true });
    tunicMats.set(job, m);
  }
  return m;
};

type Mode = 'toWork' | 'work' | 'toHome' | 'rest';

const SPEED = 1.7;

export class VillagerAgent {
  readonly group = new THREE.Group();
  private body: THREE.Mesh;
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private tool: THREE.Mesh;
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
    const g = this.group;
    const scale = v.age < 14 ? 0.7 : 1;
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.12), SKIN);
    this.legL.position.set(-0.08, 0.15, 0);
    this.legR = this.legL.clone();
    this.legR.position.x = 0.08;
    this.body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.45, 6), tunic(v.job));
    this.body.position.y = 0.52;
    this.body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 6), SKIN);
    head.position.y = 0.9;
    head.castShadow = true;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.155, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), HAIR);
    hair.position.y = 0.92;
    this.tool = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 4), STICK);
    this.tool.position.set(0.22, 0.55, 0.05);
    this.tool.rotation.z = 0.2;
    g.add(this.legL, this.legR, this.body, head, hair, this.tool);
    g.scale.setScalar(scale);
    this.updateTool();
    const a = Math.random() * Math.PI * 2;
    g.position.set(home.x + Math.cos(a) * 1.8, 0, home.z + Math.sin(a) * 1.8);
    this.target.copy(g.position);
  }

  private updateTool(): void {
    const show = ['hunter', 'woodcutter', 'stonecutter', 'miner', 'farmer', 'herder', 'shaman', 'smith'].includes(this.job);
    this.tool.visible = show;
  }

  /** Назначить рабочее место. wander — радиус блуждания вокруг него. */
  setWork(job: JobId, pos: THREE.Vector3 | null, wander: number): void {
    if (this.job !== job) {
      this.job = job;
      this.body.material = tunic(job);
      this.updateTool();
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
    const g = this.group;
    const wantHome = this.night || !this.workPos;
    if (wantHome && (this.mode === 'toWork' || this.mode === 'work')) {
      this.mode = 'toHome';
      this.pickTarget();
    }
    if (!wantHome && this.mode === 'rest' && this.timer <= 0) {
      this.mode = 'toWork';
      this.pickTarget();
    }

    const dx = this.target.x - g.position.x;
    const dz = this.target.z - g.position.z;
    const dist = Math.hypot(dx, dz);
    const moving = (this.mode === 'toWork' || this.mode === 'toHome' || dist > 0.15) && dist > 0.1;

    if (moving) {
      const step = Math.min(dist, SPEED * dt);
      g.position.x += (dx / dist) * step;
      g.position.z += (dz / dist) * step;
      g.rotation.y = Math.atan2(dx, dz);
      this.walkPhase += dt * 11;
      const swing = Math.sin(this.walkPhase) * 0.5;
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      g.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.04;
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
      this.legL.rotation.x = 0;
      this.legR.rotation.x = 0;
      this.timer -= dt;
      if (this.mode === 'work') {
        // Рабочее покачивание.
        const bob = Math.sin(t * 6 + this.walkPhase) * 0.06;
        g.position.y = Math.max(0, bob);
        this.body.rotation.x = Math.sin(t * 6 + this.walkPhase) * 0.12;
        if (this.timer <= 0) {
          if (Math.random() < 0.35 || !this.workPos) {
            this.mode = 'toHome';
          } else {
            this.mode = 'toWork';
          }
          this.pickTarget();
        }
      } else {
        g.position.y = 0;
        this.body.rotation.x = 0;
        if (this.mode === 'rest' && this.timer <= 0 && wantHome) {
          // Немного побродить у костра.
          this.pickTarget();
          this.timer = 3 + Math.random() * 5;
        }
      }
    }
  }
}
