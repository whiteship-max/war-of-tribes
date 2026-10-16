// Проверки режиссуры. Главное здесь не числа, а границы: визуализация обязана
// быть проигрывателем журнала, а не вторым симулятором, и запрет обязан стоять
// структурно — иначе следующая правка вернёт кубик в картинку, и она разойдётся
// с отчётом.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulateBattle } from './sim';
import { FRONT_WIDTH } from './config';
import { deploySetup } from './setup';
import {
  ACTS,
  ACT_PHASES,
  contestOf,
  CAPTION_HOLD,
  FIELD,
  FIGURE_CAP,
  FIGURE_MIN,
  MAX_RANKS,
  MUSTER_FIGURES,
  SKIP,
  SHAFT_PX,
  MAN_HEIGHT,
  manPixels,
  shaftShare,
  CHARGE_SECONDS,
  CLASH_HOLD,
  FLEE_DIST,
  FLEE_SECONDS,
  IMPACT_SECONDS,
  VOLLEY_SHOTS,
  bannersFor,
  blockDepth,
  buildCast,
  crowdAt,
  dustRadius,
  ranksFor,
  shaftsFor,
  figureCount,
  frameAt,
  laneOf,
  placedAt,
  sectorSpot,
  shotAtTime,
  type Cast,
  type CameraShot,
} from './replay';
import { SECTORS, UNIT_KINDS, type ArmySetup, type BattleResult, type PhaseSpan, type Sector, type Side, type Stack } from './types';
import { summarize } from './report';
import { describeEvent } from './log';
import { MAN_HEIGHT as FIGURE_MAN_HEIGHT } from '../render/units';

const SRC = join(__dirname, '..');

const battle = (a: Partial<Stack>, d: Partial<Stack>, seed = 7): BattleResult =>
  simulateBattle({ seed, attacker: deploySetup(a), defender: deploySetup(d) });

/** Ровный бой: обе стороны с пешей линией, событий в журнале много. */
const armyMix = (men: number): Partial<Stack> => ({
  spear: Math.round(men * 0.25),
  infantry: Math.round(men * 0.35),
  archer: Math.round(men * 0.25),
  cavalry: Math.round(men * 0.15),
});

const evenFight = (seed = 7): BattleResult =>
  battle({ spear: 150, infantry: 200, archer: 150, cavalry: 100 }, { spear: 200, infantry: 200, archer: 150, cavalry: 50 }, seed);

/**
 * Запись боя в том виде, в каком её писало ядро до поставки 1 (14.5): каждый бой линий делится на четыре фазы —
 * линии, обходы, ввод резерва, падение морали, — и в журнал ложатся события, которых новое ядро не пишет: ввод резерва
 * в фазе резерва, перехват обхода, сдвиг пехоты, дистанция лучников. Числа исхода и потерь те же.
 */
function asOld(r: BattleResult): BattleResult {
  const phases: BattleResult['phases'] = [];
  const relabel = new Map<number, PhaseSpan['phase']>();
  const extra: BattleResult['log'] = [];
  for (const span of r.phases) {
    const len = span.to - span.from + 1;
    // Новый натиск (`clash`) — прежние сшибка, бой линий, обходы, ввод резерва и падение морали: запись до поставки 1
    // несла их фазами (14.35: сшибка и сеча — один натиск).
    if (span.phase !== 'clash' || len < 5) {
      phases.push(span);
      continue;
    }
    const cut = [0, Math.floor(len / 5), Math.floor(len / 2), Math.floor((3 * len) / 4), len - 1, len];
    (['clash', 'lines', 'flanking', 'reserve', 'morale'] as const).forEach((phase, i) => {
      const from = span.from + cut[i];
      const to = span.from + cut[i + 1] - 1;
      if (to < from) return;
      const share = (to - from + 1) / len;
      const part = (x: number): number => Math.round(x * share * 10) / 10;
      phases.push({ ...span, phase, from, to, losses: { attacker: part(span.losses.attacker), defender: part(span.losses.defender) }, bySector: undefined });
      for (let t = from; t <= to; t += 1) relabel.set(t, phase);
      if (phase === 'flanking' && extra.length === 0) {
        extra.push({ id: 'cavalry-intercepted', side: 'attacker', target: 'D', tick: from, phase });
        extra.push({ id: 'infantry-shifted', side: 'defender', to: 'A', men: 10, tick: from, phase });
        extra.push({ id: 'archers-kiting', side: 'attacker', sector: 'E', tick: from, phase });
      }
      if (phase === 'reserve') extra.push({ id: 'reserve-committed', side: 'defender', sector: 'B', men: 5, tick: from, phase });
    });
  }
  const log = [...r.log.map((e) => (e.phase === 'clash' && relabel.has(e.tick) ? { ...e, phase: relabel.get(e.tick)! } : e)), ...extra].sort((a, b) => a.tick - b.tick);
  // Итог — последним, как у ядра.
  const result = log.filter((e) => e.id === 'result');
  return { ...r, phases, log: [...log.filter((e) => e.id !== 'result'), ...result] };
}

