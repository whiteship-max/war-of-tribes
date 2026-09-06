// Проверки режиссуры. Главное здесь не числа, а границы: визуализация обязана
// быть проигрывателем журнала, а не вторым симулятором, и запрет обязан стоять
// структурно — иначе следующая правка вернёт кубик в картинку, и она разойдётся
// с отчётом.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulateBattle } from './sim';
import { quickSetup } from './setup';
import {
  ACTS,
  CAPTION_HOLD,
  FIGURE_CAP,
  FIGURE_MIN,
  MUSTER_FIGURES,
  SKIP,
  buildCast,
  figureCount,
  frameAt,
  laneOf,
  placedAt,
  sectorSpot,
  shotAtTime,
  type Cast,
  type CameraShot,
} from './replay';
import { SECTORS, UNIT_KINDS, type ArmySetup, type BattleResult, type Sector, type Side, type Stack } from './types';

const SRC = join(__dirname, '..');

const battle = (a: Partial<Stack>, d: Partial<Stack>, seed = 7): BattleResult =>
  simulateBattle({ seed, attacker: quickSetup(a), defender: quickSetup(d) });

/** Ровный бой: обе стороны с пешей линией, событий в журнале много. */
const armyMix = (men: number): Partial<Stack> => ({
  spear: Math.round(men * 0.25),
  infantry: Math.round(men * 0.35),
  archer: Math.round(men * 0.25),
  cavalry: Math.round(men * 0.15),
});

const evenFight = (seed = 7): BattleResult =>
  battle({ spear: 150, infantry: 200, archer: 150, cavalry: 100 }, { spear: 200, infantry: 200, archer: 150, cavalry: 50 }, seed);

const sample = (cast: Cast, step = 1 / 30): number[] => {
  const out: number[] = [];
  for (let t = 0; t <= cast.seconds + 1e-9; t += step) out.push(Math.min(t, cast.seconds));
  out.push(cast.seconds);
  return out;
};

/** Исходники модуля визуализации: сам режиссёр и весь проигрыватель. */
function sources(): { file: string; code: string }[] {
  const out = [{ file: 'battle/replay.ts', code: readFileSync(join(SRC, 'battle/replay.ts'), 'utf8') }];
  out.push({ file: 'game/battle/faces.ts', code: readFileSync(join(SRC, 'game/battle/faces.ts'), 'utf8') });
  const dir = join(SRC, 'render/battle');
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue;
    out.push({ file: `render/battle/${name}`, code: readFileSync(join(dir, name), 'utf8') });
  }
  return out;
}

/** Комментарии выбрасываем: слово в объяснении — не вызов. */
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('визуализация — проигрыватель журнала, а не второй симулятор', () => {
  it('ни один модуль показа не зовёт симуляцию и не бросает кубик', () => {
    for (const { file, code } of sources()) {
      const src = stripComments(code);
      expect(src, `${file}: симуляция боя`).not.toMatch(/simulateBattle|resolveBattle|from '\.\/sim'|battle\/sim/);
      expect(src, `${file}: генератор случайных чисел`).not.toMatch(/Math\.random|seededRng|seededRandom|from '\.\/rng'/);
    }
  });

  it('режиссёр не зависит ни от чего снаружи ядра боя', () => {
    const src = readFileSync(join(SRC, 'battle/replay.ts'), 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const from of imports) {
      expect(from, `посторонний импорт ${from}`).toMatch(/^\.\/(types|log|config)$/);
    }
  });

  it('проигрыватель берёт раскадровку, а не итог боя', () => {
    // frameAt обходится одной раскадровкой: покажи ей журнал с сервера — и она
    // покажет ровно тот же бой, ничего не пересчитывая.
    const cast = buildCast(evenFight(), 'attacker');
    const frame = frameAt(cast, cast.seconds / 2);
    expect(frame.sectors.length).toBeGreaterThan(0);
    expect(frameAt.length).toBe(2);
  });
});

