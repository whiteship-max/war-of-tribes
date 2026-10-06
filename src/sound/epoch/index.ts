// Звук города и карты в игре: фон, музыка эпохи и звуки интерфейса (docs/audio.md). Ленивый кусок «звук города»
// (`vite.config.ts`, `LAZY_DOORS`): тянет его `sound/city.ts` после первого касания, когда контекст уже открыт жестом. Сам
// он ничего не открывает — выходы приходят готовыми, на них и вешаются узлы.

import { useGame } from '@/game/store';
import { dayFraction, seasonOf, solarPhase } from '@/game/derived';
import { useWorld } from '@/world/store';
import { landShare } from '@/world/land';
import { levelNow } from '@/render/gfx';
import { cityNear } from '../ear';
import { Ambience, type Hearing } from './ambience';
import { EpochMusic } from './music';
import { seeded } from './rng';
import { makeKit, type Kit } from './synth';
import { playCue, type Cue } from './cues';

export type { Cue };

/** Насколько глушить, когда поверх города свои звуки: ролик боя, промысел, предыстория. */
export interface Duck {
  music: number;
  amb: number;
}

export interface EpochMachine {
  duck(d: Duck): void;
  cue(name: Cue): void;
  stop(): void;
}

/** Окно упреждения и шаг планировщика, с. */
const HORIZON = 1;
const STEP_MS = 250;
/** Касание чаще этого — один звук: быстрые нажатия не должны трещать. */
const TAP_GAP = 0.09;

/** Радиус, в котором меряется море у дома на карте (клеток). */
const SEA_RADIUS = 7;

/** Что слышит игрок — из стора игры, мира и уха камеры. */
function hearing(): Hearing {
  const g = useGame.getState();
  const time = g.s.time;
  const season = seasonOf(time);
  const home = useWorld.getState().info?.home;
  return {
    view: g.mapOpen ? 'map' : 'city',
    solar: solarPhase(dayFraction(time), season),
    season,
    near: cityNear(),
    sea: home ? 1 - landShare(home.x, home.y, SEA_RADIUS) : 0,
  };
}

/**
 * Поднять звук города на готовых выходах. Слабый телефон — «Низкое» по уровню игры, одному на всю игру
 * (`gfx.levelNow`, docs/perf.md, решение 3): меньше слоёв — без свиста ветра, пены, отзвука, видов птиц, второй ноты
 * бурдона.
 */
export function startEpoch(out: { music: GainNode; fx: GainNode }, lite = levelNow(location.search) === 'low'): EpochMachine {
  const ctx = out.fx.context;
  const musicOut = ctx.createGain();
  musicOut.connect(out.music);
  const ambOut = ctx.createGain();
  ambOut.connect(out.fx);
  const uiOut = ctx.createGain();
  uiOut.connect(out.fx);
  // Зерно на сеанс — случайное: пьесы и фон каждый раз свои (случайность устройства в звуке законна).
  const kit: Kit = makeKit(ctx, seeded((Math.random() * 2 ** 32) >>> 0), lite, ambOut);
  const t0 = ctx.currentTime + 0.1;
  // Вход из тишины: фон набирается за пару секунд, а не включается.
  ambOut.gain.setValueAtTime(0, t0);
  ambOut.gain.linearRampToValueAtTime(1, t0 + 2.5);
  const amb = new Ambience(kit, ambOut, t0, hearing());
  const music = new EpochMusic(kit, musicOut, t0, lite);

  let lastTap = -1;
  let stopped = false;
  let heard = hearing();
  let heardAt = t0;
  const step = (): void => {
    if (stopped || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Слои переставляются, когда слышимое сдвинулось, а не каждый шаг: иначе на параметрах копились бы сотни целей.
    const h = hearing();
    const moved =
      h.view !== heard.view || h.season !== heard.season || Math.abs(h.near - heard.near) > 0.02 || Math.abs(h.sea - heard.sea) > 0.02;
    if (moved || now - heardAt > 2) {
      amb.set(h, now);
      heard = h;
      heardAt = now;
    }
    amb.tick(now, now + HORIZON);
    music.tick(now, HORIZON);
  };
  const timer = setInterval(step, STEP_MS);
  step();

  // Стройка готова: уровень здания вырос на один. Скачок сразу у нескольких — это загрузка или встреча копий, а не стройка.
  const levels = new Map<number, number>();
  for (const b of useGame.getState().s.buildings) levels.set(b.id, b.level);
  const unwatch = useGame.subscribe((g) => {
    let grew = 0;
    for (const b of g.s.buildings) {
      const was = levels.get(b.id);
      if (was !== undefined && b.level === was + 1) grew++;
      levels.set(b.id, b.level);
    }
    if (grew === 1) cue('built');
  });

  function cue(name: Cue): void {
    if (stopped || ctx.state !== 'running') return;
    const now = ctx.currentTime + 0.01;
    if (name === 'tap') {
      if (now - lastTap < TAP_GAP) return;
      lastTap = now;
    }
    playCue(kit, uiOut, name, now);
  }

  return {
    duck(d) {
      const now = ctx.currentTime;
      musicOut.gain.setTargetAtTime(d.music, now, 0.4);
      ambOut.gain.setTargetAtTime(d.amb, now, 0.4);
    },
    cue,
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      unwatch();
      const now = ctx.currentTime;
      // Гаснет за полсекунды, потом отцепляется: обрыв на полной громкости слышен щелчком.
      for (const g of [musicOut, ambOut, uiOut]) g.gain.setTargetAtTime(0, now, 0.12);
      setTimeout(() => {
        for (const g of [musicOut, ambOut, uiOut]) g.disconnect();
      }, 900);
    },
  };
}
