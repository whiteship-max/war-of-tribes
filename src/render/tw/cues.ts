// Звук ролика TW из журнала — чистая раскладка, без Web Audio (docs/battle_tw.md, раздел «Звук»): что звучит, где и на
// какой секунде ролика. Звучит машинка `sound/battlefx` (своя докачка); здесь — только откуда звук берётся.
//
// Звук ничего не решает сам, как музыка (`MUSIC_BY_ACT`): рог — на построении, трубы — на разбег первой линии, клич —
// перед сшибкой, грохот удара — там, где строи сошлись, залп — с лучников в миг срыва, свист — туча в полёте, стук — где она
// ложится, крик бегущих — у отряда в миг слома, рог победителя — после слома побеждённых. Гул сечи, лязг и конский топот —
// из кадра фигур (`ambienceAt`): сколько рубится, где и сколько коней в ходу. Тот же журнал — та же раскладка.
import { ARROW_FLIGHT, CLIPS, RUN_LAST, figurePose, figureState, targetOf, unitPose, type FigureFrame, type TwPlan, type TwUnit } from './plan';
import { hash } from './terrain';

export type CueKind =
  | 'horn'
  | 'charge'
  | 'cry'
  | 'crash'
  | 'bows'
  | 'whistle'
  | 'thud'
  | 'panic'
  | 'victory'
  | 'ram'
  | 'gate'
  | 'ladder'
  | 'wallcry'
  | 'engine'
  | 'stone'
  | 'impact'
  | 'collapse';

/** Звук на секунде ролика. */
export interface Cue {
  at: number;
  kind: CueKind;
  /** Где звучит, метры сцены; у свиста — откуда, а куда летит туча — `x2`, `z2`. */
  x: number;
  z: number;
  x2: number;
  z2: number;
  /** Сколько длится, секунды (свист — время полёта тучи). */
  dur: number;
  /** Сила 0..1: сколько стрел в залпе, сколько людей кричит. */
  size: number;
  /** Чей звук: у рога своей стороны свой голос. */
  ours: boolean;
  seed: number;
}

const cue = (at: number, kind: CueKind, x: number, z: number, size: number, ours: boolean, seed: number, more: Partial<Cue> = {}): Cue => ({
  at,
  kind,
  x,
  z,
  x2: x,
  z2: z,
  dur: 0,
  size: Math.max(0, Math.min(1, size)),
  ours,
  seed,
  ...more,
});

/** Середина и тыл армии стороны: откуда трубит рог. */
function armyHorn(plan: TwPlan, ours: boolean): { x: number; z: number } {
  const s = ours ? -1 : 1;
  const side = ours ? plan.us : plan.us === 'attacker' ? 'defender' : 'attacker';
  return { x: 0, z: plan.deployZ[side] + s * 8 };
}

