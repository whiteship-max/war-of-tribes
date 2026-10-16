// Пути фигур ролика осады — ключами по секундам (docs/gfx.md, ГФ-2). Чистые, без three.
//
// В бою путь фигуры выводит план из журнала (`tw/plan.ts`: строй, сшибка, слом). У осады журнала боя нет — есть эпизоды:
// лагерь, подвод машин, пролом, вылазка, выход гарнизона из ворот. Режиссура эпизода (`reel.ts`) ставит фигуре ключи —
// где она с какой секунды и что делает, — а кадр выводится из ключей: между двумя ключами с разными местами фигура идёт
// (клип первого ключа — шаг или бег), с одним местом — стоит клипом ключа. Ключи только добавляются и только вперёд по
// времени: кадр — функция секунды, перемотка точна.
import type { ClipId } from '../reel/troupe';

export interface Key {
  t: number;
  x: number;
  z: number;
  /** Высота над нулём сцены; NaN — по месту (земля или боевой ход стены: `site.standY`). */
  y: number;
  clip: ClipId;
  yaw: number;
  /** С этой секунды фигуры не видно (ушла за край поля, унесли павшего, ещё не пришла). */
  hide: boolean;
}

/** Где фигура на секунде: место, разворот, клип и сколько он уже идёт. */
export interface TrackPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  clip: ClipId;
  /** Время клипа: у гибели — с мгновения гибели (клип не по кругу), у прочих — общее время плюс своя фаза. */
  time: number;
  shown: boolean;
}

export class Tracks {
  readonly keys: Key[][];

  constructor(n: number) {
    this.keys = Array.from({ length: n }, () => []);
  }

  get count(): number {
    return this.keys.length;
  }

  last(i: number): Key {
    const k = this.keys[i];
    return k[k.length - 1];
  }

  /** Первый ключ: где фигура стоит с начала ролика. */
  start(i: number, x: number, z: number, clip: ClipId, yaw: number, hide = false, y = NaN): void {
    this.keys[i].length = 0;
    this.keys[i].push({ t: 0, x, z, y, clip, yaw, hide });
  }

  private push(i: number, k: Key): void {
    const list = this.keys[i];
    const prev = list[list.length - 1];
    const t = Math.max(k.t, prev ? prev.t : 0);
    // Ключ на ту же секунду правит прежний: два ключа в одно мгновение — склейка.
    if (prev && Math.abs(prev.t - t) < 1e-6 && list.length > 1) list[list.length - 1] = { ...k, t };
    else list.push({ ...k, t });
  }

  /** С секунды `t` стоит на месте клипом `clip`, лицом `yaw` (нет — как стоял). */
  act(i: number, t: number, clip: ClipId, yaw?: number): void {
    const p = this.last(i);
    this.push(i, { ...p, t, clip, yaw: yaw ?? p.yaw, hide: false });
  }

  /**
   * Идёт к `(x, z)` с `t0` по `t1` клипом `move` и там стоит клипом `stay`, лицом `yaw` (нет — куда шёл). `y` — высота в
   * конце (по месту — NaN): так спускаются с хода по лестнице и лезут на стену.
   */
  go(i: number, t0: number, t1: number, x: number, z: number, move: ClipId, stay: ClipId = 'idle', yaw?: number, y = NaN): void {
    const p = this.last(i);
    this.push(i, { ...p, t: t0, clip: move, hide: false });
    const from = this.last(i);
    const face = yaw ?? Math.atan2(x - from.x, z - from.z);
    this.push(i, { t: Math.max(t1, from.t + 0.05), x, z, y, clip: stay, yaw: face, hide: false });
  }

  /** Пала: с секунды `t` лежит, где стояла. */
  fall(i: number, t: number): void {
    const p = this.last(i);
    this.push(i, { ...p, t, clip: 'fall', hide: false });
  }

  /** С секунды `t` фигуры не видно. */
  hide(i: number, t: number): void {
    const p = this.last(i);
    this.push(i, { ...p, t, hide: true });
  }

  /** Появилась в `(x, z)` с секунды `t`. */
  appear(i: number, t: number, x: number, z: number, clip: ClipId, yaw: number, y = NaN): void {
    this.push(i, { t, x, z, y, clip, yaw, hide: false });
  }

  /** Видна ли и жива ли фигура на секунде `t`: не спрятана и не лежит. */
  standing(i: number, t: number): boolean {
    const k = this.keys[i][keyAt(this.keys[i], t)];
    return !k.hide && k.clip !== 'fall';
  }
}

/** Последний ключ не позже `t` (до первого — первый). */
export function keyAt(list: readonly Key[], t: number): number {
  let lo = 0;
  let hi = list.length - 1;
  if (hi <= 0 || t < list[0].t) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Кадр фигуры `i` на секунде `t`; `phase` — своя фаза клипа (иначе отряд машет ногами в такт). */
export function poseAt(tr: Tracks, i: number, t: number, phase: number, out: TrackPose): TrackPose {
  const list = tr.keys[i];
  const k = keyAt(list, t);
  const a = list[k];
  const b = list[k + 1];
  out.shown = !a.hide;
  out.clip = a.clip;
  if (b && t >= a.t && (b.x !== a.x || b.z !== a.z || (b.y !== a.y && !(Number.isNaN(b.y) && Number.isNaN(a.y))))) {
    const u = Math.min(1, Math.max(0, (t - a.t) / Math.max(1e-6, b.t - a.t)));
    out.x = a.x + (b.x - a.x) * u;
    out.z = a.z + (b.z - a.z) * u;
    out.y = Number.isFinite(a.y) && Number.isFinite(b.y) ? a.y + (b.y - a.y) * u : Number.isFinite(b.y) && u > 0.5 ? b.y : Number.isFinite(a.y) && u <= 0.5 ? a.y : NaN;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    out.yaw = dx * dx + dz * dz > 1e-6 ? Math.atan2(dx, dz) : a.yaw;
  } else {
    out.x = a.x;
    out.z = a.z;
    out.y = a.y;
    out.yaw = a.yaw;
  }
  // Гибель — с первого ключа падения подряд: летит со стены и лежит у подножия одним клипом, а не встаёт на втором ключе.
  let from = k;
  while (a.clip === 'fall' && from > 0 && list[from - 1].clip === 'fall') from--;
  out.time = a.clip === 'fall' ? Math.max(0, t - list[from].t) : t + phase;
  return out;
}
