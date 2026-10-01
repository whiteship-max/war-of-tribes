/**
 * Живность окружения пробы: птицы над лесом днём и светлячки над лугом ночью
 * (docs/graphics_world.md, 9.8). Тени облаков — в шейдерах земли и растительности
 * (`env/materials.ts`, `envCloud`), здесь их нет.
 *
 * ДЁШЕВО, И ЭТО НАРОЧНО: птицы — один меш экземпляров (стая — две дюжины треугольников),
 * светлячки — одна система точек; оба — по вызову отрисовки. Место каждой птицы и каждого
 * светлячка — чистая функция номера и времени сцены: ничего не копится от кадра к кадру,
 * и сцена, вернувшаяся из фона, не догоняет пропущенного. Разброс — хешем от номера
 * (`rules.hash`), без `Math.random`: стая та же на любом устройстве.
 *
 * На низком уровне живности нет (`QualitySpec.life`): бюджет вызовов там самый тесный.
 */
import * as THREE from 'three';
import { CLEAR_RADIUS } from '../plan';
import { PALETTE } from '../palette';
import { FOREST_FROM, GROUND_RADIUS, groundHeight } from '../terrain';
import { edgeRadius, hash } from './rules';

/** Сколько птиц: две стаи по семь. */
const FLOCKS = 2;
const PER_FLOCK = 7;
/** Сколько светлячков на весь луг. */
const FIREFLIES = 70;

/**
 * Птица: два крыла буквой V, мордой по +x; грани видны с обеих сторон. Взмах — масштаб
 * экземпляра по высоте: концы крыльев ходят вверх и вниз. 2 треугольника.
 */
