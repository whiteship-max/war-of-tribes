// Покои правителя (docs/city_v3.md, Г-5): дела от первого лица — сесть за стол и встать, лечь и встать, наклониться к
// окну, погреть руки у огня, взять меч. Чистый модуль без three: глаз и руки по ключам времени, их читает комната
// (`room.ts`), тела рисует `body.ts`, тесты сверяют плавность.
//
// Каждое дело — ключи от места подхода (`plan.Poi.approach`, стоя) до позы дела (`plan.Poi.pose`). Между ключами —
// монотонная кубическая кривая по каждому числу (Фритч — Карлсон): скорость непрерывна, на концах — ноль, и ни одно
// число не перелетает ключ — камера не качается и не дёргается. Встать — те же ключи назад.
import { CHAIR, HALF, POI_BY_ID, type PoiId, type SpotId } from './plan';
import { EYE_STAND } from './walk';

/** Числа ключа: глаз (место, поворот, наклон), доля рук в деле `hands` и доля посадки `sit` (ноги под столом). */
export interface Key {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hands: number;
  sit: number;
}

export type Frame = Omit<Key, 't'>;

/** Руки дела: что делают, когда доля рук — единица (`body.ts` ставит кисти и сгибает пальцы). */
export type HandsKind = 'none' | 'armrests' | 'sill' | 'warm';

export interface Act {
  id: SpotId;
  keys: readonly Key[];
  hands: HandsKind;
}

const k = (t: number, x: number, y: number, z: number, yaw: number, pitch: number, hands = 0, sit = 0): Key => ({ t, x, y, z, yaw, pitch, hands, sit });

const start = (id: SpotId, pitch: number): Key => {
  const a = POI_BY_ID[id].approach!;
  return k(0, a.x, EYE_STAND, a.z, a.yaw, pitch);
};

const rest = (id: SpotId, t: number, hands: number, sit = 0): Key => {
  const p = POI_BY_ID[id].pose;
  return k(t, p.x, p.y, p.z, p.yaw, p.pitch, hands, sit);
};

/**
 * Ключи дел. Глаз сидя — над сиденьем (`CHAIR`), лёжа — над подушкой; путь глаза не задевает мебель (тест «глаз не
 * проходит сквозь мебель»): кресло подходят сбоку, над подлокотником, спинка остаётся за глазом.
 */
export const ACTS: Record<SpotId, Act> = {
  desk: {
    id: 'desk',
    hands: 'armrests',
    keys: [
      start('desk', -0.2),
      // Взгляд на сиденье и подлокотники, шаг вбок к креслу; руки тянутся к подлокотникам.
      k(0.55, 0.52, 1.56, 2.02, 0.04, -0.52, 0.25, 0.12),
      // Опускается: руки легли, колени уходят под стол.
      k(1.15, CHAIR.x + 0.12, 1.33, 2.0, 0.02, -0.62, 0.85, 0.72),
      k(1.6, CHAIR.x, 1.26, 1.99, 0, -0.52, 1, 1),
      rest('desk', 2.0, 1, 1),
    ],
  },
  window: {
    id: 'window',
    hands: 'sill',
    keys: [start('window', -0.12), k(0.7, 0, 1.6, 5.22, 0, -0.22, 0.35), k(1.3, 0, 1.48, 5.58, 0, -0.44, 0.95), rest('window', 1.75, 1)],
  },
  hearth: {
    id: 'hearth',
    hands: 'warm',
    keys: [start('hearth', -0.18), k(0.6, 0, 1.57, -3.58, Math.PI, -0.32, 0.45), k(1.3, 0, 1.5, -3.7, Math.PI, -0.45, 1), rest('hearth', 1.7, 1)],
  },
  bed: {
    id: 'bed',
    hands: 'none',
    keys: [
      start('bed', -0.2),
      // Сел на край кровати лицом к западу.
      k(0.85, -3.18, 1.36, -3.95, -1.3, -0.36),
      // Откинулся на спину: взгляд — в подбой полога.
      k(1.75, -3.78, 1.04, -4.3, -0.3, 1.0),
      // Голова на подушке, приподнята: в открытый бок кровати — на покои.
      rest('bed', 3.0, 0),
    ],
  },
  arms: {
    id: 'arms',
    hands: 'none',
    // Наклон над сундуком к мечу; рука берёт рукоять (`room.ts` зовёт `take('sword')` на `GRAB_AT`), меч — к глазу.
    keys: [start('arms', -0.1), k(0.6, 4.34, 1.58, -1.95, Math.PI / 2, -0.14), rest('arms', 1.35, 0)],
  },
};

/** На каком ключе дела «Оружие» рука берёт меч, с. */
export const GRAB_AT = 0.6;

/** Сколько длится дело, с. */
export const actLength = (a: Act): number => a.keys[a.keys.length - 1].t;

const CH = ['x', 'y', 'z', 'yaw', 'pitch', 'hands', 'sit'] as const;

/**
 * Числа дела в момент `t` (0 … длина): монотонная кубическая кривая по каждому числу. Наклоны в ключах — по Фритчу —
 * Карлсону: там, где число разворачивается, наклон — ноль, и кривая не перелетает ключ; на концах — ноль (с места и до
 * места — плавно).
 */
export function frameAt(a: Act, t: number): Frame {
  const keys = a.keys;
  const tt = Math.min(actLength(a), Math.max(0, t));
  let i = 0;
  while (i + 2 < keys.length && tt > keys[i + 1].t) i++;
  const out = {} as Frame;
  for (const c of CH) out[c] = hermite(keys, c, i, tt);
  return out;
}

function slope(keys: readonly Key[], c: (typeof CH)[number], i: number): number {
  if (i === 0 || i === keys.length - 1) return 0;
  const d0 = (keys[i][c] - keys[i - 1][c]) / (keys[i].t - keys[i - 1].t);
  const d1 = (keys[i + 1][c] - keys[i][c]) / (keys[i + 1].t - keys[i].t);
  if (d0 * d1 <= 0) return 0;
  // Гармоническое среднее — наклон Фритча — Карлсона: не больше ни одного из соседних.
  const w0 = 2 * (keys[i + 1].t - keys[i].t) + (keys[i].t - keys[i - 1].t);
  const w1 = keys[i + 1].t - keys[i].t + 2 * (keys[i].t - keys[i - 1].t);
  return (w0 + w1) / (w0 / d0 + w1 / d1);
}

function hermite(keys: readonly Key[], c: (typeof CH)[number], i: number, t: number): number {
  const a = keys[i];
  const b = keys[i + 1];
  const h = b.t - a.t;
  const s = h > 0 ? (t - a.t) / h : 1;
  const m0 = slope(keys, c, i) * h;
  const m1 = slope(keys, c, i + 1) * h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * a[c] + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * b[c] + (s3 - s2) * m1;
}

/** Точки на пути глаза, чтобы проверить, что он не проходит сквозь мебель и стены: каждые 20 мс. */
export function sampleAct(a: Act, dt = 0.02): Frame[] {
  const out: Frame[] = [];
  for (let t = 0; t <= actLength(a) + 1e-9; t += dt) out.push(frameAt(a, t));
  return out;
}

/** Дело точки (у `hall` — нет). */
export const actOf = (id: PoiId): Act | null => (id === 'hall' ? null : ACTS[id]);

/** Глаз — в комнате (с нишей южного окна): числа для тестов и для стенда. */
export const inRoom = (f: Pick<Frame, 'x' | 'z'>): boolean => Math.abs(f.x) < HALF && f.z > -HALF && f.z < HALF + 1.0;
