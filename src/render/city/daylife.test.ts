// Живой город (docs/city_v3.md, ЖГ-1): распорядок меняется по часам, состояние города меняет вид. Только вид — механики нет.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cityPlan } from './layout';
import { buildStatic } from './budget';
import { CityLife, FEAST_AT, FEAST_RING, QUEUE_LEN, idleMode, shiftPose, standFree, type Anchor } from './life';
import { mainSite, type Site } from './sites';
import { CALM_MOOD, FEAST_DAYS, FeastClock, SHIFT_AT, SHIFT_LEN, cheerOf, forcedMood, lookOf, moodOf, rhythmAt, shiftAt, type CityMood } from './rhythm';
import { FEAST_LOG_TRIS, LIFE_CAP } from './spec';
import { createInitialState } from '@/game/state';
import { DAY_LENGTH } from '@/game/pace';
import { MORALE_BASE } from '@/game/constants';

const plan = cityPlan();
const st = buildStatic(plan, 'medium');
const tavern = mainSite(st.sites, 'tavern')!;
const storage = mainSite(st.sites, 'storage')!;
const workshops = (['smithy', 'sawmill'] as const).map((t) => mainSite(st.sites, t)).filter((m): m is Site => m !== null);

/** Фазы солнца по часам: утро, полдень, вечер, ночь (`derived.solarPhase`: 0 — рассвет, 0.5 — закат). */
const MORNING = 0.1;
const NOON = 0.26;
const EVENING = 0.52;
const NIGHT = 0.8;
/** Доля ночи окон в эти фазы — как у сцены (утро и полдень светлы, вечер — сумерки). */
const DARK: Record<number, number> = { [MORNING]: 0, [NOON]: 0, [EVENING]: 0.45, [NIGHT]: 1 };

const mesh = (life: CityLife, name: string): THREE.InstancedMesh => life.group.getObjectByName(name) as THREE.InstancedMesh;
const crowd = (life: CityLife): THREE.InstancedMesh[] =>
  life.group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && c.name.startsWith('city-people'));
function placed(im: THREE.InstancedMesh): THREE.Vector3[] {
  const m = new THREE.Matrix4();
  return Array.from({ length: im.count }, (_, k) => (im.getMatrixAt(k, m), new THREE.Vector3().setFromMatrixPosition(m)));
}
const people = (life: CityLife): THREE.Vector3[] => crowd(life).flatMap(placed);
/** Стоящие (шаг не идёт, `gait.y` — 0): идущие проходят и сквозь проезды ворот, стоящие — только на мостовой. */
const standing = (life: CityLife): THREE.Vector3[] =>
  crowd(life).flatMap((im) => {
    const g = im.geometry.getAttribute('gait') as THREE.BufferAttribute;
    return placed(im).filter((_p, k) => g.getY(k) === 0);
  });
/** Сколько людей у фасада постройки (до `f` метров перед ним). */
const before = (pts: THREE.Vector3[], a: Anchor, f: number): number =>
  pts.filter((p) => {
    const dx = p.x - a.x;
    const dz = p.z - a.z;
    const fwd = dx * a.fx + dz * a.fz;
    const side = -dx * a.fz + dz * a.fx;
    return fwd > a.hf - 0.5 && fwd < a.hf + f && Math.abs(side) < a.hr + 4;
  }).length;
/** В рядах рынка: проходы меж рядов (z 8.3 и 14.8, x −11…19, `seedPeople`). */
const market = (pts: THREE.Vector3[]): number => pts.filter((p) => p.x > -11.5 && p.x < 19.5 && (Math.abs(p.z - 8.3) < 1.2 || Math.abs(p.z - 14.8) < 1.2)).length;

function life(mood: CityMood = CALM_MOOD, q: 'low' | 'medium' = 'medium'): CityLife {
  const l = new CityLife({ plan, chimneys: st.chimneys, flagTops: st.flagTops, quality: q });
  l.set(1000, 6, []);
  l.setPlaces(tavern, storage);
  l.setStations(workshops);
  l.setMood(mood);
  return l;
}
const at = (l: CityLife, solar: number, t = 40): CityLife => (l.update(0.1, t, DARK[solar] ?? 0, 0, solar), l);

