/**
 * Люди в кадре: женщина у огня и руки того, из чьих глаз смотрит камера.
 *
 * СВОЙ ФАЙЛ, А НЕ СТРОКИ В `models.ts`, И ПРИЧИНА В МАТЕРИАЛЕ. Всё остальное на
 * поляне — тело с цветом в вершинах, склеенное набором деталей (`render/kit.ts`),
 * и развёртки у него нет вовсе: склейка её выбрасывает. Люди — единственные, у
 * кого она есть: лицо, вышивка, мех и рукав лежат рисунком на холсте
 * (`paint.ts`), и собирать их приходится со своей развёрткой и своей склейкой.
 *
 * ЛИЦО ЖИВЁТ ПЕРЕКЛАДКОЙ РАЗВЁРТКИ, А НЕ ПЕРЕРИСОВКОЙ. Все выражения лежат в
 * атласе сразу; вершины лица идут первыми в склейке, и сменить выражение —
 * значит сдвинуть их развёртку на соседнюю клетку (`setMood`): полторы сотни
 * чисел, а не загрузка холста.
 *
 * Вызовов у женщины столько же, сколько было, — два: тело и руки. Руки игрока —
 * по вызову на руку, и только пока в них что-то есть.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ATLAS_W,
  FACE_CELL,
  MOOD_CALM,
  REGION,
  SLEEVE,
  SLEEVE_CLOTH,
  SLEEVE_SKIN,
  bake,
  faceRect,
  rectUv,
  swatchUv,
  personAtlas,
  type Look,
  type Mood,
} from './paint';

/** Где у женщины плечи: от них висят руки, и вокруг них они поворачиваются. */
export const WOMAN_SHOULDER = 1.3;

/** Где голова и какой она величины. От неё считаются лицо, волосы и повязка. */
const HEAD_Y = 1.47;
const HEAD_R = 0.114;

/**
 * Какую часть головы занимает лицо: ±80° вокруг носа, от макушки до подбородка.
 *
 * Шире — и черты у краёв клетки сжимались бы в щель; уже — и по бокам лица
 * появлялась бы голая сфера. Клетка атласа ложится ровно на этот кусок сферы, и
 * черты рисунка (`paint.drawFace`) расставлены под него.
 */
const FACE_PHI = (160 * Math.PI) / 180;
const FACE_T0 = 0.16 * Math.PI;
const FACE_T1 = 0.82 * Math.PI;

type Uv = { u0: number; u1: number; v0: number; v1: number };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

/** Поставить деталь на место — развёртку это не трогает. */
function set(geo: THREE.BufferGeometry, x: number, y: number, z: number, rot?: { x?: number; y?: number; z?: number }): THREE.BufferGeometry {
  _e.set(rot?.x ?? 0, rot?.y ?? 0, rot?.z ?? 0);
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  _m.compose(_v, _q, _s);
  geo.applyMatrix4(_m);
  return geo;
}

/** Уложить развёртку детали в прямоугольник холста. */
function into(geo: THREE.BufferGeometry, r: Uv): THREE.BufferGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
  return geo;
}

/** Вся деталь — одним цветом образца. */
function flat(geo: THREE.BufferGeometry, [u, v]: readonly [number, number]): THREE.BufferGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  return geo;
}

/** Склеить детали с развёрткой в одну геометрию. */
function weld(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!out) throw new Error('people: не склеились детали');
  return out;
}

/** Что сцене нужно знать о теле, чтобы менять выражение. */
interface Face {
  count: number;
  base: Float32Array;
  mood: Mood;
}

/**
 * Женщина у огня: гостья, а потом жена.
 *
 * Силуэт прежний — понёва до пят, рубаха, меховая накидка, голова с повязкой и
 * коса за спиной; по нему её видно от опушки. Нового — рисунок: лицо с глазами,
 * бровями, губами и румянцем, вышивка по вороту, груди и обшлагам, пояс, подол,
 * передник и мех. Накидка открыта спереди — иначе вышивку на груди закрыла бы.
 *
 * `look` — облик гостьи (`paint.LOOKS`), `seed` — её номер: разброс прядей и
 * веснушек у каждой свой. Лицом вдоль +Z, как олень и волк.
 */