const sample = (cast: Cast, step = 1 / 30): number[] => {
  const out: number[] = [];
  for (let t = 0; t <= cast.seconds + 1e-9; t += step) out.push(Math.min(t, cast.seconds));
  out.push(cast.seconds);
  return out;
};

/** Исходники модуля визуализации: сам режиссёр и общий модуль ролика (`render/reel`, docs/gfx.md) целиком. */
function sources(): { file: string; code: string }[] {
  const out = [{ file: 'battle/replay.ts', code: readFileSync(join(SRC, 'battle/replay.ts'), 'utf8') }];
  out.push({ file: 'game/battle/faces.ts', code: readFileSync(join(SRC, 'game/battle/faces.ts'), 'utf8') });
  out.push({ file: 'game/battle/ground.ts', code: readFileSync(join(SRC, 'game/battle/ground.ts'), 'utf8') });
  const dir = join(SRC, 'render/reel');
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue;
    if (name.endsWith('.test.ts')) continue;
    out.push({ file: `render/reel/${name}`, code: readFileSync(join(dir, name), 'utf8') });
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

  it('показ не читает мир: земля и свет приезжают раскадровкой', () => {
    // Место боя записано в самой записи боя и переведено в `Cast.ground` чистой
    // функцией. Стоит показу дочитать карту — и раскадровка перестанет быть
    // самодостаточной ровно тогда, когда журнал приедет с сервера.
    for (const { file, code } of sources()) {
      const src = stripComments(code);
      expect(src, `${file}: показ полез в мир`).not.toMatch(/from '@\/world|worldApi|LocalWorld|terrainAt|featuresAt|placeAt/);
    }
  });

  it('земля и час лежат в раскадровке, а не добираются на показе', () => {
    const cast = buildCast(evenFight(), 'attacker');
    expect(cast.ground).toBeDefined();
    expect(cast.ground.solar).toBeGreaterThanOrEqual(0);
    expect(cast.ground.seed).toBe(cast.seed);
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

  it('в разметке ролика кнопок не пишется: они приходят данными', () => {
    // Ролик один — TW (прежний удалён, docs/ui_audit.md, 16): его кнопки — список данных. «Пропустить» — та же подпись
    // раскадровки (`SKIP.label`), ведёт к следующему такту смысла; «Итог» — к карточке итога (ГФ-1, docs/gfx.md).
    const jsx = stripComments(readFileSync(join(SRC, 'ui/battle/TwReplay.tsx'), 'utf8'));
    expect(jsx).not.toContain(SKIP.label);
    expect(jsx).toMatch(/const NEXT = \{ id: 'next', label: SKIP\.label \} as const;/);
    expect(jsx).toMatch(/const TW_CONTROLS = \[NEXT, RESULT\] as const;/);
    expect(jsx).toMatch(/TW_CONTROLS\.map/);
  });

  it('других кнопок в кадре нет: звук уехал в настройки', () => {
    // Переключатель звука стоял здесь же и был единственной дверью к музыке.
    // Теперь она в профиле, и рычаг на неё один — см. sound/music.test.ts.
    for (const t of [0, 3, 12]) {
      const f = frameAt(buildCast(evenFight(), 'attacker'), t);
      expect(f.controls.map((c) => c.id)).toEqual(['skip']);
    }
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
  it('ровный бой укладывается в 55–70 секунд', () => {
    for (const seed of [1, 5, 11, 23, 44]) {
      const cast = buildCast(evenFight(seed), 'attacker');
      expect(cast.seconds).toBeGreaterThanOrEqual(55);
      expect(cast.seconds).toBeLessThanOrEqual(70);
    }
  });

  // Прежняя проверка требовала только «короче ровного», и этого оказалось мало:
  // разгром шёл 49.6 против 56 у ровного боя. Шесть секунд — не разница,
  // а погрешность, и «короткие бои остаются короткими» держалось на слове.
  // Поэтому порог теперь абсолютный, и разрыв тоже.
  it('разгром вдвое короче, и разница читается, а не измеряется', () => {
    const even = buildCast(evenFight(), 'attacker');
    for (const rout of [
      battle({ infantry: 900, cavalry: 300 }, { archer: 30 }),
      battle({ infantry: 500 }, { infantry: 20 }),
      battle({ spear: 300, infantry: 300 }, { infantry: 60 }),
    ]) {
      const cast = buildCast(rout, 'attacker');
      expect(cast.seconds).toBeLessThanOrEqual(35);
      expect(even.seconds - cast.seconds).toBeGreaterThanOrEqual(20);
    }
  });

  it('длину задаёт спорность боя, а не число строк в журнале', () => {
    // Был красным с поставки 1 до минимума боя EU4 (14.21): разгром кончался в первом круге, и строк в журнале у него
    // было 5 против 18–24 у ровного боя. С минимумом разгром идёт до конца сшибки второго круга, как всякий бой.
    // Ровный бой — в размере от W (числа `evenFight` — при W 128): на W 94 те же 600 на 600 — это 6.4 W, резерв входит
    // волнами, и строки ввода резерва (12 из 30) делали журнал ровного боя втрое длиннее разгрома — вход вне области
    // (полная приёмка осады, docs/siege_v2.md, 19.4).
    const k = FRONT_WIDTH / 128;
    const sized = (s: Partial<Stack>): Partial<Stack> =>
      Object.fromEntries(Object.entries(s).map(([u, n]) => [u, Math.round((n ?? 0) * k)])) as Partial<Stack>;
    const even = battle(sized({ spear: 150, infantry: 200, archer: 150, cavalry: 100 }), sized({ spear: 200, infantry: 200, archer: 150, cavalry: 50 }), 7);
    const rout = battle({ infantry: 500 }, { infantry: 20 });
    // У разгрома строк в журнале почти столько же — мерой они быть не могут.
    const marks = (r: BattleResult): number =>
      r.log.filter((e) => e.id !== 'phase-start' && ACT_PHASES.melee.includes(e.phase)).length;
    expect(marks(rout)).toBeGreaterThan(marks(even) / 3);
    // А спорность разделяет их на порядок.
    expect(contestOf(even)).toBeGreaterThan(0.6);
    expect(contestOf(rout)).toBeLessThan(0.1);
  });

  it('пять фаз новой записи и девять старой ложатся на четыре такта и покрывают ролик целиком', () => {
    // Круг — огонь и натиск, как у EU4 (14.35): новая запись несёт пять фаз — стрельба, сближение, натиск, отступление и
    // погоня; записанная раньше — девять, и ролик обязан открывать обе.
    const fresh = evenFight();
    for (const [record, n] of [[fresh, 5], [asOld(fresh), 9]] as const) {
      const cast = buildCast(record, 'attacker');
      expect(cast.acts.map((a) => a.act)).toEqual([...ACTS]);
      expect(cast.acts[0].from).toBe(0);
      for (let i = 1; i < cast.acts.length; i++) expect(cast.acts[i].from).toBe(cast.acts[i - 1].to);
      expect(cast.acts[cast.acts.length - 1].to).toBe(cast.seconds);
      const phases = new Set(cast.spans.map((s) => s.phase));
      expect(phases.size, `фаз в записи`).toBe(n);
      // Время фаз идёт подряд, без дыр.
      const spans = [...cast.spans].sort((a, b) => a.t0 - b.t0);
      for (let i = 1; i < spans.length; i++) expect(spans[i].t0).toBeCloseTo(spans[i - 1].t1, 6);
    }
  });

  it('запись боя до поставки 1 открывается отчётом и роликом: фазы обходов, резерва и морали, перехват, приказы, пресет', () => {
    // Новый тест 6 поставки 1 (14.5): уходит то, что ядро пишет, а не тип чтения. Запись, посчитанная раньше, лежит
    // в сохранении мира — с девятью фазами, событиями ввода резерва, перехвата обхода, сдвига пехоты и дистанции
    // лучников и с именем пресета в записи. Отчёт и ролик обязаны открыть её целиком, не упав ни на одном кадре.
    const old = asOld(evenFight());
    // Граница: в записи правда есть всё, чего новое ядро не пишет.
    for (const phase of ['flanking', 'reserve', 'morale'] as const) expect(old.phases.some((p) => p.phase === phase), phase).toBe(true);
    for (const id of ['cavalry-intercepted', 'infantry-shifted', 'archers-kiting', 'reserve-committed'] as const) expect(old.log.some((e) => e.id === id), id).toBe(true);
    const record = JSON.parse(JSON.stringify({ us: 'attacker', preset: 'standard', result: old })) as { us: Side; preset: string; result: BattleResult };
    expect(record.preset).toBe('standard');
    const summary = summarize(record.result, record.us);
    expect(summary.keys.length).toBeGreaterThan(0);
    for (const e of record.result.log) expect(describeEvent(e).length, e.id).toBeGreaterThan(0);
    const cast = buildCast(record.result, record.us);
    for (const t of sample(cast, 0.5)) expect(() => frameAt(cast, t)).not.toThrow();
    expect(cast.marks.some((m) => m.id === 'cavalry-intercepted'), 'перехват — меткой ролика').toBe(true);
  });
});

describe('ролик рассказывает то же, что отчёт', () => {
  it('каждое событие журнала попадает на время и на место', () => {
    const result = evenFight();
    const cast = buildCast(result, 'attacker');
    // Служебные — начало фазы, итог, кость, глубина ряда и круги: у кости нет ни места, ни выбитых, камере к ней нечего
    // подаваться; глубина — состояние ряда, а круг и потолок — ход боя, а не миг на поле. Список тот же, что у ролика.
    const SERVICE = ['phase-start', 'result', 'dice', 'depth', 'round', 'rounds-out'];
    const meaningful = result.log.filter((e) => !SERVICE.includes(e.id));
    expect(result.log.some((e) => e.id === 'dice'), 'точка внутри области: кость в журнале есть — и в метки она не попала').toBe(true);
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

  it('событие круга сечи ложится на время своего круга, а не первой сечи', () => {
    // Бой идёт кругами, и фаза встречается в журнале не один раз: метка ищет ту, в чьи тики попало.
    // Бой с кругами — копья с лучниками против пехоты с конницей (граница утверждена ниже). Размер — 900 на сторону:
    // с поставки 1 (мораль EU4, автоматический резерв) те же составы по 600 ломаются в первом проходе.
    const r = simulateBattle({ seed: 1, attacker: deploySetup({ spear: 450, archer: 450 }), defender: deploySetup({ infantry: 600, cavalry: 300 }) });
    const cast = buildCast(r, 'attacker');
    const inRound = cast.marks.filter((m) => r.phases.some((p) => p.round && p.phase === m.phase && m.tick >= p.from && m.tick <= p.to));
    // Граница: круги в бою есть, и в них есть события, ставшие метками, — иначе правило проверялось бы даром.
    expect(r.phases.some((p) => p.round), 'в бою есть круги сечи').toBe(true);
    expect(inRound.length, 'метки в кругах').toBeGreaterThan(0);
    for (const m of cast.marks) {
      const span = cast.spans.find((s) => s.phase === m.phase && m.tick >= s.from && m.tick <= s.to)!;
      expect(m.t, `${m.id} на ${m.tick}-м тике`).toBeGreaterThanOrEqual(span.t0 - 1e-9);
      expect(m.t, `${m.id} на ${m.tick}-м тике`).toBeLessThanOrEqual(span.t1 + 1e-9);
    }
  });

  it('круг идёт сечей: его сближение и сшибка — в такте сечи и по тикам, а не в близком плане и отъезде', () => {
    // Круг — обстрел, сшибка и сеча снова (`CIRCLE_PHASES`), и имена его фаз те же, что у первого круга. Такт по
    // имени фазы положил бы сближение круга в отъезд камеры, а его потери и события — раньше, чем линии сошлись.
    // Размер — 900 на сторону: те же составы по 600 с поставки 1 ломаются в первом проходе, и кругов нет.
    const r = simulateBattle({ seed: 1, attacker: deploySetup({ spear: 450, archer: 450 }), defender: deploySetup({ infantry: 600, cavalry: 300 }) });
    const cast = buildCast(r, 'attacker');
    const inRounds = r.phases.filter((p) => p.round !== undefined);
    // Граница: в бою есть круги, и в них есть сближение и сшибка — фазы, чьё имя живёт и в других тактах.
    expect(inRounds.some((p) => p.phase === 'approach'), 'сближение в круге').toBe(true);
    expect(inRounds.some((p) => p.phase === 'clash'), 'сшибка в круге').toBe(true);
    for (const p of inRounds) {
      const span = cast.spans.find((s) => s.from === p.from && s.to === p.to);
      expect(span, `${p.phase}, круг ${p.round}`).toBeDefined();
      expect(span!.act, `${p.phase}, круг ${p.round}`).toBe('melee');
    }
    // Время ролика идёт в том же порядке, что тики боя.
    const byTime = [...cast.spans].sort((a, b) => a.t0 - b.t0 || a.from - b.from).map((s) => s.from);
    expect(byTime).toEqual([...byTime].sort((a, b) => a - b));
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
      // Ровно, а не около: концы у ролика — из итога боя, журнал задаёт только темп. Потери фаз в журнале к итогу
      // не складываются (десятые и отброшенные малые), и кадр, идущий по ним одним, расходился с отчётом на единицы.
      expect(last.side[side].men).toBe(result.sides[side].total.final);
    }
  });

  it('полупустая расстановка ролик не ломает', () => {
    // Одни лучники: фронт пуст, заняты только тыловые сектора, а фигур меньше,
    // чем секторов у противника. Ни то, ни другое не должно ронять раскадровку.
    const thin: ArmySetup = deploySetup({ archer: 3 });
    const result = simulateBattle({ seed: 3, attacker: deploySetup({ infantry: 400 }), defender: thin });
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
        // Допуск — округление, и ничего сверх: итог сектора наружу целый (до ±0.5), а потеря фазы
        // режется до десятых и ниже 0.05 не пишется (`lossBySector`, до ±0.05 на фазу).
        expect(Math.abs(lost - (start - end)), `${side}/${sector}`).toBeLessThanOrEqual(0.5 + 0.05 * r.phases.length);
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

describe('строй: где чей фронт, видно по кадру', () => {
  it('блок не перешагивает линию соприкосновения', () => {
    // Передняя шеренга стоит на месте сектора, ряды уходят назад. Если
    // центрировать блок, глубокий строй лезет за середину поля, и синие с
    // красными перемешиваются — по кадру не понять, где чей фронт.
    const deep = blockDepth(MAX_RANKS);
    expect(FIELD.contactZ).toBeGreaterThan(0);
    // Наш самый глубокий фронт кончается на −contactZ и уходит от середины назад.
    expect(-FIELD.contactZ - deep).toBeLessThan(-FIELD.contactZ);
    // Между передними шеренгами остаётся зазор, и он шире человека.
    expect(FIELD.contactZ * 2).toBeGreaterThan(1.2);
  });

  it('глубокий блок не садится на тыловой сектор своей полосы', () => {
    expect(blockDepth(MAX_RANKS)).toBeLessThan(FIELD.rowGap);
    expect(blockDepth(MAX_RANKS) + FIELD.rowGap).toBeLessThan(FIELD.rowGap + FIELD.reserveGap);
  });

  it('ряды растут с числом бойцов и упираются в потолок', () => {
    let prev = 0;
    for (const men of [10, 30, 60, 120, 240, 480, 960, 4000]) {
      const n = ranksFor(men, FIGURE_CAP);
      expect(n).toBeGreaterThanOrEqual(prev);
      expect(n).toBeLessThanOrEqual(MAX_RANKS);
      prev = n;
    }
    expect(ranksFor(30, FIGURE_CAP)).toBe(1);
    expect(ranksFor(1000, FIGURE_CAP)).toBe(MAX_RANKS);
    // Глубже, чем позволяет число фигур, строй не ставим.
    expect(ranksFor(1000, 3)).toBeLessThan(MAX_RANKS);
  });

  it('в каждом кадре наши и чужие стоят по разные стороны середины', () => {
    const cast = buildCast(evenFight(), 'attacker');
    for (const t of sample(cast, 0.5)) {
      for (const s of frameAt(cast, t).sectors) {
        const back = s.side === cast.us ? -1 : 1;
        const far = s.z + back * blockDepth(s.ranks);
        expect(Math.sign(s.z) || back).toBe(back);
        expect(Math.sign(far)).toBe(back);
      }
    }
  });
});

describe('масса: число видно без цифр', () => {
  it('знамя на каждые полсотни бойцов, и их можно сосчитать', () => {
    expect(bannersFor(0)).toBe(0);
    expect(bannersFor(50)).toBe(1);
    expect(bannersFor(150)).toBe(3);
    expect(bannersFor(500)).toBe(10);
    // Не падает с ростом армии и не исчезает у живой.
    let prev = 0;
    for (let men = 0; men <= 3000; men += 13) {
      const n = bannersFor(men);
      expect(n).toBeGreaterThanOrEqual(prev - 1);
      if (men > 0) expect(n).toBeGreaterThanOrEqual(1);
      prev = n;
    }
  });

  it('знамёна стороны сходятся с её численностью', () => {
    for (const men of [40, 200, 900]) {
      const cast = buildCast(battle(armyMix(men), armyMix(men)), 'attacker');
      for (const side of ['attacker', 'defender'] as Side[]) {
        const sum = cast.sectors.filter((c) => c.side === side).reduce((n, c) => n + c.banners, 0);
        expect(sum, `${men} бойцов`).toBe(bannersFor(cast.men[side]));
      }
    }
  });

  it('вдесятеро большая армия несёт вдесятеро больше знамён, а фигур — втрое', () => {
    const small = buildCast(battle(armyMix(50), armyMix(50)), 'attacker');
    const big = buildCast(battle(armyMix(500), armyMix(500)), 'attacker');
    const flags = (c: typeof small): number => bannersFor(c.men.attacker);
    expect(flags(big) / flags(small)).toBeGreaterThan(8);
    // Фигуры при этом упираются в потолок — ради этого масса и заведена.
    expect(big.figures.attacker / small.figures.attacker).toBeLessThan(4);
  });

  it('древков больше, чем фигур там, где есть кому их держать', () => {
    const cast = buildCast(evenFight(), 'attacker');
    for (const c of cast.sectors) {
      // Конница леса не носит вовсе, поэтому считаем по пешим местам. Одна фигура — лес округляется до одного
      // древка (лучник носит 1.4), и «больше» начинается с двух: правило развёртывания кладёт на края
      // второй линии остатки в несколько лучников.
      const foot = c.byFace.reduce((n, f) => n + (f.kind === 'cavalry' ? 0 : f.figures), 0);
      if (foot < 2) continue;
      expect(c.shafts, `${c.side}/${c.sector}`).toBeGreaterThan(foot);
    }
    const spears = shaftsFor([{ id: 'spearman', kind: 'spear', figures: 10 }]);
    const bows = shaftsFor([{ id: 'archer', kind: 'archer', figures: 10 }]);
    expect(spears).toBeGreaterThan(bows * 2);
  });

  it('у конницы леса нет: ноль, а не малое число', () => {
    // Всадник виден целиком — конь под ним крупнее любой пехоты, — и древко
    // рядом с ним читается палкой, которую никто не держит.
    expect(shaftsFor([{ id: 'rider', kind: 'cavalry', figures: 20 }])).toBe(0);
    const mixed = shaftsFor([
      { id: 'rider', kind: 'cavalry', figures: 20 },
      { id: 'spearman', kind: 'spear', figures: 10 },
    ]);
    expect(mixed).toBe(shaftsFor([{ id: 'spearman', kind: 'spear', figures: 10 }]));
  });

  it('пятно массы растёт с числом бойцов, а не фигур', () => {
    expect(dustRadius(0)).toBe(0);
    expect(dustRadius(500)).toBeGreaterThan(dustRadius(20) * 4);
    // Площадь пропорциональна числу: вдесятеро больше людей — вдесятеро площадь.
    const area = (men: number): number => Math.PI * dustRadius(men) ** 2;
    expect(area(1000) / area(100)).toBeCloseTo(10, 1);
    // И на целой раскадровке: сумма площадей сторон относится как их численность.
    const cast = buildCast(battle(armyMix(120), armyMix(480)), 'attacker');
    const sum = (side: Side): number =>
      cast.sectors.filter((c) => c.side === side).reduce((n, c) => n + Math.PI * c.dust ** 2, 0);
    expect(sum('defender') / sum('attacker')).toBeCloseTo(cast.men.defender / cast.men.attacker, 1);
  });

  it('масса проявляется вместе с фигурами и не падает на отъезде', () => {
    const cast = buildCast(battle(armyMix(600), armyMix(600)), 'attacker');
    for (const side of ['attacker', 'defender'] as Side[]) {
      let prevFlags = -1;
      let prevShafts = -1;
      for (let t = 0; t <= cast.acts[1].to; t += 0.2) {
        const f = frameAt(cast, t);
        const flags = f.side[side].banners;
        const shafts = f.sectors.filter((s) => s.side === side).reduce((n, s) => n + s.shafts, 0);
        expect(flags).toBeGreaterThanOrEqual(prevFlags);
        expect(shafts).toBeGreaterThanOrEqual(prevShafts - 1);
        prevFlags = flags;
        prevShafts = shafts;
      }
      // К концу отъезда войско несёт все свои знамёна.
      expect(frameAt(cast, cast.acts[1].to).side[side].banners).toBe(bannersFor(cast.men[side]));
    }
  });

  it('двадцать против пятисот: масса показывает разницу там, где фигуры уже не могут', () => {
    const cast = buildCast(battle(armyMix(8), armyMix(220)), 'attacker');
    const f = frameAt(cast, cast.acts[2].from);
    const dust = (side: Side): number =>
      f.sectors.filter((s) => s.side === side).reduce((n, s) => n + Math.PI * s.dust ** 2, 0);
    const men = cast.men.defender / cast.men.attacker;
    expect(men).toBeGreaterThan(8);
    // Фигуры разницу сжимают — на то и потолок.
    const byFigures = f.side.defender.figures / f.side.attacker.figures;
    expect(byFigures).toBeLessThan(men / 3);
    // Знамёна её показывают: горстка несёт одно, войско — несколько, и это
    // считается глазами. Пятно массы держит разницу ещё честнее.
    expect(f.side.attacker.banners).toBe(1);
    expect(f.side.defender.banners).toBeGreaterThanOrEqual(4);
    expect(dust('defender') / dust('attacker')).toBeGreaterThan(byFigures * 2);
  });
});

describe('действие: всё из журнала, ничего от себя', () => {
  it('залп летит в стрелковой фазе — тогда, когда по журналу стреляли', () => {
    const cast = buildCast(evenFight(), 'attacker');
    const shots = cast.marks.filter((m) => m.id === 'volley');
    expect(shots.length).toBeGreaterThan(0);
    const ranged = cast.spans.find((s) => s.phase === 'ranged')!;
    const clash = cast.spans.find((s) => s.phase === 'clash')!;

    // Событие `volley` подводит итог всей стрелковой фазы и стоит на тике
    // столкновения; стреляли в стрелковой фазе, туда залпы и легли.
    const mid = frameAt(cast, ranged.t0 + (ranged.t1 - ranged.t0) * 0.4).volleys;
    expect(mid.length).toBeGreaterThan(0);
    for (const v of mid) {
      expect(v.u).toBeGreaterThan(0);
      expect(v.u).toBeLessThan(1);
      // Летит от своих к чужим: концы дуги по разные стороны середины поля.
      expect(Math.sign(v.fromZ)).not.toBe(Math.sign(v.toZ));
      expect(v.men).toBeGreaterThan(0);
    }
    // Ни одной стрелы в небе, когда линии уже сошлись.
    expect(frameAt(cast, clash.t0).volleys).toEqual([]);
    expect(frameAt(cast, cast.seconds).volleys).toEqual([]);

    // Сколько выбито по журналу, столько и летит: залп не выдумывает своей густоты.
    for (const m of shots) {
      let sum = 0;
      for (let t = ranged.t0; t <= clash.t0; t += 0.05) {
        for (const v of frameAt(cast, t).volleys) {
          if (v.side === m.side && v.u < 0.05) sum += v.men;
        }
      }
      expect(sum).toBeGreaterThan(0);
    }
    const one = frameAt(cast, ranged.t0 + 0.02).volleys.find((v) => v.side === shots[0].side)!;
    expect(one.men * VOLLEY_SHOTS).toBeCloseTo(shots[0].amount, 5);
  });

  it('копья опускаются разом и до удара, а не после', () => {
    const cast = buildCast(evenFight(), 'attacker');
    const clash = cast.spans.find((s) => s.phase === 'clash')!;
    const approach = cast.spans.find((s) => s.phase === 'approach')!;
    expect(frameAt(cast, approach.t0).couch).toBe(0);
    expect(frameAt(cast, clash.t0).couch).toBe(1);
    // Опускаются непрерывно: рывка между кадрами нет.
    let prev = 0;
    for (let t = approach.t0; t <= clash.t0; t += 0.05) {
      const now = frameAt(cast, t).couch;
      expect(now).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(now - prev).toBeLessThan(0.15);
      prev = now;
    }
  });

  it('на первом столкновении ход почти замирает, потом идёт как шёл', () => {
    const cast = buildCast(evenFight(), 'attacker');
    const clash = cast.spans.find((s) => s.phase === 'clash')!;
    const pace = (t: number, dt = 0.1): number =>
      (frameAt(cast, t + dt).poseTime - frameAt(cast, t).poseTime) / dt;
    expect(pace(clash.t0 - 0.5)).toBeCloseTo(1, 1);
    expect(pace(clash.t0 + 0.3)).toBeLessThan(0.3);
    expect(pace(clash.t0 + CLASH_HOLD.seconds + 0.5)).toBeCloseTo(1, 1);
    // Время поз не идёт назад — иначе бойцы дёрнулись бы в обратную сторону.
    let prev = -1;
    for (let t = 0; t <= cast.seconds; t += 0.1) {
      const now = frameAt(cast, t).poseTime;
      expect(now).toBeGreaterThanOrEqual(prev);
      prev = now;
    }
  });

  it('удар отмечен вспышкой, и она гаснет', () => {
    const cast = buildCast(evenFight(), 'attacker');
    const clash = cast.spans.find((s) => s.phase === 'clash')!;
    expect(frameAt(cast, clash.t0).impact).toBe(0);
    const after = clash.t0 + CLASH_HOLD.seconds + 0.1;
    expect(frameAt(cast, after).impact).toBeGreaterThan(0.8);
    expect(frameAt(cast, after + IMPACT_SECONDS + 0.1).impact).toBe(0);
  });

  it('бегут не все разом, а каждый со своего мгновения слома', () => {
    const result = evenFight();
    const cast = buildCast(result, 'attacker');
    const broken = cast.marks.filter((m) => m.id === 'sector-broken');
    if (broken.length < 2) return;
    const first = broken[0];
    const later = broken.find((m) => m.t > first.t + 0.5);
    if (!later) return;
    const at = (t: number, m: (typeof broken)[number]): number =>
      frameAt(cast, t).sectors.find((s) => s.side === m.side && s.sector === m.sector)!.flee;
    // Когда первый уже бежит, второй ещё стоит: паника идёт по строю, а не по кнопке.
    expect(at(later.t - 0.1, first)).toBeGreaterThan(0);
    expect(at(later.t - 0.1, later)).toBe(0);
    // И бегущий уходит с поля в свою сторону, а не в чужую.
    const late = frameAt(cast, Math.min(cast.seconds, first.t + FLEE_SECONDS)).sectors.find(
      (s) => s.side === first.side && s.sector === first.sector,
    )!;
    expect(late.flee).toBe(1);
    expect(Math.sign(late.dz)).toBe(Math.sign(late.z));
    expect(Math.abs(late.dz)).toBeCloseTo(FLEE_DIST, 5);
  });

  it('конница выносится вперёд и возвращается, а не телепортируется', () => {
    for (const seed of [7, 13, 21, 34]) {
      const cast = buildCast(evenFight(seed), 'attacker');
      const ride = cast.marks.find(
        // Перехвата обхода (`cavalry-intercepted`) ядро больше не пишет: он жил приказом «держать фланг».
        (m) => m.id === 'cavalry-broke-archers' || m.id === 'flank-turned',
      );
      if (!ride) continue;
      // Смотрим только на конные сектора этой стороны и только пока они не
      // бегут: у бегущего смещение своё и заведомо больше.
      const moved = (t: number): number =>
        Math.max(
          0,
          ...frameAt(cast, t)
            .sectors.filter(
              (s) => s.side === ride.side && s.flee === 0 && s.byFace.some((f) => f.kind === 'cavalry'),
            )
            .map((s) => Math.hypot(s.dx, s.dz)),
        );
      // На середине удара кто-то вынесен; к его концу все на своих местах.
      const mid = moved(ride.t + CHARGE_SECONDS * 0.5);
      if (mid <= 0) continue;
      expect(mid).toBeGreaterThan(0.2);
      expect(moved(ride.t + CHARGE_SECONDS + 0.05)).toBeLessThan(mid);
      return;
    }
  });

  it('раскадровка остаётся воспроизводимой со всем действием', () => {
    const result = evenFight(19);
    const a = buildCast(result, 'attacker');
    const b = buildCast(result, 'attacker');
    for (const t of sample(a, 0.2)) expect(frameAt(b, t)).toEqual(frameAt(a, t));
  });
});

describe('лес древков включается по видимому размеру бойца', () => {
  it('пока боец крупнее порога, древков нет ни одного', () => {
    // Не «на близком плане», а «пока видно, что древко некому держать». Такт
    // камеры такой границей не был: на среднем плане фигуры ещё большие, а лес
    // по такту уже стоял — это и было древками без хозяина.
    for (const cast of [buildCast(evenFight(), 'attacker'), buildCast(battle(armyMix(600), armyMix(600)), 'attacker')]) {
      for (const t of sample(cast, 0.25)) {
        for (const s of frameAt(cast, t).sectors) {
          if (s.manPx >= SHAFT_PX.off) expect(s.shafts, `${s.sector} ${s.manPx.toFixed(0)}px на ${t}`).toBe(0);
        }
      }
    }
  });

  it('порог — чистая геометрия камеры и держится на числах, а не на такте', () => {
    expect(shaftShare(SHAFT_PX.off)).toBe(0);
    expect(shaftShare(SHAFT_PX.off + 20)).toBe(0);
    expect(shaftShare(SHAFT_PX.on)).toBe(1);
    expect(shaftShare(SHAFT_PX.on - 5)).toBe(1);
    const mid = shaftShare((SHAFT_PX.off + SHAFT_PX.on) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // Вдвое дальше — вдвое мельче: пикселей считает камера, а не номер такта.
    const shot = frameAt(buildCast(evenFight(), 'attacker'), 0).shot;
    expect(manPixels(shot, 20)).toBeCloseTo(manPixels(shot, 40) * 2, 6);
  });

  it('лес гаснет вместе с камерой, а не хлопком', () => {
    // На спуске камера подходит вплотную, боец растёт, и лес обязан уйти. Уйти
    // он должен в самом движении: хлопок посреди кадра виден так же, как древко
    // без хозяина, и стоит той же веры к картинке.
    const cast = buildCast(battle(armyMix(600), armyMix(600)), 'attacker');
    const step = 1 / 30;
    let worst = 0;
    let peak = 0;
    let prev: number | null = null;
    // Мерится там, где лес есть. У сектора одной конницы древков нет вовсе (`shaftsFor`), и доля
    // леса у него — число, которому нечего показывать: лёгкая, скачущая из резерва на лучников,
    // растёт в кадре быстрее пешего строя, и крутизна доли у неё ничего не гасит.
    const forested = new Set(cast.sectors.filter((c) => c.shafts > 0).map((c) => `${c.side}/${c.sector}`));
    expect(forested.size, 'граница: сектора с лесом в бою есть').toBeGreaterThan(0);
    let checked = 0;
    for (let t = 0; t <= cast.seconds; t += step) {
      const f = frameAt(cast, Math.min(t, cast.seconds));
      // Доля показанного леса у каждого сектора с лесом меняется плавно.
      for (const s of f.sectors.filter((x) => forested.has(`${x.side}/${x.sector}`))) {
        checked++;
        const next = frameAt(cast, Math.min(t + step, cast.seconds)).sectors.find(
          (x) => x.side === s.side && x.sector === s.sector,
        )!;
        expect(Math.abs(shaftShare(next.manPx) - shaftShare(s.manPx)), `${s.side}/${s.sector} на ${t.toFixed(2)}`)
          .toBeLessThanOrEqual(0.08);
      }
      const all = f.sectors.reduce((n, s) => n + s.shafts, 0);
      if (prev !== null) worst = Math.max(worst, Math.abs(all - prev));
      peak = Math.max(peak, all);
      prev = all;
    }
    // И самих древков за кадр уходит считанные штуки, а не весь лес разом.
    // Мерка относительная: хлопок — это доли, близкие к единице, а здесь
    // измерено около двадцатой части, и запас до предела двукратный.
    expect(checked).toBeGreaterThan(0);
    expect(peak).toBeGreaterThan(100);
    expect(worst, `${worst} древков за кадр при ${peak} в лесу`).toBeLessThan(peak * 0.1);
  });

  it('гашение растянуто по спуску, а не срезано в один миг', () => {
    const cast = buildCast(battle(armyMix(600), armyMix(600)), 'attacker');
    const step = 1 / 30;
    let faded = 0;
    for (const c of cast.sectors) {
      let lit = -1;
      let dark = -1;
      for (let t = 0; t <= cast.seconds; t += step) {
        const s = frameAt(cast, Math.min(t, cast.seconds)).sectors.find(
          (x) => x.side === c.side && x.sector === c.sector,
        )!;
        const share = shaftShare(s.manPx);
        if (share > 0.9) lit = t;
        if (share < 0.1 && dark < 0 && lit > 0) dark = t;
      }
      if (lit < 0 || dark < 0) continue;
      faded++;
      // Полсекунды — нижняя граница: быстрее человек читает это переключением.
      expect(dark - lit, `${c.side}/${c.sector} гаснет за ${(dark - lit).toFixed(2)} с`).toBeGreaterThan(0.5);
    }
    expect(faded, 'ни один сектор не гаснет — проверять нечего').toBeGreaterThan(0);
  });

  it('рост бойца у режиссёра и у фигуры — одно число', () => {
    // Порог считается по росту, и он обязан быть тем же, каким фигуру рисуют:
    // разойдутся — порог начнёт мерить не то, что видно.
    expect(MAN_HEIGHT).toBe(FIGURE_MAN_HEIGHT);
  });

  it('число фигур по-прежнему растёт одним ходом камеры', () => {
    const cast = buildCast(evenFight(), 'attacker');
    // Фигуры идут по такту, и это не то же, что лес: армия не должна таять на
    // спуске, а лес обязан гаснуть, как только видно, что держать его некому.
    for (const t of [0, 2, 5, 7, 9, cast.acts[1].to]) {
      const f = frameAt(cast, t);
      const grown = (f.side.attacker.figures - Math.min(MUSTER_FIGURES, cast.figures.attacker)) /
        Math.max(1, cast.figures.attacker - Math.min(MUSTER_FIGURES, cast.figures.attacker));
      expect(grown).toBeCloseTo(crowdAt(cast, t), 1);
    }
  });
});
