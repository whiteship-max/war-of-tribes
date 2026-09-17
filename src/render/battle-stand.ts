// Стенд ролика о бое. Открывается по ?replay=… и заменяет собой игру — так же,
// как ?showcase=… заменяет её стендом графики. Стенд не часть визуализации: он
// сам считает бой, чтобы было что проигрывать, и поэтому лежит рядом с папкой
// проигрывателя, а не внутри неё. В `render/battle/` симуляции нет и быть не должно.
//
//   ?replay=1&men=20&foe=20
//     бой заданного размера, ролик идёт сам.
//   ?replay=1&men=500&foe=500&at=pullback
//     кадр в середине отъезда — самое тяжёлое место: фигуры ещё крупные, а видно
//     уже много. Бюджет меряется здесь, а не на статичных планах.
//   ?replay=1&men=200&place=ford,woods&hour=19&at=field
//     то же место и тот же час, что записал бы мир: земля и свет выводятся из
//     записи боя той же чистой функцией, что и в игре.
//   &place=ford|river|ridge|road|woods|hills|shore — через запятую, как в клетке
//   &hour=0..24  час игровых суток;  &winter=1 — зимний бой
//   &t=12.5   остановиться на этой секунде
//   &at=muster|pull1|pullback|pull3|field|melee|last — планы камеры
//   &at=volley|clash|charge|rout — моменты действия, найденные в журнале
//   &snap=имя отправить кадр на dev-сервер (POST /__snap → snaps/имя.png)
//   &dpr=2    плотность пикселей снимка;  &speed=2 быстрее реального времени
//
// Подпись и бюджет дублируются в document.body.dataset.replay — их читает
// инструмент проверки, которому сама канва недоступна.
import * as THREE from 'three';
import { simulateBattle } from '@/battle/sim';
import { emptyStack, quickSetup } from '@/battle/setup';
import type { Act, Cast } from '@/battle/replay';
import { castOfRecord } from '@/game/battle/cast';
import { troopsOfKinds } from '@/game/battle/faces';
import { groundName, hourName, type BattleLand, type BattlePlace } from '@/game/battle/ground';
import { DAY_LENGTH } from '@/game/constants';
import { kindsOf, type TroopStack } from '@/game/battle/kinds';
import type { BattleResult, Side, Stack } from '@/battle/types';
import { configureRenderer } from './lighting';
import { ReplayPlayer } from './battle/player';

/**
 * Состав по числу бойцов: сбалансированное войско, доли те же на любом размере.
 * Виды настоящие и разные — стенд обязан показывать то же, что игра, а на
 * близком плане ровно это и проверяется: видно, кого собрал.
 */
function armyOf(men: number): TroopStack {
  const part = (k: number): number => Math.max(0, Math.round(men * k));
  return {
    spearman: part(0.25),
    legionary: part(0.12),
    swordsman: part(0.13),
    clubman: part(0.1),
    archer: part(0.25),
    rider: part(0.15),
  };
}

/**
 * Место боя из адреса — той же формы, что кладёт в запись мира. Стенд обязан
 * ходить тем же путём, что игра: если бы он собирал `Ground` напрямую, кадры
 * приёмки ничего не доказывали бы про настоящий ролик.
 */