export function woman(look: Look, seed: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'woman';
  const skin = skinOf(look, seed);
  const mat = skin.mat;

  const parts: THREE.BufferGeometry[] = [];
  // Лицо — первым: его вершины идут первыми в склейке, и выражение переписывает ровно их.
  const face = new THREE.SphereGeometry(HEAD_R * 1.004, 22, 14, Math.PI / 2 - FACE_PHI / 2, FACE_PHI, FACE_T0, FACE_T1 - FACE_T0);
  into(face, rectUv(faceRect(MOOD_CALM)));
  const faceCount = face.attributes.position.count;
  parts.push(set(face, 0, HEAD_Y, 0));
  const hair = swatchUv('hair');
  parts.push(set(flat(new THREE.SphereGeometry(HEAD_R, 14, 10, Math.PI / 2 + FACE_PHI / 2, Math.PI * 2 - FACE_PHI), hair), 0, HEAD_Y, 0));
  parts.push(set(flat(new THREE.SphereGeometry(HEAD_R * 1.002, 14, 3, Math.PI / 2 - FACE_PHI / 2, FACE_PHI, 0, FACE_T0 + 0.01), hair), 0, HEAD_Y, 0));
  parts.push(
    set(flat(new THREE.SphereGeometry(HEAD_R * 0.996, 14, 3, Math.PI / 2 - FACE_PHI / 2, FACE_PHI, FACE_T1 - 0.01, Math.PI - FACE_T1 + 0.01), swatchUv('neck')), 0, HEAD_Y, 0),
  );
  // Волосы объёмом: шапка чуть больше головы, сдвинута к затылку. Край её ложится
  // по нарисованной линии волос — пряди на лице продолжают её вниз.
  parts.push(set(flat(new THREE.SphereGeometry(HEAD_R * 1.07, 18, 6, 0, Math.PI * 2, 0, 0.34 * Math.PI), hair), 0, HEAD_Y - 0.004, -0.008));
  // Повязка по лбу — у линии волос, поверх шапки.
  parts.push(
    set(flat(new THREE.CylinderGeometry(HEAD_R * 0.9, HEAD_R * 0.92, 0.026, 20, 1, true), swatchUv('band')), 0, HEAD_Y + HEAD_R * 0.63, -0.004),
  );
  // Коса за спиной: по ней женщину узнают и со спины.
  const dark = swatchUv('hairDark');
  parts.push(set(flat(new THREE.CylinderGeometry(0.03, 0.017, 0.5, 6), dark), 0, 1.2, -HEAD_R - 0.03, { x: 0.1 }));
  for (let k = 0; k < 4; k++) {
    parts.push(set(flat(new THREE.SphereGeometry(0.034 - k * 0.004, 6, 4), hair), 0, 1.4 - k * 0.12, -HEAD_R - 0.012 - k * 0.012));
  }
  parts.push(set(flat(new THREE.CylinderGeometry(0.05, 0.06, 0.12, 10), swatchUv('neck')), 0, 1.36, 0));
  // Накидка: мех от плеч, открытая спереди на шестьдесят градусов.
  const cape = new THREE.CylinderGeometry(0.13, 0.26, 0.22, 20, 1, true, Math.PI / 6, (Math.PI * 5) / 3);
  into(cape, rectUv(REGION.fur));
  parts.push(set(cape, 0, 1.23, 0));
  // Рубаха: шов развёртки на спине, вышивка по груди — спереди.
  const shirt = new THREE.CylinderGeometry(0.15, 0.19, 0.44, 18, 1, false);
  into(shirt, rectUv({ x: REGION.shirt.x, y: REGION.shirt.y, w: REGION.shirt.w, h: 100 }));
  parts.push(set(shirt, 0, 1.1, 0, { y: Math.PI }));
  const belt = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 20, 1, true);
  into(belt, rectUv({ x: REGION.skirt.x, y: REGION.skirt.y, w: REGION.skirt.w, h: 10 }));
  parts.push(set(belt, 0, 0.87, 0, { y: Math.PI }));
  const skirt = new THREE.CylinderGeometry(0.19, 0.33, 0.86, 20, 1, true);
  into(skirt, rectUv({ x: REGION.skirt.x, y: REGION.skirt.y + 10, w: REGION.skirt.w, h: REGION.skirt.h - 10 }));
  parts.push(set(skirt, 0, 0.43, 0, { y: Math.PI }));

  const geo = weld(parts);
  const body = new THREE.Mesh(geo, mat);
  body.name = 'body';
  body.castShadow = true;
  body.receiveShadow = true;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const base = new Float32Array(faceCount);
  for (let i = 0; i < faceCount; i++) base[i] = uv.getX(i);
  body.userData.face = { count: faceCount, base, mood: MOOD_CALM } satisfies Face;

  const hands: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const sleeve = new THREE.CylinderGeometry(0.044, 0.036, 0.5, 10, 1, true);
    into(sleeve, rectUv({ x: 0, y: REGION.shirt.y + 18, w: 64, h: REGION.shirt.h - 18 }));
    hands.push(set(sleeve, sx * 0.2, -0.25, 0));
    hands.push(set(flat(new THREE.SphereGeometry(0.034, 8, 6).scale(0.85, 1.35, 0.75), swatchUv('skin')), sx * 0.2, -0.53, 0.01));
  }
  const arms = new THREE.Mesh(weld(hands), mat);
  arms.name = 'arms';
  arms.position.y = WOMAN_SHOULDER;
  arms.castShadow = true;
  g.add(body, arms);
  // Холст и материал — свои у каждой женщины: уходя из кадра, она их отдаёт.
  g.userData.release = skin.release;
  return g;
}

