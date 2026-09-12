/**
 * Модели поляны: земля, лес, палатка, костёр, пень и топор.
 *
 * Тот же низкополигональный склад, что в деревне, и теми же средствами: палитра
 * (`render/palette.ts`), общие материалы (`render/materials.ts`), набор деталей
 * (`render/kit.ts`) и склейка `collapse` — один вызов отрисовки на материал, а
 * не на доску. Деревья, пни, брёвна и камни берутся у деревни как есть
 * (`render/terrain.ts`): свой лес значил бы второй лес, а он должен быть тот же.
 *
 * Своего здесь ровно то, чего у деревни нет: земля поляны (у неё своя, с
 * расчисткой под кольцевой посёлок), палатка и топор.
 *
 * Красота тут делается светом и силуэтом, а не количеством треугольников: лес
 * стоит стеной и закрывает горизонт, костёр — единственный тёплый источник,
 * палатка — единственная рукотворная вещь в кадре, и потому читается сразу.
 */
import * as THREE from 'three';
import { PALETTE } from '@/render/palette';
import { KIT, LEGACY } from '@/render/materials';
import * as K from '@/render/kit';
import { makeFarTree, makeLog, makeRock, makeStump, makeTree, vnoise } from '@/render/terrain';
import { AXE_STUMP, FIRE, GLADE_R, GUEST_FROM, HOUSE, MATE_SPOT, SON_HOUSE, START, TENT, TREES, hash } from './glade';
import { HOUSE_LOGS } from './craft';
import { BOARDS } from './end';
import { ADDITIVE, mix } from './paint';

/** Докуда тянется земля. Дальше туман, и края диска не видно. */
const GROUND_R = 44;

/** Откуда начинается лес: сразу за кромкой поляны. */
const FOREST_FROM = GLADE_R + 1.2;

/** Докуда его сажаем. Дальше он всё равно в тумане. */
const FOREST_TO = 38;

/**
 * За этим радиусом дерево рисуется дешёвой моделью — конусом без ствола и без
 * донца: пять треугольников против сорока четырёх.
 *
 * Своё число, а не `FOREST_FAR` деревни: там оно выведено из её размеров (мир
 * радиусом 40, посёлок в середине), здесь поляна втрое меньше и туман ближе.
 * Взять чужое значило бы поставить порог за краем леса — и вся стена рисовалась
 * бы дорогой моделью, ни на пиксель не став лучше.
 */
const FAR_FROM = 26;

const SEGMENTS = 96;

const smooth = (t: number): number => {
  const k = THREE.MathUtils.clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
};

/**
 * Высота земли. Поляна ровная целиком — по ней ходят, и рельеф под ногами
 * стоил бы и кадров, и подскока камеры; за поляной шум и подъём чашей, чтобы
 * опушка закрывала горизонт, а не открывала пустоту за краем диска.
 */
function height(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const d = r - GLADE_R;
  if (d <= 0) return 0;
  const amp = smooth(d / 4) * 0.5;
  const n = vnoise(x / 5.5, z / 5.5) + 0.4 * vnoise(x / 2.3 + 7, z / 2.3 + 3);
  const rim = smooth((r - (GROUND_R - 9)) / 8) * 2.2;
  return amp * n + rim;
}

/** Множитель цвета травы: пятна, мелкий разброс и вытоптанность у костра. */
function tint(x: number, z: number): [number, number, number] {
  const w = 0.6 * vnoise(x / 3.2, z / 3.2) + 0.4 * vnoise(x / 1.4 + 11, z / 1.4 + 5);
  const t = THREE.MathUtils.clamp((w + 1) / 2, 0, 1);
  const j = 1 + 0.04 * (hash(Math.round(x * 3), Math.round(z * 3)) - 0.5);
  // Вытоптано вокруг огня — обжитое место должно быть видно самой землёй, а не
  // только вещами на ней: ровный зелёный диск читается полем, а не стоянкой.
  const near = smooth((4.4 - Math.hypot(x - FIRE.x, z - FIRE.z)) / 3.2);
  const out: [number, number, number] = [0, 0, 0];
  const dark = [0.78, 0.84, 0.9];
  const light = [1.14, 1.1, 0.98];
  const trod = [0.72, 0.66, 0.56];
  for (let i = 0; i < 3; i++) {
    const patch = dark[i] + (light[i] - dark[i]) * t;
    out[i] = patch * j * (1 + (trod[i] - 1) * near);
  }
  return out;
}

/**
 * Земля поляны. Полярная сетка, неиндексированная: цвет по вершинам, свет
 * плоский по граням — ровно как у деревни, только кольца реже (рельефа под
 * ногами нет, а дальний край всё равно в тумане).
 */
export function gladeGround(): THREE.Mesh {
  const radii: number[] = [0];
  let r = 0;
  while (r < GLADE_R) radii.push((r += 2.2));
  while (r < GROUND_R) radii.push((r += 1.6));
  const rings = radii.length;
  const px = new Float32Array(rings * SEGMENTS);
  const py = new Float32Array(rings * SEGMENTS);
  const pz = new Float32Array(rings * SEGMENTS);
  const pc = new Float32Array(rings * SEGMENTS * 3);
  for (let i = 0; i < rings; i++) {
    const step = i === 0 ? 0 : radii[i] - radii[i - 1];
    for (let j = 0; j < SEGMENTS; j++) {
      const idx = i * SEGMENTS + j;
      const ja = i === 0 ? 0 : (hash(i * 7, j * 13) - 0.5) * 0.35;
      const jr = i === 0 ? 0 : (hash(i * 11, j * 17) - 0.5) * 0.3 * step;
      const a = ((j + ja) / SEGMENTS) * Math.PI * 2;
      const rr = Math.max(0, radii[i] + jr);
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      px[idx] = x;
      pz[idx] = z;
      py[idx] = height(x, z) - 2 * smooth((rr - (GROUND_R - 2)) / 2);
      const [cr, cg, cb] = tint(x, z);
      pc[idx * 3] = cr;
      pc[idx * 3 + 1] = cg;
      pc[idx * 3 + 2] = cb;
    }
  }
  const pos: number[] = [];
  const col: number[] = [];
  const emit = (v: number): void => {
    pos.push(px[v], py[v], pz[v]);
    col.push(pc[v * 3], pc[v * 3 + 1], pc[v * 3 + 2]);
  };
  for (let j = 0; j < SEGMENTS; j++) {
    const n = (j + 1) % SEGMENTS;
    emit(0);
    emit(SEGMENTS + n);
    emit(SEGMENTS + j);
  }
  for (let i = 1; i < rings - 1; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const n = (j + 1) % SEGMENTS;
      const a = i * SEGMENTS + j;
      const b = i * SEGMENTS + n;
      const c = (i + 1) * SEGMENTS + n;
      const d = (i + 1) * SEGMENTS + j;
      if (hash(i * 3, j * 5) < 0.5) {
        emit(a); emit(c); emit(d);
        emit(a); emit(b); emit(c);
      } else {
        emit(a); emit(b); emit(d);
        emit(b); emit(c); emit(d);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, KIT.grass);
  mesh.name = 'ground';
  mesh.receiveShadow = true;
  return mesh;
}

/** Ставит объект на землю в точке. */
function put(o: THREE.Object3D, x: number, z: number, rotY = 0): void {
  o.position.set(x, height(x, z), z);
  o.rotation.y = rotY;
}

/**
 * Стена леса вокруг поляны.
 *
 * Тень ей не положена — та же плата, что снята с окружения деревни: склеенный
 * меш культуре не поддаётся и уходил бы в теневой проход целиком, а коробка
 * теней накрывает только поляну. Дальние деревья — дешёвой моделью
 * (`makeFarTree`, пять треугольников против сорока четырёх).
 */
export function forest(shade: Shade): THREE.Group {
  const g = new THREE.Group();
  g.name = 'forest';
  let n = 0;
  for (let r = FOREST_FROM; r < FOREST_TO; r += 2.2) {
    // Чем дальше кольцо, тем больше в нём деревьев: плотность держится ровной.
    const count = Math.max(8, Math.round(r * 0.75));
    for (let i = 0; i < count; i++) {
      const a = ((i + hash(r * 13, i * 7) * 0.9) / count) * Math.PI * 2;
      const rr = r + (hash(r * 3, i * 11) - 0.5) * 1.6;
      if (rr < FOREST_FROM) continue;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      // Рост настоящий: восемь-одиннадцать метров. Прежние трёхметровые читались
      // не лесом, а живой изгородью — поляна от этого казалась полем, а не
      // прогалиной, и верхняя треть экрана оставалась пустым небом.
      const scale = 2.6 + hash(i * 5, r * 9) * 1.4;
      const far = rr > FAR_FROM;
      const kind = hash(i * 17, r * 3);
      // Лес — не посадка из одной ёлки. Ближние кольца разбавлены лиственными и
      // сухостоем: у них другой силуэт, и стена перестаёт быть рядом конусов.
      const tree = far
        ? makeFarTree(scale, n)
        : kind < 0.13
          ? broadleaf(scale * 0.82, n)
          : kind < 0.18
            ? snag(scale * 0.9, n)
            : makeTree(scale, n);
      put(tree, x, z, hash(i, r) * Math.PI * 2);
      vary(tree, i * 31 + r * 7);
      g.add(tree);
      // Пятно тени под ближними: без него дерево, не отбрасывающее тени, висит над травой.
      if (rr < 24) shade.add(x, z, 0.62 * scale * tree.scale.x, 0.62 * scale * tree.scale.x, hash(i, r * 2));
      n++;
    }
  }
  // Пара камней и валежник у кромки: опушка не должна быть рядом одинаковых конусов.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    const rr = FOREST_FROM - 0.5 - hash(i, 3) * 1.4;
    const o = i % 3 === 0 ? makeRock(0.7 + hash(i, 5) * 0.6) : makeLog(1.4 + hash(i, 7), i);
    put(o, Math.cos(a) * rr, Math.sin(a) * rr, hash(i, 9) * Math.PI * 2);
    g.add(o);
  }
  return K.collapse(g, K.GROUND_AO, false);
}