function birdModel(): THREE.BufferGeometry {
  const w = 0.3;
  const pos = [0.07, 0, 0, -0.06, 0, 0, -0.02, 0.07, w, 0.07, 0, 0, -0.02, 0.07, -w, -0.06, 0, 0];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

export interface Life {
  birds: THREE.InstancedMesh;
  fireflies: THREE.Points;
  /** Кадр: время сцены, доля дня и ночи, доля цветения (летом светлячков больше). */
  update(t: number, daylight: number, nightK: number, bloom: number, snow: number): void;
  dispose(): void;
}

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const V = new THREE.Vector3();
const S = new THREE.Vector3();

export function makeLife(): Life {
  // ---------- Птицы ----------
  const birdMat = new THREE.MeshBasicMaterial({ color: PALETTE.bird, side: THREE.DoubleSide });
  birdMat.name = 'env-birds';
  const birds = new THREE.InstancedMesh(birdModel(), birdMat, FLOCKS * PER_FLOCK);
  birds.name = 'birds';
  birds.frustumCulled = false;
  birds.count = 0;
  /** Стая кружит над лесом: середина круга, радиус, высота и скорость — от номера стаи. */
  const flocks = Array.from({ length: FLOCKS }, (_, f) => {
    const a = hash(f, 900) * Math.PI * 2;
    const r = FOREST_FROM + 3 + hash(f, 901) * 7;
    return {
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      radius: 5 + hash(f, 902) * 4,
      height: 7 + hash(f, 903) * 3,
      speed: (0.16 + hash(f, 904) * 0.1) * (hash(f, 905) < 0.5 ? 1 : -1),
      phase: hash(f, 906) * Math.PI * 2,
    };
  });
  /** Птица в строю: сдвиг от вожака назад и вбок, своя частота взмаха. */
  const slots = Array.from({ length: FLOCKS * PER_FLOCK }, (_, i) => ({
    back: (i % PER_FLOCK) * 0.35 + hash(i, 910) * 0.3,
    side: ((i % PER_FLOCK) % 2 ? 1 : -1) * Math.ceil((i % PER_FLOCK) / 2) * 0.38 + (hash(i, 911) - 0.5) * 0.2,
    up: (hash(i, 912) - 0.5) * 0.6,
    flap: 7 + hash(i, 913) * 3,
    phase: hash(i, 914) * Math.PI * 2,
  }));

  // ---------- Светлячки ----------
  const base = new Float32Array(FIREFLIES * 3);
  const seed = new Float32Array(FIREFLIES);
  let placed = 0;
  for (let i = 0; placed < FIREFLIES && i < FIREFLIES * 6; i++) {
    // Луг у опушки и полоса вырубки: там, где трава встречает лес.
    const a = hash(i, 920) * Math.PI * 2;
    const x0 = Math.cos(a);
    const z0 = Math.sin(a);
    const edge = edgeRadius(x0 * FOREST_FROM, z0 * FOREST_FROM);
    const r = CLEAR_RADIUS - 3 + hash(i, 921) * (edge + 1 - (CLEAR_RADIUS - 3));
    if (r > GROUND_RADIUS - 2) continue;
    const x = x0 * r;
    const z = z0 * r;
    base[placed * 3] = x;
    base[placed * 3 + 1] = groundHeight(x, z) + 0.35 + hash(i, 922) * 0.9;
    base[placed * 3 + 2] = z;
    seed[placed] = hash(i, 923) * 100;
    placed++;
  }
  const flyPos = new Float32Array(placed * 3);
  const flyCol = new Float32Array(placed * 3);
  const flyGeo = new THREE.BufferGeometry();
  flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
  flyGeo.setAttribute('color', new THREE.BufferAttribute(flyCol, 3));
  // Смешение сложением (2 — AdditiveBlending числом: имя дописалось бы в первую загрузку).
  const flyMat = new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, depthWrite: false, blending: 2, fog: false, toneMapped: false });
  flyMat.name = 'env-fireflies';
  const fireflies = new THREE.Points(flyGeo, flyMat);
  fireflies.name = 'fireflies';
  fireflies.frustumCulled = false;
  const glow = new THREE.Color(PALETTE.firefly);

  const update = (t: number, daylight: number, nightK: number, bloom: number, snow: number): void => {
    // Птицы днём; зимой стаи реже — половина.
    const day = daylight * (1 - 0.5 * snow);
    const shown = day < 0.2 ? 0 : Math.round(FLOCKS * PER_FLOCK * Math.min(1, (day - 0.2) / 0.5));
    birds.visible = shown > 0;
    birds.count = shown;
    for (let i = 0; i < shown; i++) {
      const f = flocks[Math.floor(i / PER_FLOCK)];
      const s = slots[i];
      const a = f.phase + t * f.speed;
      // Вожак на круге; строй — назад по ходу и вбок.
      const dir = f.speed > 0 ? 1 : -1;
      const tx = -Math.sin(a) * dir;
      const tz = Math.cos(a) * dir;
      const x = f.x + Math.cos(a) * f.radius - tx * s.back + tz * s.side;
      const z = f.z + Math.sin(a) * f.radius - tz * s.back - tx * s.side;
      const y = f.height + s.up + Math.sin(t * 0.7 + s.phase) * 0.25;
      E.set(0, -Math.atan2(tz, tx), 0);
      Q.setFromEuler(E);
      // Взмах — масштаб по высоте от −1 до 1: концы крыльев вверх и вниз; птица парит
      // с тем же размахом треть времени.
      const flap = Math.sin(t * s.flap + s.phase);
      const beat = Math.sin(t * 0.9 + s.phase) > -0.3 ? flap : 0.35;
      birds.setMatrixAt(i, M.compose(V.set(x, y, z), Q, S.set(1, beat, 1)));
    }
    if (shown > 0) birds.instanceMatrix.needsUpdate = true;

    // Светлячки ночью, летом — больше всего: доля цветения сезона.
    const night = nightK * bloom * (1 - snow);
    fireflies.visible = night > 0.05;
    if (!fireflies.visible) return;
    for (let i = 0; i < placed; i++) {
      const k = seed[i];
      flyPos[i * 3] = base[i * 3] + Math.sin(t * 0.43 + k) * 0.45 + Math.sin(t * 0.17 + k * 1.3) * 0.3;
      flyPos[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.61 + k * 0.7) * 0.18;
      flyPos[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.37 + k) * 0.45 + Math.cos(t * 0.21 + k * 0.9) * 0.3;
      // Мигает: вспышка раз в несколько секунд, у каждого — своя.
      const blink = Math.max(0, Math.sin(t * (0.9 + (k % 0.7)) + k));
      const b = blink * blink * blink * night;
      flyCol[i * 3] = glow.r * b;
      flyCol[i * 3 + 1] = glow.g * b;
      flyCol[i * 3 + 2] = glow.b * b;
    }
    (flyGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (flyGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  };

  return {
    birds,
    fireflies,
    update,
    dispose: () => {
      birdMat.dispose();
      flyMat.dispose();
      birds.geometry.dispose();
      flyGeo.dispose();
    },
  };
}
