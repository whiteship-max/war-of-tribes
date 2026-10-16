// Режиссура ролика осады (docs/gfx.md, ГФ-2): что посчитала осада — эпизодами на секундах экрана. Чистая, без three.
//
// Главное правило то же, что у ролика боя: **показывать ровно то, что посчитала осада, без украшений поверх.** Проломы —
// исходы фаз (пролом рушит кусок стены в фазу, где его дала кость, починка ставит кусок обратно), машины — очередь лагеря
// (встают в фазу готовности, горят в фазу вылазки, которая их сожгла, идут на штурм, если штурм их пустил), мор — доля
// лагеря, ушедшая в фазу мора, огонь башни — доля лагеря, выбитая башней, исход — как кончилась осада, участь — та, с
// которой пал город. Своих чисел исхода здесь нет: их дал зовущий (`show.ts`), дверями мира.
//
// Ролик идёт эпизодами: лагерь у стен → огонь башни → подвод машин → фазы (пролом, починка, мор, нехватка, залп) и бои
// между ними (вылазка, выручка, отбитый штурм) → развязка (сдача, голод, штурм, лагерь разбит, растаял, дань, ушёл) →
// участь. Между эпизодами идёт время: сутки за секунды (`LAPSE`), и в них ночь и рассвет — фаза осады длится четыре
// игровых дня. Короткий ролик фазы (пролом, вылазка, сдача) — кусок того же ролика (`clipOf`): всё, что было до него,
// уже стоит в кадре (проломы, сгоревшие машины, павшие), потому что часы у них общие.
import type { Quality } from '../quality';
import { TW_SPEC } from '../reel/spec';
import type { ClipId, Troupe, TroupeUnit } from '../reel/troupe';
import { hash, heightAt } from '../reel/terrain';
import type { UnitKind } from '@/battle/types';
import { CITY_M, GATEHOUSE, RAM_PERIOD, type TwHouse, type TwLadder, type TwRam, type TwSiegeTower } from '../tw/site';
import { STOREY_H } from '../city/kit';
import { ENGINE, breachWidth, type TwBarrage, type TwBreach, type TwCamKey, type TwChunk, type TwEngine, type TwSmoke, type TwStone } from '../tw/barrage';
import type { FortMotion } from '../tw/fort';
import { STAKES_Z, layoutOf, type SiegeLayout } from './layout';
import { Tracks } from './tracks';
import { fightEpisode, type ShowFight, type ShowMachine, type ShowPhase, type SiegeShow } from './show';

/** Эпизод ролика осады. */
export type EpisodeKind =
  | 'pitch'
  | 'fire'
  | 'machines'
  | 'repair'
  | 'breach'
  | 'volley'
  | 'plague'
  | 'short'
  | 'sortie'
  | 'relief'
  | 'assault'
  | 'gates'
  | 'terms'
  | 'hunger'
  | 'storm'
  | 'broken'
  | 'wasted'
  | 'paid'
  | 'ransom'
  | 'left'
  | 'fate';

/** Длина эпизода, секунды экрана. */
export const EPISODE_SECONDS: Record<EpisodeKind, number> = {
  pitch: 6.5,
  fire: 5.5,
  machines: 5,
  repair: 4,
  breach: 7,
  volley: 4.5,
  plague: 5,
  short: 4,
  sortie: 8,
  relief: 8,
  assault: 7,
  gates: 9.5,
  terms: 9.5,
  hunger: 7.5,
  storm: 9,
  broken: 6.5,
  wasted: 5.5,
  paid: 7,
  ransom: 7,
  left: 5,
  fate: 6.5,
};

/** Между эпизодами — время осады идёт: столько секунд экрана. Фаза — четыре игровых дня: в них ночь и рассвет. */
export const LAPSE = 1.8;
/** Нехватка в городе и залп без пролома — не больше стольких эпизодов: дальше они идут временем между эпизодами. */
const SHORT_SHOWN = 2;
const VOLLEY_SHOWN = 2;

/** Развязка — эпизоды, которыми осада кончается. */
export const FINALES: readonly EpisodeKind[] = ['gates', 'terms', 'hunger', 'storm', 'broken', 'wasted', 'paid', 'ransom', 'left'];

export interface Episode {
  kind: EpisodeKind;
  /** Фаза осады, на которую пришёлся эпизод (0 — до первого броска). */
  k: number;
  at: number;
  len: number;
  /** Свет эпизода — доля суток рига. */
  solar: number;
  /** Бой эпизода (вылазка, выручка, штурм) — у него своё донесение с роликом. */
  fight?: ShowFight;
  /** Машины, вставшие в этот эпизод (подвод машин). */
  machines?: ShowMachine[];
}