/**
 * Разный рост и наклон.
 *
 * Клоны одной ёлки читаются посадкой: одна высота, одна ширина, все стоят
 * отвесно. Разброс по высоте — до полутора раз, по ширине — до трети, наклон —
 * до четырёх градусов: больше читалось бы бурей, меньше не видно.
 */
function vary(o: THREE.Object3D, seed: number): void {
  const w = 0.84 + hash(seed, 61) * 0.32;
  o.scale.set(w, 0.8 + hash(seed, 63) * 0.45, w);
  o.rotation.x = (hash(seed, 65) - 0.5) * 0.14;
  o.rotation.z = (hash(seed, 67) - 0.5) * 0.14;
}

/**
 * Лиственное дерево: ствол и три шапки кроны. Каждое третье — берёза: светлая
 * кора с тёмными отметинами видна в лесу издалека и сама по себе даёт глубину.
 */
function broadleaf(s: number, variant: number): THREE.Group {
  const g = new THREE.Group();
  const birch = variant % 3 === 0;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * s, 0.11 * s, 1.6 * s, 6), birch ? LEGACY.plaster : LEGACY.trunk);
  trunk.position.y = 0.8 * s;
  g.add(trunk);
  if (birch) {
    for (let k = 0; k < 4; k++) {
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.09 * s, 0.025 * s, 0.05 * s), LEGACY.dark);
      const a = hash(variant, k + 70) * Math.PI * 2;
      mark.position.set(Math.cos(a) * 0.08 * s, (0.3 + k * 0.28) * s, Math.sin(a) * 0.08 * s);
      mark.rotation.y = -a;
      g.add(mark);
    }
  }
  const crown = birch ? LEGACY.leaves2 : LEGACY.bush;
  for (let k = 0; k < 3; k++) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry((0.7 - k * 0.12) * s, 0), crown);
    const a = k * 2.1 + variant;
    const off = k === 0 ? 0 : 0.32 * s;
    b.position.set(Math.cos(a) * off, (1.7 + k * 0.45) * s, Math.sin(a) * off);
    b.scale.y = 0.82;
    b.rotation.y = a;
    g.add(b);
  }
  return g;
}

/** Сухостой: голый ствол с обломанными сучьями. Редкий — один на двадцать. */
function snag(s: number, variant: number): THREE.Group {
  const g = new THREE.Group();
  const h = 2.4 * s;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.035 * s, 0.12 * s, h, 5), LEGACY.woodDark);
  trunk.position.y = h / 2;
  g.add(trunk);
  for (let k = 0; k < 3; k++) {
    const len = (0.5 - k * 0.1) * s;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * s, 0.03 * s, len, 4), LEGACY.woodDark);
    const a = hash(variant, k + 80) * Math.PI * 2;
    b.position.set(Math.cos(a) * len * 0.4, h * (0.45 + k * 0.17), Math.sin(a) * len * 0.4);
    b.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
    g.add(b);
  }
  return g;
}

/**
 * Материал пятен тени: умножает то, что уже нарисовано под ним.
 *
 * Тот же приём, что у построек деревни (`materials.SHADE`), но свой экземпляр — и
 * не из недоверия к общему: взятый по имени, общий дописал бы себя в экспорт
 * чанка деревни, то есть в первую загрузку (то же самое про three — `paint.ADDITIVE`).
 */
const SHADE_MAT = new THREE.MeshBasicMaterial({
  vertexColors: true,
  blending: THREE.MultiplyBlending,
  transparent: true,
  depthWrite: false,
  fog: false,
  toneMapped: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

/**
 * Насколько темнее земля в середине пятна: контактное затемнение набора
 * (`kit.GROUND_AO`), взятое в полную силу — в кубе. Своего числа нет нарочно: тень
 * под деревом и затемнение у основания ствола — одна и та же тень, и холодная она
 * по тому же правилу палитры (синий темнеет меньше красного).
 */
const SHADE_MID = K.GROUND_AO.base.map((c) => c * c * c);

/**
 * Пятна тени на земле — одним мешем на всё, что их под собой держит: лес, деревья
 * поляны, палатку, колоду и место дома.
 *
 * Пятно умножает то, что уже нарисовано, поэтому нигде не даёт чёрного и одинаково
 * ложится на траву днём и ночью. Середина — `SHADE_MID`, край сходит в единицу.
 */
export class Shade {
  private pos: number[] = [];
  private col: number[] = [];

  add(x: number, z: number, rx: number, rz: number, rot = 0, y?: number): void {
    const seg = 10;
    const mid = SHADE_MID;
    const half = SHADE_MID.map((c) => c + (1 - c) * 0.5);
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const at = (a: number, k: number): number[] => {
      const lx = Math.cos(a) * rx * k;
      const lz = Math.sin(a) * rz * k;
      const px = x + lx * cos - lz * sin;
      const pz = z + lx * sin + lz * cos;
      return [px, (y ?? height(px, pz)) + 0.03, pz];
    };
    const center = [x, (y ?? height(x, z)) + 0.03, z];
    const put = (p: number[], c: readonly number[]): void => {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(c[0], c[1], c[2]);
    };
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const i0 = at(a0, 0.55);
      const i1 = at(a1, 0.55);
      const o0 = at(a0, 1);
      const o1 = at(a1, 1);
      put(center, mid);
      put(i1, half);
      put(i0, half);
      put(i0, half);
      put(i1, half);
      put(o1, [1, 1, 1]);
      put(i0, half);
      put(o1, [1, 1, 1]);
      put(o0, [1, 1, 1]);
    }
  }

  mesh(): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const m = new THREE.Mesh(geo, SHADE_MAT);
    m.name = 'shade';
    m.castShadow = false;
    m.receiveShadow = false;
    m.frustumCulled = false;
    return m;
  }
}

/**
 * Пятна тени под тем, что стоит на поляне: деревьями для рубки, палаткой, колодой
 * и местом дома. Места записаны в `glade.ts`, поэтому и пятна стоят там всегда —
 * под срубленным деревом остаётся тень пня, под разметкой дома — вытоптанная земля.
 */
export function groundShade(s: Shade): void {
  TREES.forEach((t, i) => s.add(t.x, t.z, 1.25, 1.25, hash(i, 91)));
  s.add(TENT.x, TENT.z, 1.9, 1.7, -TENT.rot);
  s.add(AXE_STUMP.x, AXE_STUMP.z, 0.75, 0.75);
  s.add(HOUSE.x, HOUSE.z, 2.3, 2.1, -HOUSE.rot);
}

