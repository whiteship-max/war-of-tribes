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
//   &t=12.5   остановиться на этой секунде;  &at=muster|pullback|field|melee|last
//   &snap=имя отправить кадр на dev-сервер (POST /__snap → snaps/имя.png)
//   &dpr=2    плотность пикселей снимка;  &speed=2 быстрее реального времени
//
// Подпись и бюджет дублируются в document.body.dataset.replay — их читает
// инструмент проверки, которому сама канва недоступна.
import * as THREE from 'three';
import { simulateBattle } from '@/battle/sim';
import { quickSetup } from '@/battle/setup';
import { buildCast, type Act, type Cast } from '@/battle/replay';
import type { BattleResult, Side, Stack } from '@/battle/types';
import { configureRenderer } from './lighting';
import { ReplayPlayer } from './battle/player';

/** Состав по числу бойцов: сбалансированная армия, доли те же на любом размере. */
function armyOf(men: number): Partial<Stack> {
  const part = (k: number): number => Math.max(0, Math.round(men * k));
  return { spear: part(0.25), infantry: part(0.35), archer: part(0.25), cavalry: part(0.15) };
}

function fight(men: number, foe: number, seed: number): BattleResult {
  return simulateBattle({ seed, attacker: quickSetup(armyOf(men)), defender: quickSetup(armyOf(foe)) });
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
  const result = fight(men, foe, seed);
  const cast = buildCast(result, us);

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
      `бой ${men} против ${foe} · сид ${seed} · ролик ${f.seconds.toFixed(1)} с\n` +
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
      ...s,
      dpr: renderer.getPixelRatio(),
      size: [canvas.clientWidth, canvas.clientHeight],
    });
  }

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