/** Стрела со стены: откуда, куда, когда сорвалась и сколько летит. */
export interface SiegeArrow {
  at: number;
  flight: number;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

/** Окно ворот: раскрыты с `open` по `close` (null — до конца); выбиты тараном — с `broken`. */
export interface GateWindow {
  open: number;
  close: number | null;
}

/** Ключ света: доля суток рига, развёрнутая вперёд (может быть больше единицы — сутки прошли). */
export interface LightKey {
  at: number;
  solar: number;
}

/** Машина ролика: где, когда встала, когда сгорела, когда пошла на штурм. */
export interface ReelMachine {
  id: ShowMachine;
  x: number;
  z: number;
  /** Встала готовой — секунда ролика; Infinity — не встала. */
  from: number;
  /** Сгорела — секунда ролика; Infinity — нет. */
  gone: number;
  /** Пошла на штурм — секунда начала подката; Infinity — нет. */
  storm: number;
}

/** Телега дани или добычи: пути — теми же ключами, что у фигур. */
export interface SiegeCarts {
  tracks: Tracks;
  /** Гружёная ли телега (добыча, дань) — мешки поверх. */
  loaded: boolean[];
}

export interface SiegeReel {
  show: SiegeShow;
  quality: Quality;
  layout: SiegeLayout;
  seconds: number;
  episodes: Episode[];
  /** Минута броска каждой фазы на часах ролика (фаза k — `phaseAt[k - 1]`). */
  phaseAt: number[];
  // --- фигуры (`Troupe` общего модуля) ---
  troupe: Troupe;
  tracks: Tracks;
  /** Своя фаза клипа фигуры. */
  phase: Float32Array;
  /** Кто кому: стены, двор, лагерь, народ города, войско из поля. */
  groups: { wall: number[]; yard: number[]; camp: number[]; folk: number[]; field: number[] };
  /** Сколько бойцов на фигуру. */
  k: number;
  // --- машины, камни, стена ---
  machines: ReelMachine[];
  barrage: TwBarrage;
  breach: TwBreach | null;
  arrows: SiegeArrow[];
  gates: GateWindow[];
  /** Ворота выбиты тараном — секунда; нет — не выбиты. */
  gateBroken: number | null;
  ladders: TwLadder[];
  ram: TwRam | null;
  tower: TwSiegeTower | null;
  carts: SiegeCarts;
  /** Факелы на стене: видны ночью. */
  torches: { x: number; y: number; z: number }[];
  /** Леса у пролома: чинят с `from` по `to`. */
  scaffolds: { x: number; width: number; from: number; to: number }[];
  /** Подкат машин штурма: где их отряд по Z на секунде (таран, башня) и когда несут лестницы. */
  paths: { ram: Path | null; tower: Path | null; ladder: { from: number; to: number } | null };
  /** Лестницы видны: построены (машина лагеря) или принесены на себе к штурму; не видны после пожара. */
  laddersShown: { from: number; gone: number };
  // --- камера и свет ---
  cam: TwCamKey[];
  light: LightKey[];
}

/** Путь подката: с `from` по `to` отряд машины идёт от `z0` к `z1`. */
export interface Path {
  from: number;
  to: number;
  z0: number;
  z1: number;
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
/** Фигура на фигуру строя — места на ходу стены. */
const WALK_STEP = 1.35;
/** Лицом к полю (к лагерю, на −Z) и к городу (на +Z). */
const FACE_OUT = Math.PI;
const FACE_IN = 0;

/** Свет между двумя минутами: вперёд, не назад; новая фаза — через ночь (прошли сутки). */
function forward(prev: number, next: number, newDay: boolean): number {
  let d = (((next - prev) % 1) + 1) % 1;
  if (newDay && d < 0.6) d += 1;
  return prev + d;
}

interface Ctx {
  show: SiegeShow;
  quality: Quality;
  lay: SiegeLayout;
  tr: Tracks;
  seed: number;
  groups: SiegeReel['groups'];
  /** Где стоит фигура дома (вернуться после эпизода). */
  home: { x: number; z: number; clip: ClipId; yaw: number }[];
  /** Жива ли фигура (павшие и ушедшие — нет). */
  alive: Uint8Array;
  machines: ReelMachine[];
  engines: TwEngine[];
  /** Номер машины-двигателя в `engines` по роду: камнемёт лагеря, требушет обстрела, орудие города. */
  engineOf: Partial<Record<'mangonel' | 'trebuchet' | 'gun', number>>;
  stones: TwStone[];
  smoke: TwSmoke[];
  bursts: NonNullable<TwBarrage['bursts']>;
  arrows: SiegeArrow[];
  gates: GateWindow[];
  gateBroken: number | null;
  breach: TwBreach | null;
  /** Куски пролома по номеру пролома (0..2): сколько их стоит сейчас. */
  breachUp: number;
  chunks: TwChunk[];
  ladders: TwLadder[];
  ram: TwRam | null;
  tower: TwSiegeTower | null;
  /** Подкат машин штурма: таран и башня — где их отряд по Z на секунде. */
  ramPath: Path | null;
  towerPath: Path | null;
  ladderPath: { from: number; to: number } | null;
  laddersShown: { from: number; gone: number };
  carts: SiegeCarts;
  scaffolds: SiegeReel['scaffolds'];
  cam: TwCamKey[];
  light: LightKey[];
  shortShown: number;
  volleyShown: number;
}

const r = (c: Ctx, a: number, b: number, salt: number): number => hash(c.seed, a * 131 + b, salt);

// ---------------------------------------------------------------------------------------------------------------------
// Фигуры

interface Role {
  group: keyof SiegeReel['groups'];
  face: string;
  kind: UnitKind;
  ours: boolean;
}

/** Сколько фигур у каждой группы и сколько бойцов на фигуру. */
function headcount(show: SiegeShow, quality: Quality, lay: SiegeLayout): { k: number; wall: number; yard: number; camp: number; folk: number; field: number } {
  const per = TW_SPEC[quality].perSide;
  const k = Math.max(1, Math.ceil(Math.max(show.camp, show.garrison, 1) / Math.max(1, per * 0.8)));
  const garrison = clamp(Math.round(show.garrison / k), 6, Math.round(per * 0.45));
  const camp = clamp(Math.round(show.camp / k), 10, Math.round(per * 0.8));
  // Ход стены вмещает столько; остальной гарнизон ждёт во дворе у ворот.
  const room = lay.wall ? Math.floor((lay.wall.halfX * 2 - 14) / WALK_STEP) : Math.round(garrison * 0.6);
  const wall = Math.min(Math.round(garrison * 0.62), room);
  const fieldFights = show.fights.some((f) => f.site === 'camp' || f.site === 'joint');
  return {
    k,
    wall,
    yard: Math.max(4, garrison - wall),
    camp,
    folk: clamp(Math.round(per * 0.06), 8, 30),
    field: fieldFights ? clamp(Math.round(camp * 0.45), 8, Math.round(per * 0.35)) : 0,
  };
}

/** Места на ходу стены: по всей длине, мимо башен и надвратной. */
function walkSpots(lay: SiegeLayout): number[] {
  const w = lay.wall;
  if (!w) return [];
  const out: number[] = [];
  for (let x = -w.halfX + 2; x <= w.halfX - 2; x += WALK_STEP) {
    if (Math.abs(x - w.gateX) < GATEHOUSE / 2 + 0.7) continue;
    if (w.towers.some((t) => Math.abs(x - t.x) < t.size / 2 + 0.5)) continue;
    out.push(Math.round(x * 100) / 100);
  }
  return out;
}

/** Расставить фигуры по местам ролика и собрать их в отряды общего модуля (`Troupe`): толпа и знамёна рисуют их как есть. */
function cast(c: Ctx, n: ReturnType<typeof headcount>): Troupe {
  const { show, lay, tr } = c;
  const def = show.us === 'def';
  const lairSiege = !lay.wall;
  const roles: Role[] = [];
  const garrisonFaces = lairSiege ? ['axeman', 'clubman', 'archer'] : ['spearman', 'archer', 'shieldman'];
  const campFaces = ['spearman', 'axeman', 'archer', 'clubman'];
  const kindOf = (face: string): UnitKind => (face === 'archer' ? 'archer' : face === 'spearman' ? 'spear' : 'infantry');
  const add = (group: Role['group'], face: string, ours: boolean): number => {
    roles.push({ group, face, kind: kindOf(face), ours });
    c.groups[group].push(roles.length - 1);
    return roles.length - 1;
  };
  for (let i = 0; i < n.wall; i++) add('wall', garrisonFaces[i % 3 === 1 ? 1 : i % 3 === 0 ? 0 : 2], def);
  for (let i = 0; i < n.yard; i++) add('yard', garrisonFaces[i % 4 === 3 ? 2 : 0], def);
  for (let i = 0; i < n.camp; i++) add('camp', campFaces[i % 4], !def);
  for (let i = 0; i < n.folk; i++) add('folk', 'militia', def);
  // Войско из поля бьёт по лагерю — сторона осаждённого: наши, если осадили нас.
  for (let i = 0; i < n.field; i++) add('field', i % 3 === 0 ? 'spearman' : 'swordsman', def);
  const total = roles.length;
  for (let i = 0; i < total; i++) tr.keys.push([]);
  c.alive = new Uint8Array(total).fill(1);
  c.home = new Array(total);

  // Стена: ход — по местам, лицом в поле; у логова — у частокола изнутри.
  const spots = walkSpots(lay);
  c.groups.wall.forEach((i, j) => {
    if (lay.wall) {
      const x = spots[Math.round((j + 0.5) * (spots.length / Math.max(1, c.groups.wall.length)) - 0.5)] ?? 0;
      home(c, i, x, lay.walkZ, 'idle', FACE_OUT);
    } else {
      const lair = lay.lair!;
      const x = lair.x0 + 2 + ((j + 0.5) / c.groups.wall.length) * (lair.x1 - lair.x0 - 4);
      home(c, i, x, lair.z0 + 2.2, 'guard', FACE_OUT);
    }
  });
  // Двор у ворот: гарнизон строем лицом к воротам.
  c.groups.yard.forEach((i, j) => {
    const cols = 7;
    const x = lay.yard.x + ((j % cols) - (cols - 1) / 2) * 1.0;
    const z = lay.yard.z + Math.floor(j / cols) * 1.0;
    home(c, i, x, z, 'idle', FACE_OUT);
  });
  // Лагерь: дозор у рогаток лицом к стене; прочие — кольцами у костров (по шесть) и кучками у шатров (по трое), а кому
  // места не хватило — строем между рогатками и шатрами, лицом к стене: лагерь войска, а не толпа у одного огня.
  const camp = lay.camp;
  const guards = Math.round(c.groups.camp.length * 0.32);
  const rest: { x: number; z: number; yaw: number; clip: ClipId }[] = [];
  camp.fires.forEach((f, fi) => {
    for (let a = 0; a < 6; a++) {
      const ang = a * 1.05 + fi;
      const x = f.x + Math.cos(ang) * 1.7;
      const z = f.z + Math.sin(ang) * 1.7;
      rest.push({ x, z, yaw: Math.atan2(f.x - x, f.z - z), clip: 'idle' });
    }
  });
  camp.tents.forEach((tt, ti) => {
    for (let j = 0; j < 3; j++) {
      const ang = r(c, ti, j, 15) * Math.PI * 2;
      const d = tt.size + 1.1 + j * 0.5;
      rest.push({ x: tt.x + Math.cos(ang) * d, z: tt.z + Math.sin(ang) * d, yaw: r(c, ti, j, 16) * Math.PI * 2, clip: 'idle' });
    }
  });
  rest.sort((a, b) => hash(c.seed, Math.round(a.x * 10), Math.round(a.z * 10)) - hash(c.seed, Math.round(b.x * 10), Math.round(b.z * 10)));
  let drill = 0;
  c.groups.camp.forEach((i, j) => {
    if (j < guards) {
      const x = -26 + ((j + 0.5) / guards) * 52 + (r(c, j, 1, 11) - 0.5) * 0.6;
      home(c, i, x, STAKES_Z - 2.2 - (j % 2) * 1.1, 'guard', FACE_IN);
      return;
    }
    const sp = rest[j - guards];
    if (sp) return home(c, i, sp.x, sp.z, sp.clip, sp.yaw);
    const row = Math.floor(drill / 16);
    home(c, i, -12 + (drill % 16) * 1.6, STAKES_Z - 6 - row * 1.3, 'idle', FACE_IN);
    drill++;
  });
  // Народ города — на площади, пока не нужен, его не видно.
  c.groups.folk.forEach((i, j) => {
    const a = j * 0.9;
    home(c, i, lay.square.x + Math.cos(a) * (3 + (j % 3)), lay.square.z + Math.sin(a) * (3 + (j % 3)), 'idle', 0, true);
  });
  // Войско из поля — за краем поля, пока не пришло.
  c.groups.field.forEach((i, j) => home(c, i, -14 + (j % 10) * 1.3, -104 - Math.floor(j / 10) * 1.3, 'idle', FACE_IN, true));

  // Отряды для толпы и знамён: стена слева и справа, двор, дозор, лагерь, народ, поле.
  const units: TroupeUnit[] = [];
  const unitOf = new Int32Array(total);
  const faceIdsList: { id: string; kind: UnitKind }[] = [];
  const faceIndex = new Map<string, number>();
  const faceOf = new Int16Array(total);
  const order: number[] = [];
  const block = (ids: number[], banner: TroupeUnit['banner']): void => {
    if (ids.length === 0) return;
    const first = order.length;
    const u: TroupeUnit = {
      id: units.length,
      ours: roles[ids[0]].ours,
      kind: roles[ids[0]].kind,
      face: roles[ids[0]].face,
      first,
      figures: ids.length,
      ranks: 2,
      depth: 1,
      fleeAt: null,
      banner,
    };
    units.push(u);
    for (const i of ids) {
      order.push(i);
      unitOf[i] = u.id;
    }
  };
  const wallIds = c.groups.wall;
  block(wallIds.filter((i) => c.home[i].x < 0), 'unit');
  block(wallIds.filter((i) => c.home[i].x >= 0), 'unit');
  block(c.groups.yard, 'unit');
  block(c.groups.camp.slice(0, guards), 'unit');
  block(c.groups.camp.slice(guards), show.us === 'atk' ? 'standard' : 'unit');
  block(c.groups.folk, null);
  block(c.groups.field, 'standard');
  for (let i = 0; i < total; i++) {
    const key = `${roles[i].face}:${roles[i].kind}`;
    if (!faceIndex.has(key)) {
      faceIndex.set(key, faceIdsList.length);
      faceIdsList.push({ id: roles[i].face, kind: roles[i].kind });
    }
    faceOf[i] = faceIndex.get(key)!;
  }
  // Номера фигур — по порядку отрядов: у отряда свои подряд (`TroupeUnit.first`). Пути переставляются тем же порядком.
  const remap = new Int32Array(total);
  order.forEach((i, j) => (remap[i] = j));
  const keys = order.map((i) => tr.keys[i]);
  tr.keys.length = 0;
  tr.keys.push(...keys);
  const homes = order.map((i) => c.home[i]);
  c.home = homes;
  c.alive = new Uint8Array(total).fill(1);
  for (const g of Object.keys(c.groups) as (keyof SiegeReel['groups'])[]) c.groups[g] = c.groups[g].map((i) => remap[i]);
  const faceSorted = new Int16Array(total);
  order.forEach((i, j) => (faceSorted[j] = faceOf[i]));
  const unitSorted = new Int32Array(total);
  order.forEach((i, j) => (unitSorted[j] = unitOf[i]));
  // Место в отряде — для знаменосца (`bearerOf`): ближе к середине — он.
  const lx = new Float32Array(total);
  const lz = new Float32Array(total);
  for (const u of units) {
    const xs = Array.from({ length: u.figures }, (_, j) => homes[u.first + j].x);
    const mid = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    for (let j = 0; j < u.figures; j++) {
      lx[u.first + j] = homes[u.first + j].x - mid;
      lz[u.first + j] = j % 2 === 0 ? 0 : -1;
    }
  }
  const scale = new Float32Array(total);
  const tone = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    scale[i] = 0.94 + r(c, i, 3, 13) * 0.12;
    tone[i] = (r(c, i, 4, 14) - 0.5) * 0.24;
  }
  return { units, unitOf: unitSorted, faceOf: faceSorted, faceIds: faceIdsList, lx, lz, scale, tone, deathAt: new Float32Array(total).fill(Infinity) };
}

function home(c: Ctx, i: number, x: number, z: number, clip: ClipId, yaw: number, hidden = false): void {
  c.home[i] = { x, z, clip, yaw };
  c.tr.keys[i] = [{ t: 0, x, z, y: NaN, clip, yaw, hide: hidden }];
}

/** Живые фигуры группы, ближе всех к точке. */
function nearest(c: Ctx, ids: readonly number[], x: number, z: number, n: number, t: number): number[] {
  return ids
    .filter((i) => c.alive[i] && c.tr.standing(i, t))
    .map((i) => ({ i, d: Math.hypot(c.tr.last(i).x - x, c.tr.last(i).z - z) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((o) => o.i);
}

/** Пасть: лежит с `t`, после `gone` — унесли (не видно). */
function die(c: Ctx, i: number, t: number, gone?: number): void {
  c.tr.fall(i, t);
  c.alive[i] = 0;
  if (gone !== undefined) c.tr.hide(i, gone);
}

/** Вернуться домой к `t1` и стоять своим клипом. */
function goHome(c: Ctx, i: number, t0: number, t1: number, move: ClipId = 'march'): void {
  const h = c.home[i];
  c.tr.go(i, t0, t1, h.x, h.z, move, h.clip, h.yaw);
}

/**
 * Пройти воротами: к проезду с этой стороны стены, сквозь него и на шаг за другую сторону — устои ворот фигура не режет.
 * `out` — из города в поле; `lane` — сдвиг по проезду (в пределах его ширины).
 */
function passGate(c: Ctx, i: number, t0: number, speed: number, out: boolean, lane: number, move: ClipId): number {
  const w = c.lay.wall;
  const gx = (w?.gateX ?? 0) + clamp(lane, -0.85, 0.85);
  const inside = w ? w.thick + 1.0 : (c.lay.lair?.z0 ?? 9) + 1;
  const outside = w ? -1.6 : (c.lay.lair?.z0 ?? 9) - 2.5;
  const p = c.tr.last(i);
  const near = out ? inside : outside;
  const far = out ? outside : inside;
  const t1 = t0 + Math.max(0.3, Math.hypot(p.x - gx, p.z - near) / speed);
  c.tr.go(i, t0, t1, gx, near, move, move);
  const t2 = t1 + Math.abs(far - near) / speed;
  c.tr.go(i, t1, t2, gx, far, move, move);
  return t2;
}

// ---------------------------------------------------------------------------------------------------------------------
// Камни, стрелы, дым

/** Камень машины `e` в точку: срыв, полёт, дуга (как у пролога обстрела, `barrage.stone`). */
function throwStone(c: Ctx, e: number, at: number, x1: number, y1: number, z1: number, hit: TwStone['hit'], chunk: number): TwStone {
  const en = c.engines[e];
  const g = ENGINE[en.kind];
  const fwd = g.arm * Math.cos(g.fired);
  const x0 = en.x + Math.sin(en.yaw) * fwd;
  const z0 = en.z + Math.cos(en.yaw) * fwd;
  const y0 = en.y + g.pivot + g.arm * Math.sin(g.fired);
  const dist = Math.hypot(x1 - x0, z1 - z0);
  en.shots.push(at);
  en.shots.sort((a, b) => a - b);
  const lift = dist * (en.kind === 'trebuchet' ? 0.32 : 0.2);
  const s: TwStone = { engine: e, at, flight: 1.5 + dist / 50, x0, y0, z0, x1, y1, z1, lift, hit, chunk, seed: c.seed + e * 131 + Math.round(at * 10) };
  c.stones.push(s);
  return s;
}

/** Залп стрел со стены: лучники на ходу бьют в точку (по разбросу). */
function volleyOfArrows(c: Ctx, from: readonly number[], at: number, tx: number, tz: number, spread: number): void {
  const w = c.lay.wall;
  const y0 = (w ? w.base + w.top : 0) + 1.3;
  from.forEach((i, j) => {
    const p = c.tr.last(i);
    const x1 = tx + (r(c, j, Math.round(at * 10), 21) - 0.5) * spread;
    const z1 = tz + (r(c, j, Math.round(at * 10), 22) - 0.5) * spread * 0.6;
    const dist = Math.hypot(x1 - p.x, z1 - p.z);
    c.arrows.push({ at: at + j * 0.05, flight: 0.9 + dist / 40, x0: p.x, y0, z0: p.z, x1, y1: heightAt(c.lay.field, x1, z1) + 0.1, z1 });
  });
}

/** Лучники стены — живые и стоящие на ходу. */
const archersOf = (c: Ctx, t: number): number[] =>
  c.groups.wall.filter((i, j) => c.alive[i] && c.tr.standing(i, t) && (j % 3 === 1 || j % 7 === 0));

function smokeAt(c: Ctx, x: number, z: number, from: number, size: number, to?: number, y?: number): void {
  c.smoke.push({ x, y: y ?? heightAt(c.lay.field, x, z) + 0.4, z, from, size, ...(to !== undefined ? { to } : {}) });
}

/** Карниз дома: огонь горящего дома встаёт по крыше, а не внутри стен (этажи набора города масштабом сцены). */
const eaveOf = (c: Ctx, h: TwHouse): number => heightAt(c.lay.field, h.x, h.z) + h.floors * STOREY_H * CITY_M;

// ---------------------------------------------------------------------------------------------------------------------
// Пролом

/** Середина пролома: пролёт стены подальше от ворот и башен, ближе к середине (как у пролога, `barrage.breachX`). */
function breachX(c: Ctx, width: number): number {
  const w = c.lay.wall!;
  const stops: [number, number][] = [[w.gateX - 3.4, w.gateX + 3.4]];
  for (const t of w.towers) stops.push([t.x - t.size / 2, t.x + t.size / 2]);
  let best = -12;
  let score = -Infinity;
  const half = width / 2 + 1;
  for (let x = -w.halfX + half + 2; x <= w.halfX - half - 2; x += 0.5) {
    if (stops.some(([a, b]) => x + half > a && x - half < b)) continue;
    const sc = -Math.abs(x + 8) * 0.5 + r(c, Math.round(x * 2), 0, 23) * 0.3;
    if (sc > score) {
      score = sc;
      best = x;
    }
  }
  return best;
}

/** Пролом ролика: ширина — по наибольшему числу проломов за осаду (та же доля, что у ядра: проломы / 3, `breachWidth`). */
const SHARES = [1 / 3, 2 / 3, 1];

function breachOf(c: Ctx): TwBreach | null {
  const w = c.lay.wall;
  const most = Math.max(0, ...c.show.phases.map((p) => p.breaches), c.show.end.breaches);
  if (!w || most <= 0) return null;
  const width = breachWidth(SHARES, most);
  const x = breachX(c, width);
  // Куски — по пролому: первый в середине, следующие — по краям (как залпы пролога).
  const chunks: TwChunk[] = [];
  for (let n = 0; n < most; n++) {
    const prev = breachWidth(SHARES, n) / 2;
    const now = breachWidth(SHARES, n + 1) / 2;
    chunks.push({ spans: n === 0 ? [[x - now, x + now]] : [[x - now, x - prev], [x + prev, x + now]], at: Infinity });
  }
  return { x, width, depth: w.top * clamp(0.5 + (most / 3) * 0.9, 0.5, 0.82), chunks };
}

/** Кусок пролома `n` рухнул в `at`. */
function collapse(c: Ctx, n: number, at: number): void {
  const ch = c.breach!.chunks[n];
  if (!Number.isFinite(ch.at)) ch.at = at;
  else (ch.again ??= []).push({ at });
  c.breachUp = n + 1;
  // Кто стоял на ходу над куском — летит со стены (`wallMen`: пролом снимает долю стоящих на стене).
  const w = c.lay.wall!;
  for (const i of c.groups.wall) {
    if (!c.alive[i] || !c.tr.standing(i, at)) continue;
    const x = c.tr.last(i).x;
    if (!ch.spans.some(([a, b]) => x > a - 0.3 && x < b + 0.3)) continue;
    const z1 = w.z - (1.4 + r(c, i, 5, 24) * 3);
    // Летит с хода: высота — от хода до земли за обвалом, наружу; на ходу он стоял (высота задана, а не по месту).
    c.tr.go(i, at, at + 0.05, x, c.lay.walkZ, 'idle', 'fall', FACE_OUT, c.lay.walkY);
    c.tr.go(i, at + 0.05, at + 0.75, x + (r(c, i, 6, 25) - 0.5) * 2, z1, 'fall', 'fall', FACE_OUT, heightAt(c.lay.field, x, z1));
    c.alive[i] = 0;
  }
}

/** Кусок пролома `n` заделан: встаёт к `at`. */
function mend(c: Ctx, n: number, at: number): void {
  const ch = c.breach!.chunks[n];
  const last = ch.again?.length ? ch.again[ch.again.length - 1] : ch;
  last.back = at;
  c.breachUp = n;
}

/** Сколько проломов стоит открытыми на секунде `t`: рухнувшие и не заделанные куски. */
export function breachesAt(reel: SiegeReel, t: number): number {
  const br = reel.breach;
  if (!br) return 0;
  let n = 0;
  for (const ch of br.chunks) {
    let cycle: { at: number; back?: number } = ch;
    for (const a of ch.again ?? []) if (t >= a.at) cycle = a;
    if (t >= cycle.at && (cycle.back === undefined || t < cycle.back)) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------------
// Камера

const box = (x0: number, x1: number, z0: number, z1: number): TwCamKey['box'] => ({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });

function key(c: Ctx, at: number, b: TwCamKey['box'], yaw: number, pitch: number): void {
  // Ключи — не ближе 1.3 с друг к другу (переход не рвётся на полпути, как у пролога).
  const prev = c.cam[c.cam.length - 1];
  if (prev && at < prev.at + 1.3) at = prev.at + 1.3;
  c.cam.push({ at, box: b, yaw, pitch });
}

/**
 * Общий план: стена и ворота из-за лагеря — шатры на переднем плане. Рамки — под портрет телефона: по горизонтали в кадре
 * 30°, и рамка шире тридцати метров уводит камеру за сотню — люди в точку (ГФ-1, `camera.fovOf`).
 */
function wide(c: Ctx, at: number, yaw = 0.3, pitch = 0.42): void {
  key(c, at, box(-17, 17, -16, c.lay.wall ? 6 : 16), yaw, pitch);
}

// ---------------------------------------------------------------------------------------------------------------------
// Эпизоды

function pitch(c: Ctx, t0: number, len: number): void {
  // Лагерь встал: дозор у рогаток, у костров — свои; четверо носят колья к рогаткам.
  const workers = c.groups.camp.slice(-4);
  workers.forEach((i, j) => {
    const x = -18 + j * 12;
    c.tr.go(i, t0 + 0.4 + j * 0.3, t0 + 2.6 + j * 0.3, x, STAKES_Z - 1.4, 'march', 'strike', FACE_IN);
    goHome(c, i, t0 + 3.8 + j * 0.2, t0 + len - 0.3);
  });
  key(c, t0, box(-14, 14, -10, 6), 0.24, 0.32);
  key(c, t0 + 3.4, box(-14, 14, -42, -24), -0.45, 0.32);
}

function fire(c: Ctx, t0: number, len: number): void {
  const e = c.engineOf.gun;
  if (e === undefined) return;
  const tents = [...c.lay.camp.tents].sort((a, b) => Math.abs(a.x) + Math.abs(a.z + 36) - (Math.abs(b.x) + Math.abs(b.z + 36))).slice(0, 3);
  // Сколько лагеря выбила башня за осаду — столько фигур у шатров, куда легло (`bombard.thinAt` у зовущего).
  const hit = clamp(Math.round(c.show.fire * c.groups.camp.length), 1, 6);
  let killed = 0;
  tents.forEach((tt, j) => {
    const s = throwStone(c, e, t0 + 0.9 + j * 1.5, tt.x, heightAt(c.lay.field, tt.x, tt.z) + 0.6, tt.z, 'hut', -1);
    const land = s.at + s.flight;
    smokeAt(c, tt.x, tt.z, land, 1.25, t0 + len + LAPSE * 2);
    for (const i of nearest(c, c.groups.camp, tt.x, tt.z, Math.ceil(hit / tents.length), land)) {
      if (killed >= hit) break;
      die(c, i, land + 0.1 + killed * 0.07, t0 + len + LAPSE);
      killed++;
    }
  });
  volleyOfArrows(c, archersOf(c, t0).slice(0, 10), t0 + 1.2, 0, STAKES_Z - 2, 30);
  const g = c.lay.spots.gun;
  key(c, t0, box(g.x - 8, g.x + 8, -2, g.z + 6), Math.PI + 0.35, 0.4);
  key(c, t0 + 2.6, box(-14, 14, -48, -30), Math.PI + 0.2, 0.36);
}

function machines(c: Ctx, t0: number, len: number, ids: ShowMachine[]): void {
  const xs: number[] = [];
  const zs: number[] = [];
  for (const id of ids) {
    const m = c.machines.find((x) => x.id === id);
    if (!m) continue;
    m.from = Math.min(m.from, t0 + 0.8);
    if (id === 'mangonel' && c.engineOf.mangonel !== undefined) c.engines[c.engineOf.mangonel].from = m.from;
    xs.push(m.x);
    zs.push(m.z);
    // Расчёт подходит к машине и берётся за работу.
    for (const [j, i] of nearest(c, c.groups.camp.slice(Math.round(c.groups.camp.length * 0.32)), m.x, m.z, 3, t0).entries()) {
      c.tr.go(i, t0 + 0.2 + j * 0.2, t0 + 1.6 + j * 0.2, m.x + (j - 1) * 1.4, m.z - 1.6, 'march', 'strike', Math.atan2(-((j - 1) * 1.4), 1.6));
      goHome(c, i, t0 + len - 1.2, t0 + len + LAPSE * 0.6);
    }
    c.bursts.push({ x: m.x, y: heightAt(c.lay.field, m.x, m.z) + 0.4, z: m.z, at: m.from - 0.1, size: 2 });
  }
  if (xs.length === 0) return;
  const x0 = Math.min(...xs) - 7;
  const x1 = Math.max(...xs) + 7;
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2;
  key(c, t0, box(Math.max(x0, mx - 14), Math.min(x1, mx + 14), Math.min(...zs) - 5, Math.max(...zs) + 4), 0.62, 0.3);
  key(c, t0 + 2.6, box(mx - 16, mx + 16, Math.min(...zs) - 3, 2), 0.25, 0.36);
}

/** Чем бьют в эту фазу: камнемёт лагеря, требушет обстрела (залп). */
function shooters(c: Ctx, p: ShowPhase): number[] {
  const out: number[] = [];
  if (p.volley && c.engineOf.trebuchet !== undefined) out.push(c.engineOf.trebuchet);
  if (p.mangonel && c.engineOf.mangonel !== undefined) out.push(c.engineOf.mangonel);
  return out;
}

function breachEp(c: Ctx, t0: number, len: number, p: ShowPhase, before: number): number {
  const w = c.lay.wall!;
  const br = c.breach!;
  const fell = p.breaches > before;
  const n = before;
  const span = br.chunks[Math.min(n, br.chunks.length - 1)].spans;
  const tx = span.length === 1 ? (span[0][0] + span[0][1]) / 2 : (span[n % 2][0] + span[n % 2][1]) / 2;
  const guns = shooters(c, p);
  const faceZ = w.z - 0.15;
  let at = t0 + len - 2.6;
  if (guns.length > 0) {
    // Пристрелка — в кладку рядом; последний камень рушит кусок (как у пролога).
    guns.forEach((e, j) => {
      throwStone(c, e, t0 + 0.8 + j * 0.5, br.x + (j % 2 === 0 ? -1 : 1) * (br.width / 2 + 1.2), w.base + w.top * 0.55, faceZ, 'wall', -1);
    });
    const last = throwStone(c, guns[guns.length - 1], t0 + 2.6, tx, w.base + w.top * 0.7, faceZ, 'wall', fell ? n : -1);
    at = last.at + last.flight;
  } else {
    // Камнемёта и залпа не было: пролом дала кость — подкоп. Пыль у подножия, кусок оседает.
    c.bursts.push({ x: tx, y: w.base + 0.4, z: w.z - 1.2, at: at - 0.5, size: 3 });
  }
  if (fell) collapse(c, n, at);
  // Стрелки отвечают по машинам и подкопу.
  volleyOfArrows(c, archersOf(c, t0).slice(0, 8), t0 + 1.2, tx, -18, 14);
  // Сначала машины, что бьют (или лагерь, где копают), потом стена у пролома и обвал вплотную.
  const eng = guns.length > 0 ? c.engines[guns[0]] : null;
  if (eng) key(c, t0, box(eng.x - 12, eng.x + 12, eng.z - 6, eng.z + 10), 0.42, 0.3);
  else key(c, t0, box(br.x - 12, br.x + 12, -24, -8), 0.3, 0.32);
  key(c, t0 + 2.2, box(br.x - 9, br.x + 9, -8, 3), 0.3, 0.34);
  key(c, Math.max(t0 + 3.6, at - 1.1), box(br.x - 7, br.x + 7, -6, 2), -0.35, 0.3);
  return at;
}

function volleyEp(c: Ctx, t0: number, p: ShowPhase): void {
  const w = c.lay.wall;
  const guns = shooters(c, p);
  if (!w || guns.length === 0) return;
  guns.forEach((e, j) => {
    throwStone(c, e, t0 + 0.7 + j * 0.6, -6 + j * 14, w.base + w.top * 0.5, w.z - 0.15, 'wall', -1);
    // Перелёт — в дом за стеной, он дымит.
    const h = c.lay.site.houses[(j * 7 + c.seed) % Math.max(1, c.lay.site.houses.length)];
    if (h) {
      const s = throwStone(c, e, t0 + 2.1 + j * 0.6, h.x, eaveOf(c, h) + 0.8, h.z, 'over', -1);
      smokeAt(c, h.x, h.z, s.at + s.flight, 0.8, s.at + s.flight + 14, eaveOf(c, h) + 0.6);
    }
  });
  key(c, t0, box(-14, 14, -40, -24), 0.4, 0.34);
  key(c, t0 + 2.2, box(-12, 12, -6, 14), 0.3, 0.46);
}

function repair(c: Ctx, t0: number, len: number, n: number): void {
  const br = c.breach!;
  const back = t0 + 1.4;
  mend(c, n, back);
  c.scaffolds.push({ x: br.x, width: br.width * 0.6, from: t0 + 0.2, to: t0 + len + 0.4 });
  const w = c.lay.wall!;
  // Чинят изнутри: защитники со двора — к пролому, берутся за кладку.
  for (const [j, i] of nearest(c, c.groups.yard, br.x, w.thick + 1, 5, t0).entries()) {
    c.tr.go(i, t0, t0 + 1.2, br.x + (j - 2) * 1.2, w.thick + 0.9, 'run', 'strike', FACE_OUT);
    goHome(c, i, t0 + len - 0.8, t0 + len + LAPSE * 0.6);
  }
  key(c, t0, box(br.x - 7, br.x + 7, -3, 8), Math.PI + 0.3, 0.4);
}

function plague(c: Ctx, t0: number, len: number, p: ShowPhase): void {
  // Мор — доля лагеря, ушедшая в эту фазу (`PhaseRow.waste`): столько фигур слегло у шатров.
  const live = c.groups.camp.filter((i) => c.alive[i]);
  const sick = clamp(Math.round(p.waste * live.length), 2, Math.max(2, Math.floor(live.length * 0.4)));
  const pool = live.slice(Math.round(live.length * 0.32));
  for (let j = 0; j < sick && j < pool.length; j++) {
    const i = pool[(j * 7 + p.k) % pool.length];
    if (!c.alive[i]) continue;
    die(c, i, t0 + 0.8 + j * 0.25, t0 + len + LAPSE * 0.7);
  }
  // Погребальные костры за шатрами.
  const cz = c.lay.camp.z0 + 4;
  smokeAt(c, -10, cz, t0 + 0.4, 1.2, t0 + len + 4);
  smokeAt(c, 12, cz - 3, t0 + 1.1, 1, t0 + len + 4);
  key(c, t0, box(-14, 14, -54, -34), 0.25, 0.32);
  key(c, t0 + 2.4, box(-10, 10, -50, -38), -0.4, 0.28);
}

/** Истощение без эпизода: доля лагеря тихо уходит между эпизодами. */
function waste(c: Ctx, t: number, p: ShowPhase): void {
  const live = c.groups.camp.filter((i) => c.alive[i]);
  const gone = Math.round(p.waste * live.length);
  for (let j = 0; j < gone; j++) {
    const i = live[live.length - 1 - ((j * 5 + p.k) % live.length)];
    if (!c.alive[i]) continue;
    c.tr.hide(i, t);
    c.alive[i] = 0;
  }
}

function short(c: Ctx, t0: number, len: number): void {
  // Нехватка в городе: у колодца толпа за хлебом.
  c.groups.folk.forEach((i, j) => {
    const h = c.home[i];
    c.tr.appear(i, t0, h.x, h.z, 'idle', Math.atan2(c.lay.square.x - h.x, c.lay.square.z - h.z));
    if (j % 3 === 0) c.tr.act(i, t0 + 1.2, 'guard');
    c.tr.hide(i, t0 + len + 0.2);
  });
  key(c, t0, box(-12, 12, 14, 36), 0, 0.58);
}

/** Вылазка: из ворот к машине или к рогаткам, бой, назад. */
function sortie(c: Ctx, t0: number, len: number, f: ShowFight): void {
  const lay = c.lay;
  const m = f.machine ? c.machines.find((x) => x.id === f.machine) : null;
  const tx = m ? m.x : 0;
  const tz = m ? m.z + 2.4 : STAKES_Z + 1.2;
  c.gates.push({ open: t0 + 0.5, close: t0 + len - 0.6 });
  const goers = c.groups.yard.filter((i) => c.alive[i]).slice(0, 14);
  const gx = lay.wall?.gateX ?? 0;
  goers.forEach((i, j) => {
    const lane = (j % 4) - 1.5;
    const out = passGate(c, i, t0 + 0.6 + j * 0.08, 3.2, true, lane * 0.5, 'run');
    c.tr.go(i, out, Math.max(out + 0.4, t0 + 3.4), tx + lane * 1.2 + (r(c, j, 7, 26) - 0.5), tz + 1 + Math.floor(j / 4) * 0.9, 'run', 'strike', Math.atan2(tx - gx, tz));
  });
  // Охрана — сторона лагеря у города: дозор встречает их.
  const guard = nearest(c, c.groups.camp, tx, tz, Math.max(4, Math.round(goers.length * 0.8)), t0);
  guard.forEach((i, j) => c.tr.go(i, t0 + 1.4, t0 + 3.2, tx + ((j % 5) - 2) * 1.2, tz - 1 - Math.floor(j / 5) * 0.9, 'run', 'strike', FACE_IN));
  const end = t0 + 5.4;
  if (f.won) {
    for (const i of guard.slice(0, Math.ceil(guard.length * 0.5))) die(c, i, t0 + 3.8 + r(c, i, 8, 27) * 1.4, t0 + len + LAPSE);
    if (m) {
      m.gone = Math.min(m.gone, t0 + 5.6);
      if (m.id === 'mangonel' && c.engineOf.mangonel !== undefined) c.engines[c.engineOf.mangonel].gone = m.gone;
      smokeAt(c, m.x, m.z, t0 + 4.4, 1.7, t0 + len + LAPSE * 3);
    }
  } else {
    for (const i of goers.slice(0, Math.ceil(goers.length * 0.35))) die(c, i, t0 + 3.9 + r(c, i, 9, 28) * 1.2, t0 + len + LAPSE);
  }
  for (const i of goers) {
    if (!c.alive[i]) continue;
    const back = passGate(c, i, end, 3.4, false, (r(c, i, 17, 36) - 0.5) * 1.4, 'run');
    goHome(c, i, back, Math.max(back + 0.3, t0 + len - 0.4), 'march');
  }
  for (const i of guard) if (c.alive[i]) goHome(c, i, end + 0.3, t0 + len + 0.5);
  volleyOfArrows(c, archersOf(c, t0).slice(0, 12), t0 + 2.2, tx, tz - 6, 10);
  key(c, t0, box(gx - 9, gx + 9, Math.max(tz, -16), 6), Math.PI - 0.25, 0.46);
  key(c, t0 + 2.6, box(tx - 8, tx + 8, tz - 6, tz + 6), Math.PI / 2 + 0.25, 0.3);
  key(c, t0 + 5.2, box(-14, 14, tz - 6, 6), 0.3, 0.42);
}

/** Удар по лагерю из поля — полководец, выручка союзника; совместный — ещё и гарнизон из ворот (клещи). */
function relief(c: Ctx, t0: number, len: number, f: ShowFight): void {
  const camp = c.lay.camp;
  const rearZ = camp.z0 - 3;
  const field = c.groups.field.filter((i) => c.alive[i]);
  field.forEach((i, j) => {
    const x = -14 + (j % 10) * 1.3;
    const z = -100 - Math.floor(j / 10) * 1.3;
    c.tr.appear(i, t0, x, z, 'march', FACE_IN);
    c.tr.go(i, t0 + 0.2, t0 + 3.6, x * 1.4, rearZ - 1 - Math.floor(j / 10) * 1.0, 'run', 'strike', FACE_IN);
  });
  const back = nearest(c, c.groups.camp, 0, rearZ + 4, Math.max(4, Math.round(field.length * 0.7)), t0);
  back.forEach((i, j) => c.tr.go(i, t0 + 2, t0 + 3.4, -10 + (j % 12) * 1.8, rearZ + 1.5, 'run', 'strike', FACE_OUT));
  if (f.site === 'joint') {
    // Клещи: гарнизон из ворот бьёт лагерь в лицо.
    c.gates.push({ open: t0 + 0.6, close: t0 + len - 0.5 });
    const goers = c.groups.yard.filter((i) => c.alive[i]).slice(0, 12);
    goers.forEach((i, j) => {
      const out = passGate(c, i, t0 + 0.7 + j * 0.08, 3.2, true, ((j % 4) - 1.5) * 0.5, 'run');
      c.tr.go(i, out, Math.max(out + 0.4, t0 + 3.6), -8 + (j % 6) * 3, STAKES_Z + 1, 'run', 'strike', Math.PI);
    });
    for (const i of goers) {
      if (!c.alive[i]) continue;
      const back = passGate(c, i, t0 + 5.8, 3.4, false, (r(c, i, 18, 37) - 0.5) * 1.4, 'run');
      goHome(c, i, back, Math.max(back + 0.3, t0 + len - 0.3), 'march');
    }
  }
  if (f.won) {
    for (const i of back.slice(0, Math.ceil(back.length * 0.6))) die(c, i, t0 + 3.9 + r(c, i, 10, 29) * 1.5, t0 + len + LAPSE);
    smokeAt(c, -6, camp.z0 + 2, t0 + 4.2, 1.4, t0 + len + LAPSE * 4);
  } else {
    for (const i of field.slice(0, Math.ceil(field.length * 0.35))) die(c, i, t0 + 4 + r(c, i, 11, 30) * 1.4, t0 + len + LAPSE);
    for (const i of field) if (c.alive[i]) c.tr.go(i, t0 + 5.6, t0 + len, c.tr.last(i).x, -112, 'run', 'run');
    for (const i of field) c.tr.hide(i, t0 + len + 0.1);
  }
  for (const i of back) if (c.alive[i]) goHome(c, i, t0 + 6, t0 + len + 0.6);
  key(c, t0, box(-14, 14, -100, -76), 0.1, 0.38);
  key(c, t0 + 3, box(-14, 14, rearZ - 8, rearZ + 8), Math.PI / 2 - 0.3, 0.32);
  if (f.site === 'joint') key(c, t0 + 5, box(-16, 16, rearZ - 2, 2), 0.4, 0.5);
}

/** Штурм: таран к воротам, башня к стене, лестницы, лезут на ход. Отбитый — откатываются; взявший — город наш. */
function assault(c: Ctx, t0: number, len: number, won: boolean, use: ReadonlySet<string>): void {
  const w = c.lay.wall;
  if (!w) {
    // Логово: идут на частокол всей толпой.
    const lair = c.lay.lair!;
    const attackers = c.groups.camp.filter((i) => c.alive[i]).slice(0, Math.round(c.groups.camp.length * 0.7));
    attackers.forEach((i, j) => c.tr.go(i, t0 + 0.4 + j * 0.03, t0 + 3.4, lair.x0 + 2 + (j % 20) * ((lair.x1 - lair.x0 - 4) / 20), lair.z0 - 1.2 - Math.floor(j / 20), 'run', 'strike', FACE_IN));
    const def = c.groups.wall.filter((i) => c.alive[i]);
    if (won) for (const i of def.slice(0, Math.ceil(def.length * 0.6))) die(c, i, t0 + 3.6 + r(c, i, 12, 31) * 2.4);
    else for (const i of attackers.slice(0, Math.ceil(attackers.length * 0.3))) die(c, i, t0 + 3.6 + r(c, i, 13, 32) * 2, t0 + len + LAPSE);
    if (!won) for (const i of attackers) if (c.alive[i]) goHome(c, i, t0 + 6, t0 + len + 0.6, 'run');
    key(c, t0, box(-16, 16, -12, lair.z1), 0.25, 0.42);
    key(c, t0 + 3, box(-14, 14, lair.z0 - 8, lair.z0 + 6), 0.5, 0.32);
    return;
  }
  const attackers = c.groups.camp.filter((i) => c.alive[i]).slice(0, Math.round(c.groups.camp.length * 0.75));
  const climbAt = t0 + 4.4;
  // Лестницы: построенные — на весь остаток фронта, на себе — на треть (`world/wall`), в ролике — слоты у стены.
  const ladderXs = use.has('ladders') ? [-34, -24, -16, 16, 26, 34] : use.has('scaling') ? [-22, -14] : [];
  const br = c.breach;
  const clear = (x: number): boolean => !w.towers.some((t) => Math.abs(x - t.x) < t.size / 2 + 0.8) && Math.abs(x) > GATEHOUSE / 2 + 1 && (!br || Math.abs(x - br.x) > br.width / 2 + 1);
  const lx = ladderXs.filter(clear);
  if (c.ladders.length > 0 && use.has('ladders')) for (const l of c.ladders) l.raiseAt = climbAt;
  else if (lx.length > 0) {
    // На себе: лестницы приносят к штурму (`SCALING`, треть стены).
    c.ladders.length = 0;
    lx.forEach((x) => c.ladders.push({ x, unit: 0, raiseAt: climbAt, queue: [] }));
    c.laddersShown = { from: t0 + 0.4, gone: Infinity };
  }
  c.ladderPath = c.ladders.length ? { from: t0 + 0.6, to: climbAt - 0.5 } : null;
  const ladderMachine = c.machines.find((m) => m.id === 'ladders');
  if (ladderMachine && use.has('ladders')) ladderMachine.storm = t0 + 0.6;
  const ladderX = c.ladders.map((l) => l.x);
  // Таран — к воротам, бьёт; ворота падают, если штурм их открыл.
  if (use.has('gate') && c.ram) {
    c.ramPath = { from: t0 + 0.6, to: t0 + 3.6, z0: c.lay.spots.ram.z, z1: -1.4 };
    c.ram.hits = [t0 + 4.1, t0 + 4.1 + RAM_PERIOD, t0 + 4.1 + RAM_PERIOD * 2];
    c.gateBroken = t0 + 4.1 + RAM_PERIOD * 2 + 0.05;
    const ramM = c.machines.find((m) => m.id === 'ram');
    if (ramM) ramM.storm = t0 + 0.6;
    c.bursts.push({ x: w.gateX, y: w.base + 1, z: w.z - 1, at: c.gateBroken, size: 2.4 });
  }
  if (use.has('tower') && c.tower) {
    c.towerPath = { from: t0 + 0.6, to: t0 + 4.6, z0: c.lay.spots.tower.z, z1: -4.5 };
    c.tower.at = t0 + 5.2;
    const tm = c.machines.find((m) => m.id === 'tower');
    if (tm) tm.storm = t0 + 0.6;
  }
  // Кто куда: к лестницам, к пролому, к воротам — по очереди.
  const targets: { x: number; kind: 'ladder' | 'breach' | 'gate' | 'tower' }[] = [];
  for (const x of ladderX) targets.push({ x, kind: 'ladder' });
  if (br && breachesUp(c, t0) > 0) targets.push({ x: br.x, kind: 'breach' });
  if (use.has('gate')) targets.push({ x: w.gateX, kind: 'gate' });
  if (use.has('tower') && c.tower) targets.push({ x: c.tower.x, kind: 'tower' });
  if (targets.length === 0) targets.push({ x: -20, kind: 'ladder' }, { x: 20, kind: 'ladder' });
  const top = w.base + w.top;
  attackers.forEach((i, j) => {
    const tg = targets[j % targets.length];
    const row = Math.floor(j / targets.length);
    const x = tg.x + ((row % 5) - 2) * 0.9;
    const reach = t0 + 2.6 + (j % 7) * 0.12;
    c.tr.go(i, t0 + 0.5 + (j % 9) * 0.05, reach, x, -2.6 - (row % 4) * 0.9, 'run', 'guard', FACE_IN);
    if (!won) return;
    // Взяли: первые лезут на ход (лестница, пролом, мост башни), за ними — в ворота, когда те упадут.
    if (tg.kind === 'gate') {
      const at = Math.max(reach + 0.2, (c.gateBroken ?? reach) + 0.3 + row * 0.15);
      const inn = passGate(c, i, at, 3, false, ((row % 3) - 1) * 0.6, 'run');
      c.tr.go(i, inn, inn + 1.4, w.gateX + ((row % 3) - 1) * 0.8, 8 + (row % 6) * 0.9, 'run', 'strike', FACE_IN);
    } else if (row < 3) {
      const at = climbAt + 0.4 + row * 0.9 + (j % 3) * 0.2;
      c.tr.go(i, at, at + 1.4, x, c.lay.walkZ, tg.kind === 'breach' ? 'run' : 'march', 'strike', FACE_IN, top);
    }
  });
  const defenders = c.groups.wall.filter((i) => c.alive[i]);
  volleyOfArrows(c, archersOf(c, t0).slice(0, 14), t0 + 1.4, 0, -10, 40);
  volleyOfArrows(c, archersOf(c, t0).slice(0, 14), t0 + 3.0, 0, -5, 40);
  if (won) {
    for (const [j, i] of defenders.entries()) if (j % 2 === 0) die(c, i, climbAt + 1.2 + r(c, i, 14, 33) * 3);
  } else {
    // Отбили: со стены и с лестниц падают нападающие, остальные откатываются.
    for (const i of attackers.slice(0, Math.ceil(attackers.length * 0.3))) die(c, i, climbAt - 0.6 + r(c, i, 15, 34) * 2.4, t0 + len + LAPSE);
    for (const i of attackers) if (c.alive[i]) goHome(c, i, t0 + len - 2.2, t0 + len + 0.8, 'run');
  }
  key(c, t0, box(-16, 16, -22, 2), 0.08, 0.36);
  if (use.has('gate')) key(c, t0 + 2.8, box(-8, 8, -11, 3), 0.55, 0.3);
  const lx0 = ladderX.length ? Math.min(...ladderX) : -16;
  key(c, t0 + 4.4, box(Math.max(-22, lx0 - 4), Math.max(-22, lx0 - 4) + 26, -9, 3), -0.42, 0.34);
  if (won && c.gateBroken !== null) key(c, c.gateBroken - 0.4, box(-8, 8, -7, 10), 0.3, 0.38);
}

const breachesUp = (c: Ctx, t: number): number =>
  c.breach ? c.breach.chunks.filter((ch) => {
    let cycle: { at: number; back?: number } = ch;
    for (const a of ch.again ?? []) if (t >= a.at) cycle = a;
    return t >= cycle.at && (cycle.back === undefined || t < cycle.back);
  }).length : 0;

/** Сдача: ворота настежь, гарнизон выходит живым колонной, лагерь стоит коридором, потом входит в город. */
function surrender(c: Ctx, t0: number, len: number): void {
  const lay = c.lay;
  const w = lay.wall;
  const gx = w?.gateX ?? 0;
  c.gates.push({ open: t0 + 0.4, close: null });
  // Коридор: дозор лагеря встаёт двумя рядами вдоль дороги от ворот.
  const guard = c.groups.camp.filter((i) => c.alive[i]).slice(0, 16);
  guard.forEach((i, j) => {
    const side = j % 2 === 0 ? -1 : 1;
    c.tr.go(i, t0 + 0.2, t0 + 2.2, gx + side * 3.2, -5 - Math.floor(j / 2) * 2.2, 'march', 'guard', side < 0 ? Math.PI / 2 : -Math.PI / 2);
  });
  // Гарнизон: двор первым, потом со стены — по лестницам у надвратной вниз, во двор и в ворота; уходит в поле живым.
  const out: number[] = [...c.groups.yard, ...c.groups.wall].filter((i) => c.alive[i]);
  const exitX = -70;
  out.forEach((i, j) => {
    const at = t0 + 1.0 + j * 0.16;
    const p = c.tr.last(i);
    if (w && Number.isNaN(p.y) && Math.abs(p.z - lay.walkZ) < 0.5) {
      // Со стены — к лестнице у надвратной и вниз во двор.
      const sx = (p.x < 0 ? -1 : 1) * (GATEHOUSE / 2 + 1.4);
      c.tr.go(i, at, at + Math.abs(p.x - sx) / 3.2, sx, lay.walkZ, 'march', 'march', undefined, w.base + w.top);
      const t1 = c.tr.last(i).t;
      c.tr.go(i, t1, t1 + 1.1, sx, w.thick + 1.6, 'march', 'march', FACE_OUT, w.base);
    }
    const t2 = Math.max(c.tr.last(i).t, at);
    const out = passGate(c, i, t2, 1.6, true, ((j % 2) - 0.5) * 1.1, 'march');
    c.tr.go(i, out, out + 1.6 * 8, gx + ((j % 2) - 0.5) * 1.1, -24, 'march', 'march');
    c.tr.go(i, c.tr.last(i).t, c.tr.last(i).t + 6, exitX, -30 - (j % 5), 'march', 'march');
    c.tr.hide(i, c.tr.last(i).t);
    c.alive[i] = 0;
  });
  // Лагерь входит в город.
  const enter = c.groups.camp.filter((i) => c.alive[i] && !guard.includes(i)).slice(0, 20);
  enter.forEach((i, j) => {
    const at = t0 + len * 0.62 + j * 0.12;
    const inn = passGate(c, i, at, 1.7, false, ((j % 3) - 1) * 0.8, 'march');
    c.tr.go(i, inn, inn + 2.4, gx + ((j % 4) - 1.5) * 1.6, lay.square.z - 4 + Math.floor(j / 4), 'march', 'cheer', FACE_IN);
  });
  key(c, t0, box(gx - 10, gx + 10, -14, 6), 0.22, 0.3);
  key(c, t0 + 3.2, box(gx - 16, gx + 2, -22, 0), 0.62, 0.32);
  key(c, t0 + len * 0.62, box(gx - 9, gx + 9, -6, 24), 0.1, 0.46);
}

/** Голод: ворота настежь, гарнизон расходится в поле, лагерь входит в пустой город. */
function hunger(c: Ctx, t0: number, len: number): void {
  const lay = c.lay;
  const w = lay.wall;
  const gx = w?.gateX ?? 0;
  c.gates.push({ open: t0 + 0.8, close: null });
  const out = [...c.groups.yard, ...c.groups.wall].filter((i) => c.alive[i]);
  out.forEach((i, j) => {
    const at = t0 + 1 + (j % 12) * 0.12;
    const p = c.tr.last(i);
    // Кто послабее — остаётся сидеть на ходу; прочие — вниз и прочь, кто куда.
    if (j % 5 === 4) {
      c.tr.act(i, at, 'idle');
      return;
    }
    if (w && Number.isNaN(p.y) && Math.abs(p.z - lay.walkZ) < 0.5) {
      const sx = (p.x < 0 ? -1 : 1) * (GATEHOUSE / 2 + 1.4);
      c.tr.go(i, at, at + Math.abs(p.x - sx) / 3.2, sx, lay.walkZ, 'march', 'march', undefined, w.base + w.top);
      const t1 = c.tr.last(i).t;
      c.tr.go(i, t1, t1 + 1, sx, w.thick + 1.6, 'march', 'march', FACE_OUT, w.base);
    }
    const t2 = Math.max(c.tr.last(i).t, at);
    passGate(c, i, t2, 2.6, true, ((j % 3) - 1) * 0.6, 'run');
    const side = j % 2 === 0 ? -1 : 1;
    c.tr.go(i, c.tr.last(i).t, c.tr.last(i).t + 4, side * (60 + (j % 9) * 2), -6 - (j % 7) * 2, 'run', 'run');
    c.tr.hide(i, c.tr.last(i).t);
    c.alive[i] = 0;
  });
  const enter = c.groups.camp.filter((i) => c.alive[i]).slice(0, 20);
  enter.forEach((i, j) => {
    const at = t0 + len * 0.55 + j * 0.1;
    const inn = passGate(c, i, at, 1.7, false, ((j % 3) - 1) * 0.8, 'march');
    c.tr.go(i, inn, inn + 2.2, gx + ((j % 4) - 1.5) * 1.6, lay.square.z - 4 + Math.floor(j / 4), 'march', 'cheer', FACE_IN);
  });
  key(c, t0, box(-16, 16, -18, 8), 0.3, 0.44);
  key(c, t0 + 2.4, box(gx - 12, gx + 12, -12, 6), -0.2, 0.34);
  key(c, t0 + len * 0.55, box(gx - 9, gx + 9, -6, 24), 0.1, 0.46);
}

/** Лагерь разбит: бегут в поле, шатры горят, на стене ликуют. */
function broken(c: Ctx, t0: number, len: number): void {
  const camp = c.lay.camp;
  for (const [j, i] of c.groups.camp.entries()) {
    if (!c.alive[i]) continue;
    const at = t0 + 0.4 + (j % 10) * 0.08;
    c.tr.go(i, at, at + 4.2, c.tr.last(i).x * 1.3 + (r(c, j, 16, 35) - 0.5) * 8, -114, 'run', 'run');
    c.tr.hide(i, at + 4.2);
    c.alive[i] = 0;
  }
  const burning = [...camp.tents].sort((a, b) => Math.abs(a.x) - Math.abs(b.x)).slice(0, c.quality === 'low' ? 3 : 6);
  for (const [j, tt] of burning.entries()) smokeAt(c, tt.x, tt.z, t0 + 0.8 + j * 0.4, 1.35 + (j % 2) * 0.25);
  for (const i of [...c.groups.wall, ...c.groups.field]) if (c.alive[i] && c.tr.standing(i, t0)) c.tr.act(i, t0 + 2, 'cheer');
  key(c, t0, box(-14, 14, -48, -24), Math.PI + 0.3, 0.4);
  key(c, t0 + 3, box(-16, 16, -84, -40), Math.PI + 0.1, 0.46);
}

/** Лагерь растаял или ушёл: уцелевшие уходят в поле. */
function leave(c: Ctx, t0: number, len: number, pyres: boolean): void {
  const live = c.groups.camp.filter((i) => c.alive[i]);
  live.forEach((i, j) => {
    const at = t0 + 0.6 + (j % 14) * 0.12;
    c.tr.go(i, at, at + len - 0.8, -4 + (j % 8) * 1.2, -116, 'march', 'march');
    c.tr.hide(i, at + len - 0.8);
    c.alive[i] = 0;
  });
  if (pyres) smokeAt(c, 4, c.lay.camp.z0 + 3, t0 + 0.3, 0.8, t0 + len + 2);
  key(c, t0, box(-16, 16, -58, -26), 0.05, 0.42);
  key(c, t0 + 2.4, box(-16, 16, -104, -60), 0.2, 0.46);
}

/** Телеги дани или добычи: из ворот к лагерю (у выкупа логова — от частокола к нашему лагерю). */
function cartsOut(c: Ctx, t0: number, n: number, loaded: boolean): void {
  const tr = c.carts.tracks;
  const gx = c.lay.wall?.gateX ?? 0;
  const fromZ = c.lay.wall ? c.lay.yard.z : c.lay.lair!.z0;
  for (let j = 0; j < n; j++) {
    const i = tr.count;
    tr.keys.push([{ t: 0, x: gx + (j % 2 === 0 ? -0.9 : 0.9), z: fromZ + j * 3.4, y: NaN, clip: 'idle', yaw: FACE_OUT, hide: true }]);
    c.carts.loaded.push(loaded);
    const at = t0 + 0.6 + j * 1.1;
    tr.appear(i, at, gx + (j % 2 === 0 ? -0.9 : 0.9), fromZ, 'march', FACE_OUT);
    tr.go(i, at, at + 4.6, -6 + j * 4, STAKES_Z - 8, 'march', 'idle');
  }
}

function tribute(c: Ctx, t0: number, len: number, kind: 'paid' | 'ransom'): void {
  if (c.lay.wall) c.gates.push({ open: t0 + 0.4, close: t0 + len - 1 });
  cartsOut(c, t0, kind === 'paid' ? 3 : 2, true);
  const live = c.groups.camp.filter((i) => c.alive[i]);
  live.forEach((i, j) => {
    const at = t0 + len * 0.55 + (j % 14) * 0.1;
    c.tr.go(i, at, at + 4, -4 + (j % 8) * 1.2, -100, 'march', 'march');
    c.tr.hide(i, at + 4);
    c.alive[i] = 0;
  });
  key(c, t0, box(-10, 10, -14, 8), 0.25, 0.32);
  key(c, t0 + 2.8, box(-14, 14, -36, -6), 0.45, 0.4);
}

/** Участь взятого города: обоз с добром, колонна уведённых, город в огне. */
function fate(c: Ctx, t0: number, len: number): void {
  const lay = c.lay;
  const f = c.show.end.fate ?? 'plunder';
  // Победители ликуют у ворот и на стене.
  const winners = c.groups.camp.filter((i) => c.alive[i] && c.tr.standing(i, t0));
  for (const i of winners.slice(0, 12)) c.tr.act(i, t0 + 0.3, 'cheer');
  if (f === 'burn') {
    const houses = [...lay.site.houses].sort((a, b) => Math.hypot(a.x, a.z - lay.square.z) - Math.hypot(b.x, b.z - lay.square.z)).slice(0, c.quality === 'low' ? 5 : c.quality === 'medium' ? 10 : 14);
    houses.forEach((h, j) => smokeAt(c, h.x, h.z, t0 + 0.3 + j * 0.3, 1.5 + (j % 3) * 0.3, undefined, eaveOf(c, h) + 0.6));
    if (!lay.wall && lay.lair) for (const [j, h] of lay.lair.tents.slice(0, 8).entries()) smokeAt(c, h.x, h.z, t0 + 0.3 + j * 0.3, 1.3);
  } else if (f === 'captives') {
    // Уводят людей: народ города колонной из ворот к лагерю, по бокам — конвой.
    c.groups.folk.forEach((i, j) => {
      const at = t0 + 0.4 + j * 0.18;
      const h = c.home[i];
      c.tr.appear(i, at, h.x, h.z, 'march', FACE_OUT);
      const out = passGate(c, i, at, 1.6, true, ((j % 2) - 0.5) * 0.9, 'march');
      c.tr.go(i, out, out + 5, -8 + (j % 3), -52 - (j % 4), 'march', 'idle', FACE_OUT);
    });
  } else {
    cartsOut(c, t0, 3, true);
    // Грабёж: из дома тянет дымом.
    const h = lay.site.houses[c.seed % Math.max(1, lay.site.houses.length)];
    if (h) smokeAt(c, h.x, h.z, t0 + 0.5, 0.6, t0 + len + 4, eaveOf(c, h) + 0.6);
  }
  if (f === 'burn') {
    key(c, t0, box(-12, 12, 6, 30), 0.2, 0.4);
    key(c, t0 + 3, box(-16, 16, -6, 32), -0.35, 0.46);
  } else {
    key(c, t0, box(-12, 12, -6, 20), 0.2, 0.42);
    key(c, t0 + 2.8, box(-14, 14, -36, -2), 0.6, 0.4);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Сборка

/** Порядок эпизодов по осаде: что и в какую фазу. Длина и свет — у каждого свои. */
function planOf(show: SiegeShow): Episode[] {
  const eps: Episode[] = [{ kind: 'pitch', k: 0, at: 0, len: EPISODE_SECONDS.pitch, solar: show.solar0 }];
  if (show.fire > 0 && show.tower > 0 && show.wall > 0) eps.push({ kind: 'fire', k: 0, at: 0, len: EPISODE_SECONDS.fire, solar: show.solar0 });
  let shortN = 0;
  let volleyN = 0;
  const readyShown = new Set<ShowMachine>();
  const machinesAt = (k: number): ShowMachine[] =>
    show.machines.filter((m) => m.ready !== null && m.ready <= k && !readyShown.has(m.id) && (m.burned === null || m.burned >= k)).map((m) => m.id);
  const last = Math.max(show.end.k, show.phases.length);
  for (let k = 0; k <= last; k++) {
    const ready = machinesAt(k);
    if (ready.length > 0) {
      ready.forEach((id) => readyShown.add(id));
      const sol = show.machines.find((m) => m.id === ready[0])?.solar ?? show.solar0;
      eps.push({ kind: 'machines', k, at: 0, len: EPISODE_SECONDS.machines, solar: sol, machines: ready });
    }
    for (const f of show.fights.filter((x) => x.k === k && !x.end)) {
      const kind: EpisodeKind = fightEpisode(f.site);
      eps.push({ kind, k, at: 0, len: EPISODE_SECONDS[kind], solar: f.solar, fight: f });
    }
    const p = show.phases[k - 1];
    if (!p) continue;
    if (p.repaired > 0 && show.wall > 0) eps.push({ kind: 'repair', k, at: 0, len: EPISODE_SECONDS.repair, solar: p.solar });
    if (p.out === 'breach') {
      if (show.wall > 0) eps.push({ kind: 'breach', k, at: 0, len: EPISODE_SECONDS.breach, solar: p.solar });
    } else if (p.out === 'plague') eps.push({ kind: 'plague', k, at: 0, len: EPISODE_SECONDS.plague, solar: p.solar });
    else if (p.out === 'short' && shortN < SHORT_SHOWN && show.wall > 0) {
      shortN++;
      eps.push({ kind: 'short', k, at: 0, len: EPISODE_SECONDS.short, solar: p.solar });
    } else if ((p.volley || p.mangonel) && p.out !== 'gates' && volleyN < VOLLEY_SHOWN && show.wall > 0) {
      volleyN++;
      eps.push({ kind: 'volley', k, at: 0, len: EPISODE_SECONDS.volley, solar: p.solar });
    }
  }
  const how = show.end.how;
  const endFight = show.fights.find((f) => f.end);
  eps.push({ kind: how, k: show.end.k, at: 0, len: EPISODE_SECONDS[how], solar: show.end.solar, ...(endFight ? { fight: endFight } : {}) });
  if (show.end.fate) eps.push({ kind: 'fate', k: show.end.k, at: 0, len: EPISODE_SECONDS.fate, solar: show.end.solar });
  return eps;
}

/** Ролик осады целиком. Короткий ролик эпизода — кусок того же ролика (`clipOf`). */
export function siegeReel(show: SiegeShow, quality: Quality): SiegeReel {
  const lay = layoutOf(show, quality);
  const seed = show.seed >>> 0;
  const tr = new Tracks(0);
  const c: Ctx = {
    show,
    quality,
    lay,
    tr,
    seed,
    groups: { wall: [], yard: [], camp: [], folk: [], field: [] },
    home: [],
    alive: new Uint8Array(0),
    machines: [],
    engines: [],
    engineOf: {},
    stones: [],
    smoke: [],
    bursts: [],
    arrows: [],
    gates: [],
    gateBroken: null,
    breach: null,
    breachUp: 0,
    chunks: [],
    ladders: [],
    ram: null,
    tower: null,
    ramPath: null,
    towerPath: null,
    ladderPath: null,
    laddersShown: { from: Infinity, gone: Infinity },
    carts: { tracks: new Tracks(0), loaded: [] },
    scaffolds: [],
    cam: [],
    light: [],
    shortShown: 0,
    volleyShown: 0,
  };
  const n = headcount(show, quality, lay);
  const troupe = cast(c, n);
  c.breach = breachOf(c);

  // Машины лагеря: где стоят, когда встали; сожжённые и пущенные на штурм — по эпизодам.
  for (const m of show.machines) {
    if (m.ready === null) continue;
    const s = lay.spots[m.id];
    c.machines.push({ id: m.id, x: s.x, z: s.z, from: Infinity, gone: Infinity, storm: Infinity });
  }
  const aim = c.breach?.x ?? -8;
  const engine = (kind: TwEngine['kind'], x: number, z: number, toX: number, toZ: number, from?: number): number => {
    const y = heightAt(lay.field, x, z);
    c.engines.push({ kind, x, z, y, yaw: Math.atan2(toX - x, toZ - z), shots: [], ...(from !== undefined ? { from } : {}) });
    return c.engines.length - 1;
  };
  if (c.machines.some((m) => m.id === 'mangonel')) c.engineOf.mangonel = engine('mangonel', lay.spots.mangonel.x, lay.spots.mangonel.z, aim, 0, Infinity);
  if (show.phases.some((p) => p.volley)) c.engineOf.trebuchet = engine('trebuchet', lay.spots.trebuchet.x, lay.spots.trebuchet.z, aim, 0);
  if (show.tower > 0 && show.fire > 0 && lay.wall) c.engineOf.gun = engine('mangonel', lay.spots.gun.x, lay.spots.gun.z, 0, -40);
  if (lay.wall) {
    if (c.machines.some((m) => m.id === 'ram')) c.ram = { unit: 0, x: lay.wall.gateX, hits: [] };
    if (c.machines.some((m) => m.id === 'tower')) c.tower = { unit: 0, x: lay.spots.tower.x, at: Infinity };
    // Построенные лестницы стоят у лагеря рядами там, где их потом поставят к стене.
    if (c.machines.some((m) => m.id === 'ladders')) {
      const w = lay.wall;
      for (const x of [-34, -24, -16, 16, 26, 34]) if (!w.towers.some((tt) => Math.abs(x - tt.x) < tt.size / 2 + 0.8)) c.ladders.push({ x, unit: 0, raiseAt: Infinity, queue: [] });
    }
  }

  // Эпизоды по порядку, время между ними — сутки за `LAPSE`.
  const eps = planOf(show);
  const phaseAt: number[] = new Array(show.phases.length).fill(NaN);
  let t = 0;
  let prevK = 0;
  let sol = show.solar0;
  let breachVisible = 0;
  const lapsePhases = (fromK: number, toK: number, at: number): void => {
    // Фазы без своего эпизода исхода (без перемен, нехватка сверх показанной): бросок — на ходу времени, истощение уходит
    // тихо. Фаза `fromK` — та, чьи эпизоды (машины, вылазка) уже прошли, а бросок ещё не показан.
    for (let k = Math.max(1, fromK); k <= toK; k++) {
      const p = show.phases[k - 1];
      if (!p || !Number.isNaN(phaseAt[k - 1])) continue;
      phaseAt[k - 1] = at;
      if (p.out !== 'plague') waste(c, at, p);
    }
  };
  for (const [ei, ep] of eps.entries()) {
    if (ei > 0) {
      // Время идёт: свет вперёд, через ночь, если пошла новая фаза.
      const next = forward(sol, ep.solar, ep.k !== prevK);
      c.light.push({ at: t, solar: sol });
      lapsePhases(prevK, ep.k - 1, t + LAPSE / 2);
      wide(c, t + 0.2, 0.3 + (ei % 2) * 0.2, 0.52);
      t += LAPSE;
      sol = next;
    }
    ep.at = t;
    c.light.push({ at: t, solar: sol });
    const p = show.phases[ep.k - 1];
    switch (ep.kind) {
      case 'pitch':
        pitch(c, t, ep.len);
        break;
      case 'fire':
        fire(c, t, ep.len);
        break;
      case 'machines':
        machines(c, t, ep.len, ep.machines ?? []);
        break;
      case 'repair': {
        // Сколько заделано к броску: столько кусков встаёт, сверху вниз.
        for (let j = 0; j < (p?.repaired ?? 0) && breachVisible > 0; j++) {
          breachVisible--;
          repair(c, t, ep.len, breachVisible);
        }
        phaseAt[ep.k - 1] = t + ep.len;
        break;
      }
      case 'breach': {
        const before = breachVisible;
        const at = breachEp(c, t, ep.len, p!, before);
        breachVisible = p!.breaches;
        phaseAt[ep.k - 1] = at;
        break;
      }
      case 'volley':
        volleyEp(c, t, p!);
        phaseAt[ep.k - 1] = t + ep.len - 0.5;
        break;
      case 'plague':
        plague(c, t, ep.len, p!);
        phaseAt[ep.k - 1] = t + 1;
        break;
      case 'short':
        short(c, t, ep.len);
        phaseAt[ep.k - 1] = t + 1;
        break;
      case 'sortie':
        sortie(c, t, ep.len, ep.fight!);
        break;
      case 'relief':
        relief(c, t, ep.len, ep.fight!);
        break;
      case 'assault':
        assault(c, t, ep.len, false, new Set(show.end.openings ?? ['scaling']));
        break;
      case 'gates':
      case 'terms':
        surrender(c, t, ep.len);
        if (p) phaseAt[ep.k - 1] = t + 0.4;
        break;
      case 'hunger':
        hunger(c, t, ep.len);
        break;
      case 'storm':
        assault(c, t, ep.len, true, new Set(show.end.openings ?? ['scaling']));
        break;
      case 'broken':
        if (ep.fight && (ep.fight.site === 'camp' || ep.fight.site === 'joint')) relief(c, t, Math.min(ep.len, EPISODE_SECONDS.relief), { ...ep.fight, won: true });
        else if (ep.fight && ep.fight.site === 'sortie') sortie(c, t, Math.min(ep.len, EPISODE_SECONDS.sortie), { ...ep.fight, won: true });
        broken(c, t + (ep.fight ? 4.2 : 0), ep.len);
        if (ep.fight) ep.len += 4.2;
        break;
      case 'wasted':
        leave(c, t, ep.len, true);
        break;
      case 'left':
        leave(c, t, ep.len, false);
        break;
      case 'paid':
      case 'ransom':
        tribute(c, t, ep.len, ep.kind);
        break;
      case 'fate':
        fate(c, t, ep.len);
        break;
    }
    // Истощение фазы без мора — тихо, в конце её эпизода исхода.
    if (p && (ep.kind === 'breach' || ep.kind === 'short' || ep.kind === 'volley')) waste(c, t + ep.len, p);
    t += ep.len;
    prevK = ep.k;
    // Пролом в фазе без своего эпизода (стены нет — логово): счёт по журналу.
    if (p && p.breaches !== breachVisible && ep.kind !== 'repair' && c.breach) breachVisible = breachesUp(c, t);
  }
  lapsePhases(prevK, show.phases.length, t);
  for (let k = 0; k < phaseAt.length; k++) if (Number.isNaN(phaseAt[k])) phaseAt[k] = t;
  c.light.push({ at: t, solar: sol });
  const seconds = t + 1.5;
  c.light.push({ at: seconds, solar: sol });

  // Факелы на стене: у ворот и через пролёт.
  const torches: SiegeReel['torches'] = [];
  if (lay.wall) {
    const w = lay.wall;
    for (const x of [-GATEHOUSE / 2 - 0.6, GATEHOUSE / 2 + 0.6, ...w.towers.map((tt) => tt.x + tt.size / 2 + 0.4)]) torches.push({ x, y: w.base + w.top + 1.2, z: w.z + 0.25 });
  }

  const barrage: TwBarrage = {
    shots: c.stones.length,
    shares: SHARES,
    seconds,
    walls: Boolean(lay.wall),
    besieger: 'attacker',
    engines: c.engines,
    stones: c.stones.sort((a, b) => a.at - b.at),
    breach: c.breach,
    fallers: [],
    crew: [],
    smoke: c.smoke,
    cam: [],
    cues: [],
    look: { crew: -1, faller: -1 },
    bursts: c.bursts,
  };
  for (const m of c.machines) if (!Number.isFinite(m.from)) m.from = 0;
  if (c.engineOf.mangonel !== undefined && !Number.isFinite(c.engines[c.engineOf.mangonel].from ?? 0)) c.engines[c.engineOf.mangonel].from = c.machines.find((m) => m.id === 'mangonel')?.from ?? 0;

  return {
    show,
    quality,
    layout: lay,
    seconds,
    episodes: eps,
    phaseAt,
    troupe,
    tracks: tr,
    phase: Float32Array.from({ length: tr.count }, (_, i) => hash(seed, i, 41) * 3),
    groups: c.groups,
    k: n.k,
    machines: c.machines,
    barrage,
    breach: c.breach,
    arrows: c.arrows,
    gates: c.gates,
    gateBroken: c.gateBroken,
    ladders: c.ladders,
    ram: c.ram,
    tower: c.tower,
    carts: c.carts,
    torches,
    scaffolds: c.scaffolds,
    paths: { ram: c.ramPath, tower: c.towerPath, ladder: c.ladderPath },
    laddersShown: c.laddersShown,
    cam: c.cam,
    light: c.light,
  };
}

/** Подвижное места ролика осады: лестницы, башня, таран и ворота — по эпизодам (`tw/fort.FortMotion`). */
export function motionOf(reel: SiegeReel): FortMotion {
  const paths = reel.paths;
  const lerp = (p: Path | null, park: number, t: number): number => {
    if (!p) return park;
    const u = clamp((t - p.from) / Math.max(0.01, p.to - p.from), 0, 1);
    return p.z0 + (p.z1 - p.z0) * u;
  };
  const spots = reel.layout.spots;
  return {
    ladderZ: (_l, t) => {
      const p = paths.ladder;
      if (!p) return spots.ladders.z;
      const u = clamp((t - p.from) / Math.max(0.01, p.to - p.from), 0, 1);
      return spots.ladders.z + (-1.2 - spots.ladders.z) * u;
    },
    towerZ: (t) => lerp(paths.tower, spots.tower.z, t),
    ram: (t) => {
      const z = lerp(paths.ram, spots.ram.z, t);
      if (!reel.ram) return { z, swing: 0 };
      const until = reel.gateBroken ?? Infinity;
      return { z, swing: t <= until + 0.3 ? ramSwingOf(reel.ram, t) : 0 };
    },
    gate: (t) => ({ open: gateAt(reel, t), shake: gateShakeOf(reel.ram, t) }),
    shown: (what, t) => {
      if (what === 'ladders') {
        const m = reel.machines.find((x) => x.id === 'ladders');
        const from = Math.min(m?.from ?? Infinity, reel.laddersShown.from);
        return t >= from && t < Math.min(m?.gone ?? Infinity, reel.laddersShown.gone);
      }
      const m = reel.machines.find((x) => x.id === what);
      return !!m && t >= m.from && t < m.gone;
    },
  };
}

function ramSwingOf(ram: TwRam, t: number): number {
  for (const h of ram.hits) {
    const dt = t - h;
    if (dt > -RAM_PERIOD * 0.8 && dt <= 0) {
      const u = 1 + dt / (RAM_PERIOD * 0.8);
      return u < 0.55 ? -0.6 * Math.sin((u / 0.55) * Math.PI * 0.5) : -0.6 + 1.6 * ((u - 0.55) / 0.45) ** 2;
    }
    if (dt > 0 && dt < 0.25) return 1 - dt / 0.25;
  }
  return 0;
}

function gateShakeOf(ram: TwRam | null, t: number): number {
  if (!ram) return 0;
  let s = 0;
  for (const h of ram.hits) {
    const dt = t - h;
    if (dt >= 0 && dt < 0.5) s = Math.max(s, (1 - dt / 0.5) * Math.cos(dt * 40));
  }
  return s;
}

/** Ворота на секунде: раскрыты окнами эпизодов (вылазка, сдача, дань) или выбиты тараном. 0 — закрыты, 1 — настежь. */
export function gateAt(reel: SiegeReel, t: number): number {
  if (reel.gateBroken !== null && t >= reel.gateBroken) return Math.min(1, (t - reel.gateBroken) / 0.4);
  let v = 0;
  const ease = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  for (const g of reel.gates) {
    const open = ease((t - g.open) / 1.1);
    const close = g.close === null ? 0 : ease((t - g.close) / 1.1);
    v = Math.max(v, open * (1 - close));
  }
  return v;
}

/** Свет на секунде ролика — доля суток рига (0..1). */
export function solarAt(reel: SiegeReel, t: number): number {
  const L = reel.light;
  let i = 0;
  while (i + 1 < L.length && L[i + 1].at <= t) i++;
  const a = L[i];
  const b = L[i + 1];
  const s = b && b.at > a.at ? a.solar + (b.solar - a.solar) * clamp((t - a.at) / (b.at - a.at), 0, 1) : a.solar;
  return ((s % 1) + 1) % 1;
}

/** Эпизод на секунде ролика: последний начавшийся. */
export function episodeAt(reel: SiegeReel, t: number): Episode {
  let cur = reel.episodes[0];
  for (const e of reel.episodes) if (e.at <= t) cur = e;
  return cur;
}

/** Машины лагеря, стоящие на секунде `t`: встали и не сгорели. */
export function machinesUp(reel: SiegeReel, t: number): ShowMachine[] {
  return reel.machines.filter((m) => t >= m.from && t < m.gone).map((m) => m.id);
}

/** Короткий ролик эпизода: с полвремени до него (там, где камера ещё в общем плане) до конца эпизода. */
export function clipOf(reel: SiegeReel, ep: Episode): { from: number; to: number } {
  return { from: Math.max(0, ep.at - LAPSE * 0.6), to: Math.min(reel.seconds, ep.at + ep.len + 0.8) };
}

/** Эпизоды, у которых есть свой короткий ролик: пролом, вылазка, выручка, штурм и развязка (сдача и прочее). */
export const CLIPPED: readonly EpisodeKind[] = ['breach', 'sortie', 'relief', 'assault', ...FINALES];