/** Пятно тени под тем, кто ходит: оленем, волком, женщиной. Едет вместе с ним. */
export function blob(rx: number, rz: number): THREE.Mesh {
  const s = new Shade();
  s.add(0, 0, rx, rz, 0, -0.012);
  const m = s.mesh();
  m.name = 'blob';
  return m;
}

/**
 * Подлесок: сухая трава пучками, камни, валежник и кусты.
 *
 * РЕДКО, НО ВЕЗДЕ. Поляна без него — белый лист бумаги, на котором стоят
 * вещи; с ним у земли появляется масштаб, и шаг читается шагом. Пучок — три
 * травинки треугольниками, куст — две приплюснутые шапки, камень наполовину в
 * земле. Зимой трава — солома из-под снега, а цветов нет.
 *
 * Двумя мешами, и разделено это ветром: трава качается (`surface` роль
 * `tuft`), камни, валежник и кусты — нет. Всё остальное — одно тело с цветом в
 * вершинах, один вызов отрисовки на меш. Места, где ходят и работают, чисты:
 * очаг, палатка, колода, дом и место женщины у огня.
 */
export function undergrowth(): { sway: THREE.Mesh; still: THREE.Mesh } {
  const sway: K.Part[] = [];
  const still: K.Part[] = [];
  const keep: readonly [number, number, number][] = [
    [FIRE.x, FIRE.z, 1.9],
    [TENT.x, TENT.z, 2.1],
    [AXE_STUMP.x, AXE_STUMP.z, 1.0],
    [HOUSE.x, HOUSE.z, 2.5],
    [MATE_SPOT.x, MATE_SPOT.z, 0.8],
    [START.x, START.z, 0.6],
    ...TREES.map((t): [number, number, number] => [t.x, t.z, 0.55]),
  ];
  const free = (x: number, z: number): boolean => keep.every(([kx, kz, r]) => Math.hypot(x - kx, z - kz) > r);
  const tint = (hex: number): K.Paint => ({ mat: KIT.body, tint: new THREE.Color(hex) });
  const base = [0.62, 0.68, 0.74] as const;

  for (let i = 0; i < 380; i++) {
    const a = hash(i, 201) * Math.PI * 2;
    const r = i < 250 ? 1.6 + Math.sqrt(hash(i, 203)) * 11.4 : 13.2 + hash(i, 203) * 8;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!free(x, z)) continue;
    const y = height(x, z);
    const h = 0.18 + hash(i, 205) * 0.2;
    // Зима: из-под снега торчит сухая трава — солома, а не зелень.
    const paint = tint(mix(PALETTE.thatch, PALETTE.trunk, 0.15 + hash(i, 207) * 0.45));
    for (let b = 0; b < 3; b++) {
      const ba = hash(i, 209 + b) * Math.PI * 2;
      const lean = 0.25 + hash(i, 213 + b) * 0.35;
      const w = 0.035 + hash(i, 217) * 0.02;
      const geo = new THREE.BufferGeometry();
      const dx = Math.cos(ba);
      const dz = Math.sin(ba);
      const tip = h * (0.75 + 0.25 * hash(i, 219 + b));
      geo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [-dz * w, 0, dx * w, dz * w, 0, -dx * w, dx * lean * tip * 0.5, tip, dz * lean * tip * 0.5],
          3,
        ),
      );
      geo.computeVertexNormals();
      sway.push(K.place(geo, paint, x, y, z, undefined, { base, y0: y, y1: y + h }));
    }
    // Цветов зимой нет: пятно цвета у ног — сухие метёлки, а не лепестки.
  }

  for (let i = 0; i < 18; i++) {
    const a = hash(i, 231) * Math.PI * 2;
    const r = 5 + hash(i, 233) * 8.5;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!free(x, z)) continue;
    const s = 0.1 + hash(i, 235) * 0.16;
    const rock = tint(mix(PALETTE.stone, PALETTE.stoneDark, hash(i, 237)));
    const y = height(x, z);
    still.push(
      K.place(new THREE.DodecahedronGeometry(s, 0), rock, x, y + s * 0.35, z, { x: hash(i, 239) * 3, y: hash(i, 241) * 3 }, { base: [0.7, 0.72, 0.8], y0: y, y1: y + s }),
    );
  }

  for (let i = 0; i < 12; i++) {
    const a = hash(i, 251) * Math.PI * 2;
    const r = 7 + hash(i, 253) * 6;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!free(x, z)) continue;
    const len = 0.6 + hash(i, 255) * 0.7;
    const ya = hash(i, 257) * Math.PI;
    const wood = tint(mix(PALETTE.woodDark, PALETTE.trunk, hash(i, 259)));
    still.push(K.cyl(0.022, 0.035, len, wood, 5, x, height(x, z) + 0.04, z, { z: Math.PI / 2, y: ya }));
    // Сучок в сторону — палка читается веткой, а не черенком.
    still.push(K.cyl(0.01, 0.018, len * 0.35, wood, 4, x + Math.cos(ya) * len * 0.15, height(x, z) + 0.07, z - Math.sin(ya) * len * 0.15, { z: Math.PI / 2 - 0.6, y: ya + 0.8 }));
  }

  for (let i = 0; i < 16; i++) {
    const a = ((i + hash(i, 261) * 0.7) / 16) * Math.PI * 2;
    const r = 11.6 + hash(i, 263) * 2.2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    // Путь гостьи от опушки к огню не зарастает: она идёт по нему при игроке.
    if (!free(x, z) || Math.hypot(x - GUEST_FROM.x, z - GUEST_FROM.z) < 2.2) continue;
    const s = 0.8 + hash(i, 265) * 0.5;
    // Зима: куст под снегом — зелень едва проглядывает. Ярко-зелёный ком на белом
    // читался весной, забытой посреди зимы (поймано снимком первого кадра).
    const leaf = tint(mix(mix(PALETTE.bush, PALETTE.leaves, hash(i, 267)), PALETTE.snowflake, 0.62));
    const y = height(x, z);
    for (let k = 0; k < 2; k++) {
      const geo = new THREE.IcosahedronGeometry(0.42 * s * (1 - k * 0.25), 0);
      geo.scale(1.25, 0.7, 1);
      still.push(K.place(geo, leaf, x + k * 0.35 * s, y + 0.26 * s + k * 0.12, z + k * 0.2 * s, { y: a }, { base: [0.66, 0.7, 0.76], y0: y, y1: y + 0.6 * s }));
    }
  }

  const make = (parts: K.Part[], name: string): THREE.Mesh => {
    const m = K.assemble(parts);
    m.name = name;
    m.castShadow = false;
    return m;
  };
  return { sway: make(sway, 'grass'), still: make(still, 'litter') };
}

/**
 * Костёр: обод камней, поленья и пламя.
 *
 * Пламя — два именованных меша, как у костра деревни (`render/buildings.ts`), и
 * имена те же: по ним его находит сцена, чтобы шевелить. Светящееся склейке не
 * поддаётся и остаётся отдельным мешем — так и задумано.
 */
export function campfire(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'campfire';
  const parts: K.Part[] = [];
  const stone = K.paintOf('stoneDark');
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = 0.62 + hash(i, 2) * 0.08;
    parts.push(
      K.place(new THREE.DodecahedronGeometry(0.15 + hash(i, 4) * 0.05, 0), stone, Math.cos(a) * r, 0.1, Math.sin(a) * r, {
        x: hash(i, 6) * 3,
        y: hash(i, 8) * 3,
      }),
    );
  }
  // Зола внутри обода: без неё камни лежат прямо на траве и очаг не читается.
  parts.push(K.cyl(0.56, 0.6, 0.07, K.paintOf('trample'), 12, 0, 0.035, 0));
  for (let i = 0; i < 4; i++) {
    parts.push(
      K.cyl(0.065, 0.075, 0.86, K.paintOf('woodDark'), 5, 0, 0.14 + (i % 2) * 0.09, 0, {
        z: Math.PI / 2,
        y: (i / 4) * Math.PI + 0.3,
      }),
    );
  }
  const logs = K.assemble(parts);
  logs.name = 'hearth';
  g.add(logs);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.85, 6), LEGACY.fire);
  flame.position.y = 0.52;
  flame.name = 'flame';
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.52, 6), LEGACY.fireInner);
  inner.position.y = 0.42;
  inner.name = 'flameInner';
  g.add(flame, inner);
  put(g, FIRE.x, FIRE.z);
  return g;
}

