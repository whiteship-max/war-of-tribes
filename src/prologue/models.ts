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
import { AXE_STUMP, FIRE, GLADE_R, TENT, TREES } from './glade';

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

const hash = (a: number, b: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

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
export function forest(): THREE.Group {
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
      const tree = far ? makeFarTree(scale, n) : makeTree(scale, n);
      put(tree, x, z, hash(i, r) * Math.PI * 2);
      g.add(tree);
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
  return K.collapse(g, K.GROUND_AO);
}

/** Высота земли в точке — сцене, чтобы ставить упавший ствол и щепу. */
export const groundAt = height;

/** Цвет отсвета костра — тот же, что у деревни. */
export const FIRE_LIGHT = PALETTE.fireLight;