describe('живой город: распорядок по часам', () => {
  it('часы распорядка: рынок до полудня, работа днём, трактир вечером, дозор ночью', () => {
    // Граница области — фаза солнца 0..1; точки внутри неё.
    for (const s of [MORNING, NOON, EVENING, NIGHT]) expect(s >= 0 && s < 1).toBe(true);
    const m = rhythmAt(MORNING);
    const n = rhythmAt(NOON);
    const e = rhythmAt(EVENING);
    const z = rhythmAt(NIGHT);
    expect(m.market, 'утром рынок открыт').toBeGreaterThan(0.95);
    expect(n.market, 'в полдень ещё шумит').toBeGreaterThan(0.6);
    expect(e.market + z.market, 'вечером и ночью рынка нет').toBe(0);
    expect(rhythmAt(0.003).market, 'до рассвета лавки закрыты').toBe(0);
    expect(m.work + n.work, 'днём работают').toBeGreaterThan(1.9);
    expect(z.work, 'ночью не работают').toBe(0);
    expect(e.tavern, 'вечер — у трактира').toBeGreaterThan(0.9);
    expect(m.tavern + n.tavern, 'днём трактир пуст').toBe(0);
    expect(z.patrol, 'ночью дозор').toBe(1);
    expect(m.patrol + n.patrol + e.patrol, 'дозор только ночью').toBe(0);
  });

  it('смена стражи — на рассвете, в полдень, на закате и в полночь, и только тогда', () => {
    for (const a of SHIFT_AT) {
      const mid = a + SHIFT_LEN / 2;
      // Точка — внутри окна смены (утверждение, а не расчёт в голове).
      expect(mid > a && mid < a + SHIFT_LEN).toBe(true);
      expect(shiftAt(mid)).toBeCloseTo(0.5, 5);
      expect(shiftAt(a + SHIFT_LEN + 0.002), 'после смены — нет').toBe(-1);
      expect(shiftAt(a - 0.002), 'до смены — нет').toBe(-1);
    }
    expect(shiftAt(0.1)).toBe(-1);
    // Ход смены: уходит к двери, пусто, выходит; вне смены — на посту.
    const post = { x: 0, z: 0 };
    const door = { x: 3, z: 0 };
    expect(shiftPose(post, door, 1, -1)).toMatchObject({ x: 0, z: 0, moving: 0, hidden: false });
    expect(shiftPose(post, door, 1, 0.2)).toMatchObject({ moving: 1, hidden: false });
    expect(shiftPose(post, door, 1, 0.2).x).toBeCloseTo(3 * (0.2 / 0.45), 5);
    expect(shiftPose(post, door, 1, 0.5).hidden).toBe(true);
    expect(shiftPose(post, door, 1, 0.99).x).toBeLessThan(0.1);
  });

  it('утром люди в рядах рынка, вечером ряды пусты, а у трактира люди; ночью — дозор с фонарём', () => {
    const l = life();
    // Стоящие — по местам; идущие ходят и проходами меж рядов, их не считаем.
    const morning = standing(at(l, MORNING));
    const noon = standing(at(l, NOON));
    const evening = standing(at(l, EVENING));
    const all = { morning: people(at(l, MORNING)).length, night: people(at(l, NIGHT)).length };
    const night = standing(at(l, NIGHT));
    expect(before(evening, tavern, 8), 'вечером у трактира').toBeGreaterThanOrEqual(5);
    expect(before(morning, tavern, 8) + before(noon, tavern, 8), 'днём у трактира не стоят').toBe(0);
    expect(market(morning), 'утром в рядах').toBeGreaterThan(10);
    expect(market(noon), 'в полдень — ещё торгуют').toBeGreaterThan(6);
    expect(market(evening), 'вечером рядов нет').toBe(0);
    expect(all.night, 'ночью улицы пустеют').toBeLessThan(all.morning / 3);
    // Днём у мастерских — работники лицом к фасаду; ночью их нет.
    const atWork = (pts: THREE.Vector3[]): number => workshops.reduce((n, w) => n + before(pts, w, 1.4), 0);
    expect(atWork(noon), 'днём у мастерских').toBeGreaterThan(atWork(night));
    // Дозор: ночью на постах ворот и дозоре больше фигур, чем днём, — и они идут.
    const gate = mesh(l, 'city-gate-guards');
    at(l, NOON);
    const dayGate = gate.count;
    at(l, NIGHT);
    expect(gate.count, 'ночью — дозор').toBeGreaterThan(dayGate);
    const spots = { x: new Float32Array(64), y: new Float32Array(64), z: new Float32Array(64), yaw: new Float32Array(64), moving: new Uint8Array(64) };
    const { count, wall } = l.guardsInto(spots);
    const walking = Array.from(spots.moving.slice(wall, count)).filter((m) => m === 1).length;
    expect(walking, 'дозор идёт').toBeGreaterThanOrEqual(2);
    // Фонарь дозора — огонёк в руке, ночью горит.
    const torches = l.group.getObjectByName('city-torches') as THREE.Points;
    expect(torches.visible).toBe(true);
    l.dispose();
  });

  it('в смену стражи караул уходит в проезд и выходит; вне смены все на постах', () => {
    const l = life();
    const spots = { x: new Float32Array(64), y: new Float32Array(64), z: new Float32Array(64), yaw: new Float32Array(64), moving: new Uint8Array(64) };
    at(l, 0.2);
    const still = l.guardsInto(spots);
    const posts = still.count - still.wall;
    expect(Array.from(spots.moving.slice(still.wall, still.count)).every((m) => m === 0), 'вне смены стоят').toBe(true);
    // Середина смены в полдень — точка внутри окна.
    const mid = SHIFT_AT[1] + SHIFT_LEN * 0.3;
    expect(shiftAt(mid)).toBeGreaterThan(0);
    at(l, mid);
    const sh = l.guardsInto(spots);
    const moving = Array.from(spots.moving.slice(sh.wall, sh.count)).filter((m) => m === 1).length;
    expect(moving, 'смена идёт').toBeGreaterThan(0);
    expect(sh.count - sh.wall, 'никого лишнего').toBeLessThanOrEqual(posts);
    l.dispose();
  });
});

