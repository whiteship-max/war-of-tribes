// Бойцы в сцене. Армия хранится счётчиками, а не жителями, поэтому и здесь
// фигурки не привязаны к людям: сколько бойцов в `s.army` — столько и видно.
//
// Заняты они тем, чем занята настоящая дружина: двое стоят у ворот, кто-то ходит
// дозором по окружной дороге под стеной, остальные машут оружием у казарм.
// Рисует их тот же пул инстансов, что и жителей (figures.ts): агент правит позу,
// а из чего он собран — решает units.ts по виду бойца.
import * as THREE from 'three';
import type { TroopId } from '@/game/types';
import { Figure } from './figures';
import { poseFigure } from './poses';
import { dressSoldier } from './units';
import { GATE_ANGLE, OUTER_ROAD } from './plan';

/**
 * Потолок показа дружины — не потолок армии. Больше полутора десятков фигурок в
 * кадре не различить, а бойцов к концу партии сотни; точное число стоит в строке
 * состояния и в казармах.
 */
export const MAX_SOLDIERS = 14;

/** Сколько фигурок дружины рисует сцена при этой армии. */
export const shownSoldiers = (army: Partial<Record<TroopId, number>>): number =>
  Math.min(
    MAX_SOLDIERS,
    Object.values(army).reduce((n: number, v) => n + Math.max(0, v ?? 0), 0),
  );

export type Post = 'gate' | 'patrol' | 'drill';

export class SoldierAgent {
  readonly figure = new Figure();
  private angle: number;

  constructor(
    readonly troop: TroopId,
    readonly post: Post,
    private anchor: THREE.Vector3,
    index: number,
  ) {
    this.angle = Math.atan2(anchor.z, anchor.x);
    const f = this.figure;
    dressSoldier(f, troop);
    // Своё смещение по времени: иначе дружина машет оружием одним движением.
    f.phase = index * 1.37;
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
        // Стража стоит в изготовке: щит вперёд, оружие отведено.
        p.copy(this.anchor);
        p.y = 0;
        this.faceOut();
        poseFigure(f, 'guard', t);
        break;
      }
      case 'patrol': {
        // Дозор идёт по окружной дороге под стеной.
        this.angle += (dt * 0.9) / OUTER_ROAD;
        p.set(Math.cos(this.angle) * OUTER_ROAD, 0, Math.sin(this.angle) * OUTER_ROAD);
        f.rotationY = Math.atan2(-Math.sin(this.angle), -Math.cos(this.angle)) + Math.PI / 2;
        poseFigure(f, 'walk', t);
        break;
      }
      default: {
        // Учения: замах и удар на месте, с переступом вокруг своего места.
        const sway = Math.sin(t * 1.1 + f.phase);
        p.set(this.anchor.x + sway * 0.3, 0, this.anchor.z + Math.cos(t * 0.9 + f.phase) * 0.22);
        f.rotationY = this.angle + Math.PI + sway * 0.4;
        poseFigure(f, 'strike', t);
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
