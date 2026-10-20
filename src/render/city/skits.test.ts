// Сценки жителей вблизи (docs/city_v3.md, ЖГ-2): только при максимальном приближении, выбор по часу, погоде и состоянию
// города, не подряд одна и та же, актёры — не в домах, не в постройках и не на проходе. Только вид и звук — механики нет.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cityPlan, distPoly, insidePoly } from './layout';
import { buildStatic } from './budget';
import { SQUARE_PATHS } from './life';
import { CALM_MOOD, forcedMood, rhythmAt, type CityMood } from './rhythm';
import {
  KEEP_R,
  SKITS,
  SKIT_IDS,
  SKIT_ZOOM,
  SkitDirector,
  TOWN_PLACES,
  dayOf,
  eveOf,
  nightOf,
  placeKind,
  placeOf,
  posesFor,
  seededRnd,
  skitWeight,
  skitWorld,
  type Active,
  type SkitCtx,
  type SkitId,
} from './skits';
import { CitySkits, SKIT_HEAR } from './skitview';
import { skitsHeard } from '@/sound/ear';
import { SKITS_CAP, SKIT_FIGURES } from './spec';
import type { Site } from './sites';

const plan = cityPlan();
const st = buildStatic(plan, 'medium');
const world = skitWorld(plan, st.sites);

/** Фазы солнца: утро, полдень, вечер, ночь (`derived.solarPhase`: 0 — рассвет, 0,5 — закат). */
const MORNING = 0.1;
const NOON = 0.26;
const EVENING = 0.52;
const NIGHT = 0.8;

const ctxOf = (solar: number, mood: CityMood = CALM_MOOD, extra: Partial<SkitCtx> = {}): SkitCtx => ({
  solar,
  rh: rhythmAt(solar),
  mood,
  rain: 0,
  snow: 0,
  storm: 0,
  winter: false,
  lair: false,
  ...extra,
});
const mood = (m: string): CityMood => forcedMood(`?mood=${m}`)!;
const allowed = (c: SkitCtx): Set<SkitId> => new Set(SKIT_IDS.filter((id) => skitWeight(id, c) > 0));

/** Точки взгляда: в городе — у трактира, на площади, у рядов, на паперти, у южных ворот, в переулке, у казармы; за стеной — дорога, поле, луг у загона, опушка. */
const EYES: readonly { x: number; z: number }[] = [
  { x: -6, z: 100 },
  { x: 12, z: -14 },
  { x: 4, z: 22 },
  { x: -4, z: -30 },
  { x: 6, z: 112 },
  { x: -44, z: 30 },
  { x: 18, z: -136 },
  { x: 3, z: 240 },
  { x: 240, z: -60 },
  { x: 70, z: 196 },
  { x: -40, z: 220 },
];

/** Сценки, которые режиссёр ставит за `n` шагов по 7 с у взгляда `eye`. */
function run(eye: { x: number; z: number }, c: SkitCtx, seed: number, n = 8): Active[] {
  const d = new SkitDirector(world, 3, seededRnd(seed));
  const cam = { x: eye.x + 60, z: eye.z + 80 };
  const seen: Active[] = [];
  for (let k = 0; k < n; k++) {
    d.update(k * 7, eye, cam, true, c);
    for (const a of d.active) if (a && !seen.includes(a)) seen.push(a);
  }
  return seen;
}

/** Своя проверка «в постройке» — по коробкам сайтов, как у `daylife.test.ts` (рынок, костёр и храм — площадки). */
const solid: readonly Site[] = st.sites.filter((s) => !['market', 'campfire', 'church'].includes(s.type));
const inBox = (x: number, z: number, s: Site): boolean => {
  const dx = x - s.x;
  const dz = z - s.z;
  return Math.abs(dx * s.fx + dz * s.fz) < s.hf - 0.2 && Math.abs(-dx * s.fz + dz * s.fx) < s.hr - 0.2;
};
const inHouse = (x: number, z: number): boolean =>
  plan.houses.some((h) => {
    const dx = x - h.x;
    const dz = z - h.z;
    return Math.abs(dx * h.fx + dz * h.fz) <= h.d / 2 && Math.abs(-dx * h.fz + dz * h.fx) <= h.w / 2;
  });
/** На проходе: ближе полуширины улицы, дорожки площади или дороги к её оси. */
const onPass = (x: number, z: number): boolean =>
  [...plan.streets, ...SQUARE_PATHS, ...plan.roads].some((s) => distPoly({ x, z }, s.pts) < s.half);