/** Все звуки ролика по журналу — по секундам. */
export function cuesOf(plan: TwPlan): Cue[] {
  const out: Cue[] = [];
  const seed = plan.cast.seed;
  const front = (ours: boolean): TwUnit[] => plan.units.filter((u) => u.ours === ours && u.row === 'front');
  // Рог на построении: наш трубит первым, их отвечает.
  for (const ours of [true, false]) {
    const h = armyHorn(plan, ours);
    out.push(cue(ours ? 0.6 : 1.9, 'horn', h.x, h.z, 1, ours, seed + (ours ? 1 : 2)));
  }
  // Трубы на разбег и клич перед сшибкой — у каждой стороны, где стоит её первая линия.
  for (const ours of [true, false]) {
    const list = front(ours);
    if (list.length === 0) continue;
    const side = list[0].side;
    const s = ours ? -1 : 1;
    const figs = list.reduce((n, u) => n + u.figures, 0);
    const h = armyHorn(plan, ours);
    out.push(cue(Math.max(0.2, plan.clashAt - RUN_LAST - 0.4 + (ours ? 0 : 0.35)), 'charge', h.x, h.z, 1, ours, seed + (ours ? 3 : 4)));
    out.push(cue(Math.max(0.2, plan.clashAt - 1.4 + (ours ? 0 : 0.2)), 'cry', 0, plan.contactZ[side] + s * 4, figs / 200, ours, seed + (ours ? 5 : 6)));
  }
  // Грохот удара: в каждом слоте, где первые линии обеих сторон сошлись; на новый натиск кругов — тише.
  for (let slot = 0; slot < 3; slot++) {
    const inSlot = plan.units.filter((u) => u.row === 'front' && u.lane !== null && (u.ours ? u.lane : 2 - u.lane) === slot);
    if (!inSlot.some((u) => u.ours) || !inSlot.some((u) => !u.ours)) continue;
    const figs = inSlot.reduce((n, u) => n + u.figures, 0);
    out.push(cue(plan.clashAt + hash(seed, slot, 31) * 0.15, 'crash', plan.slotX[slot], 0, figs / 240, true, seed + 10 + slot));
    for (const [, b] of plan.fire) {
      if (b <= plan.clashAt + 1 || b >= plan.timing.melee[1]) continue;
      out.push(cue(b + hash(seed, slot, 32) * 0.2, 'crash', plan.slotX[slot], 0, (figs / 240) * 0.6, true, seed + 20 + slot));
    }
  }
  // Залпы: срыв — с лучников, свист — туча в полёте, стук — где ложится.
  for (const u of plan.units) {
    if (u.form !== 'bow') continue;
    for (const v of u.volleys) {
      const e = targetOf(plan, u, v);
      if (!e) continue;
      // Срыв — там, где стоят стреляющие: у резерва, ушедшего во вторую линию, — у первого вставшего.
      const a = unitPose(plan, u, v);
      for (let i = u.first; i < u.first + u.figures; i++) {
        if (plan.goAt[i] > v || plan.deathAt[i] <= v) continue;
        const q = figurePose(plan, i, v, null, figureState());
        a.x = q.x;
        a.z = q.z;
        break;
      }
      const b = unitPose(plan, e, v + ARROW_FLIGHT);
      const size = u.figures / 60;
      const k = Math.round(v * 100) + u.id * 7919;
      out.push(cue(v, 'bows', a.x, a.z, size, u.ours, k));
      out.push(cue(v + 0.1, 'whistle', a.x, a.z, size, u.ours, k + 1, { x2: b.x, z2: b.z, dur: ARROW_FLIGHT }));
      out.push(cue(v + ARROW_FLIGHT, 'thud', b.x, b.z, size, u.ours, k + 2));
    }
  }
  // Обход: где ушедшие в обход врезаются во фланг — грохот поменьше.
  const hits = new Map<string, { at: number; x: number; z: number; n: number; ours: boolean }>();
  for (let i = 0; i < plan.figures; i++) {
    if (plan.goKind[i] !== 2) continue;
    const u = plan.units[plan.unitOf[i]];
    const key = `${u.id}:${plan.goLane[i]}`;
    const at = plan.goAt[i] + plan.path[i * 8 + 7];
    const h = hits.get(key);
    if (!h) hits.set(key, { at, x: plan.path[i * 8 + 4], z: plan.path[i * 8 + 5], n: 1, ours: u.ours });
    else {
      h.at = Math.min(h.at, at);
      h.n += 1;
    }
  }
  for (const h of hits.values()) if (h.at < plan.seconds) out.push(cue(h.at, 'crash', h.x, h.z, h.n / 60, h.ours, seed + Math.round(h.at * 10)));
  // Бегство: крик у отряда в миг слома; рог победителя — когда побеждённые побежали все.
  for (const u of plan.units) {
    if (u.fleeAt === null || u.row === 'general' || u.fleeAt >= plan.seconds) continue;
    const p = unitPose(plan, u, u.fleeAt);
    out.push(cue(u.fleeAt, 'panic', p.x, p.z, u.figures / 120, u.ours, seed + 100 + u.id));
  }
  for (const side of ['attacker', 'defender'] as const) {
    const at = plan.brokenAt[side];
    if (at === null) continue;
    const ours = side !== plan.us;
    const h = armyHorn(plan, ours);
    if (at + 1.5 < plan.seconds) out.push(cue(at + 1.5, 'victory', h.x, h.z, 1, ours, seed + 200));
  }
  siegeCues(plan, out);
  barrageCues(plan, out);
  return out.sort((a, b) => a.at - b.at || a.seed - b.seed);
}

