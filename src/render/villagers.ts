// Жители у костра. Мешей у агента нет — он правит позу своей Figure, а рисует
// всех разом пул инстансов (figures.ts).
//
// Ходьбы на работу и обратно больше нет. Она стоила дорого — путь, поворот,
// покачивание на каждого работника каждый кадр — и не сообщала ничего: на 390 px
// не видно, кто куда пошёл. Хуже, она давала обратный смысл: чем лучше идут дела,
// тем пустее деревня, потому что все разошлись по углам.
//
// Правило теперь одно: у костра стоят свободные руки. Житель без работы гуляет по
// площади, назначенный — исчезает со сцены, снятый — возвращается. Занятость
// показывают сами здания (worksigns.ts).
//
// Поимённых жителей в игре нет — население это число, — поэтому и фигурка ничья:
// агент знает только своё место у огня и свой покрой одежды (units.ts). Покрои
// (`FOLK_KINDS`) берутся по кругу: толпа у костра не должна выглядеть штампованной.
// Показывается их не больше `MAX_VILLAGERS`: при населении в сотни толпу всё равно
// не сосчитать, а счёт — весь смысл площади.
import * as THREE from 'three';
import type { GameState } from '@/game/types';
import { idleCount } from '@/game/derived';
import { Figure } from './figures';
import { poseFigure } from './poses';
import { dressVillager } from './units';

const SPEED = 1.0;

/**
 * Потолок показа свободных рук — не потолок племени. При населении в сотни толпу
 * у костра всё равно не сосчитать, а счёт — весь смысл площади; точное число
 * стоит в строке состояния и в «Племени». Снимать этот потолок нельзя: фигурки
 * рисуются инстансами, но матрицы им всё равно пишутся каждый кадр.
 */
export const MAX_VILLAGERS = 10;

/** Сколько фигурок у костра рисует сцена при этом состоянии. */
export const shownVillagers = (s: GameState): number => Math.min(idleCount(s), MAX_VILLAGERS);

/** Где гуляют: кольцо вокруг костра, внутри площади. */
const HOME_MIN = 1.3;
const HOME_MAX = 2.6;

export class VillagerAgent {
  readonly figure = new Figure();
  private timer = 1 + Math.random() * 3;
  private target = new THREE.Vector3();
  night = false;
  /**
   * Поза, пока житель стоит. Пусто — стойка (`poses`); у вида `next` её ставит кусок окружения
   * (`env/folk.folkIdle`: греют руки у огня, говорят) вместе с новыми покроями.
   */
  idle: ((f: Figure, t: number, night: boolean) => void) | null = null;

  /** `kind` — покрой одежды: жителей различает только вид, ролей у них нет. */
  constructor(readonly kind: number) {
    const f = this.figure;
    dressVillager(f, kind);
    const a = Math.random() * Math.PI * 2;
    const r = HOME_MIN + Math.random() * (HOME_MAX - HOME_MIN);
    f.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    this.pickTarget();
  }

  private pickTarget(): void {
    const a = Math.random() * Math.PI * 2;
    const r = HOME_MIN + Math.random() * (HOME_MAX - HOME_MIN);
    this.target.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  }

  update(dt: number, t: number): void {
    const f = this.figure;
    const p = f.position;
    const dx = this.target.x - p.x;
    const dz = this.target.z - p.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.12) {
      const step = Math.min(dist, SPEED * dt);
      p.x += (dx / dist) * step;
      p.z += (dz / dist) * step;
      f.rotationY = Math.atan2(dx, dz);
      poseFigure(f, 'walk', t);
      // Площадь ровная (внутри расчистки земля на нуле), рельеф спрашивать не у кого.
      p.y = 0;
      return;
    }

    if (this.idle) this.idle(f, t, this.night);
    else poseFigure(f, 'stand', t);
    p.y = 0;
    this.timer -= dt;
    if (this.timer > 0) return;
    // Ночью у огня стоят дольше: греются, а не бродят.
    this.timer = this.night ? 5 + Math.random() * 6 : 3 + Math.random() * 5;
    this.pickTarget();
  }
}