/**
 * Палатка: наклонный навес из шкур на жердях.
 *
 * Единственная рукотворная вещь в кадре, кроме костра, и потому нарочно простая:
 * два ската, конёк, растяжки, шкура у входа. Она обязана читаться силуэтом с
 * другого конца поляны — там она двадцать пикселей.
 */
export function tent(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tent';
  const parts: K.Part[] = [];
  const pole = K.paintOf('timber');
  const skin = K.paintOf('hide');
  const w = 2.4;
  const d = 2.7;
  const h = 1.8;
  const foot = 0.12;

  // Конёк лежит на двух стойках — по одной у каждого торца. Стойки чуть
  // расходятся наружу, как их и ставят, чтобы шатёр не складывался.
  for (const sz of [-1, 1]) {
    parts.push(K.cyl(0.055, 0.07, h, pole, 5, 0, h / 2, (sz * d) / 2, { x: sz * 0.07 }));
  }
  // Сам конёк выступает за торцы: за него и вяжут растяжки.
  parts.push(K.cyl(0.05, 0.05, d + 0.5, pole, 5, 0, h, 0, { x: Math.PI / 2 }));

  /*
   * Скаты. Угол берётся из тех же w и h, а не подбирается на глаз: плита должна
   * лечь ровно от конька до земли. Знак поворота — не мелочь, на нём палатка
   * один раз уже развалилась в кучу досок: поворот на `+z` уводит ось +X вверх,
   * поэтому правому скату нужен минус.
   */
  const slope = Math.atan2(h - foot, w / 2);
  const len = Math.hypot(h - foot, w / 2);
  for (const sx of [-1, 1]) {
    parts.push(
      K.box(len, 0.07, d, skin, (sx * w) / 4, (h + foot) / 2, 0, { z: -sx * slope }, {
        base: [0.72, 0.74, 0.82],
        y0: foot,
        y1: h,
      }),
    );
  }
  // Задний торец закрыт наглухо, передний — открыт к огню.
  parts.push(
    K.gablePrism(w, foot, 0.08, h - foot, skin, 0, -d / 2 - 0.02, undefined, {
      base: [0.7, 0.72, 0.8],
      y0: 0,
      y1: h,
    }),
  );
  // Полог: откинут набок и подвязан к стойке — вход виден, а внутрь не заглянуть.
  parts.push(K.box(0.62, 1.3, 0.06, skin, -0.62, 0.68, d / 2 + 0.04, { z: 0.14 }));

  // Лежанка под навесом: лапник поверх жердей. Пустая палатка читается сараем.
  parts.push(K.box(1.5, 0.1, 0.9, K.paintOf('bush'), 0, 0.16, -0.2));
  for (const sx of [-1, 1]) parts.push(K.cyl(0.05, 0.05, 1.6, pole, 5, (sx * 0.62), 0.08, -0.2, { z: Math.PI / 2 }));

  // Камни, прижимающие край шкуры к земле.
  for (let i = 0; i < 6; i++) {
    const sx = i < 3 ? -1 : 1;
    parts.push(
      K.place(
        new THREE.DodecahedronGeometry(0.12, 0),
        K.paintOf('stone'),
        (sx * w) / 2 + sx * 0.06,
        0.07,
        (i % 3) * 0.95 - 0.95,
        { y: hash(i, 21) * 3 },
      ),
    );
  }
  g.add(K.assemble(parts));
  put(g, TENT.x, TENT.z, TENT.rot);
  return g;
}

/** Треугольник фронтона: тонкий, двусторонний, в плоскости ZY. */
function gableEnd(w: number, h: number, paint: K.Paint, x: number, y: number): K.Part {
  const geo = new THREE.BufferGeometry();
  const hw = w / 2;
  // Обе стороны двумя треугольниками: тело склейки рисует только лицевую.
  const p = [0, 0, -hw, 0, 0, hw, 0, h, 0, 0, 0, hw, 0, 0, -hw, 0, h, 0];
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.computeVertexNormals();
  return K.place(geo, paint, x, y, 0);
}

/**
 * Дом: сруб, в котором ровно столько брёвен, сколько в него положено.
 *
 * СЧЁТ ВИДЕН ПО БРЕВНУ, А НЕ ПО СТУПЕНЯМ. Каждое бревно лежит на своём месте по
 * номеру, и порядок не меняется: восемь венцов по четыре бревна, потом крыша —
 * десять плах, по очереди на оба ската. Ступени стройки (`craft.houseStage`) —
 * не шесть моделей, а то, докуда дошёл счёт: положивший двенадцать брёвен
 * видит двенадцать.
 *
 * Дверной проём — в стене, что смотрит на огонь: передние брёвна нижних шести
 * венцов лежат двумя половинами, и проём растёт вместе со стеной. Достроенный
 * дом закрывается пологом из шкуры — по нему видно, что дом готов, а не просто
 * покрыт.
 *
 * До первого бревна на месте стоят четыре колышка: цель видна с первого
 * захода, иначе «Ставить дом» над пустой травой читалось бы загадкой.
 *
 * Пересобирается целиком на каждой стройке — стройка это тап, а не кадр, — и
 * склеен в один меш, как палатка.
 */
export function house(logs: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'house';
  const parts: K.Part[] = [];
  const bark = K.paintOf('trunk');
  const end = K.paintOf('cut');
  const plank = K.paintOf('timber');
  const n = Math.max(0, Math.min(HOUSE_LOGS, Math.floor(logs)));
  const half = 1.15;
  const len = half * 2 + 0.36;
  const r = 0.11;
  const course = 0.2;
  const walls = 32;
  const doorHalf = 0.36;
  const doorCourses = 6;

  if (n === 0) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) parts.push(K.cyl(0.035, 0.045, 0.55, plank, 5, sx * half, 0.27, sz * half));
    }
  }

  for (let i = 0; i < Math.min(n, walls); i++) {
    const c = Math.floor(i / 4);
    const side = i % 4;
    if (side === 1 || side === 3) {
      // Боковые стены на полвенца выше: так брёвна сцепляются в углах, как у сруба.
      const x = side === 1 ? half : -half;
      const y = r + c * course + course / 2;
      parts.push(K.cyl(r, r, len, bark, 6, x, y, 0, { x: Math.PI / 2 }));
      for (const sz of [-1, 1]) parts.push(K.cyl(r * 0.85, r * 0.85, 0.02, end, 6, x, y, sz * (len / 2 + 0.01), { x: Math.PI / 2 }));
      continue;
    }
    const z = side === 2 ? half : -half;
    const y = r + c * course;
    if (side === 2 && c < doorCourses) {
      // Передняя стена с проёмом: полбревна слева и полбревна справа — это одно бревно.
      const piece = len / 2 - doorHalf;
      for (const sx of [-1, 1]) {
        parts.push(K.cyl(r, r, piece, bark, 6, sx * (doorHalf + piece / 2), y, z, { z: Math.PI / 2 }));
      }
    } else {
      parts.push(K.cyl(r, r, len, bark, 6, 0, y, z, { z: Math.PI / 2 }));
    }
    for (const sx of [-1, 1]) parts.push(K.cyl(r * 0.85, r * 0.85, 0.02, end, 6, sx * (len / 2 + 0.01), y, z, { z: Math.PI / 2 }));
  }

  const roof = n - walls;
  if (roof > 0) {
    const eave = r + 7 * course + course / 2 + r;
    const rise = 0.95;
    const run = half + 0.25;
    const slope = Math.atan2(rise, run);
    const width = Math.hypot(rise, run) / 5;
    // Фронтоны закрывают торцы, как только легла первая плаха: без них сквозь
    // крышу видно небо, и она читается навесом.
    for (const sx of [-1, 1]) parts.push(gableEnd(run * 2, rise, plank, sx * (half + 0.02), eave - 0.04));
    for (let j = 0; j < roof; j++) {
      const s = j % 2 === 0 ? 1 : -1;
      const t = (Math.floor(j / 2) + 0.5) / 5;
      parts.push(K.box(len + 0.3, 0.07, width + 0.02, plank, 0, eave + rise * t, s * run * (1 - t), { x: s * slope }));
    }
  }
  if (n >= HOUSE_LOGS) {
    parts.push(K.box(doorHalf * 2 - 0.04, doorCourses * course, 0.04, K.paintOf('hide'), 0, (doorCourses * course) / 2, half + 0.02));
  }

  g.add(K.assemble(parts));
  put(g, HOUSE.x, HOUSE.z, HOUSE.rot);
  return g;
}

