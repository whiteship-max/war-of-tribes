// Обзор деревни отпущен, но не в пустоту: у панорамы есть привязка к посёлку,
// у приближения — пол и потолок. Проверяется это числами, а не глазами.
import { describe, expect, it } from 'vitest';
import { FRAME_RADIUS, OUTSKIRTS_RADIUS } from './plan';
import { readFileSync } from 'node:fs';
import { AZIMUTH, PAN_LEASH, PAN_STEP_MAX, clampPan, framing, zoomRange } from './camera';

/** Телефон в портрете — тот экран, ради которого всё и делается. */
const PHONE = 390 / 844;

describe('камера деревни', () => {
  it('привязка держит центр экрана в пределах окрестностей', () => {
    // Внутри поводка ничего не двигается.
    expect(clampPan(3, -4)).toEqual({ x: 3, z: -4 });
    // Снаружи — возвращается ровно на поводок, не меняя направления.
    const far = clampPan(200, 0);
    expect(far.x).toBeCloseTo(PAN_LEASH, 6);
    expect(far.z).toBeCloseTo(0, 6);
    const diag = clampPan(-100, 100);
    expect(Math.hypot(diag.x, diag.z)).toBeCloseTo(PAN_LEASH, 6);
    expect(diag.x / diag.z).toBeCloseTo(-1, 6);
    // Центр экрана доходит до самого дальнего двора и ни на шаг дальше.
    expect(PAN_LEASH).toBeCloseTo(OUTSKIRTS_RADIUS, 6);
  });

  it('поводок не спотыкается о ноль', () => {
    expect(clampPan(0, 0)).toEqual({ x: 0, z: 0 });
  });

  it('кадровая дистанция лежит между полом и потолком приближения', () => {
    for (const aspect of [PHONE, 375 / 812, 0.62, 1, 16 / 9]) {
      const f = framing(aspect);
      const z = zoomRange(f);
      expect(z.min).toBeLessThan(f.dist);
      expect(z.max).toBeGreaterThanOrEqual(f.dist);
    }
  });

  it('пол приближения ближе прежнего: здание должно дорасти до пальца', () => {
    const f = framing(PHONE);
    const z = zoomRange(f);
    // Прежний пол — 0.45 кадровой дистанции. Здание на 20 px становилось 45 px,
    // то есть ровно впритык к пальцу; теперь оно вырастает вдвое сильнее.
    expect(z.min).toBeLessThan(f.dist * 0.45);
    // Но не настолько, чтобы камера залезла внутрь моделей.
    expect(z.min).toBeGreaterThanOrEqual(12);
  });

  it('потолок отдаления не выпускает деревню в туман', () => {
    for (const aspect of [PHONE, 0.62, 1, 16 / 9]) {
      const f = framing(aspect);
      const z = zoomRange(f);
      // Дальний край застройки при полном отдалении остаётся по эту сторону тумана.
      expect(z.max + FRAME_RADIUS).toBeLessThanOrEqual(f.fogFar);
    }
  });

  it('портрет телефона кадрируется ближе и сверху', () => {
    const phone = framing(PHONE);
    const wide = framing(16 / 9);
    expect(phone.polar).toBeLessThan(wide.polar);
    expect(phone.fov).toBeGreaterThan(wide.fov);
    expect(phone.targetY).toBeGreaterThan(wide.targetY);
  });
});

describe('шаг панорамы', () => {
  it('одиночного шага дальше половины поводка не бывает', () => {
    // У горизонта луч ложится почти вдоль земли, и один пиксель даёт километры.
    // Такой шаг не подрезается, а отбрасывается — предел и есть признак того,
    // что расчёт выродился, а не палец ушёл.
    expect(PAN_STEP_MAX).toBeLessThan(PAN_LEASH);
    expect(PAN_STEP_MAX).toBeGreaterThan(0);
  });
});

describe('поворота у камеры деревни нет', () => {
  // Проверка по исходнику, и это тот же приём, что у замка алмазов: вернуть
  // поворот можно правкой одной строки, а заметить это по картинке нельзя —
  // жалоба придёт через месяц с телефона. Убран именно жест вместе с его
  // состоянием, а не спрятан за настройкой: мёртвый рычаг хуже отсутствующего.
  //
  // Читается **код без комментариев**: объяснение, почему поворот убран, само
  // называет и `OrbitControls`, и `orbitDelta`, — искать их надо в том, что
  // выполняется, а не в том, что написано людям.
  const strip = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const scene = strip(readFileSync(new URL('./Scene.ts', import.meta.url), 'utf8'));
  const camera = strip(readFileSync(new URL('./camera.ts', import.meta.url), 'utf8'));

  it('чисел поворота в камере не осталось', () => {
    expect(camera).not.toMatch(/orbitDelta/);
    expect(camera).not.toMatch(/ROTATE_SPEED/);
  });

  it('угол один на всю игру, и сцена его не хранит', () => {
    expect(AZIMUTH).toBeCloseTo(Math.atan2(9, 12), 12);
    // Ни поля с азимутом, ни второго числа рядом: сцена берёт константу и
    // нигде её не запоминает — запоминать нечего, поворота нет.
    expect(scene).not.toMatch(/this\.azimuth/);
    expect(scene).not.toMatch(/Math\.atan2\(9, 12\)/);
    expect(scene).toMatch(/AZIMUTH \+ this\.spinTurn/);
  });

  it('второго судьи у камеры больше нет — OrbitControls убран целиком', () => {
    // Он вёл панораму с первого пикселя, ничего не зная о разборе жеста, и
    // держался в сцене ради зажима наклона. Наклон теперь ставит кадрирование,
    // приближение — щипок, поворота нет вовсе, и держать класс не за чем.
    expect(scene).not.toMatch(/OrbitControls/);
    expect(scene).not.toMatch(/this\.controls/);
  });

  it('два пальца только приближают', () => {
    expect(scene).toMatch(/private pinchZoom\(\): void \{/);
    // Середина между пальцами и была поворотом: считать её больше незачем.
    expect(scene).not.toMatch(/private twoFingers/);
  });

  it('кто двигает камеру, тот и обновляет её матрицы', () => {
    // Луч под палец и области попадания считаются между кадрами, а кадра может
    // не быть вовсе: на скрытой странице и на карте цепочка кадров стоит.
    // Пока это держалось на лупе, первое ведение на свежем экране уходило в
    // пустоту — шаг выходил вырожденным и отбрасывался по `PAN_STEP_MAX`.
    expect(scene).toMatch(/this\.camera\.updateMatrixWorld\(\);/);
  });

  it('камера трогается только с разрешения разбора жеста', () => {
    expect(scene).toMatch(/touch\.panning\(now\)/);
  });

  it('приближение зажато полом и потолком в одном месте', () => {
    // Раньше это делал `controls.update()`; теперь — сам щипок по `zoomRange`.
    expect(scene).toMatch(/this\.zoom = zoom;/);
    expect(scene).toMatch(/Math\.min\(Math\.max\(want, this\.zoom\.min\), this\.zoom\.max\)/);
  });
});