/**
 * Холст и материал одного облика.
 *
 * ОТДЕЛЬНО ОТ ФИГУРЫ НАРОЧНО. У женщины и у сына холст свой — они разные люди, и
 * лица у них разные. А пришедших из леса пятеро, и печь пять одинаковых холстов
 * значило бы платить пятью текстурами за то, чего никто не различит: они ватага,
 * и узнают их силуэтом. Поэтому сцена печёт им один холст и отдаёт его всем
 * пятерым (`raider`), а отдаёт обратно один раз.
 */
export interface Skin {
  mat: THREE.MeshLambertMaterial;
  release: () => void;
}

export function skinOf(look: Look, seed: number): Skin {
  const map = bake(personAtlas(look, seed));
  const mat = new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide });
  mat.name = 'person';
  return {
    mat,
    release: (): void => {
      map.dispose();
      mat.dispose();
    },
  };
}

/** Где у сына плечи. */
export const BOY_SHOULDER = 0.82;

/**
 * Сын у огня.
 *
 * Тот же способ, что у матери, и те же клетки атласа: лицо перекладкой
 * развёртки, рубаха и мех — рисунком. Отличается он ростом (метр с небольшим
 * против её полутора с лишним), стрижкой вместо косы и портами вместо понёвы —
 * тем, что видно в двадцать пикселей. Рубаха на нём материнская: шьёт её она.
 */
