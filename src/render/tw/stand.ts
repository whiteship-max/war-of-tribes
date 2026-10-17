// Стенд ролика боя в стиле Total War: `?replay=tw&…` (docs/battle_tw.md, раздел 9). Бой считает прежний стенд
// (`battle-stand.standBattle`) — тем же путём, что игра: состав, место и час из адреса, правило развёртывания ядра.
// Здесь он только показывается.
//
//   ?replay=tw&men=300&foe=300                 бой, ролик идёт сам, камера — общий вид
//   &quality=low|medium|high                   уровень (по умолчанию средний)
//   &t=12.5 | &at=deploy|volley|advance|charge|clash|melee|reserve|flank|waver|rout|pursuit|last   кадр стоит
//   &at=overview|turn|outcome|coda                такты смысла: кадр режиссёра (docs/gfx.md, «Камера»)
//   &layer=1 [&at=…|card]                       тем же слоем, что в игре (`TwReplay`: шкала сил, кнопки, карточка итога)
//   &cam=auto|near|side|top|low|line|cav       положение камеры для снимка (line, cav — вплотную к своему строю и коннице)
//   &place=… &hour=… &winter=1 &beasts=1 &seed=… &clean=1 &dpr=2 &speed=2
//   &sound=1                                   звук боя: первое касание холста открывает его (жест), настройку не трогает
//
// Счёт кадра — в `document.body.dataset.replay` (его читает `npm run tw:shots`), отладочный крючок — `window.twStand`.
import { barrageShares } from '@/ui/battle/barrage';
import * as THREE from 'three';
import { standBattle } from '../battle-stand';
import { groundName, hourName } from '@/game/battle/ground';
import { configureRenderer } from '../lighting';
import { nextFrame, pixelRatio } from '../loop';
import { qualityOf } from '../quality';
import { TW_BUDGET, TW_SPEC } from '../reel/spec';
import { twPlanOfRecord } from './record';
import { TwPlayer } from './player';
import { ADVANCE_FROM, unitPose, type TwPlan } from './plan';
import { OVERVIEW_PITCH, type CamState } from '../reel/camera';
import { CueClock, ambienceAt, cuesOf } from './cues';
import { beatsOf } from '../reel/beats';
import { beatCues } from '../reel/director';
import type { BattleFx } from '@/sound/battlefx';
import type { BattleRecord, BattleSite } from '@/world/types';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

/** Именованные моменты: по ним снимают кадры самопроверки. Ищутся по режиссуре, а не подбираются руками. */
/**
 * Секунда ролика для момента стенда: пролог обстрела — своими секундами (docs/battle_tw.md, раздел 15), бой — секундами боя
 * со сдвигом на длину пролога (`TwPlayer.pre`): часы ролика идут от начала пролога.
 */
function momentOf(plan: TwPlan, at: string): number {
  const b = plan.barrage;
  const pre = b?.seconds ?? 0;
  if (b) {
    const firstWall = Math.min(...b.stones.filter((s) => s.hit === 'wall' || s.hit === 'hut').map((s) => s.at + s.flight));
    const chunk = b.breach?.chunks[0]?.at ?? firstWall;
    switch (at) {
      case 'bombard':
        return 1.4;
      case 'loose':
        return b.stones[0].at + b.stones[0].flight * 0.45;
      case 'impact':
        return firstWall + 0.6;
      case 'collapse':
        return chunk + 0.3;
      case 'fall':
        return chunk + 0.6;
      case 'smoke':
        return pre - 0.4;
    }
  }
  return pre + moment(plan, at);
}

