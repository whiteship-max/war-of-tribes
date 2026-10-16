// Режиссура ролика осады (docs/gfx.md, ГФ-2): ролик показывает ровно то, что посчитала осада. Здесь — на осадах, собранных
// руками внутри области каждого правила (проломы и починки, машины и пожар, каждый исход); набор настоящих осад мира —
// `ui/battle/siege.test.ts` (ролик = донесение).
import { describe, expect, it } from 'vitest';
import { NOON } from '@/game/battle/ground';
import { inGate } from '../tw/site';
import { breachesAt, clipOf, episodeAt, gateAt, machinesUp, siegeReel, solarAt, CLIPPED, EPISODE_SECONDS, FINALES } from './reel';
import { poseAt, type TrackPose } from './tracks';
import type { ShowPhase, SiegeShow } from './show';

const ground = { land: 'plain', river: false, ford: false, ridge: false, road: true, woods: false, winter: false, solar: NOON, seed: 7 } as const;

const phase = (k: number, out: ShowPhase['out'], breaches: number, more: Partial<ShowPhase> = {}): ShowPhase => ({
  k,
  out,
  breaches,
  repaired: 0,
  volley: false,
  mangonel: false,
  waste: 0.03,
  solar: 0.3,
  ...more,
});

function show(more: Partial<SiegeShow> = {}): SiegeShow {
  return {
    us: 'atk',
    seed: 11,
    wall: 6,
    tower: 0,
    camp: 400,
    garrison: 160,
    phases: [phase(1, 'calm', 0), phase(2, 'breach', 1, { volley: true }), phase(3, 'short', 1), phase(4, 'breach', 2, { mangonel: true }), phase(5, 'gates', 2)],
    machines: [{ id: 'mangonel', ready: 3, spent: false, burned: null, solar: 0.2 }],
    fire: 0,
    ration: false,
    fights: [],
    end: { how: 'gates', fate: 'plunder', k: 5, breaches: 2, solar: 0.3 },
    solar0: 0.25,
    ground,
    ...more,
  };
}

/** Осады внутри области каждого правила: исходы, починка, мор, машины и вылазка на машину, огонь башни, деревянная стена. */
const SET: [string, SiegeShow][] = [
  ['сдача после двух проломов', show()],
  [
    'починка и пролом снова',
    show({
      phases: [phase(1, 'breach', 1, { volley: true }), phase(2, 'calm', 0, { repaired: 1 }), phase(3, 'breach', 1, { volley: true }), phase(4, 'breach', 2, { volley: true }), phase(5, 'calm', 2)],
      machines: [],
      end: { how: 'hunger', fate: 'captives', k: 6, breaches: 2, solar: 0.6 },
    }),
  ],
  [
    'вылазка жжёт камнемёт, мор, голод',
    show({
      us: 'def',
      tower: 4,
      fire: 0.08,
      phases: [phase(1, 'plague', 0, { waste: 0.08 }), phase(2, 'breach', 1), phase(3, 'calm', 1, { mangonel: true })],
      machines: [{ id: 'mangonel', ready: 2, spent: false, burned: 3, solar: 0.4 }, { id: 'ram', ready: 1, spent: false, burned: null, solar: 0.4 }],
      fights: [{ k: 3, site: 'sortie', won: true, machine: 'mangonel', solar: 0.7 }],
      end: { how: 'hunger', fate: 'burn', k: 4, breaches: 1, solar: 0.1 },
    }),
  ],
  [
    'штурм машинами',
    show({
      wall: 9,
      phases: [phase(1, 'breach', 1, { volley: true }), phase(2, 'breach', 2, { volley: true })],
      machines: [
        { id: 'ladders', ready: 1, spent: true, burned: null, solar: 0.2 },
        { id: 'ram', ready: 1, spent: true, burned: null, solar: 0.2 },
        { id: 'tower', ready: 2, spent: true, burned: null, solar: 0.2 },
      ],
      fights: [{ k: 3, site: 'wall', won: true, end: true, solar: 0.3 }],
      end: { how: 'storm', fate: 'plunder', k: 3, breaches: 2, solar: 0.3, openings: ['breach', 'gate', 'tower', 'ladders'] },
    }),
  ],
  [
    'частокол, лагерь разбит клещами',
    show({
      us: 'def',
      wall: 2,
      phases: [phase(1, 'calm', 0), phase(2, 'breach', 1)],
      machines: [],
      fights: [{ k: 3, site: 'joint', won: true, end: true, solar: 0.4 }],
      end: { how: 'broken', fate: null, k: 3, breaches: 1, solar: 0.4 },
    }),
  ],
  ['дань', show({ us: 'def', phases: [phase(1, 'short', 0), phase(2, 'short', 0)], machines: [], end: { how: 'paid', fate: null, k: 3, breaches: 0, solar: 0.45 } })],
  ['логово, лагерь растаял', show({ wall: 0, phases: [phase(1, 'plague', 0, { waste: 0.1 }), phase(2, 'calm', 0)], machines: [], end: { how: 'wasted', fate: null, k: 2, breaches: 0, solar: 0.9 } })],
];