/**
 * Звук обстрела перед штурмом (docs/battle_tw.md, раздел 15): скрип рычага и удар перекладины, свист камня, удар в кладку,
 * обвал, крик сбитых — раскладка пролога (`barrage.ts`). Часы ролика идут от начала пролога, поэтому звук боя сдвигается
 * на его длину — так же, как кадр (`TwPlayer.pre`).
 */
function barrageCues(plan: TwPlan, out: Cue[]): void {
  const b = plan.barrage;
  if (!b) return;
  for (const c of out) c.at += b.seconds;
  const ours = b.besieger === plan.us;
  for (const c of b.cues) out.push(cue(c.at, c.kind, c.x, c.z, c.size, c.kind === 'wallcry' ? !ours : ours, c.seed, { x2: c.x2, z2: c.z2, dur: c.dur }));
}

/**
 * Звук штурма (docs/battle_tw.md, раздел 13) — из той же режиссуры, что кадр: лестница стукнула о стену, когда её
 * поставили; таран бьёт в такт своих ударов, последний — треск выбитых ворот; на стене кричат, когда к ней пошли, пока
 * по лестницам лезут и когда ворота пали.
 */
function siegeCues(plan: TwPlan, out: Cue[]): void {
  const site = plan.site;
  const w = site?.wall;
  if (!site || !w || site.kind !== 'wall') return;
  const seed = plan.cast.seed;
  const defOurs = w.side === plan.us;
  site.ladders.forEach((l, k) => out.push(cue(l.raiseAt, 'ladder', l.x, w.z, 0.6, !defOurs, seed + 300 + k)));
  const ram = site.ram;
  if (ram) {
    ram.hits.forEach((h, k) => {
      const last = w.gateAt !== null && k === ram.hits.length - 1 && Math.abs(h - w.gateAt) < 1e-6;
      out.push(cue(h, last ? 'gate' : 'ram', ram.x, w.z, 1, !defOurs, seed + 400 + k));
    });
  }
  // Крики на стене: когда штурм подошёл, пока лезут — на лестницах по очереди, когда пали ворота.
  out.push(cue(plan.clashAt - 0.4, 'wallcry', w.gateX, w.z + w.inward * w.thick, 1, defOurs, seed + 500));
  const until = Math.min(plan.brokenAt[w.side] ?? Infinity, plan.brokenAt[w.side === 'defender' ? 'attacker' : 'defender'] ?? Infinity, plan.seconds);
  const n = site.ladders.length;
  for (let t = plan.clashAt + 3, k = 0; n > 0 && t < until; t += 4.5, k++) {
    const l = site.ladders[Math.floor(hash(seed, k, 501) * n)];
    out.push(cue(t, 'wallcry', l.x, w.z + w.inward * 0.6, 0.6, defOurs, seed + 510 + k));
  }
  if (w.gateAt !== null && w.gateAt > 0) out.push(cue(w.gateAt + 0.3, 'wallcry', w.gateX, w.z + w.inward * 4, 1, defOurs, seed + 590));
}

/**
 * Часы звуков: отдаёт звуки, чьё время пришло с прошлого кадра. Перемотка назад и скачок вперёд (снова, ×4 на паузе)
 * звуков не сыплют: прошлые — уже прозвучали, пропущенные — не догоняют.
 */
