// Осада и падение города на карте: рогатки, знак участи, подписи — и цена всего этого
// для земли.
//
// Главное здесь — последний раздел. Карта печёт землю в кэш, и однажды уже горела на
// том, что новая рисовка заставляла перепекать тайл каждый кадр. Поэтому «рогатки земли
// не касаются» проверяется не рассуждением, а счётчиком выпечек (`ground.tileBakes`) на
// настоящем кадре (`frame.drawFrame`): холст подменён записывающей заглушкой, всё
// остальное — те же функции, что у игрока.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { putChunk, chunkKey, clearCache } from '@/world/cache';
import { useWorld } from '@/world/store';
import { CHUNK, FALL_MARK, WORLD_ORIGIN } from '@/world/data/tuning';
import { CAMP_WORKS_RIPE } from '@/world/data/tuning';
import type { Fate, SettlementView } from '@/world/types';
import { SCALE_START, TREE_FREE_R } from './const';
import { cacheFor } from './grid';
import { drawFrame } from './frame';
import { dropTiles, tileBakes } from './ground';
import { fakeCanvasEnv, waterChunk } from './fakecanvas';
import {
  FELL_WORDS,
  FRONT_R,
  FRONT_STAKES,
  LABEL_MAX_PX,
  REAR_R,
  REAR_STAKES,
  WORKS_STEPS,
  dropSiegeMarks,
  fellShown,
  fitLabel,
  stakeOrder,
  stakesAt,
  worksKey,
  worksStand,
  worksStep,
} from './siegemark';

// ---------- Чистая часть ----------