/**
 * Дом сына: разметка, стопка досок рядом и то, что уже легло.
 *
 * Это не второй сруб, и строить его до конца никто не будет: на пятой доске
 * приходят из леса (`end.ts`). Поэтому он и выглядит начатым — четыре колышка,
 * первый венец и убывающая стопка тёса рядом: видно, что человек начал, и видно,
 * сколько он успел.
 *
 * Стопка убывает ровно на то, что легло: доска не берётся из воздуха, и обратное
 * было бы видно глазом на первом же кадре.
 */
export function frame(boards: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'frame';
  const parts: K.Part[] = [];
  const plank = K.paintOf('plank');
  const timber = K.paintOf('timber');
  const n = Math.max(0, Math.min(BOARDS, Math.floor(boards)));
  const half = 0.72;
  const len = half * 2 + 0.22;
  const t = 0.09;

  // Колышки по углам: разметка, с которой человек и начинает.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) parts.push(K.cyl(0.032, 0.042, 0.42, timber, 5, sx * half, 0.21, sz * half));
  }
  // Что легло: венец по кругу, доска за доской, против часовой от передней стены.
  for (let i = 0; i < n; i++) {
    const course = Math.floor(i / 4);
    const side = i % 4;
    const y = t / 2 + course * (t + 0.01);
    if (side === 1 || side === 3) {
      parts.push(K.box(t, t, len, timber, (side === 1 ? 1 : -1) * half, y, 0));
    } else {
      parts.push(K.box(len, t, t, timber, 0, y, (side === 2 ? 1 : -1) * half));
    }
  }
  // Стопка нетёсаных досок рядом: столько, сколько ещё не легло.
  for (let i = 0; i < BOARDS - n; i++) {
    parts.push(K.box(len, t * 0.8, 0.22, plank, half + 0.5, t * 0.4 + i * (t * 0.8 + 0.012), -0.1, { y: 0.08 }));
  }
  // Щепа: место, где тешут, видно и без человека.
  for (let i = 0; i < 5; i++) {
    const a = hash(i, 71) * Math.PI * 2;
    const r = 0.9 + hash(i, 73) * 0.4;
    parts.push(K.box(0.14, 0.02, 0.05, K.paintOf('cut'), Math.cos(a) * r, 0.01, Math.sin(a) * r, { y: hash(i, 77) * 3 }));
  }

  g.add(K.assemble(parts));
  put(g, SON_HOUSE.x, SON_HOUSE.z, Math.atan2(SON_HOUSE.x, -SON_HOUSE.z));
  return g;
}

/** Колода, в которой торчит топор. Сам топор — отдельным мешем: его забирают. */
export function chopBlock(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'block';
  const parts: K.Part[] = [
    K.cyl(0.42, 0.46, 0.62, K.paintOf('trunk'), 9, 0, 0.31, 0),
    K.cyl(0.4, 0.4, 0.04, K.paintOf('cut'), 9, 0, 0.63, 0),
  ];
  // Щепа вокруг колоды: место, где рубят, видно и без топора.
  for (let i = 0; i < 7; i++) {
    const a = hash(i, 31) * Math.PI * 2;
    const r = 0.55 + hash(i, 33) * 0.5;
    parts.push(
      K.box(0.16 + hash(i, 35) * 0.1, 0.03, 0.06, K.paintOf('cut'), Math.cos(a) * r, 0.02, Math.sin(a) * r, {
        y: hash(i, 37) * 3,
      }),
    );
  }
  g.add(K.assemble(parts));
  put(g, AXE_STUMP.x, AXE_STUMP.z);
  return g;
}

/**
 * Топор.
 *
 * Один и тот же меш и в колоде, и в руке: вещь одна, и выглядеть она обязана
 * одинаково. Рукоять лежит вдоль −Z, лезвие у дальнего конца — так его удобно
 * и втыкать в колоду, и держать перед камерой.
 */
export function axe(): THREE.Mesh {
  const parts: K.Part[] = [
    K.cyl(0.028, 0.034, 0.78, K.paintOf('wood'), 6, 0, 0, 0, { x: Math.PI / 2 }),
    // Обух и лезвие: два клина, лезвие светлее — металл на солнце иначе пропадает.
    K.box(0.09, 0.17, 0.1, K.paintOf('metal'), 0, 0.02, -0.36),
    K.box(0.05, 0.2, 0.13, K.paintOf('bone'), 0.035, 0.02, -0.43, { z: 0.12 }),
    K.box(0.05, 0.03, 0.09, K.paintOf('woodDark'), 0, 0, -0.28),
  ];
  const m = K.assemble(parts);
  m.name = 'axe';
  return m;
}

/** Пень на месте сваленного дерева. Деревня рисует такие же. */
export function stump(x: number, z: number, seed: number): THREE.Group {
  const g = makeStump(0.9 + hash(seed, 41) * 0.3);
  put(g, x, z, hash(seed, 43) * Math.PI * 2);
  return K.collapse(g, K.GROUND_AO);
}

/** Дерево, которое можно свалить: то же, что в лесу, но со своей тенью. */
export function choppable(index: number): THREE.Group {
  const t = TREES[index];
  const g = makeTree(2.3 + hash(index, 51) * 0.6, index);
  put(g, t.x, t.z, hash(index, 53) * Math.PI * 2);
  // Тот же разброс роста и наклона, что у леса: семь деревьев поляны — тоже не клоны.
  vary(g, index * 97 + 5);
  return K.collapse(g, K.GROUND_AO);
}

/** Высота земли в точке — сцене, чтобы ставить упавший ствол и щепу. */
export const groundAt = height;

/** Цвет отсвета костра — тот же, что у деревни. */
export const FIRE_LIGHT = PALETTE.fireLight;

/**
 * Краска по цвету палитры, у которого нет своего материала.
 *
 * Масть зверя, рог и тетива — цвета, а не материалы: сезон их не переливает, и
 * заводить под каждый по материалу значило бы платить лишним вызовом отрисовки
 * за оттенок. Тот же приём, каким деревня красит коня (`render/buildings.ts`).
 */
const coat = (hex: number): K.Paint => ({ ...K.paintOf('wood'), tint: new THREE.Color(hex) });

/** Масть оленя, светлое брюхо, рог и тёмная морда: четыре оттенка на всего зверя. */
const DEER_COAT = 0x8a6039;
const DEER_BELLY = 0xc2a077;
const DEER_HORN = PALETTE.bone;
const DEER_MUZZLE = 0x4a3527;

/** Высота холки: от неё считается весь зверь. Взрослый олень, не лань. */
const DEER_H = 1.24;

/** Туловище оленя вместе с хвостом. Ноги и голова — отдельными мешами: они ходят. */
function deerTorso(): THREE.Mesh {
  const c = coat(DEER_COAT);
  const parts: K.Part[] = [
    // Корпус — два бруса вместо одного: круп выше и уже груди, и от этого
    // силуэт читается оленем, а не ящиком на ножках.
    K.box(0.5, 0.54, 0.78, c, 0, DEER_H - 0.27, 0.16),
    K.box(0.44, 0.48, 0.5, c, 0, DEER_H - 0.24, -0.42),
    K.box(0.42, 0.2, 0.72, coat(DEER_BELLY), 0, DEER_H - 0.5, 0.14),
    // Хвост: короткий, светлый — единственное белое пятно, по нему зверя и
    // видно в траве, когда он повернулся спиной.
    K.box(0.12, 0.2, 0.08, coat(DEER_BELLY), 0, DEER_H - 0.16, -0.66),
  ];
  const m = K.assemble(parts);
  m.name = 'torso';
  return m;
}

/**
 * Шея, голова и рога — одним мешем с осью поворота в холке.
 *
 * Отдельно от корпуса потому, что голова — это и есть весь язык зверя: пасётся
 * (опущена), заметил (вскинута). Сказать то же самое корпусом нечем.
 */