function moment(plan: TwPlan, at: string): number {
  const firstVolley = Math.min(...plan.units.flatMap((u) => u.volleys), Infinity);
  const broke = Math.min(...plan.units.map((u) => u.fleeAt ?? Infinity));
  const beats = beatsOf(plan.cast, plan.result, plan.timing);
  const beat = (id: string): number | null => beats.find((b) => b.id === id)?.at ?? null;
  switch (at) {
    // Такты смысла (docs/gfx.md, «Такты»): кадр режиссёра на такте — общий план, сшибка, перелом, развязка, поле после боя.
    case 'overview':
      return Math.min(3, plan.clashAt - 2);
    case 'turn': {
      // Камера пришла к перелому: тронулась (`beatCues`) и прошла переход.
      const i = beats.findIndex((b) => b.id === 'turn');
      return i >= 0 ? Math.max(beats[i].at, beatCues(beats)[i]) + 2.6 : plan.clashAt + 4;
    }
    case 'outcome': {
      const b = beat('outcome');
      return b !== null ? Math.min(plan.timing.end, b + 1.8) : plan.timing.rout[0] + 1;
    }
    case 'coda':
      return plan.seconds - 0.2;
    case 'deploy':
      return 1.5;
    case 'volley':
      return Number.isFinite(firstVolley) ? firstVolley + 0.9 : 2;
    case 'advance':
      return ADVANCE_FROM + 3.5;
    case 'charge':
      return plan.clashAt - 1;
    case 'clash':
      return plan.clashAt + 0.35;
    case 'melee':
      return plan.timing.melee[0] + (plan.timing.melee[1] - plan.timing.melee[0]) * 0.5;
    case 'rout':
      return Number.isFinite(broke) ? broke + 2.5 : plan.timing.rout[0] + 2;
    case 'waver':
      return Number.isFinite(broke) ? broke - 0.5 : plan.timing.rout[0];
    case 'reserve': {
      const go = Math.min(...plan.units.map((u) => (u.row === 'reserve' && u.commit ? u.commit.at : Infinity)));
      return Number.isFinite(go) ? go + 1.8 : plan.timing.melee[0] + 4;
    }
    case 'flank': {
      let go = Infinity;
      for (let i = 0; i < plan.figures; i++) if (plan.goKind[i] === 2) go = Math.min(go, plan.goAt[i]);
      return Number.isFinite(go) ? go + 1.6 : plan.timing.melee[0] + 4;
    }
    case 'pursuit': {
      const b = Math.min(plan.brokenAt.attacker ?? Infinity, plan.brokenAt.defender ?? Infinity);
      return Number.isFinite(b) ? b + 3 : plan.timing.rout[0] + 3;
    }
    case 'last':
      return plan.seconds;
    // Место боя (docs/battle_tw.md, раздел 13): лестницы у стены, таран, пролом ворот, улица, через стену.
    case 'ladders':
      return plan.clashAt + 2.5;
    case 'ram': {
      const h = plan.site?.ram?.hits[1];
      return h !== undefined ? h - 0.05 : plan.clashAt + 2;
    }
    case 'breach': {
      const g = plan.site?.wall?.gateAt;
      return g !== null && g !== undefined && g > 0 ? g + 1.6 : plan.clashAt + 6;
    }
    case 'streets': {
      const g = plan.site?.wall?.gateAt;
      return g !== null && g !== undefined && g > 0 ? Math.min(plan.seconds, g + 7) : plan.timing.melee[1];
    }
    case 'over': {
      let go = Infinity;
      for (let i = 0; i < plan.figures; i++) if (plan.goKind[i] === 4) go = Math.min(go, plan.goAt[i]);
      return Number.isFinite(go) ? go + 2 : plan.timing.melee[1];
    }
    // Совместный удар: гарнизон идёт из ворот через лагерь (путь 5) — середина потока.
    case 'sally': {
      let a = Infinity;
      let b = -Infinity;
      for (let i = 0; i < plan.figures; i++) {
        if (plan.goKind[i] !== 5) continue;
        a = Math.min(a, plan.goAt[i]);
        b = Math.max(b, plan.goAt[i]);
      }
      return Number.isFinite(a) ? (a + b) / 2 + 1 : 2;
    }
    default:
      return 0;
  }
}

