// Стенд ролика осады: `?replay=siege&case=…` (docs/gfx.md, ГФ-2). Осады стенда — записи осады (`world/siegerecord`), какие
// пишет мир: фазы с бросками, залпы, машины в очереди, бои; в ролик они идут той же дверью, что в игре (`ui/battle/siege`).
//
//   ?replay=siege&case=gates|storm|hunger|broken|paid|lair|repair   осада-образец (по умолчанию gates)
//   &quality=low|medium|high      уровень (по умолчанию средний)
//   &at=<эпизод>[:фаза][@доля]    кадр стоит на эпизоде (pitch, breach:2, sortie, gates, fate…; доля его длины — 0.6)
//   &t=12.5                       кадр стоит на секунде
//   &clip=<эпизод>[:фаза]         короткий ролик эпизода
//   &layer=1 [&at=…|card]         тем же слоем, что в игре (`SiegeReplay`): фаза, проломы, подпись, кнопки, карточка
//   &cam=auto|top|wide            положение камеры для снимка; &clean=1 &dpr=2 &speed=2
//   &us=atk|def &wall=N           чья осада и уровень частокола поверх образца (снимки П-6: роль зрителя, дерево и камень)
//   &solar=0.3                    свет всех эпизодов — эта доля суток (0.25 — полдень, 0.75 — полночь), без стенда — час осады
//
// Счёт кадра — в `document.body.dataset.replay` (его читает `npm run tw:shots`), отладочный крючок — `window.twStand`.
import * as THREE from 'three';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { configureRenderer } from '../lighting';
import { pixelRatio } from '../loop';
import { qualityOf } from '../quality';
import { TW_BUDGET, TW_SPEC } from '../reel/spec';
import { siegeReel, clipOf, episodeAt, type Episode, type SiegeReel } from './reel';
import { SiegePlayer } from './player';
import { showOfSiege, clipsOfSiege, type SiegeClip } from '@/ui/battle/siege';
import { SIEGE_PHASE } from '@/world/data/siegeroll';
import { worldDays } from '@/game/pace';
import type { SiegeRecord } from '@/world/siegerecord';
import type { PhaseOut, PhaseRow, SiegeDeed } from '@/world/siegeroll';
import type { MachineOrder } from '@/world/machines';
import type { Report } from '@/world/types';
import type { SiegeShow } from './show';

const S = 1_760_000_000_000;
const at = (k: number): number => S + k * SIEGE_PHASE;

/** Строка фазы: бросок и исход, поправки — для подписи (стенд их не считает, только показывает). */
const row = (k: number, out: PhaseOut, die: number, mods: PhaseRow['mods'] = {}, waste = 0.03): PhaseRow => ({ at: at(k), die, mods, out, waste });
const volley = (k: number): SiegeDeed => ({ at: at(k - 1) + 3_600_000, act: 'volley' });

interface Case {
  rec: SiegeRecord;
  report: Pick<Report, 'title' | 'text' | 'won' | 'loot' | 'led'>;
}

/** Время племени в минуту конца: чтобы первая фаза пришлась на вечер, а развязка — на утро. */
const PLACE = (hour: number) => ({ land: 'plain' as const, woods: true, road: true, time: 60 * (40 + hour / 24) });