describe('рогатки: ступени готовности', () => {
  it('ступень монотонна по готовности и доходит до конца ровно на дозревших рогатках', () => {
    let prev = -1;
    for (let i = 0; i <= 1000; i++) {
      const step = worksStep(i / 1000);
      expect(step).toBeGreaterThanOrEqual(prev);
      prev = step;
    }
    expect(worksStep(0)).toBe(0);
    expect(worksStep(1)).toBe(WORKS_STEPS);
    expect(worksStep(0.999)).toBe(WORKS_STEPS - 1);
  });

  it('недостроенный ряд редеет по всему кругу, а не пустеет с одной стороны', () => {
    // На любой ступени от четверти колья стоят в каждой четверти круга: иначе
    // «достроено наполовину» читалось бы «укреплена одна сторона города».
    for (const n of [FRONT_STAKES, REAR_STAKES]) {
      const order = stakeOrder(n);
      expect(new Set(order).size, 'порядок — перестановка').toBe(n);
      for (let step = WORKS_STEPS / 4; step <= WORKS_STEPS; step++) {
        const shown = stakesAt(n, step);
        for (let q = 0; q < 4; q++) {
          const inQuarter = order.filter((rank, i) => rank < shown && Math.floor((i / n) * 4) === q).length;
          expect(inQuarter, `${n} кольев, ступень ${step}, четверть ${q}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('ряды лежат внутри вырубки: рогатки не просят земли под собой', () => {
    expect(FRONT_R).toBeLessThan(REAR_R);
    expect(REAR_R).toBeLessThan(TREE_FREE_R);
  });

  it('ключ спрайта различает всё, от чего зависит картинка', () => {
    const keys = new Set<string>();
    for (const f of [0, 3, WORKS_STEPS]) {
      for (const r of [0, 5, WORKS_STEPS]) {
        for (const half of ['back', 'front'] as const) {
          for (const bucket of [22, 64]) for (const dpr of [1, 2]) keys.add(worksKey(f, r, half, bucket, dpr));
        }
      }
    }
    expect(keys.size).toBe(3 * 3 * 2 * 2 * 2);
  });

  it('рогатки сходят с карты в минуту голода, а у постороннего — ждут куска карты', () => {
    expect(worksStand(1000, 999)).toBe(true);
    expect(worksStand(1000, 1000)).toBe(false);
    expect(worksStand(undefined, 1e15)).toBe(true);
  });
});

describe('знак участи', () => {
  it('держится ровно `FALL_MARK` и ни минутой дольше', () => {
    const at = 5_000_000;
    for (const fate of Object.keys(FELL_WORDS) as Fate[]) {
      expect(fellShown({ fate, at }, at)).toBe(true);
      expect(fellShown({ fate, at }, at + FALL_MARK - 1)).toBe(true);
      expect(fellShown({ fate, at }, at + FALL_MARK)).toBe(false);
      expect(fellShown({ fate, at }, at - 1), 'до падения знака нет').toBe(false);
    }
    expect(fellShown(null, at)).toBe(false);
  });

  it('у каждой участи своё слово, и слова не повторяются', () => {
    const words = Object.values(FELL_WORDS);
    expect(new Set(words).size).toBe(words.length);
    expect(Object.keys(FELL_WORDS).sort()).toEqual(['burn', 'captives', 'plunder']);
  });
});

// ---------- Подписи ----------

describe('подпись поселения вписывается, а не разъезжается', () => {
  /** Мерка без холста: широкие буквы шире узких, как у настоящего шрифта. */
  const measure = (s: string): number =>
    Array.from(s).reduce((w, ch) => w + (/[ШЩЖМЮФWM@…]/.test(ch) ? 11 : /[ijl.,:;'!| ]/.test(ch) ? 3 : 7), 0);

  const NAMES = [
    '',
    'Ольховец',
    'Ш'.repeat(40),
    'i'.repeat(40),
    'Логово разбойников',
    'Большой Новый Город У Самой Реки Где Ивы',
    `${'Щ'.repeat(20)} ${'l'.repeat(19)}`,
  ];

  it('ширина вписанной подписи не больше потолка при любом имени до сорока знаков', () => {
    for (const name of NAMES) {
      const fit = fitLabel(name, LABEL_MAX_PX, measure);
      expect(measure(fit), name).toBeLessThanOrEqual(LABEL_MAX_PX);
      // Короткое имя не трогается, длинное — начало имени с многоточием.
      if (measure(name) <= LABEL_MAX_PX) expect(fit).toBe(name);
      else {
        expect(fit.endsWith('…')).toBe(true);
        expect(name.startsWith(fit.slice(0, -1).trimEnd())).toBe(true);
      }
    }
    // Проверка не пустая: хотя бы одно имя действительно пришлось резать.
    expect(NAMES.some((n) => measure(n) > LABEL_MAX_PX)).toBe(true);
  });

  it('кадр пишет имя только вписанным: сырого `s.name` в `fillText` нет', () => {
    const src = readFileSync(join(process.cwd(), 'src/ui/map/frame.ts'), 'utf8');
    expect(src).not.toMatch(/(fill|stroke)Text\(s\.name/);
    expect(src).toMatch(/fittedLabel\(ctx, s\.name\)/);
  });
});

// ---------- Земля: сколько печётся ----------

const START = 1_800_000_000_000;
const MID = { cx: 12, cy: 12 };
const CITY = {
  x: WORLD_ORIGIN.x + MID.cx * CHUNK + 10,
  y: WORLD_ORIGIN.y + MID.cy * CHUNK + 10,
};

const town = (i: number, marks: boolean): SettlementView => ({
  id: `t${i}`,
  x: CITY.x + (i % 3) * 3,
  y: CITY.y + Math.floor(i / 3) * 3,
  name: i === 0 ? 'Ш'.repeat(40) : `Город ${i}`,
  stage: 'town',
  relation: i === 0 ? 'self' : 'neutral',
  owner: null,
  tribeId: null,
  tribeName: null,
  color: '#e8a43c',
  mine: i === 0,
  castle: false,
  visible: true,
  seenAt: START,
  stale: false,
  seenPop: 100,
  marching: false,
  ruin: false,
  sacked: false,
  // Осада началась минуту назад и будет дозревать весь прогон; падение — только что.
  besieged: marks && i % 2 === 0 ? { since: START - 60_000, starvesAt: START + 10 * CAMP_WORKS_RIPE } : null,
  fell: marks && i % 2 === 1 ? { fate: (['plunder', 'captives', 'burn'] as Fate[])[i % 3], at: START } : null,
});

/** Положить мир в кэш и стор: девять кусков воды, шесть городов посередине. */
function lay(marks: boolean): SettlementView[] {
  clearCache();
  const list = Array.from({ length: 6 }, (_, i) => town(i, marks));
  for (let cy = MID.cy - 1; cy <= MID.cy + 1; cy++) {
    for (let cx = MID.cx - 1; cx <= MID.cx + 1; cx++) putChunk(chunkKey(cx, cy), waterChunk(cx, cy, list), START);
  }
  useWorld.setState({
    info: { seed: 20260912, size: 800, origin: WORLD_ORIGIN, home: CITY, homeId: 't0', createdAt: START },
    marches: [],
    figures: [],
    selected: null,
    spotlight: null,
  });
  return list;
}

describe('рогатки и знаки участи не прибавляют ни одной выпечки земли', () => {
  const VP = { w: 375, h: 812 };
  let env: ReturnType<typeof fakeCanvasEnv>;

  beforeAll(() => {
    env = fakeCanvasEnv();
    vi.useFakeTimers();
  });
  afterAll(() => {
    vi.useRealTimers();
    env.restore();
    clearCache();
  });

  /** Кадры карты: камера по пути `camAt`, часы идут на `stepMs` за кадр. */
  function run(marks: boolean, frames: number, stepMs: number, camAt: (f: number) => { cx: number; cy: number }) {
    lay(marks);
    dropTiles();
    dropSiegeMarks();
    const ctx = (globalThis as unknown as { document: { createElement: () => { getContext: () => CanvasRenderingContext2D } } })
      .document.createElement()
      .getContext();
    const bakes: number[] = [];
    const canvases0 = env.created();
    for (let f = 1; f <= frames; f++) {
      vi.setSystemTime(START + f * stepMs);
      const before = tileBakes();
      drawFrame(ctx, { ...camAt(f), scale: SCALE_START }, VP, 2, f);
      bakes.push(tileBakes() - before);
    }
    return { bakes, canvases: env.created() - canvases0 };
  }

  it('неподвижная камера над осаждённым и павшим городом, пока рогатки растут, не печёт ничего', () => {
    const capacity = cacheFor(VP);
    // Часы идут по полминуты за кадр: за прогон рогатки проходят все ступени, то есть
    // спрайт рогаток перепекается много раз — а земля не должна ни разу.
    const frames = capacity + 120;
    const stepMs = CAMP_WORKS_RIPE / 100;
    // Точки прогона внутри области правила: осада идёт и знак держится на каждом кадре.
    expect(START + frames * stepMs).toBeLessThan(START + 10 * CAMP_WORKS_RIPE);
    expect(frames * stepMs).toBeLessThan(FALL_MARK);
    const still = () => ({ cx: CITY.x + 2, cy: CITY.y + 2 });
    const marked = run(true, frames, stepMs, still);
    const late = marked.bakes.slice(capacity).reduce((a, b) => a + b, 0);
    expect(late, 'выпечек стоя после того, как запрос испечён').toBe(0);
    // Проверка не пустая: земля в начале пеклась, а рогатки и знаки рисовались —
    // холстов заведено больше, чем без них.
    expect(marked.bakes.slice(0, capacity).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    const plain = run(false, frames, stepMs, still);
    expect(marked.canvases, 'рогатки и знаки на самом деле пеклись').toBeGreaterThan(plain.canvases);
  });

  it('камера в движении печёт с рогатками ровно столько же, сколько без них', () => {
    const path = (f: number) => ({ cx: CITY.x + 2 + f * 0.09, cy: CITY.y + 2 + f * 0.05 });
    const frames = 400;
    const stepMs = 3_000;
    expect(START + frames * stepMs).toBeLessThan(START + 10 * CAMP_WORKS_RIPE);
    const marked = run(true, frames, stepMs, path);
    const plain = run(false, frames, stepMs, path);
    const total = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(total(plain.bakes), 'проверка не пустая: движущаяся камера печёт').toBeGreaterThan(cacheFor(VP));
    expect(total(marked.bakes)).toBe(total(plain.bakes));
    expect(marked.canvases).toBeGreaterThan(plain.canvases);
  });
});