describe('один журнал — один ролик', () => {
  it('та же раскадровка: фаза, сектор, камера, число фигур', () => {
    const result = evenFight();
    const a = buildCast(result, 'attacker');
    const b = buildCast(result, 'attacker');
    expect(b).toEqual(a);

    const keyOf = (t: number) => {
      const f = frameAt(a, t);
      const g = frameAt(b, t);
      return [
        [f.act, f.phase, f.focus?.sector ?? '—', f.shot, f.side.attacker.figures, f.side.defender.figures],
        [g.act, g.phase, g.focus?.sector ?? '—', g.shot, g.side.attacker.figures, g.side.defender.figures],
      ];
    };
    for (const t of sample(a, 0.25)) {
      const [x, y] = keyOf(t);
      expect(y).toEqual(x);
    }
  });

  it('повтор совпадает и после пересборки из того же журнала', () => {
    const result = evenFight(31);
    const once = sample(buildCast(result, 'defender'), 0.5).map((t) => frameAt(buildCast(result, 'defender'), t));
    const twice = sample(buildCast(result, 'defender'), 0.5).map((t) => frameAt(buildCast(result, 'defender'), t));
    expect(twice).toEqual(once);
  });
});

describe('число фигур — чистая функция от числа бойцов', () => {
  it('одно и то же число бойцов даёт одно и то же число фигур', () => {
    for (const men of [0, 1, 7, 20, 55, 200, 500, 5000]) {
      expect(figureCount(men)).toBe(figureCount(men));
    }
  });

  it('корень с потолком: не падает, не превышает потолка, не исчезает у живой армии', () => {
    let prev = 0;
    for (let men = 0; men <= 4000; men += 7) {
      const n = figureCount(men);
      expect(n).toBeGreaterThanOrEqual(prev);
      expect(n).toBeLessThanOrEqual(FIGURE_CAP);
      if (men > 0) expect(n).toBeGreaterThanOrEqual(FIGURE_MIN);
      prev = n;
    }
    expect(figureCount(0)).toBe(0);
    // Двадцать и пятьсот обязаны читаться по-разному, пятьсот и тысяча — уже нет.
    expect(figureCount(500)).toBeGreaterThan(figureCount(20) * 3);
    expect(figureCount(4000)).toBe(figureCount(500));
  });

  it('раскадровка берёт число фигур той же функцией', () => {
    const result = battle({ infantry: 40 }, { infantry: 300 });
    const cast = buildCast(result, 'attacker');
    expect(cast.figures.attacker).toBe(figureCount(cast.men.attacker));
    expect(cast.figures.defender).toBe(figureCount(cast.men.defender));
  });
});

describe('«Пропустить» на каждом кадре', () => {
  it('кнопка есть в любом кадре и ведёт в отчёт', () => {
    for (const result of [evenFight(), battle({ infantry: 900 }, { archer: 40 })]) {
      const cast = buildCast(result, 'attacker');
      for (const t of [-5, ...sample(cast), cast.seconds + 10]) {
        const f = frameAt(cast, t);
        const skip = f.controls.find((c) => c.id === 'skip');
        expect(skip, `нет кнопки на ${t}`).toBeTruthy();
        expect(skip!.goes).toBe('report');
      }
    }
  });

  it('в разметке ролика кнопок не пишется: они приходят кадром', () => {
    const jsx = stripComments(readFileSync(join(SRC, 'ui/battle/BattleReplay.tsx'), 'utf8'));
    expect(jsx).not.toContain(SKIP.label);
    expect(jsx).toMatch(/frame\.controls\.map/);
  });
});