function cases(): Record<string, Case> {
  const wood = { front: 0.5, rear: 0, machines: 1.5 };
  const order = (id: MachineOrder['id']): MachineOrder => ({ id, at: S + 1000 });
  return {
    gates: {
      rec: {
        us: 'atk',
        campId: 'general',
        startedAt: S,
        sinceAt: S,
        fate: 'captives',
        wall: 6,
        garrison: 180,
        camp: 420,
        wood,
        log: [volley(2), volley(4)],
        phases: [row(1, 'calm', 6, { wall: -3 }), row(2, 'breach', 13, { volley: 2, wall: -3 }), row(3, 'short', 9, { breach: 1, machine: 1, wall: -3 }), row(4, 'breach', 12, { breach: 1, volley: 2, machine: 1, progress: 1, wall: -3 }), row(5, 'gates', 14, { breach: 2, machine: 1, progress: 3, wall: -3 })],
        machines: [order('mangonel')],
        end: { at: at(5), how: 'gates', fate: 'plunder' },
        place: PLACE(9),
      },
      report: { title: 'Ворота открыли: Вельск', text: 'Вельск сдался на 5-й фазе осады: гарнизон ушёл живым, участь «ограбить».', won: true, loot: { food: 320, wood: 140, gold: 90 }, led: 0 },
    },
    storm: {
      rec: {
        us: 'atk',
        campId: 'general',
        startedAt: S,
        sinceAt: S,
        fate: 'plunder',
        wall: 9,
        garrison: 240,
        camp: 520,
        wood: { front: 0.3, rear: 0, machines: 2.4 },
        log: [volley(1), volley(2)],
        phases: [row(1, 'breach', 14, { volley: 2, wall: -4 }), row(2, 'breach', 13, { breach: 1, volley: 2, progress: 1, wall: -4 }), row(3, 'short', 10, { breach: 2, progress: 2, wall: -4 })],
        machines: [order('ladders'), order('ram'), order('tower')].map((m) => ({ ...m, spent: at(3) + 3_600_000 })),
        fights: [{ at: at(3) + 3_600_000, site: 'wall', won: true }],
        end: { at: at(3) + 3_600_000, how: 'storm', fate: 'plunder' },
        place: PLACE(14),
      },
      report: { title: 'Город взят штурмом: Озёрск', text: 'Лестницы, таран и башня; город взят. Участь «ограбить».', won: true, loot: { food: 500, gold: 210 }, led: 0 },
    },
    hunger: {
      rec: {
        us: 'def',
        campId: 'm7',
        startedAt: S,
        sinceAt: S,
        fate: 'burn',
        wall: 4,
        garrison: 140,
        camp: 380,
        tower: 4,
        fire: { slow: 0.2, thin: 0.12, at: S, base: 0 },
        // Выбитое башней к концу — образец стенда (в игре его пишет мир при снятии лагеря, `SiegeRecord.thinned`).
        thinned: 0.12,
        wood: { front: 0.5, rear: 0, machines: 2 },
        phases: [row(1, 'plague', 2, { wall: -2 }, 0.08), row(2, 'breach', 13, { wall: -2 }), row(3, 'calm', 7, { breach: 1, machine: 1, wall: -2 }), row(4, 'short', 11, { breach: 1, hunger: 1, progress: 1, wall: -2 })],
        machines: [{ ...order('mangonel'), spent: at(4) + 3_600_000, burned: true }],
        fights: [{ at: at(4) + 3_600_000, site: 'sortie', won: true, machine: 'mangonel' }],
        end: { at: at(4) + worldDays(3), how: 'hunger', fate: 'burn' },
        place: PLACE(20),
      },
      report: { title: 'Хлеб кончился', text: 'Враги взяли город голодом, гарнизон разошёлся. Участь «сжечь».', won: false, loot: { food: 40, wood: 300 }, led: 0 },
    },
    broken: {
      rec: {
        us: 'def',
        campId: 'm3',
        startedAt: S,
        sinceAt: S,
        wall: 2,
        garrison: 160,
        camp: 300,
        phases: [row(1, 'calm', 5, { wall: -1 }), row(2, 'breach', 14, { wall: -1 })],
        end: { at: at(2) + 7_200_000, how: 'broken' },
        place: PLACE(7),
      },
      report: { title: 'Лагерь разбит: Серые Волки', text: 'Гарнизон из ворот и дружина с поля: лагерь разметан, осада снята.', won: true, loot: null, led: 0 },
    },
    paid: {
      rec: {
        us: 'def',
        campId: 'm5',
        startedAt: S,
        sinceAt: S,
        wall: 5,
        garrison: 120,
        camp: 340,
        phases: [row(1, 'short', 10, { wall: -2 }), row(2, 'short', 11, { progress: 1, wall: -2 })],
        end: { at: at(2) + 3_600_000, how: 'paid' },
        place: PLACE(16),
      },
      report: { title: 'Дань отдана', text: 'Лагерь взял дань и ушёл. Город неприкосновенен.', won: false, loot: { food: 210, gold: 60 }, led: 0 },
    },
    lair: {
      rec: {
        us: 'atk',
        campId: 'general',
        startedAt: S,
        sinceAt: S,
        garrison: 90,
        camp: 260,
        log: [volley(2)],
        phases: [row(1, 'plague', 3, {}, 0.09), row(2, 'calm', 8, { volley: 2 }), row(3, 'short', 11, { volley: 0 })],
        end: { at: at(4), how: 'hunger', fate: 'burn' },
        place: { ...PLACE(18), land: 'hills' },
      },
      report: { title: 'Город взят голодом: Логово', text: 'В логове кончился хлеб. Участь «сжечь».', won: true, loot: { food: 80 }, led: 0 },
    },
    repair: {
      rec: {
        us: 'def',
        campId: 'm9',
        startedAt: S,
        sinceAt: S,
        fate: 'captives',
        wall: 7,
        garrison: 200,
        camp: 460,
        log: [{ at: at(1) + 1_800_000, act: 'repair' }],
        phases: [row(1, 'breach', 14, { wall: -3 }), row(2, 'calm', 9, { breach: 1, wall: -3 }), row(3, 'breach', 15, { wall: -3 }), row(4, 'breach', 13, { breach: 1, progress: 1, wall: -3 }), row(5, 'calm', 6, { breach: 2, progress: 2, wall: -3 })],
        end: { at: at(6), how: 'hunger', fate: 'captives' },
        place: PLACE(5),
      },
      report: { title: 'Хлеб кончился', text: 'Пролом заделывали, но хлеб кончился. Участь «увести людей».', won: false, loot: { food: 10 }, led: 34 },
    },
  };
}

