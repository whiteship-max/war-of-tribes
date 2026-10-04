// Регионы на карте (docs/map_tw.md, раздел 13): камера — в рамке, заранее испечённое — под потолком памяти, регион
// на экране — та же мерка, что у мира (разметка и её тесты — `world/theatre/theatre.test.ts`).
import { describe, expect, it } from 'vitest';
import { cellOf } from '@/world/atlas/project';
import { WORLD_ORIGIN } from '@/world/data/tuning';
import { theatreById, theatres } from '@/world/theatre/theatre';
import { SCALE_MAX, SCALE_MIN } from '../../const';
import { type Camera, type Viewport, viewRect } from '../../grid';
import { PREBAKE_BUDGET, planBytes, theatrePlan } from './plan';
import { THEATRE_EDGE, holdInTheatre, reachOf } from './camera';
import { activeTheatre, setActiveTheatre, withinActive } from './active';

/** Клетка мира под долготой и широтой. */
function at(lon: number, lat: number): { x: number; y: number } {
  const p = cellOf(lon, lat);
  return { x: WORLD_ORIGIN.x + Math.floor(p.col), y: WORLD_ORIGIN.y + Math.floor(p.row) };
}

describe('регионы на карте', () => {
  it('заранее испечённое любого региона влезает в потолок памяти', () => {
    for (const t of theatres()) {
      const b = planBytes(theatrePlan(t), true);
      expect(b.overview + b.mid + b.sheets, t.id).toBeLessThanOrEqual(PREBAKE_BUDGET);
      // План не пуст: регион печётся, а не только числится.
      expect(theatrePlan(t).chunks.length, t.id).toBeGreaterThan(0);
      expect(theatrePlan(t).mids.length, t.id).toBeGreaterThan(0);
    }
  });

  it('регион игрока: пока его нет, рамки нет; есть — своё внутри, чужое снаружи', () => {
    expect(activeTheatre()).toBe(null);
    const paris = at(2.35, 48.86);
    expect(withinActive(paris.x, paris.y)).toBe(true);
    const de = theatreById('germany');
    expect(de).not.toBe(null);
    setActiveTheatre(de);
    try {
      const munich = at(11.58, 48.14);
      expect(withinActive(munich.x, munich.y)).toBe(true);
      expect(withinActive(paris.x, paris.y)).toBe(false);
      const sea = at(-8, 45.5);
      expect(withinActive(sea.x, sea.y)).toBe(false);
    } finally {
      setActiveTheatre(null);
    }
  });
});

describe('регионы: камера в рамке', () => {
  /** Сеяный генератор: тест повторяется буква в букву. */
  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const VIEWS: Viewport[] = [
    { w: 375, h: 812 },
    { w: 812, h: 375 },
    { w: 768, h: 1024 },
    { w: 1400, h: 900 },
  ];

  it('кадр не выходит за рамку региона с краем ни на каком масштабе и ни в каком положении', () => {
    const rnd = rng(20261003);
    let moved = 0;
    for (const t of theatres()) {
      const reach = reachOf(t.box);
      for (const vp of VIEWS) {
        for (let k = 0; k < 40; k++) {
          // Камеры и внутри рамки, и далеко за ней: правило решает именно там, где камера уходит.
          const cam: Camera = {
            cx: t.box.x - 150 + rnd() * (t.box.w + 300),
            cy: t.box.y - 150 + rnd() * (t.box.h + 300),
            scale: SCALE_MIN + rnd() * (SCALE_MAX - SCALE_MIN),
          };
          const held = holdInTheatre(cam, vp, t.box);
          if (held.cx !== cam.cx || held.cy !== cam.cy || held.scale !== cam.scale) moved++;
          const r = viewRect(held, vp);
          const eps = 1e-6;
          expect(r.x, `${t.id} ${vp.w}×${vp.h}`).toBeGreaterThanOrEqual(reach.x - eps);
          expect(r.y, `${t.id} ${vp.w}×${vp.h}`).toBeGreaterThanOrEqual(reach.y - eps);
          expect(r.x + r.w, `${t.id} ${vp.w}×${vp.h}`).toBeLessThanOrEqual(reach.x + reach.w + eps);
          expect(r.y + r.h, `${t.id} ${vp.w}×${vp.h}`).toBeLessThanOrEqual(reach.y + reach.h + eps);
          expect(held.scale).toBeLessThanOrEqual(SCALE_MAX);
          // Рамка держит, а не дёргает: второй раз камера уже не сдвигается.
          expect(holdInTheatre(held, vp, t.box)).toEqual(held);
        }
      }
    }
    // Правило не холостое: значительная часть камер была за рамкой и сдвинута.
    expect(moved).toBeGreaterThan(theatres().length * VIEWS.length * 10);
  });

  it('камеру внутри рамки рамка не трогает: панорама внутри региона идёт за пальцем один к одному', () => {
    const de = theatreById('germany')!;
    const vp: Viewport = { w: 375, h: 812 };
    const cam: Camera = { cx: de.box.x + de.box.w / 2, cy: de.box.y + de.box.h / 2, scale: 44 };
    expect(holdInTheatre(cam, vp, de.box)).toEqual(cam);
    // Край — на `THEATRE_EDGE` клеток за рамкой, не больше и не меньше.
    const far = holdInTheatre({ ...cam, cx: de.box.x - 1000 }, vp, de.box);
    expect(viewRect(far, vp).x).toBeCloseTo(de.box.x - THEATRE_EDGE, 9);
  });
});