export function boy(look: Look, seed: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'boy';
  const skin = skinOf(look, seed);
  const mat = skin.mat;
  const headY = 0.99;
  const headR = 0.1;

  const parts: THREE.BufferGeometry[] = [];
  // Лицо первым — по нему сцена меняет выражение (`setMood`).
  const face = new THREE.SphereGeometry(headR * 1.004, 20, 12, Math.PI / 2 - FACE_PHI / 2, FACE_PHI, FACE_T0, FACE_T1 - FACE_T0);
  into(face, rectUv(faceRect(MOOD_CALM)));
  const faceCount = face.attributes.position.count;
  parts.push(set(face, 0, headY, 0));
  const hair = swatchUv('hair');
  parts.push(set(flat(new THREE.SphereGeometry(headR, 14, 10, Math.PI / 2 + FACE_PHI / 2, Math.PI * 2 - FACE_PHI), hair), 0, headY, 0));
  parts.push(set(flat(new THREE.SphereGeometry(headR * 1.002, 14, 3, Math.PI / 2 - FACE_PHI / 2, FACE_PHI, 0, FACE_T0 + 0.01), hair), 0, headY, 0));
  parts.push(
    set(flat(new THREE.SphereGeometry(headR * 0.996, 14, 3, Math.PI / 2 - FACE_PHI / 2, FACE_PHI, FACE_T1 - 0.01, Math.PI - FACE_T1 + 0.01), swatchUv('neck')), 0, headY, 0),
  );
  // Вихор на макушке: стриженая голова без него — шар.
  parts.push(set(flat(new THREE.SphereGeometry(headR * 1.06, 16, 6, 0, Math.PI * 2, 0, 0.36 * Math.PI), hair), 0, headY - 0.004, -0.006));
  parts.push(set(flat(new THREE.CylinderGeometry(0.042, 0.05, 0.08, 8), swatchUv('neck')), 0, 0.9, 0));
  // Рубаха до середины бедра, подпоясанная.
  const shirt = new THREE.CylinderGeometry(0.105, 0.135, 0.36, 14, 1, false);
  into(shirt, rectUv({ x: REGION.shirt.x, y: REGION.shirt.y, w: REGION.shirt.w, h: 100 }));
  parts.push(set(shirt, 0, 0.7, 0, { y: Math.PI }));
  const belt = new THREE.CylinderGeometry(0.14, 0.14, 0.045, 14, 1, true);
  into(belt, rectUv({ x: REGION.skirt.x, y: REGION.skirt.y, w: REGION.skirt.w, h: 10 }));
  parts.push(set(belt, 0, 0.54, 0, { y: Math.PI }));
  // Порты: две ноги, а не подол, — по ним мальчика и отличают от матери.
  for (const sx of [-1, 1]) {
    const leg = new THREE.CylinderGeometry(0.055, 0.045, 0.5, 8, 1, true);
    into(leg, rectUv({ x: REGION.skirt.x, y: REGION.skirt.y + 40, w: REGION.skirt.w, h: 60 }));
    parts.push(set(leg, sx * 0.058, 0.27, 0));
    parts.push(set(flat(new THREE.BoxGeometry(0.07, 0.05, 0.13), swatchUv('hairDark')), sx * 0.058, 0.025, 0.02));
  }

  const geo = weld(parts);
  const body = new THREE.Mesh(geo, mat);
  body.name = 'body';
  body.castShadow = true;
  body.receiveShadow = true;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const base = new Float32Array(faceCount);
  for (let i = 0; i < faceCount; i++) base[i] = uv.getX(i);
  body.userData.face = { count: faceCount, base, mood: MOOD_CALM } satisfies Face;

  const hands: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const sleeve = new THREE.CylinderGeometry(0.033, 0.028, 0.34, 8, 1, true);
    into(sleeve, rectUv({ x: 0, y: REGION.shirt.y + 18, w: 64, h: REGION.shirt.h - 18 }));
    hands.push(set(sleeve, sx * 0.13, -0.17, 0));
    hands.push(set(flat(new THREE.SphereGeometry(0.026, 7, 5).scale(0.85, 1.35, 0.75), swatchUv('skin')), sx * 0.13, -0.36, 0.01));
  }
  const arms = new THREE.Mesh(weld(hands), mat);
  arms.name = 'arms';
  arms.position.y = BOY_SHOULDER;
  arms.castShadow = true;
  g.add(body, arms);
  g.userData.release = skin.release;
  return g;
}

/** Где у пришедшего плечи и где его рука: сюда сцена вешает топор или лук. */
export const RAIDER_SHOULDER = 1.36;
export const RAIDER_HAND = { x: 0.27, y: 1.04, z: 0.12 };