/** Положения камеры для снимков: от общего вида — ниже, сбоку, сверху, вплотную к сшибке. */
function shot(base: CamState, cam: string, plan: TwPlan, t = 0): CamState {
  switch (cam) {
    // Вплотную к своему отряду на секунде кадра (облик бойцов, docs/polish.md, П-5): к середине первой линии наших
    // пеших — строй; к нашей коннице (иначе — к чужой) — всадники.
    case 'line':
    case 'cav': {
      const horse = (u: TwPlan['units'][number]): boolean => u.form === 'horse' || u.form === 'heavy';
      const pick = (ours: boolean): TwPlan['units'][number] | undefined =>
        plan.units.filter((u) => u.ours === ours && (cam === 'cav' ? horse(u) : u.row === 'front' && !horse(u) && u.form !== 'bow')).sort((a, b) => Math.abs(a.x) - Math.abs(b.x))[0];
      const u = pick(true) ?? pick(false);
      if (!u) return base;
      const at = unitPose(plan, u, t);
      // Камера — перед строем наискось, к лицам (наши смотрят на +z, чужие — на −z); цель — в первых шеренгах.
      const fwd = u.ours ? 1 : -1;
      return cam === 'cav'
        ? { tx: at.x, tz: at.z - fwd * 1.2, dist: 7.5, yaw: (u.ours ? Math.PI : 0) + 0.6, pitch: 0.2 }
        : { tx: at.x, tz: at.z + fwd * 0.4, dist: 5.5, yaw: (u.ours ? Math.PI : 0) + 0.5, pitch: 0.16 };
    }
    case 'near':
      return { tx: base.tx * 0.3, tz: 0, dist: 15, yaw: 0.35, pitch: 0.36 };
    case 'low':
      return { ...base, dist: base.dist * 0.6, pitch: 0.42 };
    case 'side':
      return { ...base, tz: 0, dist: base.dist * 0.75, yaw: Math.PI / 2, pitch: 0.55 };
    case 'top':
      return { ...base, dist: base.dist * 1.05, pitch: 1.2 };
    // Штурм снаружи: из-за штурмующих на стену; у ворот — вплотную к проезду.
    case 'outside':
      return { ...base, tz: base.tz * 0.3, dist: base.dist * 0.7, yaw: Math.PI, pitch: 0.5 };
    case 'foe': {
      // Вплотную к первому отряду противника на линии: стая, лестницы, частокол — где бьются они, а не середина.
      const u = plan.units.find((x) => x.side !== plan.us && x.row === 'front');
      return u ? { tx: u.x, tz: 0, dist: 13, yaw: 0.4, pitch: 0.4 } : base;
    }
    case 'gate': {
      // У ворот снаружи: цель — перед проездом, камера — со стороны поля, чуть наискось.
      const w = plan.site?.wall;
      if (!w) return base;
      return { tx: w.gateX, tz: w.z - w.inward * 3, dist: 22, yaw: w.inward < 0 ? Math.PI * 0.86 : Math.PI * 0.14, pitch: 0.5 };
    }
    // Пролом обстрела (раздел 15): снаружи, вплотную к нему.
    case 'breach': {
      const w = plan.site?.wall;
      const br = plan.barrage?.breach;
      if (!w || !br) return base;
      return { tx: br.x, tz: w.z - w.inward * 2, dist: 20, yaw: (w.inward > 0 ? 0 : Math.PI) + 0.35, pitch: 0.42 };
    }
    // Машина обстрела вблизи: требушет и расчёт.
    case 'engine': {
      const e = plan.barrage?.engines.find((x) => x.kind === 'trebuchet');
      return e ? { tx: e.x, tz: e.z, dist: 17, yaw: e.yaw + 2.1, pitch: 0.42 } : base;
    }
    default:
      return { ...base, pitch: OVERVIEW_PITCH };
  }
}

/**
 * Стенд ролика тем же слоем, что в игре (`ui/battle/TwReplay`): шкала сил, кнопки, полоса морали, карточка итога. Запись
 * боя — стенда; кадр стоит на моменте `&at=` (или `&t=`), камера — режиссёра. Холст — свой, как у ролика без города.
 */