describe('сценки жителей вблизи', () => {
  it('каталог: восемнадцать сценок — двенадцать в городе и шесть за стеной; потолок фигур одной сценки — бюджетный', () => {
    expect(SKITS.length).toBe(18);
    const town = SKITS.filter((d) => d.where.every((k) => TOWN_PLACES.includes(k)));
    expect(town.map((d) => d.id).sort()).toEqual(['brawl', 'dice', 'drunks', 'funeral', 'haggle', 'preacher', 'revel', 'thief', 'widow']);
    // Дети, влюблённые и танцы бывают и на лугу за стеной — у них и город, и луг.
    for (const id of ['children', 'lovers', 'dance'] as const) expect(SKITS.find((d) => d.id === id)!.where).toContain('meadow');
    for (const d of SKITS) expect(d.cast.length, d.id).toBeLessThanOrEqual(SKIT_FIGURES);
    expect(SKITS_CAP.medium.slots, 'средний уровень тесный — две сценки').toBe(2);
  });

  it('сценки только вблизи: издали режиссёр не держит ни одной, вид не рисует и не звучит', () => {
    const d = new SkitDirector(world, 2, seededRnd(1));
    const c = ctxOf(NOON);
    d.update(0, EYES[1], { x: 60, z: 60 }, true, c);
    expect(d.active.some((a) => a !== null), 'вблизи — есть').toBe(true);
    d.update(1, EYES[1], { x: 60, z: 60 }, false, c);
    expect(d.active.every((a) => a === null), 'отдалил — ни одной').toBe(true);

    const v = new CitySkits({ plan, sites: st.sites, quality: 'medium' });
    const cam = new THREE.PerspectiveCamera(36, 390 / 844, 1, 2000);
    const eye = EYES[1];
    const place = (dist: number): void => {
      cam.position.set(eye.x + dist * 0.4, dist * 0.78, eye.z + dist * 0.48);
      cam.lookAt(eye.x, 0, eye.z);
      cam.updateMatrixWorld();
    };
    // Граница области: доля приближения ниже порога — издали; 1 — у пола приближения.
    for (const [share, near] of [
      [SKIT_ZOOM - 0.2, false],
      [1, true],
    ] as const) {
      expect(share >= SKIT_ZOOM).toBe(near);
      place(near ? 45 : 300);
      let drawn = 0;
      let heard = 0;
      for (let k = 0; k < 6; k++) {
        v.update(k * 3, cam, eye, share, false, ctxOf(NOON), false);
        drawn = Math.max(drawn, v.drawn());
        heard = Math.max(heard, skitsHeard().length);
      }
      if (near) {
        expect(drawn, 'вблизи — фигуры').toBeGreaterThan(0);
        expect(heard, 'вблизи — звук').toBeGreaterThan(0);
      } else {
        expect(drawn, 'издали — ни одной фигуры').toBe(0);
        expect(heard, 'издали — тихо').toBe(0);
        expect(v.group.children.every((m) => !m.visible), 'издали — ни одного вызова').toBe(true);
      }
    }
    // Из покоев сценок нет: вид из окна — даль.
    place(45);
    v.update(40, cam, eye, 1, true, ctxOf(NOON), false);
    expect(v.drawn()).toBe(0);
    v.dispose();
  });

  it('звук по месту: ближе к камере — громче, на краю слышимости — тихо', () => {
    const v = new CitySkits({ plan, sites: st.sites, quality: 'medium' });
    const cam = new THREE.PerspectiveCamera(36, 390 / 844, 1, 2000);
    const eye = EYES[1];
    for (let k = 0; k < 4; k++) v.update(k * 3, cam, eye, 1, false, ctxOf(NOON), false);
    const a = v.director.active.find((x) => x !== null)!;
    expect(a).toBeDefined();
    const c = v.director.centerOf(a, 9);
    const gainAt = (dist: number): number => {
      cam.position.set(c.x + dist * 0.6, dist * 0.78, c.z);
      cam.lookAt(c.x, 0, c.z);
      cam.updateMatrixWorld();
      v.update(9, cam, eye, 1, false, ctxOf(NOON), false);
      return skitsHeard().find((h) => h.id === a.def.id)?.gain ?? 0;
    };
    const near = gainAt(SKIT_HEAR.near * 0.8);
    const mid = gainAt((SKIT_HEAR.near + SKIT_HEAR.far) / 2);
    const far = gainAt(SKIT_HEAR.far * 1.1);
    expect(near, 'вплотную — во всю громкость').toBeGreaterThan(0.95);
    expect(mid).toBeLessThan(near);
    expect(mid).toBeGreaterThan(0);
    expect(far, 'дальше слышимости — ни звука').toBe(0);
    v.dispose();
  });

  it('выбор по часу, погоде и состоянию города', () => {
    // Граница области: точки суток — внутри своих окон (день, вечер, ночь).
    expect(dayOf(NOON)).toBe(1);
    expect(dayOf(MORNING)).toBe(1);
    expect(eveOf(EVENING)).toBeGreaterThan(0.9);
    expect(nightOf(NIGHT)).toBe(1);
    const day = allowed(ctxOf(NOON));
    const night = allowed(ctxOf(NIGHT));
    for (const id of ['haggle', 'children', 'preacher', 'travelers', 'shepherd', 'reapers', 'pilgrims'] as const) {
      expect(day.has(id), `днём — ${id}`).toBe(true);
      expect(night.has(id), `ночью нет — ${id}`).toBe(false);
    }
    for (const id of ['drunks', 'brawl', 'dice', 'thief'] as const) expect(night.has(id), `ночью — ${id}`).toBe(true);
    expect(allowed(ctxOf(MORNING)).has('reapers'), 'жнут с утра').toBe(true);
    // Погода: в ливень не пляшут, не милуются, не проповедуют и не жнут; путники идут.
    const rain = allowed(ctxOf(NOON, CALM_MOOD, { rain: 0.8 }));
    for (const id of ['dance', 'lovers', 'preacher', 'reapers', 'children'] as const) expect(rain.has(id), `в ливень нет — ${id}`).toBe(false);
    expect(rain.has('travelers')).toBe(true);
    // Зима: ни жнецов, ни стада.
    const winter = allowed(ctxOf(NOON, CALM_MOOD, { winter: true }));
    expect(winter.has('reapers') || winter.has('shepherd')).toBe(false);
    // Тревога: город пуст; за стеной — только лазутчики, и только если логово близко.
    expect([...allowed(ctxOf(NOON, mood('siege')))]).toEqual([]);
    expect([...allowed(ctxOf(EVENING, mood('siege'), { lair: true }))]).toEqual(['scouts']);
    expect(day.has('scouts'), 'логова нет — лазутчиков нет').toBe(false);
    // Праздник после победы — пир и танцы; траур после поражения — вдова и похороны, не пляшут.
    const feast = allowed(ctxOf(NOON, mood('feast')));
    expect(feast.has('revel') && feast.has('dance')).toBe(true);
    expect(feast.has('widow') || feast.has('funeral')).toBe(false);
    expect(day.has('revel') || day.has('widow') || day.has('funeral'), 'в будни — ни пира, ни похорон').toBe(false);
    const mourn = allowed(ctxOf(NOON, mood('mourn')));
    expect(mourn.has('widow') && mourn.has('funeral')).toBe(true);
    expect(mourn.has('dance') || mourn.has('revel')).toBe(false);
    // Мор — похороны, ни танцев, ни детей; голод — воров больше, хмуро — драк больше.
    const plague = allowed(ctxOf(NOON, mood('plague')));
    expect(plague.has('funeral')).toBe(true);
    expect(plague.has('dance') || plague.has('children')).toBe(false);
    expect(skitWeight('thief', ctxOf(NOON, mood('hunger')))).toBeGreaterThan(2 * skitWeight('thief', ctxOf(NOON)));
    expect(skitWeight('brawl', ctxOf(EVENING, mood('gloom')))).toBeGreaterThan(1.5 * skitWeight('brawl', ctxOf(EVENING)));
    expect(skitWeight('dance', ctxOf(EVENING, mood('cheer')))).toBeGreaterThan(2 * skitWeight('dance', ctxOf(EVENING)));
  });

  it('режиссёр ставит только то, что бывает в эту минуту, и там, где оно бывает', () => {
    const cases: [string, SkitCtx][] = [
      ['полдень', ctxOf(NOON)],
      ['вечер', ctxOf(EVENING)],
      ['ночь', ctxOf(NIGHT)],
      ['праздник', ctxOf(EVENING, mood('feast'))],
      ['траур', ctxOf(NOON, mood('mourn'))],
      ['голод', ctxOf(NOON, mood('hunger'))],
      ['осада', ctxOf(NOON, mood('siege'), { lair: true })],
    ];
    const met = new Set<SkitId>();
    for (const [name, c] of cases) {
      const ok = allowed(c);
      for (const eye of EYES) {
        for (const a of run(eye, c, 7)) {
          expect(ok.has(a.def.id), `${name}: ${a.def.id} не бывает`).toBe(true);
          expect(a.def.where, `${name}: ${a.def.id} на месте «${a.stage.kind}»`).toContain(a.stage.kind);
          met.add(a.def.id);
        }
      }
    }
    // Траур на паперти и площади — вдова или похороны.
    const mourning = [EYES[1], EYES[3]].flatMap((e) => run(e, ctxOf(NOON, mood('mourn')), 11));
    expect(mourning.some((a) => a.def.id === 'widow' || a.def.id === 'funeral')).toBe(true);
    // Каждая сценка находит себе место хоть где-то.
    const rest = SKIT_IDS.filter((id) => !met.has(id));
    for (const id of rest) {
      const c = id === 'scouts' ? ctxOf(EVENING, CALM_MOOD, { lair: true }) : id === 'widow' || id === 'funeral' ? ctxOf(NOON, mood('mourn')) : id === 'revel' ? ctxOf(NOON, mood('feast')) : ctxOf(NOON);
      const found = EYES.some((e) => [1, 2, 3, 4, 5].some((seed) => run(e, c, seed, 12).some((a) => a.def.id === id)));
      expect(found, `${id} — нигде не встала`).toBe(true);
    }
  });

  it('не повторяются подряд и не идут две одинаковые разом', () => {
    const d = new SkitDirector(world, 3, seededRnd(3));
    const started: SkitId[] = [];
    let last: (Active | null)[] = [];
    for (let k = 0; k < 900; k++) {
      const t = k * 2;
      // Взгляд гуляет по городу: площадь, трактир, паперть.
      const eye = EYES[[1, 0, 3][Math.floor(k / 120) % 3]];
      d.update(t, eye, { x: eye.x + 60, z: eye.z + 80 }, true, ctxOf(k % 300 < 150 ? NOON : EVENING));
      const ids = d.active.filter((a): a is Active => a !== null).map((a) => a.def.id);
      expect(new Set(ids).size, 'две одинаковые разом').toBe(ids.length);
      for (const a of d.active) if (a && !last.includes(a)) started.push(a.def.id);
      last = [...d.active];
    }
    expect(started.length).toBeGreaterThan(40);
    for (let i = 1; i < started.length; i++) expect(started[i], `подряд ${started[i]}`).not.toBe(started[i - 1]);
    expect(new Set(started).size, 'разнообразие').toBeGreaterThan(6);
  });

  it('актёры — не в домах, не в постройках, стоящие — не на проходе; город в стене, поле за ней', () => {
    const cases: SkitCtx[] = [ctxOf(NOON), ctxOf(EVENING), ctxOf(NIGHT), ctxOf(NOON, mood('feast')), ctxOf(NOON, mood('mourn')), ctxOf(EVENING, CALM_MOOD, { lair: true })];
    let checked = 0;
    for (const c of cases) {
      for (const eye of EYES) {
        for (const seed of [2, 5]) {
          for (const a of run(eye, c, seed, 6)) {
            const poses = posesFor(a.def);
            const town = TOWN_PLACES.includes(a.stage.kind);
            for (let f = 0; f <= 1; f += 0.1) {
              const lt = f * a.len;
              a.def.pose(lt, a.len, a.r, poses);
              poses.forEach((p, i) => {
                if (p.hide) return;
                const q = placeOf(a, lt, p);
                const where = `${a.def.id}#${i} на «${a.stage.kind}» (${q.x.toFixed(1)}, ${q.z.toFixed(1)})`;
                expect(inHouse(q.x, q.z), `в доме: ${where}`).toBe(false);
                const box = solid.find((s) => inBox(q.x, q.z, s));
                expect(box?.type, `в постройке: ${where}`).toBeUndefined();
                expect(insidePoly(q, plan.wall) || insidePoly(q, plan.castleWall), `не в своей части мира: ${where}`).toBe(town);
                if (!a.def.moving) expect(onPass(q.x, q.z), `на проходе: ${where}`).toBe(false);
                checked++;
              });
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it('место под взглядом: трактир, площадь, паперть, поле, дорога; сценка уходит, если взгляд ушёл', () => {
    expect(placeKind(world, -6, 100)).toBe('tavern');
    expect(placeKind(world, -4, -30)).toBe('parvis');
    expect(placeKind(world, 20, -10)).toBe('square');
    expect(placeKind(world, 240, -60)).toBe('field');
    expect(placeKind(world, 3, 240)).toBe('road');
    const d = new SkitDirector(world, 1, seededRnd(9));
    d.update(0, EYES[1], { x: 60, z: 60 }, true, ctxOf(NOON));
    const first = d.active[0];
    expect(first).not.toBeNull();
    // Граница: новый взгляд дальше `KEEP_R` от сценки.
    const away = { x: EYES[1].x, z: EYES[1].z + KEEP_R + 60 };
    const c = d.centerOf(first!, 1);
    expect(Math.hypot(c.x - away.x, c.z - away.z)).toBeGreaterThan(KEEP_R);
    d.update(1, away, { x: 60, z: 60 }, true, ctxOf(NOON));
    expect(d.active[0]).not.toBe(first);
  });

  it('сторож плавности опустил уровень — сценок меньше сразу', () => {
    const v = new CitySkits({ plan, sites: st.sites, quality: 'high' });
    expect(v.director.active.length).toBe(SKITS_CAP.high.slots);
    v.setLevel('low');
    expect(v.director.active.length).toBe(SKITS_CAP.low.slots);
    v.dispose();
  });
});