describe('камера: один непрерывный ход', () => {
  const dist = (a: CameraShot, b: CameraShot): number =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) + Math.hypot(a.atX - b.atX, a.atY - b.atY, a.atZ - b.atZ);

  it('склеек нет: между соседними кадрами камера не прыгает', () => {
    const cast = buildCast(evenFight(), 'attacker');
    const step = 1 / 30;
    let prev = shotAtTime(cast, 0);
    let worst = 0;
    for (let t = step; t <= cast.seconds; t += step) {
      const now = shotAtTime(cast, t);
      worst = Math.max(worst, dist(prev, now));
      prev = now;
    }
    // Метр с небольшим за кадр — это уже полёт; склейка дала бы десятки.
    expect(worst).toBeLessThan(1.5);
  });

  it('начали близко, отъехали, закончили близко', () => {
    const cast = buildCast(evenFight(), 'attacker');
    const low = frameAt(cast, 0).shot;
    const top = frameAt(cast, cast.acts[1].to).shot;
    const last = frameAt(cast, cast.seconds).shot;
    // «Отъехали» — это про то, сколько поля попадает в кадр, а не только про
    // высоту камеры: она уходит и вверх, и назад, и угол при этом шире.
    const reach = (c: CameraShot): number => Math.hypot(c.x - c.atX, c.y - c.atY, c.z - c.atZ);
    const view = (c: CameraShot): number => 2 * reach(c) * Math.tan((c.fov * Math.PI) / 360);
    expect(low.y).toBeLessThan(3);
    expect(top.y).toBeGreaterThan(low.y * 2);
    expect(reach(top)).toBeGreaterThan(reach(low) * 2);
    // В стратегический план влезает втрое больше поля, чем в близкий.
    expect(view(top)).toBeGreaterThan(view(low) * 3);
    expect(last.y).toBeLessThan(3);
    // Отъезд непрерывен и однонаправлен: камера всё время идёт вверх и назад.
    let prev = low;
    for (let t = cast.acts[1].from; t <= cast.acts[1].to; t += 0.2) {
      const now = frameAt(cast, t).shot;
      expect(now.y).toBeGreaterThanOrEqual(prev.y - 1e-6);
      prev = now;
    }
  });

  it('на бою камера подаётся к сектору события', () => {
    const cast = buildCast(evenFight(), 'attacker');
    const melee = cast.acts[2];
    const marks = cast.marks.filter((m) => m.act === 'melee' && m.sector);
    expect(marks.length).toBeGreaterThan(0);
    const moved = cast.keys.filter((k) => k.act === 'melee' && k.t > melee.from && k.t < melee.to);
    expect(moved.length).toBeGreaterThan(0);
    // Ключ стоит там, где сектор: смещение камеры по X одного знака с сектором.
    for (const k of moved) {
      const m = marks.reduce((best, m) => (Math.abs(m.t - k.t) < Math.abs(best.t - k.t) ? m : best));
      const spot = sectorSpot(m.side, cast.us, m.sector!, 1);
      if (Math.abs(spot.x) > 0.1) expect(Math.sign(k.shot.atX)).toBe(Math.sign(spot.x));
    }
  });
});