export class CueClock {
  private next = 0;
  private last: number | null = null;
  constructor(readonly cues: readonly Cue[]) {}

  take(t: number): Cue[] {
    // Первый кадр со звуком (машинка приехала позже ролика): прозвучит то, что было за последние полторы секунды, —
    // рог построения не теряется из-за медленной докачки.
    if (this.last === null) {
      const from = t - 1.5;
      this.next = this.cues.findIndex((c) => c.at > from);
      if (this.next < 0) this.next = this.cues.length;
      this.last = from;
    }
    if (t < this.last - 1e-6 || t - this.last > 1.5) {
      this.next = this.cues.findIndex((c) => c.at > t);
      if (this.next < 0) this.next = this.cues.length;
      this.last = t;
      return [];
    }
    const out: Cue[] = [];
    while (this.next < this.cues.length && this.cues[this.next].at <= t) out.push(this.cues[this.next++]);
    this.last = t;
    return out;
  }
}

/** Гул на кадре: сколько рубится в каждом слоте и где, сколько коней в ходу и где, доля рубящихся на поле. */
export interface Ambience {
  fight: { x: number; z: number; n: number }[];
  gallop: { x: number; z: number; n: number };
  /** Доля рубящихся среди тех, кто на ногах: гул сечи. */
  roar: number;
  /** На ногах всего: ропот войска до сшибки. */
  standing: number;
}

const STRIKE = CLIPS.indexOf('strike');
const RUN = CLIPS.indexOf('run');
const MARCH = CLIPS.indexOf('march');
const FALL = CLIPS.indexOf('fall');
const horses = new WeakMap<TwPlan, Uint8Array>();

/** Верхом ли фигура (конница и стая): топот — их. */
function horseOf(plan: TwPlan): Uint8Array {
  let h = horses.get(plan);
  if (!h) {
    h = new Uint8Array(plan.figures);
    for (let i = 0; i < plan.figures; i++) {
      const u = plan.units[plan.unitOf[i]];
      h[i] = u.form === 'horse' || u.form === 'heavy' || u.form === 'pack' ? 1 : 0;
    }
    horses.set(plan, h);
  }
  return h;
}

/** Гул, лязг и топот на кадре — из уже разложенных фигур (`poseFigures`), без второго счёта. */
export function ambienceAt(plan: TwPlan, frame: FigureFrame): Ambience {
  const horse = horseOf(plan);
  const fight = [0, 1, 2].map(() => ({ x: 0, z: 0, n: 0 }));
  const gallop = { x: 0, z: 0, n: 0 };
  let standing = 0;
  let striking = 0;
  for (let i = 0; i < plan.figures; i++) {
    if (!frame.shown[i]) continue;
    const clip = frame.clip[i];
    if (clip === FALL) continue;
    standing += 1;
    const x = frame.x[i];
    const z = frame.z[i];
    if (clip === STRIKE) {
      striking += 1;
      // Слот — по месту: середина поля делится по середине между слотами.
      const s = x > (plan.slotX[0] + plan.slotX[1]) / 2 ? 0 : x < (plan.slotX[1] + plan.slotX[2]) / 2 ? 2 : 1;
      const f = fight[s];
      f.x += x;
      f.z += z;
      f.n += 1;
    }
    if (horse[i] && (clip === RUN || clip === MARCH)) {
      // Галоп громче шага: шаг весит меньше и в середину топота тянет меньше.
      const w = clip === RUN ? 1 : 0.4;
      gallop.x += x * w;
      gallop.z += z * w;
      gallop.n += w;
    }
  }
  for (const f of fight) if (f.n > 0) {
    f.x /= f.n;
    f.z /= f.n;
  }
  if (gallop.n > 0) {
    gallop.x /= gallop.n;
    gallop.z /= gallop.n;
  }
  return { fight, gallop, roar: standing > 0 ? striking / standing : 0, standing };
}