describe('живой город: состояние меняет вид', () => {
  it('из партии: осада и набег — тревога, пустые закрома — голод, письмо о море — мор, мораль — оживление', () => {
    const s = createInitialState();
    expect(moodOf(s, false, -Infinity)).toMatchObject({ alarm: 0, hunger: 0, plague: 0, feast: 0 });
    expect(moodOf(s, true, -Infinity).alarm, 'враг идёт к городу').toBe(1);
    expect(moodOf({ ...s, siege: { byName: 'Волки', until: s.time + 100 } }, false, -Infinity).alarm, 'осада').toBe(1);
    expect(moodOf({ ...s, resources: { ...s.resources, food: 0 } }, false, -Infinity).hunger).toBe(1);
    expect(moodOf({ ...s, inbox: [{ defId: 'sickness', at: s.time }] as typeof s.inbox }, false, -Infinity).plague).toBe(1);
    const t = s.time + 3 * DAY_LENGTH;
    const fresh = { ...s, time: t, log: [{ at: t - 0.5 * DAY_LENGTH, text: 'Жителей стало меньше на 3: мор.', kind: 'bad' as const }] };
    expect(moodOf(fresh, false, -Infinity).plague, 'мор за сутки').toBe(1);
    const old = { ...fresh, log: [{ ...fresh.log[0], at: t - 2 * DAY_LENGTH }] };
    expect(moodOf(old, false, -Infinity).plague, 'старый мор прошёл').toBe(0);
    expect(cheerOf(MORALE_BASE)).toBe(0);
    expect(cheerOf(100)).toBe(1);
    expect(cheerOf(20)).toBe(-1);
    // Праздник после победы: первое чтение запоминает, рост счёта побед — праздник до срока; в тревогу не празднуют.
    const clock = new FeastClock();
    expect(clock.observe(s)).toBe(-Infinity);
    const won = { ...s, stats: { ...s.stats, battlesWon: s.stats.battlesWon + 1 } };
    const until = clock.observe(won);
    expect(until).toBeCloseTo(s.time + FEAST_DAYS * DAY_LENGTH, 5);
    expect(moodOf(won, false, until).feast).toBe(1);
    expect(moodOf({ ...won, time: until + 1 }, false, until).feast, 'праздник кончился').toBe(0);
    expect(moodOf(won, true, until).feast, 'тревога сильнее праздника').toBe(0);
    expect(forcedMood('?mood=feast')?.feast).toBe(1);
    expect(forcedMood('?mood=siege')?.alarm).toBe(1);
    expect(forcedMood('?weather=rain')).toBeNull();
  });

  it('праздник — хоровод на площади вокруг костра; в спокойный день хоровода нет', () => {
    const calm = people(at(life(), NOON));
    const ring = (pts: THREE.Vector3[]): number => pts.filter((p) => Math.abs(Math.hypot(p.x - FEAST_AT.x, p.z - FEAST_AT.z) - FEAST_AT.r - 0.17) < 0.4).length;
    const l = life(forcedMood('?mood=feast')!);
    const feast = people(at(l, NOON));
    expect(ring(feast), 'хоровод').toBeGreaterThanOrEqual(FEAST_RING - 3);
    expect(ring(calm), 'без праздника — нет').toBeLessThan(3);
    // Костёр праздника горит в сумерках: пламя и шалаш поленьев той цены, что считает бюджет.
    at(l, EVENING);
    expect((l.group.getObjectByName('city-bonfire') as THREE.Points).visible).toBe(true);
    const logs = mesh(l, 'city-bonfire-logs');
    expect(logs.visible).toBe(true);
    expect((logs.geometry.index!.count / 3) * logs.count).toBe(FEAST_LOG_TRIS);
    const quiet = at(life(), EVENING);
    expect(mesh(quiet, 'city-bonfire-logs').visible, 'без праздника костра нет').toBe(false);
    quiet.dispose();
    // Хоровод — на свободной мостовой: ни одно место круга не в доме и не в храме.
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      for (const r of [FEAST_AT.r, FEAST_AT.r + 0.35]) expect(standFree(plan, FEAST_AT.x + Math.cos(a) * r, FEAST_AT.z + Math.sin(a) * r)).toBe(true);
    }
    l.dispose();
  });

  it('набег или осада — улицы пусты, стража на стенах, у трактира никого', () => {
    const calm = life();
    const alarm = life(forcedMood('?mood=siege')!);
    const c = people(at(calm, EVENING));
    const a = people(at(alarm, EVENING));
    expect(a.length, 'люди прячутся').toBeLessThan(c.length * 0.12);
    expect(before(a, tavern, 8)).toBe(0);
    // Войска дома мало (6 мест), а на стене — почти все места уровня.
    expect(mesh(calm, 'city-guards').count).toBe(6);
    expect(mesh(alarm, 'city-guards').count).toBeGreaterThanOrEqual(Math.ceil(LIFE_CAP.medium.guards * 0.85));
    calm.dispose();
    alarm.dispose();
  });

  it('голод — очередь у амбара; мор и хмурость — людей меньше', () => {
    const calm = people(at(life(), NOON));
    const hunger = people(at(life(forcedMood('?mood=hunger')!), NOON));
    expect(before(hunger, storage, 12), 'очередь у амбара').toBeGreaterThanOrEqual(QUEUE_LEN - 4);
    expect(before(hunger, storage, 12)).toBeGreaterThan(before(calm, storage, 12) + 5);
    const plague = people(at(life(forcedMood('?mood=plague')!), NOON));
    const gloom = people(at(life(forcedMood('?mood=gloom')!), NOON));
    expect(plague.length, 'мор — меньше людей').toBeLessThan(calm.length * 0.6);
    expect(gloom.length, 'хмуро — пустее').toBeLessThan(calm.length * 0.75);
    // Оживлённый город торгует и после полудня — а спокойный к трём часам ряды сворачивает.
    const late = 0.36;
    expect(rhythmAt(late).market).toBeLessThan(0.35);
    const cheer = standing(at(life(forcedMood('?mood=cheer')!), late));
    expect(market(cheer)).toBeGreaterThan(market(standing(at(life(), late))));
  });

  it('места у трактира, в очереди и у мастерских — на мостовой, не в домах и не в постройках', () => {
    // Рынок — ряды с проходами, Костёр — площадка колодца, в храм входят прихожане: люди в их коробках нарочно (`seedPeople`); прочие — сплошные.
    const others = st.sites.filter((s) => s.type !== 'houses' && s.type !== 'market' && s.type !== 'campfire' && s.type !== 'church');
    const inSite = (x: number, z: number, s: Site): boolean => {
      const dx = x - s.x;
      const dz = z - s.z;
      return Math.abs(dx * s.fx + dz * s.fz) < s.hf - 0.2 && Math.abs(-dx * s.fz + dz * s.fx) < s.hr - 0.2;
    };
    for (const mood of ['hunger', 'calm'] as const) {
      const l = life(forcedMood(`?mood=${mood}`)!);
      for (const solar of [MORNING, NOON, EVENING]) {
        for (const p of standing(at(l, solar))) {
          const bad = others.find((s) => inSite(p.x, p.z, s));
          expect(bad, `человек в постройке ${bad?.type} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBeUndefined();
        }
      }
      l.dispose();
    }
  });

  it('режим стоящего: тревога прячет всех; праздник и очередь — сильнее распорядка', () => {
    const rh = rhythmAt(NOON);
    const pl = { tavern: true, queue: true };
    const alarm = forcedMood('?mood=siege')!;
    for (let j = 0; j < 40; j++) expect(idleMode('market', j, 0.1, rh, alarm, lookOf(alarm), 1, 3, pl, true)).toBe('hidden');
    const feast = forcedMood('?mood=feast')!;
    expect(idleMode('well', 4, 0.9, rh, feast, lookOf(feast), 1, 3, pl, true)).toBe('feast');
    const hunger = forcedMood('?mood=hunger')!;
    expect(idleMode('market', 7, 0.1, rh, hunger, lookOf(hunger), 1, 3, pl, true)).toBe('queue');
    expect(idleMode('market', 7, 0.1, rh, CALM_MOOD, lookOf(CALM_MOOD), 1, 3, pl, true)).toBe('home');
  });
});
