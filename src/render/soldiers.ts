// Бойцы в сцене. Армия хранится счётчиками, а не жителями, поэтому и здесь
// фигурки не привязаны к людям: сколько бойцов в `s.army` — столько и видно.
//
// Заняты они тем, чем занята настоящая дружина: двое стоят у ворот, кто-то ходит
// дозором по окружной дороге под стеной, остальные машут оружием у казарм.
// Рисует их тот же пул инстансов, что и жителей (figures.ts): агент правит позу.
import * as THREE from 'three';
import type { TroopId } from '@/game/types';
import { Figure, STICK_RADIUS } from './figures';
import { PALETTE, TROOP_TINT } from './palette';
import { GATE_ANGLE, OUTER_ROAD } from './plan';

/** Больше десятка фигурок в кадре не различить, а рисовать их дорого. */
export const MAX_SOLDIERS = 14;

export type Post = 'gate' | 'patrol' | 'drill';

/** Кому положен щит: щитоносцу и латнику — он и в силуэте виден. */
const HAS_SHIELD: TroopId[] = ['shieldman', 'rider', 'legionary'];

/** У кого оружие из металла — клинок, а не древко. */
const STEEL_ARM: TroopId[] = ['swordsman', 'shieldman', 'legionary'];

export class SoldierAgent {
  readonly figure = new Figure();
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
    const f = this.figure;
    f.torsoWidth = 1.06;
    f.colors.torso.setHex(TROOP_TINT[troop]);
    // Шлем — у всех, кроме дубинщика: у того ещё только волосы.
    f.colors.cap.setHex(troop === 'clubman' ? PALETTE.hair : PALETTE.metal);
    // Оружие: у всех древко, у мечников — клинок. В силуэте важно, что оно есть.
    f.stick = { length: troop === 'archer' ? 0.9 : 1.15, radius: STICK_RADIUS * 1.12, tilt: 0.18 };
    f.colors.stick.setHex(STEEL_ARM.includes(troop) ? PALETTE.metal : PALETTE.woodDark);
    f.shield = HAS_SHIELD.includes(troop);
    f.position.copy(anchor);
  }

  /** Куда смотреть: наружу от центра — стража стоит лицом к полю. */
  private faceOut(): void {
    this.figure.rotationY = Math.atan2(this.figure.position.x, this.figure.position.z);
  }

  update(dt: number, t: number): void {
    const f = this.figure;
    const p = f.position;
    switch (this.post) {
      case 'gate': {
        // Стража стоит: лёгкое покачивание, чтобы фигурка не выглядела вкопанной.
        p.copy(this.anchor);
        p.y = Math.abs(Math.sin(t * 1.2 + this.phase)) * 0.015;
        this.faceOut();
        f.legSwing = 0;
        break;
      }
      case 'patrol': {
        // Дозор идёт по окружной дороге под стеной.
        this.angle += (dt * 0.9) / OUTER_ROAD;
        p.set(Math.cos(this.angle) * OUTER_ROAD, 0, Math.sin(this.angle) * OUTER_ROAD);
        f.rotationY = Math.atan2(-Math.sin(this.angle), -Math.cos(this.angle)) + Math.PI / 2;
        f.legSwing = Math.sin(t * 9 + this.phase) * 0.45;
        p.y = Math.abs(Math.sin(t * 9 + this.phase)) * 0.035;
        break;
      }
      default: {
        // Учения: шаг вперёд-назад и удар оружием сверху вниз.
        const swing = Math.sin(t * 2.2 + this.phase);
        p.set(this.anchor.x + swing * 0.35, 0, this.anchor.z + Math.cos(t * 1.7 + this.phase) * 0.25);
        f.rotationY = this.angle + Math.PI + Math.sin(t * 1.1 + this.phase) * 0.5;
        if (f.stick) f.stick.tilt = 0.18 + Math.sin(t * 5 + this.phase) * 0.7;
        f.legSwing = swing * 0.3;
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