export function mountTwStandUi(p: URLSearchParams): void {
  const battle = standBattle(p);
  const quality = qualityOf(p.get('quality')) ?? 'medium';
  const rec = {
    us: battle.us,
    result: battle.result,
    troops: battle.troops,
    ...(battle.militia ? { militia: battle.militia } : {}),
    ...(battle.place ? { place: battle.place } : {}),
    ...(battle.beastSide ? { beasts: battle.beastSide } : {}),
    ...(battle.site ? { site: battle.site as BattleSite } : {}),
    ...(battle.shots ? { shots: battle.shots } : {}),
    ...(battle.openings ? { openings: battle.openings } : {}),
  } as BattleRecord;
  const plan = twPlanOfRecord(battle.result, battle.us, battle.troops, quality, battle.militia, battle.place, battle.beastSide, battle.site, barrageShares(battle.shots), battle.openings);
  const at = p.get('at');
  // `card` — карточка итога на последнем кадре (поле после боя).
  const freeze = p.has('t') ? Number(p.get('t')) : at === 'card' ? plan.barrage ? plan.barrage.seconds + plan.seconds : plan.seconds : at ? momentOf(plan, at) : null;
  const root = document.getElementById('root') ?? document.body;
  void import('@/ui/battle/TwReplay').then(({ TwReplay }) => {
    createRoot(root).render(createElement(TwReplay, { rec, onDone: () => undefined, freeze, ended: at === 'card' }));
    // Снимок стенда ждёт счёта кадра (`tw-shots`): слой ролика встал — кадр тот.
    const ready = (): void => {
      if (!document.querySelector('.replay-tw canvas, .canvas-wrap canvas')) return void setTimeout(ready, 200);
      document.body.dataset.replay = JSON.stringify({ tw: true, ui: true, quality, t: freeze ?? 0, k: plan.k, calls: 0, triangles: 0, crowdTriangles: 0, textureMB: 0, figures: plan.sideFigures, budget: TW_BUDGET[quality] });
    };
    setTimeout(ready, 600);
  });
}