function deerHead(): THREE.Mesh {
  const c = coat(DEER_COAT);
  const horn = coat(DEER_HORN);
  const parts: K.Part[] = [
    K.cyl(0.13, 0.17, 0.56, c, 6, 0, 0.24, 0.14, { x: -0.5 }),
    K.box(0.19, 0.21, 0.34, c, 0, 0.47, 0.36, { x: 0.24 }),
    K.box(0.13, 0.13, 0.18, coat(DEER_MUZZLE), 0, 0.42, 0.54, { x: 0.24 }),
  ];
  for (const sx of [-1, 1]) {
    // Глаз: большой и тёмный, с бликом. Олень смотрит боком — глаза у него на
    // боках головы, и именно по ним вскинутая голова читается живой, а не чучелом.
    parts.push(K.box(0.018, 0.042, 0.058, coat(PALETTE.dark), sx * 0.097, 0.494, 0.407, { x: 0.24 }));
    parts.push(K.box(0.02, 0.012, 0.016, coat(PALETTE.bone), sx * 0.1, 0.506, 0.418, { x: 0.24 }));
    // Уши торчат в стороны — их видно с любого ракурса, и вскинутая голова
    // читается даже когда зверь стоит боком.
    parts.push(K.box(0.05, 0.14, 0.09, c, sx * 0.12, 0.55, 0.3, { z: sx * 0.5 }));
    // Рог: ствол и два отростка. Больше отростков на восьми метрах не видно.
    parts.push(K.cyl(0.018, 0.026, 0.36, horn, 4, sx * 0.08, 0.72, 0.28, { z: sx * 0.32, x: -0.2 }));
    parts.push(K.cyl(0.014, 0.018, 0.22, horn, 4, sx * 0.17, 0.86, 0.34, { z: sx * 0.7 }));
    parts.push(K.cyl(0.014, 0.018, 0.2, horn, 4, sx * 0.14, 0.9, 0.16, { z: sx * 0.25, x: 0.6 }));
  }
  const m = K.assemble(parts);
  m.name = 'head';
  return m;
}

/** Пара ног с осью в суставе: их и качает шаг. `back` — задние, они толще. */
function deerLegs(back: boolean): THREE.Mesh {
  const c = coat(DEER_COAT);
  const parts: K.Part[] = [];
  const z = back ? -0.42 : 0.38;
  for (const sx of [-1, 1]) {
    parts.push(K.cyl(back ? 0.075 : 0.06, 0.045, 0.62, c, 5, sx * 0.17, -0.31, z));
    parts.push(K.box(0.08, 0.07, 0.13, coat(DEER_MUZZLE), sx * 0.17, -0.6, z + 0.02));
  }
  const m = K.assemble(parts);
  m.name = back ? 'legsBack' : 'legsFront';
  return m;
}

/**
 * Олень: корпус, голова и две пары ног.
 *
 * Четыре меша, а не один склеенный, и это единственное место на поляне, где
 * склейка отменена нарочно: зверь — единственное, что здесь движется само, и
 * неподвижный олень читается чучелом с первого взгляда. Плата — четыре вызова
 * отрисовки; при бюджете поляны в полтора десятка это ровно та цена, ради
 * которой бюджет и держат низким.
 *
 * Ставит его на место сцена: положение зверя живёт во времени кадров и в
 * сохранение не попадает (`hunt.ts`, шапка).
 */
export function deer(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'deer';
  const legsF = deerLegs(false);
  const legsB = deerLegs(true);
  legsF.position.y = DEER_H - 0.34;
  legsB.position.y = DEER_H - 0.34;
  const head = deerHead();
  head.position.set(0, DEER_H - 0.2, 0.42);
  g.add(deerTorso(), head, legsF, legsB);
  return g;
}

/**
 * Туша: тот же зверь, лежащий на боку.
 *
 * Одним мешем — лежащему двигать нечем. Ноги вытянуты и подняты: лежащий на
 * боку олень с ногами «как стоял» читается спящим, а спящего игрок пойдёт
 * будить.
 */
export function carcass(): THREE.Mesh {
  const c = coat(DEER_COAT);
  const parts: K.Part[] = [
    K.box(0.54, 0.5, 0.76, c, 0, 0.26, 0.14, { z: Math.PI / 2 }),
    K.box(0.48, 0.44, 0.48, c, 0, 0.24, -0.44, { z: Math.PI / 2 }),
    K.box(0.2, 0.72, 0.2, coat(DEER_BELLY), 0.16, 0.2, 0.12, { z: Math.PI / 2 }),
    // Шея и голова лежат в траве, рога торчат вверх — по ним тушу и видно.
    K.cyl(0.13, 0.17, 0.5, c, 6, 0, 0.16, 0.6, { x: 1.35 }),
    K.box(0.19, 0.2, 0.32, c, 0, 0.11, 0.88, { x: 1.5, z: 0.4 }),
    K.cyl(0.02, 0.028, 0.4, coat(DEER_HORN), 4, 0.06, 0.3, 0.94, { x: -0.5, z: 0.5 }),
    K.cyl(0.016, 0.02, 0.26, coat(DEER_HORN), 4, 0.2, 0.44, 0.98, { z: 1.0 }),
  ];
  for (const sx of [-1, 1]) {
    for (const z of [-0.4, 0.36]) {
      parts.push(K.cyl(0.07, 0.045, 0.6, c, 5, 0.3, 0.34 + sx * 0.12, z, { z: 1.1 + sx * 0.24 }));
    }
  }
  const m = K.assemble(parts);
  m.name = 'carcass';
  return m;
}

/**
 * Стрела: древко, наконечник и оперение.
 *
 * Лежит вдоль −Z, наконечником вперёд — тем же концом, каким смотрит камера,
 * поэтому летящей стреле не нужно ни разворота, ни поправки: направление взгляда
 * и есть её поворот.
 */
export function arrow(): THREE.Mesh {
  const parts: K.Part[] = [
    K.cyl(0.008, 0.008, 0.68, K.paintOf('wood'), 5, 0, 0, 0, { x: Math.PI / 2 }),
    K.cone(0.017, 0.07, K.paintOf('metal'), 5, 0, 0, -0.37, { x: -Math.PI / 2 }),
  ];
  for (let i = 0; i < 3; i++) {
    parts.push(K.box(0.004, 0.05, 0.11, K.paintOf('bone'), 0, 0, 0.29, { z: (i / 3) * Math.PI * 2 }));
  }
  const m = K.assemble(parts);
  m.name = 'arrow';
  m.castShadow = false;
  return m;
}

/**
 * Лук: дуга и тетива.
 *
 * Дуга набрана короткими отрезками по окружности — гнуть геометрию тут нечем, а
 * восьми отрезков хватает, чтобы на вытянутой руке она читалась дугой, а не
 * многоугольником. Плечи лука лежат в плоскости XY, тетива идёт по хорде.
 */
export function bow(): THREE.Mesh {
  const wood = coat(0x7d5a34);
  const string = coat(0xd8cdb4);
  const parts: K.Part[] = [];
  const r = 0.62;
  const span = 2.0;
  const n = 8;
  // Дуга в плоскости YZ: плечи уходят вверх и вниз, а концы наклонены к
  // стрелку — тетива обязана оказаться с его стороны, иначе лук вывернут.
  for (let i = 0; i < n; i++) {
    const a = -span / 2 + (span * (i + 0.5)) / n;
    parts.push(
      K.cyl(0.013, 0.016, (r * span) / n + 0.012, wood, 4, 0, Math.sin(a) * r, r * (1 - Math.cos(a)), { x: a }),
    );
  }
  const tipY = Math.sin(span / 2) * r;
  const tipZ = r * (1 - Math.cos(span / 2));
  parts.push(K.cyl(0.005, 0.005, tipY * 2, string, 3, 0, 0, tipZ));
  const m = K.assemble(parts);
  m.name = 'bow';
  m.castShadow = false;
  return m;
}

/**
 * Шкура волка, светлое подпалое брюхо и тёмная морда.
 *
 * Шкура светлее, чем была: тёмно-серый волк под луной сливался с травой в одно
 * пятно. Серый волк и есть светло-серый — ночью он ловит тот немногий свет, что
 * есть, а днём остаётся волком, а не собакой.
 */
const WOLF_COAT = 0x6e685f;
const WOLF_BELLY = 0x9a9285;
const WOLF_MUZZLE = 0x2f2b26;

/** Высота в холке. Заметно ниже оленя (1.24) — и по силуэту это первое, что видно. */
const WOLF_H = 0.84;