describe('армия не тает на отъезде', () => {
  it('число фигур растёт от горстки до всего войска', () => {
    const cast = buildCast(evenFight(), 'attacker');
    for (const side of ['attacker', 'defender'] as Side[]) {
      const start = placedAt(cast, side, 0);
      expect(start).toBeLessThanOrEqual(MUSTER_FIGURES);
      let prev = -1;
      for (let t = 0; t <= cast.acts[1].to; t += 0.1) {
        const n = placedAt(cast, side, t);
        expect(n).toBeGreaterThanOrEqual(prev);
        prev = n;
      }
      expect(prev).toBe(cast.figures[side]);
      // И на кадре тоже: сумма по секторам — то же число.
      const f = frameAt(cast, cast.acts[1].to);
      expect(f.side[side].figures).toBe(cast.figures[side]);
    }
  });

  it('на близком плане в кадре кусок строя, а не всё войско', () => {
    const cast = buildCast(evenFight(), 'attacker');
    const f = frameAt(cast, 1);
    expect(f.side.attacker.figures).toBeLessThan(cast.figures.attacker);
    expect(f.side.attacker.figures).toBeGreaterThan(0);
    // Кусок — связный: заполнены сектора, ближние к камере, а не по фигуре отовсюду.
    const shown = f.sectors.filter((s) => s.side === 'attacker' && s.figures > 0);
    const ranks = cast.sectors
      .filter((c) => c.side === 'attacker')
      .sort((a, b) => a.rank - b.rank)
      .slice(0, shown.length)
      .map((c) => c.sector);
    expect(shown.map((s) => s.sector).sort()).toEqual(ranks.sort());
  });

  it('павшие ложатся, а не исчезают: к концу боя стоящих меньше поставленных', () => {
    const cast = buildCast(evenFight(), 'attacker');
    const end = frameAt(cast, cast.seconds);
    const loser = end.side.attacker.standing < end.side.defender.standing ? 'attacker' : 'defender';
    expect(end.side[loser].standing).toBeLessThan(end.side[loser].figures);
    for (const s of end.sectors) expect(s.standing).toBeLessThanOrEqual(s.figures);
  });
});

describe('время ролика', () => {
  it('ровный бой укладывается в 40–60 секунд', () => {
    for (const seed of [1, 5, 11, 23, 44]) {
      const cast = buildCast(evenFight(seed), 'attacker');
      expect(cast.seconds).toBeGreaterThanOrEqual(40);
      expect(cast.seconds).toBeLessThanOrEqual(60);
    }
  });

  it('асимметричный бой короче сам собой — растягивать нечего', () => {
    const even = buildCast(evenFight(), 'attacker');
    const rout = buildCast(battle({ infantry: 900, cavalry: 300 }, { archer: 30 }), 'attacker');
    expect(rout.seconds).toBeLessThan(even.seconds);
  });

  it('девять фаз ложатся на четыре такта и покрывают ролик целиком', () => {
    const cast = buildCast(evenFight(), 'attacker');
    expect(cast.acts.map((a) => a.act)).toEqual([...ACTS]);
    expect(cast.acts[0].from).toBe(0);
    for (let i = 1; i < cast.acts.length; i++) expect(cast.acts[i].from).toBe(cast.acts[i - 1].to);
    expect(cast.acts[cast.acts.length - 1].to).toBe(cast.seconds);
    const phases = new Set(cast.spans.map((s) => s.phase));
    expect(phases.size).toBe(9);
    // Время фаз идёт подряд, без дыр.
    const spans = [...cast.spans].sort((a, b) => a.t0 - b.t0);
    for (let i = 1; i < spans.length; i++) expect(spans[i].t0).toBeCloseTo(spans[i - 1].t1, 6);
  });
});