/** Свет всех эпизодов — одна доля суток (снимки дня и ночи одной осады): стенд, не игра. */
function forceSolar(show: SiegeShow, solar: number): void {
  show.solar0 = solar;
  show.end.solar = solar;
  for (const ph of show.phases) ph.solar = solar;
  for (const mc of show.machines) mc.solar = solar;
  for (const f of show.fights) f.solar = solar;
}

/** Эпизод из адреса: `kind[:k][@доля]`. */
function pickEpisode(reel: SiegeReel, spec: string | null): { ep: Episode; share: number } | null {
  if (!spec) return null;
  const [head, frac] = spec.split('@');
  const [kind, k] = head.split(':');
  const ep = reel.episodes.find((e) => e.kind === kind && (k === undefined || e.k === Number(k)));
  return ep ? { ep, share: frac !== undefined ? Number(frac) : 0.6 } : null;
}

export function standSiege(p: URLSearchParams): { rec: SiegeRecord; report: Report; name: string } {
  const all = cases();
  const name = p.get('case') ?? 'gates';
  const base = all[name] ?? all.gates;
  // Роль и стена поверх образца (П-6): та же осада глазами другой стороны, частоколом или камнем.
  const us = p.get('us');
  const wall = p.has('wall') ? Math.max(0, Math.round(Number(p.get('wall')))) : null;
  const c: Case = { ...base, rec: { ...base.rec, ...(us === 'atk' || us === 'def' ? { us } : {}), ...(wall !== null ? { wall } : {}) } };
  const report: Report = {
    id: `stand-${name}`,
    at: c.rec.end.at,
    kind: c.rec.us === 'atk' ? 'raid' : 'defense',
    title: c.report.title,
    target: { id: 'stand', name: 'Стенд', x: 0, y: 0 },
    won: c.report.won,
    sent: {},
    lost: {},
    enemyPower: null,
    enemyLost: null,
    loot: c.report.loot,
    intel: null,
    battle: null,
    siege: c.rec,
    ...(c.report.led ? { led: c.report.led } : {}),
    text: c.report.text,
    read: true,
  };
  return { rec: c.rec, report, name };
}

/** Стенд ролика осады тем же слоем, что в игре (`ui/battle/SiegeReplay`). */
export function mountSiegeStandUi(p: URLSearchParams): void {
  const { rec, report } = standSiege(p);
  const quality = qualityOf(p.get('quality')) ?? 'medium';
  const reel = siegeReel(showOfSiege(rec, report), quality);
  const at = p.get('at');
  const pick = pickEpisode(reel, at === 'card' ? null : at);
  const clipSpec = p.get('clip');
  const clip: SiegeClip | null = clipSpec ? (clipsOfSiege(rec).find((c) => `${c.kind}:${c.k}` === clipSpec || c.kind === clipSpec) ?? null) : null;
  const freeze = p.has('t') ? Number(p.get('t')) : pick ? pick.ep.at + pick.ep.len * pick.share : null;
  const root = document.getElementById('root') ?? document.body;
  void import('@/ui/battle/SiegeReplay').then(({ SiegeReplay }) => {
    createRoot(root).render(createElement(SiegeReplay, { rec, report, clip, onDone: () => undefined, freeze, ended: at === 'card' }));
    const ready = (): void => {
      if (!document.querySelector('.replay-siege canvas, .canvas-wrap canvas')) return void setTimeout(ready, 200);
      document.body.dataset.replay = JSON.stringify({ siege: true, ui: true, quality, t: freeze ?? 0, k: reel.k, calls: 0, triangles: 0, crowdTriangles: 0, textureMB: 0, figures: { all: reel.tracks.count }, budget: TW_BUDGET[quality] });
    };
    setTimeout(ready, 800);
  });
}