describe('ролик осады: проломы, машины и итог — те, что посчитала осада', () => {
  it.each(SET)('%s: проломы на броске каждой фазы — журнал фаз', (_name, s) => {
    const reel = siegeReel(s, 'medium');
    // Граница области: у осады есть фазы, и бросок каждой — внутри ролика.
    expect(s.phases.length).toBeGreaterThan(0);
    s.phases.forEach((p, i) => {
      const at = reel.phaseAt[i];
      expect(at, `фаза ${p.k} на часах ролика`).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThanOrEqual(reel.seconds);
      if (s.wall > 0) expect(breachesAt(reel, at + 0.01), `проломов после броска фазы ${p.k}`).toBe(p.breaches);
    });
    if (s.wall > 0) expect(breachesAt(reel, reel.seconds), 'проломов в конце — в минуту конца осады').toBe(s.end.breaches);
  });

  it.each(SET)('%s: машины — построенные стоят, сгоревшие сгорели', (_name, s) => {
    const reel = siegeReel(s, 'medium');
    const built = s.machines.filter((m) => m.ready !== null && m.burned === null).map((m) => m.id).sort();
    expect(machinesUp(reel, reel.seconds).sort()).toEqual(built);
    for (const m of s.machines.filter((x) => x.burned !== null)) {
      const ep = reel.episodes.find((e) => e.kind === 'sortie' && e.fight?.machine === m.id);
      expect(ep, `вылазка на ${m.id}`).toBeTruthy();
      expect(machinesUp(reel, ep!.at), `${m.id} стоял до вылазки`).toContain(m.id);
      expect(machinesUp(reel, ep!.at + ep!.len), `${m.id} сгорел вылазкой`).not.toContain(m.id);
    }
  });

  it.each(SET)('%s: развязка — исход осады, участь — та, с которой пал город', (_name, s) => {
    const reel = siegeReel(s, 'medium');
    const finale = reel.episodes.find((e) => FINALES.includes(e.kind));
    expect(finale?.kind).toBe(s.end.how);
    expect(reel.episodes.some((e) => e.kind === 'fate')).toBe(s.end.fate !== null);
    // Сдача и голод открывают ворота, дань — открывает и закрывает; лагерь разбит — ворота при нём открыты на клещи.
    if (s.wall > 0 && (s.end.how === 'gates' || s.end.how === 'hunger' || s.end.how === 'terms')) expect(gateAt(reel, reel.seconds)).toBe(1);
    if (s.end.how === 'storm' && s.end.openings?.includes('gate')) expect(gateAt(reel, reel.seconds), 'таран выбил ворота').toBe(1);
  });

  it.each(SET)('%s: стена — преграда: сквозь неё ходят только воротами, по ходу и по лестнице', (_name, s) => {
    const reel = siegeReel(s, 'medium');
    const w = reel.layout.wall;
    if (!w) return;
    const pose: TrackPose = { x: 0, y: 0, z: 0, yaw: 0, clip: 'idle', time: 0, shown: true };
    let checked = 0;
    for (let t = 0; t <= reel.seconds; t += 0.25) {
      for (let i = 0; i < reel.tracks.count; i++) {
        poseAt(reel.tracks, i, t, 0, pose);
        if (!pose.shown) continue;
        const d = -(w.z - pose.z) * w.inward;
        if (d <= 0.05 || d >= w.thick - 0.05 || Math.abs(pose.x) > w.halfX) continue;
        checked++;
        // В толще стены: в проезде, на ходу (высота хода — по месту, ход у `walkZ`) или на лестнице (высота задана).
        const onWalkLine = Math.abs(pose.z - reel.layout.walkZ) < 0.05;
        expect(inGate(w, pose.x) || onWalkLine || Number.isFinite(pose.y), `фигура ${i} на ${t} с в толще стены (${pose.x.toFixed(2)}, ${pose.z.toFixed(2)})`).toBe(true);
      }
    }
    expect(checked, 'граница области: в толще стены кто-то бывает (ход, ворота)').toBeGreaterThan(0);
  });

  it('эпизоды идут подряд с временем между ними; свет проходит ночь, когда идёт новая фаза', () => {
    const reel = siegeReel(show(), 'medium');
    for (let i = 1; i < reel.episodes.length; i++) expect(reel.episodes[i].at).toBeGreaterThan(reel.episodes[i - 1].at + reel.episodes[i - 1].len - 1e-6);
    // Между фазами — ночь: свет уходит за закат (доля суток больше 0.5) хотя бы раз.
    let night = false;
    for (let t = 0; t < reel.seconds; t += 0.1) if (solarAt(reel, t) > 0.55 && solarAt(reel, t) < 0.95) night = true;
    expect(night).toBe(true);
    expect(episodeAt(reel, 0).kind).toBe('pitch');
  });

  it('короткий ролик эпизода — кусок того же ролика: пролом, вылазка, сдача', () => {
    const s = SET[2][1];
    const reel = siegeReel(s, 'low');
    for (const kind of ['breach', 'sortie', 'hunger'] as const) {
      const ep = reel.episodes.find((e) => e.kind === kind)!;
      expect(CLIPPED).toContain(kind);
      const clip = clipOf(reel, ep);
      expect(clip.from).toBeLessThanOrEqual(ep.at);
      expect(clip.to).toBeGreaterThanOrEqual(ep.at + Math.min(ep.len, EPISODE_SECONDS[kind]));
    }
  });
});