/**
 * Волк: корпус с головой и четыре ноги.
 *
 * ДВА МЕША, А НЕ ЧЕТЫРЕ, КАК У ОЛЕНЯ, И ЭТО РАЗНИЦА ПО ДЕЛУ, А НЕ ЭКОНОМИЯ.
 * Оленю голова отведена отдельным мешем потому, что он **стоит** — пасётся,
 * поднимает голову, — и неподвижный склеенный зверь читался бы чучелом. Волк
 * не стоит никогда: он либо рысит по кругу, либо бросается. Голову он при этом
 * несёт низко и ровно — это и есть весь его силуэт, и сказать ею нечего.
 *
 * Ноги одним мешем на все четыре: пёс идёт **намётом**, то есть передняя пара и
 * задняя ходят вместе, а не враздрай, как у пасущегося оленя. Значит одного
 * поворота хватает на всё, и это не упрощение, а то, как оно и бывает.
 *
 * Плата — два вызова отрисовки на волка днём и три ночью, когда горят глаза:
 * шесть на ночную пару. Замер (`prologue:report`) — восемнадцать вызовов на
 * ночную поляну со стаей в кадре против семнадцати на дневную с тушей.
 */
export function wolf(glow: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.name = 'wolf';
  const c = coat(WOLF_COAT);
  const belly = coat(WOLF_BELLY);
  const dark = coat(WOLF_MUZZLE);
  // Жёлтый глаз днём — янтарь из палитры, смесью соломы и руды; зрачок тёмной щелью.
  const amber = coat(mix(PALETTE.thatch, PALETTE.ore, 0.45));

  const body: K.Part[] = [
    // Корпус — два бруса: грудь выше и шире паха. У волка это наоборот, чем у
    // оленя, и разница видна силуэтом даже в тридцать пикселей.
    K.box(0.34, 0.38, 0.58, c, 0, WOLF_H - 0.2, 0.1),
    K.box(0.3, 0.32, 0.42, c, 0, WOLF_H - 0.24, -0.36),
    K.box(0.28, 0.14, 0.56, belly, 0, WOLF_H - 0.38, 0.08),
    // Шея вперёд и вниз: голова на уровне спины, а не над ней.
    K.cyl(0.12, 0.14, 0.34, c, 6, 0, WOLF_H - 0.1, 0.36, { x: -1.15 }),
    K.box(0.17, 0.17, 0.26, c, 0, WOLF_H - 0.12, 0.56),
    K.box(0.1, 0.1, 0.18, dark, 0, WOLF_H - 0.16, 0.72),
    // Хвост — полено книзу: поднятый хвост читается собакой, опущенный волком.
    K.cyl(0.06, 0.03, 0.42, c, 5, 0, WOLF_H - 0.3, -0.66, { x: 0.9 }),
  ];
  for (const sx of [-1, 1]) {
    // Уши стоймя и врозь: по ним зверя видно с любой стороны.
    body.push(K.box(0.04, 0.13, 0.08, c, sx * 0.08, WOLF_H + 0.01, 0.5, { z: sx * 0.28 }));
    body.push(K.box(0.042, 0.028, 0.012, amber, sx * 0.05, WOLF_H - 0.075, 0.694));
    body.push(K.box(0.012, 0.026, 0.006, dark, sx * 0.05, WOLF_H - 0.075, 0.7));
  }
  const torso = K.assemble(body);
  torso.name = 'torso';

  const legs: K.Part[] = [];
  for (const sx of [-1, 1]) {
    for (const z of [-0.32, 0.28]) {
      legs.push(K.cyl(0.05, 0.035, 0.46, c, 5, sx * 0.12, -0.23, z));
      legs.push(K.box(0.06, 0.05, 0.11, dark, sx * 0.12, -0.44, z + 0.02));
    }
  }
  const feet = K.assemble(legs);
  feet.name = 'legs';
  feet.position.y = WOLF_H - 0.38;

  /*
   * Глаза ночью: два мягких пятна света одним мешем на пару.
   *
   * Светящееся склейке не поддаётся — у него свой материал, не тело с цветом в
   * вершинах, — поэтому глаза отдельно, ровно как пламя костра. Пятно, а не
   * точка: точка в два пикселя на опушке читалась соринкой, а пятно — взглядом из
   * темноты. Цвет — жёлтое нутро огня: глаза не светятся сами, они возвращают
   * костёр. Смотрят вперёд, вдоль морды: глаза зверя отсвечивают, когда он глядит
   * на огонь и на человека у огня, а боком — нет. Днём их нет (сцена гасит), днём
   * у волка жёлтые глаза в самой морде; платит за пятна ночь — вызов на волка.
   */
  const eyePos: number[] = [];
  const eyeUv: number[] = [];
  const spot = 0.07;
  for (const sx of [-1, 1]) {
    for (const [qx, qy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      eyePos.push(sx * 0.05 + qx * spot, WOLF_H - 0.075 + qy * spot, 0.708);
      eyeUv.push((qx + 1) / 2, (qy + 1) / 2);
    }
  }
  const eyeGeo = new THREE.BufferGeometry();
  eyeGeo.setAttribute('position', new THREE.Float32BufferAttribute(eyePos, 3));
  eyeGeo.setAttribute('uv', new THREE.Float32BufferAttribute(eyeUv, 2));
  const eyes = new THREE.Mesh(eyeGeo, glow);
  eyes.name = 'eyes';
  eyes.castShadow = false;
  eyes.visible = false;
  g.add(torso, feet, eyes);
  return g;
}

/** Сколько искр над костром. */
const SPARKS = 30;

/**
 * Искры: светящиеся точки, летящие от огня вверх и гаснущие на лету.
 *
 * ВРЕМЯ СЦЕНЫ ЦЕЛИКОМ И НИ ОДНОЙ СЛУЧАЙНОСТИ. Каждая искра ходит по своему кругу —
 * взлетела, закрутилась, погасла, родилась снова, — и где она сейчас, выводится из
 * времени кадра и `glade.hash` её номера. Ничего не копится и никуда не пишется.
 * Одна система точек — один вызов отрисовки, и только пока огонь горит. Днём
 * искры почти не видны, и это правда: их видно в темноте.
 */
export class Sparks {
  readonly points: THREE.Points;
  private mat: THREE.PointsMaterial;
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private hot = new THREE.Color(PALETTE.fireInner);
  private cool = new THREE.Color(PALETTE.fire);

  constructor(map: THREE.Texture) {
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('color', this.col);
    this.mat = new THREE.PointsMaterial({
      size: 0.07,
      map,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: ADDITIVE,
      fog: false,
      toneMapped: false,
    });
    // Где искры бывают: над огнём до четырёх метров и в полутора в стороны, куда
    // сносит ветер. Сфера считается один раз по крайним точкам: каждый кадр её
    // пересчитывать незачем, а без неё искры рисовались бы и с огнём за спиной.
    const p = this.pos.array as Float32Array;
    p.set([FIRE.x, 0.3, FIRE.z, FIRE.x, 4, FIRE.z, FIRE.x + 1.7, 2, FIRE.z, FIRE.x - 1.7, 2, FIRE.z, FIRE.x, 2, FIRE.z + 1.7, FIRE.x, 2, FIRE.z - 1.7]);
    geo.computeBoundingSphere();
    this.points = new THREE.Points(geo, this.mat);
    this.points.name = 'sparks';
  }

  /**
   * `s` — время сцены в секундах, `glow` — яркость (ночью выше), `size` — высота
   * огня: полный очаг бросает искры выше. Ветер сносит их тем сильнее, чем выше.
   */
  update(s: number, on: boolean, glow: number, windX: number, windZ: number, size: number): void {
    this.points.visible = on;
    if (!on) return;
    const p = this.pos.array as Float32Array;
    const c = this.col.array as Float32Array;
    for (let i = 0; i < SPARKS; i++) {
      const period = 1.1 + hash(i, 501) * 1.4;
      const k = (s / period + hash(i, 503)) % 1;
      const rise = (1.2 + hash(i, 505) * 1.8) * size;
      const a = hash(i, 507) * Math.PI * 2 + s * (1.4 + hash(i, 509) * 2);
      const r = 0.05 + k * (0.16 + hash(i, 511) * 0.22);
      p[i * 3] = FIRE.x + Math.cos(a) * r + windX * k * k * 1.4;
      p[i * 3 + 1] = 0.45 + k * rise;
      p[i * 3 + 2] = FIRE.z + Math.sin(a) * r + windZ * k * k * 1.4;
      const fade = Math.min(1, k / 0.08) * (1 - k) ** 1.7 * glow;
      c[i * 3] = (this.hot.r + (this.cool.r - this.hot.r) * k) * fade;
      c[i * 3 + 1] = (this.hot.g + (this.cool.g - this.hot.g) * k) * fade;
      c[i * 3 + 2] = (this.hot.b + (this.cool.b - this.hot.b) * k) * fade;
    }
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

/** Сколько капель и снежинок в поле. Поровну: одна непогода за раз. */
const DROPS = 300;

/** Докуда стоит поле: поляна вся в нём, и ходить из-под дождя некуда. */
const DROP_R = 15;

/** Докуда поднимается. Выше не видно — там туман и кроны. */
const DROP_TOP = 11;

/**
 * Дождевая черта: длина и снос ветром, метры.
 *
 * ДОЖДЬ — ЧЕРТОЙ, А НЕ ТОЧКОЙ. Первой версией капля была точкой, как снежинка, и
 * на снимке дождь вышел редкими бледными квадратами — то есть снегом. Дождь
 * глаз узнаёт по штриху: капля летит быстрее, чем длится кадр, и видна следом.
 */
const RAIN_LEN = 0.55;
const RAIN_SLANT = 0.08;

/**
 * Полуширина черты — доля расстояния до глаза.
 *
 * ЧЕРТА — ДВА ТРЕУГОЛЬНИКА, А НЕ ОТРЕЗОК ЛИНИИ, И ЭТО ПРО ВЕС, А НЕ ПРО ВИД.
 * Отрезками (`THREE.LineSegments`) дождь выглядел ровно так, как надо, но линии
 * в игре не рисует больше никто, и их классы уехали в общий чанк `three` — то
 * есть в первую загрузку, на 0.6 КБ, ради дождя в режиме, куда игрок может не
 * зайти ни разу. Поймала это опись сборки. Треугольники рисует тот же `Mesh`,
 * что и всё остальное.
 *
 * Ширина растёт с расстоянием нарочно: так черта держит полтора-два пикселя и
 * у лица, и у опушки, а не толстеет вблизи в полосу.
 */
const RAIN_WIDTH = 0.0008;

/** Ближе этого к глазу черту не рисуем: у лица это не капля, а царапина на стекле. */
const RAIN_NEAR = 1.2;

/**
 * Размер снежинки — в пикселях экрана, а не в метрах.
 *
 * Снежинка в метрах у самого глаза вырастала в белый квадрат шириной в палец —
 * на снимке 375 px такой и стоял. Снег у лица не должен закрывать поляну;
 * постоянный размер на экране это и даёт, а издалека снег и так мелкий.
 */
const FLAKE_PX = 3;

/**
 * Дождь и снег.
 *
 * ДВЕ СИСТЕМЫ, НО ВИДНА ВСЕГДА ОДНА — И ВЫЗОВ ОТРИСОВКИ ОДИН. Дождь — черты из
 * треугольников, развёрнутые к взгляду; снег — точки. Одной системой их не
 * свести: у точки и черты разная геометрия. Зато погода одна за раз, и
 * невидимая система не рисуется вовсе.
 *
 * ПОЛЕ СТОИТ В МИРЕ, А НЕ ЕДЕТ ЗА КАМЕРОЙ, и это стоило одной строки, а даёт
 * всё: капли, привязанные к голове, не отстают от шага, поэтому идти под таким
 * дождём — как идти в стеклянной колбе. Поляна тринадцать метров в радиусе, поле
 * пятнадцать — накрывает целиком и без хитростей.
 *
 * Разброс — `glade.hash`, как весь остальной мир этой папки. `Math.random`
 * здесь нет ни одного.
 */
export class Precip {
  readonly root = new THREE.Group();
  private rain: THREE.Mesh;
  private flakes: THREE.Points;
  private rainMat: THREE.MeshBasicMaterial;
  private snowMat: THREE.PointsMaterial;
  /** Своя скорость у каждой капли: одинаковые падают стеной. */
  private speed = new Float32Array(DROPS);
  /** Где висит капля: по земле место постоянное, падает только высота. */
  private dropX = new Float32Array(DROPS);
  private dropY = new Float32Array(DROPS);
  private dropZ = new Float32Array(DROPS);

  constructor() {
    const dots = new Float32Array(DROPS * 3);
    for (let i = 0; i < DROPS; i++) {
      const a = hash(i, 3) * Math.PI * 2;
      const r = Math.sqrt(hash(i, 5)) * DROP_R;
      this.dropX[i] = Math.cos(a) * r;
      this.dropY[i] = hash(i, 7) * DROP_TOP;
      this.dropZ[i] = Math.sin(a) * r;
      dots.set([this.dropX[i], this.dropY[i], this.dropZ[i]], i * 3);
      this.speed[i] = 0.7 + hash(i, 9) * 0.6;
    }
    // Шесть вершин на черту: два треугольника без индекса. Раскладывает их
    // `update`, развернув к взгляду, — до первого кадра они вырождены в ноль.
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 18), 3));
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dots, 3));
    // Туман ни дождь, ни снег не берут: они и так у самого лица, а выцветшая
    // капля читается грязью на стекле.
    this.rainMat = new THREE.MeshBasicMaterial({
      color: PALETTE.fog,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.snowMat = new THREE.PointsMaterial({
      color: PALETTE.snowflake,
      size: FLAKE_PX,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.rain = new THREE.Mesh(rainGeo, this.rainMat);
    this.rain.castShadow = false;
    this.rain.receiveShadow = false;
    this.flakes = new THREE.Points(dotGeo, this.snowMat);
    for (const o of [this.rain, this.flakes]) {
      o.frustumCulled = false;
      o.visible = false;
      this.root.add(o);
    }
  }

  /**
   * Подвинуть непогоду.
   *
   * `wet` — насколько она вступила: 0 — сухо, 1 — в полную силу. Плавно, а не
   * рывком: дождь, начавшийся в один кадр, читается сбоем картинки. `ex`, `ez`
   * и `yaw` — где стоит и куда смотрит глаз: к нему черты и разворачиваются.
   */
  update(dt: number, mode: 'rain' | 'snow', wet: number, ex: number, ez: number, yaw: number): void {
    const on = wet > 0.01;
    this.rain.visible = on && mode === 'rain';
    this.flakes.visible = on && mode === 'snow';
    if (!on) return;
    if (mode === 'rain') {
      this.rainMat.opacity = wet * 0.6;
      const attr = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      const p = attr.array as Float32Array;
      // Правая ось взгляда по земле: вдоль неё черта и получает ширину.
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      for (let i = 0; i < DROPS; i++) {
        let y = this.dropY[i] - this.speed[i] * 13 * dt;
        if (y < 0) y += DROP_TOP;
        this.dropY[i] = y;
        const x = this.dropX[i];
        const z = this.dropZ[i];
        const d = Math.hypot(x - ex, z - ez);
        const hw = d < RAIN_NEAR ? 0 : RAIN_WIDTH * d;
        const ox = rx * hw;
        const oz = rz * hw;
        const tx = x - RAIN_SLANT;
        const ty = y + RAIN_LEN;
        const o = i * 18;
        p[o] = x - ox;
        p[o + 1] = y;
        p[o + 2] = z - oz;
        p[o + 3] = x + ox;
        p[o + 4] = y;
        p[o + 5] = z + oz;
        p[o + 6] = tx + ox;
        p[o + 7] = ty;
        p[o + 8] = z + oz;
        p[o + 9] = x - ox;
        p[o + 10] = y;
        p[o + 11] = z - oz;
        p[o + 12] = tx + ox;
        p[o + 13] = ty;
        p[o + 14] = z + oz;
        p[o + 15] = tx - ox;
        p[o + 16] = ty;
        p[o + 17] = z - oz;
      }
      attr.needsUpdate = true;
      return;
    }
    this.snowMat.opacity = wet * 0.85;
    const attr = this.flakes.geometry.attributes.position as THREE.BufferAttribute;
    const p = attr.array as Float32Array;
    for (let i = 0; i < DROPS; i++) {
      p[i * 3 + 1] -= this.speed[i] * 1.1 * dt;
      // Снег сносит боком, а дождь идёт своей чертой: у капли своя инерция.
      p[i * 3] += Math.sin(p[i * 3 + 1] * 0.7 + i) * dt * 0.4;
      if (p[i * 3 + 1] < 0) p[i * 3 + 1] += DROP_TOP;
    }
    attr.needsUpdate = true;
  }

  dispose(): void {
    this.rain.geometry.dispose();
    this.flakes.geometry.dispose();
    this.rainMat.dispose();
    this.snowMat.dispose();
  }
}