export function mountSiegeStand(p: URLSearchParams): void {
  const root = document.getElementById('root') ?? document.body;
  root.innerHTML = '';
  document.body.style.margin = '0';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none';
  root.appendChild(canvas);
  const caption = document.createElement('div');
  caption.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;padding:8px 10px;font:11px/1.35 ui-monospace,monospace;white-space:pre-wrap;color:#f4efe4;background:rgba(20,18,14,.6);z-index:5;pointer-events:none';
  if (p.get('clean') === '1') caption.style.display = 'none';
  root.appendChild(caption);

  const { rec, report, name } = standSiege(p);
  const quality = qualityOf(p.get('quality')) ?? 'medium';
  const show = showOfSiege(rec, report);
  if (p.has('solar')) forceSolar(show, Number(p.get('solar')));
  const reel = siegeReel(show, quality);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(pixelRatio(Number(p.get('dpr') ?? 2)));
  configureRenderer(renderer);
  renderer.info.autoReset = false;
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
  const clipSpec = p.get('clip');
  const clipEp = pickEpisode(reel, clipSpec);
  // Первый кадр рисует сам конструктор — счёт кадра пишется со второго, когда проигрыватель уже есть.
  let made = false;
  const player = new SiegePlayer(renderer, reel, TW_SPEC[quality], { speed: Number(p.get('speed') ?? 1), ...(clipEp ? { range: clipOf(reel, clipEp.ep) } : {}), onFrame: () => made && publish() });
  made = true;
  player.cam.attach(canvas);
  const budget = TW_BUDGET[quality];
  function publish(): void {
    const s = player.stats();
    const ep = episodeAt(reel, player.time);
    caption.textContent =
      `осада «${name}» · ${quality} · k ${reel.k} · ролик ${reel.seconds.toFixed(1)} с · эпизодов ${reel.episodes.length}\n` +
      `t=${player.time.toFixed(2)} · ${ep.kind}${ep.k ? ` (фаза ${ep.k})` : ''} · фигур ${reel.tracks.count} · вызовов ${s.calls}/${budget.calls} · ` +
      `треугольников ${s.triangles.toLocaleString('ru')}/${budget.triangles.toLocaleString('ru')} · текстуры ${s.textureMB}/${budget.textureMB} МБ`;
    document.body.dataset.replay = JSON.stringify({
      siege: true,
      case: name,
      quality,
      k: reel.k,
      seconds: reel.seconds,
      t: Number(player.time.toFixed(3)),
      episode: ep.kind,
      figures: { all: reel.tracks.count },
      ...s,
      budget,
      dpr: renderer.getPixelRatio(),
    });
  }
  // Крючок для `tw:shots` (замер цены кадра читает `player` и `plan.figures`): «сшибка» — штурм, самый тяжёлый эпизод; нет
  // штурма — первый пролом.
  const storm = reel.episodes.find((e) => e.kind === 'storm') ?? reel.episodes.find((e) => e.kind === 'breach');
  (window as unknown as { twStand?: unknown }).twStand = { player, reel, plan: { figures: reel.tracks.count, clashAt: storm?.at ?? 0 } };
  window.addEventListener('resize', () => {
    renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
    player.fit();
  });
  const at = p.get('at');
  const pick = pickEpisode(reel, at);
  const frozen = p.has('t') ? Number(p.get('t')) : pick ? pick.ep.at + pick.ep.len * pick.share : null;
  if (frozen !== null) {
    player.seek(frozen);
    const cam = p.get('cam');
    if (cam === 'top' || cam === 'wide') {
      player.cam.auto = false;
      Object.assign(player.cam.goal, { tx: 0, tz: -18, dist: cam === 'top' ? 90 : 75, yaw: 0.35, pitch: cam === 'top' ? 1.15 : 0.55 });
      player.cam.snap();
    }
    player.draw();
    publish();
    player.live(p.get('clean') !== '1');
  } else player.start();
}
