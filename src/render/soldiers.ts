// Бойцы в сцене. Армия хранится счётчиками, а не жителями, поэтому и здесь
// фигурки не привязаны к людям: сколько бойцов в `s.army` — столько и видно.
//
// Заняты они тем, чем занята настоящая дружина: двое стоят у ворот, кто-то ходит
// дозором по окружной дороге под стеной, остальные машут оружием у казарм.
import * as THREE from 'three';
import type { TroopId } from '@/game/types';
import { GATE_ANGLE, OUTER_ROAD } from './plan';

/** Больше десятка фигурок в кадре не различить, а рисовать их дорого. */
export const MAX_SOLDIERS = 14;

export type Post = 'gate' | 'patrol' | 'drill';

const SKIN = new THREE.MeshLambertMaterial({ color: 0xd9a77a, flatShading: true });
const HAIR = new THREE.MeshLambertMaterial({ color: 0x3a2618, flatShading: true });

/** Цвет по виду бойца: чем выше в лестнице, тем ближе к металлу. */
const TROOP_COLOR: Record<TroopId, number> = {
  clubman: 0x8a6a4a,
  spearman: 0xa2563f,
  archer: 0x6f8a4a,
  axeman: 0x9a5a2a,
  swordsman: 0x7a5f9a,
  shieldman: 0x4f6f9a,
  legionary: 0x8a8f96,
};

const tunicMats = new Map<TroopId, THREE.MeshLambertMaterial>();
const tunic = (troop: TroopId): THREE.MeshLambertMaterial => {
  let m = tunicMats.get(troop);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: TROOP_COLOR[troop], flatShading: true });
    tunicMats.set(troop, m);
  }
  return m;
};

const STEEL = new THREE.MeshLambertMaterial({ color: 0x6c7075, flatShading: true });
const SHAFT = new THREE.MeshLambertMaterial({ color: 0x6b4426, flatShading: true });

/** Кому положен щит: щитоносцу и латнику — он и в силуэте виден. */
const HAS_SHIELD: TroopId[] = ['shieldman', 'legionary'];

export class SoldierAgent {
  readonly group = new THREE.Group();
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private body: THREE.Mesh;
  private weapon: THREE.Object3D;
  private phase: number;
  private angle: number;

  constructor(
    readonly troop: TroopId,
    readonly post: Post,
    private anchor: THREE.Vector3,
    index: number,
  ) {
    this.phase = index * 1.37;
    this.angle = Math.atan2(anchor.z, anchor.x);
    const g = this.group;
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.12), SKIN);
    this.legL.position.set(-0.08, 0.15, 0);
    this.legR = this.legL.clone();
    this.legR.position.x = 0.08;
    this.body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.21, 0.45, 6), tunic(troop));
    this.body.position.y = 0.52;
    this.body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 6), SKIN);
    head.position.y = 0.9;
    head.castShadow = true;
    const helm = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2),
      troop === 'clubman' ? HAIR : STEEL,
    );
    helm.position.y = 0.92;
    // Оружие: у всех древко, у мечников — клинок. В силуэте важно, что оно есть.
    this.weapon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, troop === 'archer' ? 0.9 : 1.15, 4),
      troop === 'swordsman' || troop === 'shieldman' || troop === 'legionary' ? STEEL : SHAFT,
    );
    this.weapon.position.set(0.23, 0.62, 0.04);
    this.weapon.rotation.z = 0.18;
    g.add(this.legL, this.legR, this.body, head, helm, this.weapon);
    if (HAS_SHIELD.includes(troop)) {
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 8), STEEL);
      shield.rotation.z = Math.PI / 2;
      shield.position.set(-0.24, 0.58, 0.06);
      shield.castShadow = true;
      g.add(shield);
    }
    g.position.copy(anchor);
  }

  /** Куда смотреть: наружу от центра — стража стоит лицом к полю. */
  private faceOut(): void {
    this.group.rotation.y = Math.atan2(this.group.position.x, this.group.position.z);
  }

  update(dt: number, t: number): void {
    const g = this.group;
    switch (this.post) {
      case 'gate': {
        // Стража стоит: лёгкое покачивание, чтобы фигурка не выглядела вкопанной.
        g.position.copy(this.anchor);
        g.position.y = Math.abs(Math.sin(t * 1.2 + this.phase)) * 0.015;
        this.faceOut();
        this.legL.rotation.x = 0;
        this.legR.rotation.x = 0;
        break;
      }
      case 'patrol': {
        // Дозор идёт по окружной дороге под стеной.
        this.angle += (dt * 0.9) / OUTER_ROAD;
        g.position.set(Math.cos(this.angle) * OUTER_ROAD, 0, Math.sin(this.angle) * OUTER_ROAD);
        g.rotation.y = Math.atan2(-Math.sin(this.angle), -Math.cos(this.angle)) + Math.PI / 2;
        const swing = Math.sin(t * 9 + this.phase) * 0.45;
        this.legL.rotation.x = swing;
        this.legR.rotation.x = -swing;
        g.position.y = Math.abs(Math.sin(t * 9 + this.phase)) * 0.035;
        break;
      }
      default: {
        // Учения: шаг вперёд-назад и удар оружием сверху вниз.
        const swing = Math.sin(t * 2.2 + this.phase);
        g.position.set(this.anchor.x + swing * 0.35, 0, this.anchor.z + Math.cos(t * 1.7 + this.phase) * 0.25);
        g.rotation.y = this.angle + Math.PI + Math.sin(t * 1.1 + this.phase) * 0.5;
        this.weapon.rotation.z = 0.18 + Math.sin(t * 5 + this.phase) * 0.7;
        this.legL.rotation.x = swing * 0.3;
        this.legR.rotation.x = -swing * 0.3;
        break;
      }
    }
  }
}

/** Где стоит боец с этим номером: сперва ворота, потом учения, потом дозор. */
export function postFor(index: number, hasBarracks: boolean, barracks: THREE.Vector3 | null): {
  post: Post;
  anchor: THREE.Vector3;
} {
  if (index < 2) {
    // Двое у ворот, по сторонам от проезда.
    const side = index === 0 ? 1 : -1;
    const r = OUTER_ROAD + 0.35;
    const a = GATE_ANGLE + (side * 0.075);
    return { post: 'gate', anchor: new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r) };
  }
  if (hasBarracks && barracks && index < 6) {
    const a = (index / 4) * Math.PI * 2;
    return {
      post: 'drill',
      anchor: new THREE.Vector3(
        barracks.x + Math.cos(a) * 1.5,
        0,
        barracks.z + Math.sin(a) * 1.5,
      ),
    };
  }
  const a = GATE_ANGLE + (index / MAX_SOLDIERS) * Math.PI * 2;
  return { post: 'patrol', anchor: new THREE.Vector3(Math.cos(a) * OUTER_ROAD, 0, Math.sin(a) * OUTER_ROAD) };
}