describe('ролик рассказывает то же, что отчёт', () => {
  it('каждое событие журнала попадает на время и на место', () => {
    const result = evenFight();
    const cast = buildCast(result, 'attacker');
    const meaningful = result.log.filter((e) => e.id !== 'phase-start' && e.id !== 'result');
    expect(cast.marks.length).toBe(meaningful.length);
    for (const m of cast.marks) {
      expect(m.t).toBeGreaterThanOrEqual(0);
      expect(m.t).toBeLessThanOrEqual(cast.seconds);
      expect(m.text.length).toBeGreaterThan(0);
      if (m.sector) expect(m.lane).toBe(laneOf(m.sector));
    }
    // Порядок событий в ролике — порядок в журнале.
    const ticks = cast.marks.map((m) => m.tick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
  });

  it('подпись держится ровно столько, сколько обещано', () => {
    const cast = buildCast(evenFight(), 'attacker');
    // Событий на одном тике бывает несколько, и подпись показывает последнее из
    // них: берём такое, у которого рядом нет соседа, иначе проверяем не то.
    const i = cast.marks.findIndex(
      (m, k) =>
        m.act === 'melee' &&
        (k + 1 >= cast.marks.length || cast.marks[k + 1].t > m.t + CAPTION_HOLD + 0.3),
    );
    expect(i).toBeGreaterThanOrEqual(0);
    const m = cast.marks[i];
    expect(frameAt(cast, m.t + 0.1).caption).toBe(m.text);
    expect(frameAt(cast, m.t + CAPTION_HOLD + 0.1).caption).toBeNull();
  });

  it('сектор, побежавший по журналу, помечен бежавшим и в кадре', () => {
    const result = evenFight();
    const cast = buildCast(result, 'attacker');
    const broke = cast.marks.find((m) => m.id === 'sector-broken');
    if (!broke) return;
    expect(frameAt(cast, broke.t - 0.5).sectors.find((s) => s.side === broke.side && s.sector === broke.sector)?.broken)
      .toBe(false);
    expect(frameAt(cast, cast.seconds).sectors.find((s) => s.side === broke.side && s.sector === broke.sector)?.broken)
      .toBe(true);
  });

  it('наши всегда на своей стороне поля, чужие напротив', () => {
    for (const us of ['attacker', 'defender'] as Side[]) {
      const cast = buildCast(evenFight(), us);
      const f = frameAt(cast, cast.seconds / 2);
      for (const s of f.sectors) {
        if (s.side === us) expect(s.z).toBeLessThan(0);
        else expect(s.z).toBeGreaterThan(0);
      }
      // Полоса 0 нашего фронта стоит против полосы 2 чужого — это facing симуляции.
      expect(sectorSpot(us, us, 'A', 1).x).toBeCloseTo(sectorSpot(foe(us), us, 'C', 1).x, 6);
    }
  });
});

const foe = (s: Side): Side => (s === 'attacker' ? 'defender' : 'attacker');

describe('кадр не врёт о численности', () => {
  it('в начале живы все, в конце — столько же, сколько в итоге боя', () => {
    const result = evenFight();
    const cast = buildCast(result, 'attacker');
    const first = frameAt(cast, 0);
    const last = frameAt(cast, cast.seconds);
    for (const side of ['attacker', 'defender'] as Side[]) {
      expect(first.side[side].men).toBe(result.sides[side].total.initial);
      expect(last.side[side].men).toBeCloseTo(result.sides[side].total.final, -0.6);
    }
  });

  it('полупустая расстановка ролик не ломает', () => {
    // Одни лучники: фронт пуст, заняты только тыловые сектора, а фигур меньше,
    // чем секторов у противника. Ни то, ни другое не должно ронять раскадровку.
    const thin: ArmySetup = quickSetup({ archer: 3 });
    const result = simulateBattle({ seed: 3, attacker: quickSetup({ infantry: 400 }), defender: thin });
    const cast = buildCast(result, 'attacker');
    expect(cast.figures.defender).toBe(figureCount(3));
    const placed = cast.sectors.filter((c) => c.side === 'defender').reduce((n, c) => n + c.figures, 0);
    expect(placed).toBe(cast.figures.defender);
    for (const t of sample(cast, 1)) expect(() => frameAt(cast, t)).not.toThrow();
  });

  it('сумма фигур по секторам равна числу фигур стороны', () => {
    for (const men of [12, 40, 200, 900]) {
      const cast = buildCast(battle(armyMix(men), armyMix(men)), 'attacker');
      for (const side of ['attacker', 'defender'] as Side[]) {
        const placed = cast.sectors.filter((c) => c.side === side).reduce((n, c) => n + c.figures, 0);
        expect(placed, `${men} бойцов`).toBe(cast.figures[side]);
        // И по видам внутри сектора сумма тоже сходится.
        for (const c of cast.sectors.filter((x) => x.side === side)) {
          expect(c.byFace.reduce((n, f) => n + f.figures, 0)).toBe(c.figures);
        }
      }
    }
  });
});

describe('потери по секторам: журнал знает, где всё сломалось', () => {
  it('сумма по секторам сходится с потерями фазы', () => {
    for (const seed of [3, 7, 19]) {
      const r = evenFight(seed);
      for (const p of r.phases) {
        expect(p.bySector, `${p.phase}: нет разбивки`).toBeDefined();
        for (const side of ['attacker', 'defender'] as Side[]) {
          const sum = Object.values(p.bySector![side]).reduce((n, v) => n + (v ?? 0), 0);
          expect(sum, `${p.phase}/${side}`).toBeCloseTo(p.losses[side], 0);
        }
      }
    }
  });

  it('потери сектора за бой сходятся с его итогом', () => {
    const r = evenFight();
    for (const side of ['attacker', 'defender'] as Side[]) {
      for (const sector of SECTORS) {
        const cell = r.sides[side].sectors[sector];
        const start = UNIT_KINDS.reduce((n, k) => n + cell.initial[k], 0);
        const end = UNIT_KINDS.reduce((n, k) => n + cell.final[k], 0);
        if (start <= 0) continue;
        const lost = r.phases.reduce((n, p) => n + (p.bySector?.[side]?.[sector] ?? 0), 0);
        expect(lost, `${side}/${sector}`).toBeCloseTo(start - end, 0);
      }
    }
  });

  it('разбивка детерминирована: тот же вход — те же числа', () => {
    const a = evenFight(11);
    const b = evenFight(11);
    expect(b.phases).toEqual(a.phases);
  });

  it('сектор тает по своим потерям, а не вместе со всей армией', () => {
    const r = evenFight();
    const cast = buildCast(r, 'attacker');
    expect(cast.detailed).toBe(true);
    // Ищем сектор, который просел резко: он обязан просесть в кадре тогда же,
    // когда по журналу, а не размазаться по всему ролику.
    let worst: { side: Side; sector: Sector; span: (typeof cast.spans)[number]; lost: number } | null = null;
    for (const span of cast.spans) {
      for (const side of ['attacker', 'defender'] as Side[]) {
        for (const [sector, lost] of Object.entries(span.bySector?.[side] ?? {})) {
          if (!worst || (lost ?? 0) > worst.lost) worst = { side, sector: sector as Sector, span, lost: lost ?? 0 };
        }
      }
    }
    expect(worst).toBeTruthy();
    const { side, sector, span } = worst!;
    const men = (t: number): number =>
      frameAt(cast, t).sectors.find((s) => s.side === side && s.sector === sector)!.figures;
    const alive = (t: number): number => {
      const f = frameAt(cast, t).sectors.find((s) => s.side === side && s.sector === sector)!;
      return f.figures > 0 ? f.standing / f.figures : 1;
    };
    // За эту фазу доля живых падает; и падает она сильнее, чем в среднем по ролику.
    const drop = alive(span.t0) - alive(span.t1);
    const whole = alive(0) - alive(cast.seconds);
    expect(men(span.t1)).toBeGreaterThan(0);
    expect(drop).toBeGreaterThan(0);
    expect(drop / Math.max(1e-6, whole)).toBeGreaterThan((span.t1 - span.t0) / cast.seconds);
  });

  it('старая запись боя без разбивки открывается и показывается', () => {
    const r = evenFight();
    // Ровно то, что лежит в сохранении, сделанном до появления поля.
    const legacy: BattleResult = { ...r, phases: r.phases.map(({ bySector, ...rest }) => rest) };
    const cast = buildCast(legacy, 'attacker');
    expect(cast.detailed).toBe(false);
    for (const t of sample(cast, 1)) expect(() => frameAt(cast, t)).not.toThrow();
    const end = frameAt(cast, cast.seconds);
    // Числа не потерялись: к концу живо столько же, сколько в итоге боя.
    for (const side of ['attacker', 'defender'] as Side[]) {
      expect(end.side[side].men).toBeCloseTo(r.sides[side].total.final, -0.6);
    }
  });
});