function placeOf(p: URLSearchParams): BattlePlace | undefined {
  const marks = (p.get('place') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const hour = p.has('hour') ? Number(p.get('hour')) : null;
  const winter = p.get('winter') === '1';
  if (marks.length === 0 && hour === null && !winter) return undefined;
  const land: BattleLand = marks.includes('shore') ? 'shore' : marks.includes('hills') ? 'hills' : 'plain';
  const place: BattlePlace = { land };
  if (marks.includes('river') || marks.includes('ford')) place.river = true;
  if (marks.includes('ford')) place.ford = true;
  if (marks.includes('ridge')) place.ridge = true;
  if (marks.includes('road')) place.road = true;
  if (marks.includes('woods')) place.woods = true;
  // Час и время года приходят одним числом — игровым временем племени, ровно
  // как в игре. Зима — это просто день из зимнего сезона (`SEASON_DAYS`).
  const day = winter ? 15 : 0;
  place.time = (day + (hour === null ? 0.5 : hour / 24)) * DAY_LENGTH;
  return place;
}

function fight(a: Stack, d: Stack, seed: number): BattleResult {
  return simulateBattle({ seed, attacker: quickSetup(a), defender: quickSetup(d) });
}

/** Именованные моменты ролика: по ним снимают кадры приёмки. */
function moment(cast: Cast, at: string): number {
  const win = (a: Act): { from: number; to: number } => cast.acts.find((w) => w.act === a)!;
  switch (at) {
    case 'muster':
      return win('muster').from + 1.5;
    case 'pull1':
      return win('pullback').from + (win('pullback').to - win('pullback').from) * 0.2;
    case 'pullback':
      return win('pullback').from + (win('pullback').to - win('pullback').from) * 0.5;
    case 'pull3':
      return win('pullback').from + (win('pullback').to - win('pullback').from) * 0.8;
    case 'field':
      return win('melee').from + 1;
    case 'melee':
      return win('melee').from + (win('melee').to - win('melee').from) * 0.6;
    // Моменты действия ищутся по журналу: стенд обязан показывать ровно то, что
    // в нём записано, а не подобранную руками секунду.
    case 'volley': {
      // Стрельба живёт в стрелковой фазе, а событие `volley` подводит её итог
      // на тике столкновения, — берём фазу, а не отметку события.
      const r = cast.spans.find((x) => x.phase === 'ranged');
      const a = cast.spans.find((x) => x.phase === 'approach');
      return r && a ? r.t0 + (a.t1 - r.t0) * 0.63 : 1.5;
    }
    case 'clash': {
      const clash = cast.spans.find((x) => x.phase === 'clash');
      return clash ? clash.t0 + 0.5 : win('melee').from;
    }
    case 'charge': {
      const m = cast.marks.find(
        (x) => x.id === 'cavalry-broke-archers' || x.id === 'flank-turned' || x.id === 'cavalry-intercepted',
      );
      return m ? m.t + 1.3 : win('melee').from + 4;
    }
    case 'rout': {
      const m = cast.marks.find((x) => x.id === 'sector-broken');
      return m ? m.t + 2.2 : cast.seconds - 4;
    }
    case 'last':
      return cast.seconds;
    default:
      return 0;
  }
}

export function mountReplayStand(p: URLSearchParams): void {
  const root = document.getElementById('root') ?? document.body;
  root.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none';
  root.appendChild(canvas);

  const caption = document.createElement('div');
  caption.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;padding:8px 10px;font:12px/1.35 ui-monospace,monospace;' +
    'white-space:pre-wrap;color:#fff;background:rgba(0,0,0,.55);z-index:5';
  if (p.get('clean') === '1') caption.style.display = 'none';
  root.appendChild(caption);

  const men = Number(p.get('men') ?? 200);
  const foe = Number(p.get('foe') ?? men);
  const seed = Number(p.get('seed') ?? 7);
  const us = (p.get('us') as Side) ?? 'attacker';
  const mine = armyOf(men);
  const theirs = p.get('foeKinds') === '1' ? null : armyOf(foe);
  const result = fight(kindsOf(mine), theirs ? kindsOf(theirs) : { ...emptyStack(), infantry: foe }, seed);
  // Чужой состав — как в игре: из родов и ступени снаряжения (`foeKinds=1`
  // показывает именно этот путь, а не поимённый).
  const foeTroops = theirs ?? troopsOfKinds(result.sides.defender.initial, { infantry: 3 });
  const cast = castOfRecord(result, us, { attacker: mine, defender: foeTroops }, undefined, placeOf(p));

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    // Снимок читается из буфера сразу после render, но в отладке кадр иногда
    // берут и позже — без этого он придёт пустым.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Number(p.get('dpr') ?? 2));
  configureRenderer(renderer);
  // Честный счёт вызовов вместе с теневым проходом — как в игре и в стенде графики.
  renderer.info.autoReset = false;

  // onFrame ставится после сборки: конструктор рисует первый кадр сам, а подпись
  // читает `player`, которого в этот момент ещё нет.
  const opts = { speed: Number(p.get('speed') ?? 1) } as { speed: number; onFrame?: () => void };
  const player = new ReplayPlayer(renderer, cast, opts);
  opts.onFrame = () => publish();

  const resize = (): void => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    player.fit();
    player.draw();
  };
  window.addEventListener('resize', resize);
  resize();

  const at = p.get('at');
  const frozen = p.has('t') ? Number(p.get('t')) : at ? moment(cast, at) : null;

  function publish(): void {
    const s = player.stats();
    const f = cast;
    const text =
      `бой ${men} против ${foe} · сид ${seed} · ролик ${f.seconds.toFixed(1)} с · ` +
      `${groundName(f.ground)} ${hourName(f.ground)}${f.ground.winter ? ', зимой' : ''}\n` +
      `t=${player.time.toFixed(2)} · фигур ${f.figures.attacker}/${f.figures.defender} · ` +
      `вызовов ${s.calls} · треугольников ${s.triangles.toLocaleString('ru')} · инстансов ${s.instances}`;
    caption.textContent = text;
    document.body.dataset.replay = JSON.stringify({
      men,
      foe,
      seed,
      seconds: f.seconds,
      t: Number(player.time.toFixed(3)),
      figures: f.figures,
      battleMen: f.men,
      ground: f.ground,
      ...s,
      dpr: renderer.getPixelRatio(),
      size: [canvas.clientWidth, canvas.clientHeight],
    });
  }

  // Отладочный крючок стенда: инструмент проверки не видит канву и не может
  // дотянуться до сцены иначе. В игру стенд не попадает, поэтому и крючок тоже.
  (window as unknown as { replayStand?: unknown }).replayStand = { player, cast, result };

  if (frozen !== null) {
    player.seek(frozen);
    publish();
  } else {
    player.start();
  }

  const name = p.get('snap');
  if (name) {
    // Снимок берётся сразу после кадра: буфер WebGL живёт до следующей отрисовки.
    requestAnimationFrame(() => {
      player.draw();
      publish();
      canvas.toBlob((blob) => {
        if (!blob) return;
        void fetch(`/__snap?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob })
          .then((r) => r.text())
          .then((file) => {
            caption.textContent += `\nснимок → ${file}`;
          })
          .catch(() => {
            caption.textContent += '\nснимок некуда класть: /__snap есть только у dev-сервера';
          });
      }, 'image/png');
    });
  }
}
