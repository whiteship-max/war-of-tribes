// Стенд ролика боя в стиле Total War: `?replay=tw&…` (docs/battle_tw.md, раздел 9). Бой считает прежний стенд
// (`battle-stand.standBattle`) — тем же путём, что игра: состав, место и час из адреса, правило развёртывания ядра.
// Здесь он только показывается.
//
//   ?replay=tw&men=300&foe=300                 бой, ролик идёт сам, камера — общий вид
//   &quality=low|medium|high                   уровень (по умолчанию средний)
//   &t=12.5 | &at=deploy|volley|advance|charge|clash|melee|reserve|flank|waver|rout|pursuit|last   кадр стоит
//   &cam=auto|near|side|top|low                положение камеры для снимка
//   &place=… &hour=… &winter=1 &beasts=1 &seed=… &clean=1 &dpr=2 &speed=2
//   &sound=1                                   звук боя: первое касание холста открывает его (жест), настройку не трогает
//
// Счёт кадра — в `document.body.dataset.replay` (его читает `npm run tw:shots`), отладочный крючок — `window.twStand`.
import * as THREE from 'three';
import { standBattle } from '../battle-stand';
import { groundName, hourName } from '@/game/battle/ground';
import { configureRenderer } from '../lighting';
import { nextFrame, pixelRatio } from '../loop';
import { qualityOf } from '../quality';
import { TW_BUDGET, TW_SPEC } from './spec';
import { twPlanOfRecord } from './record';
import { TwPlayer } from './player';
import { ADVANCE_FROM, type TwPlan } from './plan';
import { OVERVIEW_PITCH, type CamState } from './camera';
import { CueClock, ambienceAt, cuesOf } from './cues';
import type { BattleFx } from '@/sound/battlefx';

/** Именованные моменты: по ним снимают кадры самопроверки. Ищутся по режиссуре, а не подбираются руками. */
function moment(plan: TwPlan, at: string): number {
  const firstVolley = Math.min(...plan.units.flatMap((u) => u.volleys), Infinity);
  const broke = Math.min(...plan.units.map((u) => u.fleeAt ?? Infinity));
  switch (at) {
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
    default:
      return 0;
  }
}

/** Положения камеры для снимков: от общего вида — ниже, сбоку, сверху, вплотную к сшибке. */
function shot(base: CamState, cam: string): CamState {
  switch (cam) {
    case 'near':
      return { tx: base.tx * 0.3, tz: 0, dist: 15, yaw: 0.35, pitch: 0.36 };
    case 'low':
      return { ...base, dist: base.dist * 0.6, pitch: 0.42 };
    case 'side':
      return { ...base, tz: 0, dist: base.dist * 0.75, yaw: Math.PI / 2, pitch: 0.55 };
    case 'top':
      return { ...base, dist: base.dist * 1.05, pitch: 1.2 };
    default:
      return { ...base, pitch: OVERVIEW_PITCH };
  }
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
      'font:13px system-ui;padding:8px 12px;border:0;border-radius:8px;background:rgba(32,28,22,.72);color:#f4efe4;min-height:44px';
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
  const plan = twPlanOfRecord(battle.result, battle.us, battle.troops, quality, battle.militia, battle.place, battle.beastSide, battle.site);

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
  const frozen = p.has('t') ? Number(p.get('t')) : at ? moment(plan, at) : null;
  const cam = p.get('cam') ?? 'auto';
  const freeze = (): void => {
    player.seek(frozen ?? 0);
    if (cam !== 'auto') {
      player.cam.auto = false;
      Object.assign(player.cam.goal, shot(player.stage.autoView(frozen ?? 0, canvas.clientWidth / Math.max(1, canvas.clientHeight)), cam));
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
      `${plan.k > 1 ? ` (1 фигура — ${plan.k} бойца)` : ''} · ролик ${plan.seconds.toFixed(1)} с · ` +
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
      seconds: plan.seconds,
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