/**
 * Пришедший из леса.
 *
 * Материал общий на всех пятерых и приходит снаружи (`skinOf`): они ватага, и
 * пять холстов ради пяти одинаковых лиц — плата ни за что. Различает их рост и
 * то, что в руках: троим сцена даёт топор, двоим лук.
 *
 * Лицом вдоль +Z, как женщина, олень и волк.
 */
export function raider(mat: THREE.MeshLambertMaterial, tall: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'raider';
  const headY = 1.52 * tall;
  const headR = 0.117;

  const parts: THREE.BufferGeometry[] = [];
  const face = new THREE.SphereGeometry(headR * 1.004, 20, 12, Math.PI / 2 - FACE_PHI / 2, FACE_PHI, FACE_T0, FACE_T1 - FACE_T0);
  into(face, rectUv(faceRect(MOOD_CALM)));
  const faceCount = face.attributes.position.count;
  parts.push(set(face, 0, headY, 0));
  const hair = swatchUv('hair');
  parts.push(set(flat(new THREE.SphereGeometry(headR, 14, 10, Math.PI / 2 + FACE_PHI / 2, Math.PI * 2 - FACE_PHI), hair), 0, headY, 0));
  parts.push(set(flat(new THREE.SphereGeometry(headR * 1.002, 14, 3, Math.PI / 2 - FACE_PHI / 2, FACE_PHI, 0, FACE_T0 + 0.01), hair), 0, headY, 0));
  parts.push(
    set(flat(new THREE.SphereGeometry(headR * 0.996, 14, 3, Math.PI / 2 - FACE_PHI / 2, FACE_PHI, FACE_T1 - 0.01, Math.PI - FACE_T1 + 0.01), swatchUv('neck')), 0, headY, 0),
  );
  parts.push(set(flat(new THREE.SphereGeometry(headR * 1.07, 16, 6, 0, Math.PI * 2, 0, 0.34 * Math.PI), hair), 0, headY - 0.004, -0.008));
  parts.push(set(flat(new THREE.CylinderGeometry(0.058, 0.07, 0.12, 10), swatchUv('neck')), 0, headY - 0.13, 0));
  // Плечи шире бёдер — тем и отличается мужчина от женщины в силуэте.
  const shirt = new THREE.CylinderGeometry(0.21, 0.17, 0.54, 16, 1, false);
  into(shirt, rectUv({ x: REGION.shirt.x, y: REGION.shirt.y, w: REGION.shirt.w, h: 100 }));
  parts.push(set(shirt, 0, headY - 0.43, 0, { y: Math.PI }));
  // Меховая накидка на плечах: по ней ватагу видно от опушки.
  const cape = new THREE.CylinderGeometry(0.17, 0.26, 0.2, 18, 1, true, Math.PI / 6, (Math.PI * 5) / 3);
  into(cape, rectUv(REGION.fur));
  parts.push(set(cape, 0, headY - 0.22, 0));
  const belt = new THREE.CylinderGeometry(0.18, 0.18, 0.055, 16, 1, true);
  into(belt, rectUv({ x: REGION.skirt.x, y: REGION.skirt.y, w: REGION.skirt.w, h: 10 }));
  parts.push(set(belt, 0, headY - 0.73, 0, { y: Math.PI }));
  for (const sx of [-1, 1]) {
    const leg = new THREE.CylinderGeometry(0.082, 0.066, 0.78, 8, 1, true);
    into(leg, rectUv({ x: REGION.skirt.x, y: REGION.skirt.y + 40, w: REGION.skirt.w, h: 60 }));
    parts.push(set(leg, sx * 0.085, headY - 1.14, 0));
    parts.push(set(flat(new THREE.BoxGeometry(0.1, 0.06, 0.19), swatchUv('hairDark')), sx * 0.085, headY - 1.5, 0.03));
  }

  const geo = weld(parts);
  const body = new THREE.Mesh(geo, mat);
  body.name = 'body';
  body.castShadow = true;
  body.receiveShadow = true;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const base = new Float32Array(faceCount);
  for (let i = 0; i < faceCount; i++) base[i] = uv.getX(i);
  body.userData.face = { count: faceCount, base, mood: MOOD_CALM } satisfies Face;

  const hands: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const sleeve = new THREE.CylinderGeometry(0.05, 0.04, 0.52, 9, 1, true);
    into(sleeve, rectUv({ x: 0, y: REGION.shirt.y + 18, w: 64, h: REGION.shirt.h - 18 }));
    hands.push(set(sleeve, sx * 0.22, -0.26, 0));
    hands.push(set(flat(new THREE.SphereGeometry(0.038, 8, 6).scale(0.85, 1.35, 0.75), swatchUv('skin')), sx * 0.22, -0.55, 0.01));
  }
  const arms = new THREE.Mesh(weld(hands), mat);
  arms.name = 'arms';
  arms.position.y = RAIDER_SHOULDER * tall;
  arms.castShadow = true;
  g.add(body, arms);
  // Холста своего у него нет — он общий, и отдаёт его сцена один раз.
  return g;
}