export function mountTwStand(p: URLSearchParams): void {
  const root = document.getElementById('root') ?? document.body;
  root.innerHTML = '';
  document.body.style.margin = '0';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none';
  root.appendChild(canvas);
  const clean = p.get('clean') === '1';

  const caption = document.createElement('div');
  caption.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;padding:8px 10px;font:11px/1.35 ui-monospace,monospace;' +
    'white-space:pre-wrap;color:#f4efe4;background:rgba(20,18,14,.6);z-index:5;pointer-events:none';
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:8px;left:8px;right:8px;display:flex;gap:8px;z-index:6';
  const button = (label: string, on: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'font:13px var(--font-sans);padding:8px 12px;border:0;border-radius:8px;background:rgba(32,28,22,.72);color:#f4efe4;min-height:44px';
    b.addEventListener('click', on);
    bar.appendChild(b);
    return b;
  };
  if (clean) {
    caption.style.display = 'none';
    bar.style.display = 'none';
  }
  root.appendChild(caption);
  root.appendChild(bar);

  const battle = standBattle(p);
  const quality = qualityOf(p.get('quality')) ?? 'medium';
  const spec = TW_SPEC[quality];
  const plan = twPlanOfRecord(battle.result, battle.us, battle.troops, quality, battle.militia, battle.place, battle.beastSide, battle.site, barrageShares(battle.shots), battle.openings);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(pixelRatio(Number(p.get('dpr') ?? 2)));
  configureRenderer(renderer);
  renderer.info.autoReset = false;
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);

  const opts = { speed: Number(p.get('speed') ?? 1) } as { speed: number; onFrame?: (t: number) => void; onEnd?: () => void };
  const player = new TwPlayer(renderer, plan, spec, opts);
  player.cam.attach(canvas);
  const play = button('Пауза', () => {
    if (player.playing) player.stop();
    else player.start();
    play.textContent = player.playing ? 'Пауза' : 'Смотреть';
  });
  const overviewBtn = button('Общий вид', () => {
    player.cam.release();
    overviewBtn.style.opacity = '0.5';
  });
  overviewBtn.style.opacity = '0.5';
  player.cam.onTake = () => {
    overviewBtn.style.opacity = '1';
  };
  // Звук стенда: машинка приезжает сразу, а открывается первым касанием — без жеста браузер не даст звука. Своя
  // докачка, как в игре; настройку звука стенд не пишет — слышно только с `&sound=1`.
  let fx: BattleFx | null = null;
  let lastT = 0;
  const clock = new CueClock(cuesOf(plan));
  if (p.get('sound') === '1') {
    void import('@/sound/battlefx').then((m) => {
      const wake = (): void => {
        canvas.removeEventListener('pointerdown', wake);
        fx = m.battleFx(quality === 'low', () => true);
        fx.arm();
      };
      canvas.addEventListener('pointerdown', wake);
    });
  }
  opts.onFrame = (t: number) => {
    publish();
    if (fx) {
      const e = player.cam.camera.matrixWorld.elements;
      const r = Math.hypot(e[0], e[2]) || 1;
      const c = player.cam.camera.position;
      fx.frame(clock.take(t), ambienceAt(plan, player.stage.frame), { x: c.x, y: c.y, z: c.z, rx: e[0] / r, rz: e[2] / r }, Math.max(0, Math.min(0.25, t - lastT)));
    }
    lastT = t;
  };
  opts.onEnd = () => {
    play.textContent = 'Смотреть';
    // Кадров больше нет — гул смолкает, а не тянет последний кадр.
    fx?.rest();
  };

  const resize = (): void => {
    renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
    player.fit();
    if (frozen !== null) freeze();
  };
  window.addEventListener('resize', resize);

  const at = p.get('at');
  const frozen = p.has('t') ? Number(p.get('t')) : at ? momentOf(plan, at) : null;
  const cam = p.get('cam') ?? 'auto';
  const freeze = (): void => {
    player.seek(frozen ?? 0);
    if (cam !== 'auto') {
      player.cam.auto = false;
      Object.assign(player.cam.goal, shot(player.view(frozen ?? 0), cam, plan, frozen ?? 0));
      player.cam.snap();
    }
    player.draw();
  };

  const budget = TW_BUDGET[quality];
  function publish(): void {
    const s = player.stats();
    const g = plan.cast.ground;
    caption.textContent =
      `бой ${battle.men} против ${battle.foe} · сид ${battle.seed} · ${quality} · k ${plan.k}` +
      `${plan.k > 1 ? ` (1 фигура — ${plan.k} бойца)` : ''} · ролик ${player.seconds.toFixed(1)} с · ` +
      `${groundName(g)} ${hourName(g)}${g.winter ? ', зимой' : ''}${plan.crossing ? ' · переправа' : ''}\n` +
      `t=${player.time.toFixed(2)} · фигур ${plan.sideFigures.attacker}/${plan.sideFigures.defender} · отрядов ${plan.units.length} · ` +
      `вызовов ${s.calls}/${budget.calls} · треугольников ${s.triangles.toLocaleString('ru')}/${budget.triangles.toLocaleString('ru')} · ` +
      `текстуры ${s.textureMB}/${budget.textureMB} МБ`;
    document.body.dataset.replay = JSON.stringify({
      tw: true,
      quality,
      men: battle.men,
      foe: battle.foe,
      seed: battle.seed,
      k: plan.k,
      seconds: player.seconds,
      t: Number(player.time.toFixed(3)),
      figures: plan.sideFigures,
      units: plan.units.length,
      crossing: plan.crossing,
      ground: g,
      ...s,
      budget,
      looks: player.stage.crowd.looks(),
      dpr: renderer.getPixelRatio(),
      size: [canvas.clientWidth, canvas.clientHeight],
    });
  }

  (window as unknown as { twStand?: unknown }).twStand = { player, plan, battle };

  if (frozen !== null) {
    freeze();
    publish();
    // Камеру можно вести и на стоящем кадре: цикл кадров живёт, ход ролика — нет.
    player.live(!clean);
  } else {
    player.start();
  }

  const name = p.get('snap');
  if (name) {
    nextFrame(() => {
      player.draw();
      publish();
      canvas.toBlob((blob) => {
        if (!blob) return;
        void fetch(`/__snap?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob }).catch(() => undefined);
      }, 'image/png');
    });
  }
}
