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
// агент знает только своё место у огня. Показывается их не больше `MAX_VILLAGERS`:
// при населении в сотни толпу всё равно не сосчитать, а счёт — весь смысл площади.
import * as THREE from 'three';
import { Figure } from './figures';
import { JOB_TINT, PALETTE } from './palette';

const SPEED = 1.0;

/** Где гуляют: кольцо вокруг костра, внутри площади. */
const HOME_MIN = 1.3;
const HOME_MAX = 2.6;

export class VillagerAgent {
  readonly figure = new Figure();
  private timer = 1 + Math.random() * 3;
  private target = new THREE.Vector3();
  private walkPhase = Math.random() * 10;
  night = false;

  constructor() {
    const f = this.figure;
    f.colors.stick.setHex(PALETTE.stake);
    // Свободный житель одет как свободный: у костра других не бывает.
    f.colors.torso.setHex(JOB_TINT.idle);
    f.stick = null;
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

  update(dt: number): void {
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
      this.walkPhase += dt * 9;
      f.legSwing = Math.sin(this.walkPhase) * 0.45;
      // Площадь ровная (внутри расчистки земля на нуле), рельеф спрашивать не у кого.
      p.y = Math.abs(Math.sin(this.walkPhase)) * 0.04;
      return;
    }

    f.legSwing = 0;
    f.torsoTilt = 0;
    p.y = 0;
    this.timer -= dt;
    if (this.timer > 0) return;
    // Ночью у огня стоят дольше: греются, а не бродят.
    this.timer = this.night ? 5 + Math.random() * 6 : 3 + Math.random() * 5;
    this.pickTarget();
  }
}