/**
 * Сменить выражение: переложить развёртку лица на клетку атласа.
 *
 * Не перерисовка: холст испечён один раз, а клетки всех выражений в нём уже
 * лежат. Зовётся каждый кадр и ничего не делает, пока выражение то же.
 */
export function setMood(body: THREE.Mesh, mood: Mood): void {
  const f = body.userData.face as Face | undefined;
  if (!f || f.mood === mood) return;
  f.mood = mood;
  const uv = body.geometry.attributes.uv as THREE.BufferAttribute;
  const shift = (mood * FACE_CELL) / ATLAS_W;
  for (let i = 0; i < f.count; i++) uv.setX(i, f.base[i] + shift);
  uv.needsUpdate = true;
}

/**
 * Рука игрока: кулак и предплечье в рукаве.
 *
 * Кулак в начале координат, локоть — по +Z, ручка того, что держат, проходит
 * сквозь кулак вдоль Y. Сцена вешает руку на топор и на лук и разворачивает её
 * к краю экрана (`scene.armPose`), а рукав меняет материалом: лён с вышитым
 * обшлагом — или мех, когда одежда сшита.
 */
export function arm(material: THREE.Material): THREE.Group {
  const parts: THREE.BufferGeometry[] = [];
  // Рукав от обшлага к локтю: у локтя толще, чем у запястья.
  const sleeve = new THREE.CylinderGeometry(0.042, 0.033, 0.42, 12, 1, true);
  into(sleeve, rectUv(SLEEVE_CLOTH, SLEEVE, SLEEVE));
  parts.push(set(sleeve, 0, 0, 0.27, { x: Math.PI / 2 }));
  // Обшлаг — шире рукава: у меха пышный край, у льна вышитая полоса.
  const cuff = new THREE.CylinderGeometry(0.041, 0.039, 0.05, 12, 1, true);
  into(cuff, rectUv({ x: 0, y: 74, w: 128, h: 22 }, SLEEVE, SLEEVE));
  parts.push(set(cuff, 0, 0, 0.07, { x: Math.PI / 2 }));
  // Кулак — гранёная призма вдоль ручки: пальцы, сомкнутые вокруг топорища. Шар в
  // руке на снимке читался картофелиной, брусок — кирпичом.
  parts.push(set(flat(new THREE.CylinderGeometry(0.043, 0.039, 0.09, 7), SLEEVE_SKIN), 0, 0, -0.004));
  parts.push(set(flat(new THREE.SphereGeometry(0.019, 5, 4).scale(1, 1, 1.8), SLEEVE_SKIN), 0.036, 0.03, -0.022, { x: 0.4 }));
  const mesh = new THREE.Mesh(weld(parts), material);
  mesh.name = 'arm';
  mesh.castShadow = false;
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}
