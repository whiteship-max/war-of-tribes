// Камера без поводка и ограничитель детализации на отдалении (ПН-00; docs/gdd/path_of_sword.md, 3.5.7, решение С3).
//
// Области правил (правило 11) — утверждением в самих тестах: порог дальнего вида лежит между самым мелким масштабом и
// масштабом, с которого карта открывается (иначе ограничитель не включался бы никогда или включался бы всегда); весь
// регион в кадре — мельче порога у каждого региона (иначе свободная камера уводила бы за ограничитель).
import { afterEach, describe, expect, it } from 'vitest';
import type { SettlementView } from '@/world/types';
import { HOME_SIGHT } from '@/world/data/tuning';
import { SICILY, SICILY_SIGHT } from '@/world/spawn';
import { homeSight } from '@/world/sight';
import { theatres } from '@/world/theatre/theatre';
import { SCALE_MAX, SCALE_MIN, SCALE_START } from '../const';
import { type Camera, type Viewport, holdCamera, viewRect } from '../grid';
import { holdInTheatre, reachOf } from './theatre/camera';
import { FAR_CELL, FAR_LABELS, OLD_ZOOM_MARGIN, decideFar, farBelow, farFrame, farPick, isFar, oldSpan } from './far';
import { placeItems } from './scene';

const PHONE: Viewport = { w: 390, h: 844 };
const DESKTOP: Viewport = { w: 1440, h: 900 };
const SIGHTS = [HOME_SIGHT, SICILY_SIGHT];

afterEach(() => {
  decideFar(SCALE_START, PHONE, null);
});

describe('камера без поводка (ПН-00)', () => {
  const home = { x: SICILY[0].x + 0.5, y: SICILY[0].y + 0.5 };

  it('ни поводка, ни потолка отдаления: камеру не тянет к дому и щипок до упора не останавливается раньше', () => {
    // Бросок пальцем за сотню клеток от дома — камера там и остаётся.
    const far = holdCamera({ cx: home.x + 120, cy: home.y - 90, scale: 16 }, PHONE);
    expect(far.cx).toBe(home.x + 120);
    expect(far.cy).toBe(home.y - 90);
    // Щипок до упора — самый мелкий масштаб игры, а не «дальше разведанного не отдалить».
    expect(holdCamera({ cx: home.x, cy: home.y, scale: SCALE_MIN / 2 }, PHONE).scale).toBe(SCALE_MIN);
    expect(holdCamera({ cx: home.x, cy: home.y, scale: SCALE_MAX * 2 }, PHONE).scale).toBe(SCALE_MAX);
  });

  it('держит только рамка региона: отдаление — до всего региона, и не дальше рамки с краем', () => {
    for (const t of theatres()) {
      for (const vp of [PHONE, DESKTOP]) {
        const frame = (c: Camera, v: Viewport): Camera => holdInTheatre(c, v, t.box);
        const mid = { cx: t.box.x + t.box.w / 2, cy: t.box.y + t.box.h / 2 };
        const out = holdCamera({ ...mid, scale: SCALE_MIN }, vp, frame);
        const r = viewRect(out, vp);
        const reach = reachOf(t.box);
        // Регион целиком в кадре хотя бы по одной оси — дальше отдалять незачем; за рамку с краем кадр не выходит.
        expect(r.w >= t.box.w - 1e-6 || r.h >= t.box.h - 1e-6, `${t.id}: весь регион в кадре`).toBe(true);
        expect(r.x, t.id).toBeGreaterThanOrEqual(reach.x - 1e-6);
        expect(r.y, t.id).toBeGreaterThanOrEqual(reach.y - 1e-6);
        expect(r.x + r.w, t.id).toBeLessThanOrEqual(reach.x + reach.w + 1e-6);
        expect(r.y + r.h, t.id).toBeLessThanOrEqual(reach.y + reach.h + 1e-6);
      }
    }
  });
});

describe('ограничитель детализации: порог — прежний потолок у типичного игрока', () => {
  it('на пороге кадр по длинной стороне вмещает ровно столько клеток, сколько вмещал прежний потолок', () => {
    for (const sight of SIGHTS) {
      for (const vp of [PHONE, DESKTOP]) {
        const r = viewRect({ cx: 0, cy: 0, scale: farBelow(vp, sight) }, vp);
        // Прежняя формула `grid.zoomFloor` при разведанном круге обзора: пролёт = 2·обзор + 1 + 2·запас.
        expect(Math.max(r.w, r.h)).toBeCloseTo(2 * sight + 1 + 2 * OLD_ZOOM_MARGIN, 9);
        expect(oldSpan(sight)).toBe(2 * sight + 1 + 2 * OLD_ZOOM_MARGIN);
      }
    }
    // Своё место — круг обзора дома: Сицилия шире прочих.
    expect(homeSight(SICILY[0])).toBe(SICILY_SIGHT);
  });

  it('порог внутри рабочих масштабов: карта открывается подробной, щипок до упора — дальний вид', () => {
    for (const sight of SIGHTS) {
      for (const vp of [PHONE, DESKTOP]) {
        const at = farBelow(vp, sight);
        expect(at, 'точка внутри области: порог выше самого мелкого масштаба').toBeGreaterThan(SCALE_MIN);
        expect(at, 'точка внутри области: порог ниже масштаба открытия').toBeLessThan(SCALE_START);
        expect(isFar(SCALE_START, vp, sight)).toBe(false);
        expect(isFar(at * 1.001, vp, sight)).toBe(false);
        expect(isFar(at * 0.999, vp, sight)).toBe(true);
        expect(isFar(SCALE_MIN, vp, sight)).toBe(true);
      }
    }
  });

  it('весь регион в кадре — всегда дальний вид: свободная камера не уводит за ограничитель', () => {
    for (const t of theatres()) {
      const mid = { cx: t.box.x + t.box.w / 2, cy: t.box.y + t.box.h / 2 };
      for (const vp of [PHONE, DESKTOP]) {
        const whole = holdCamera({ ...mid, scale: SCALE_MIN }, vp, (c, v) => holdInTheatre(c, v, t.box));
        for (const sight of SIGHTS) expect(isFar(whole.scale, vp, sight), `${t.id}, ${vp.w}×${vp.h}, обзор ${sight}`).toBe(true);
      }
    }
  });

  it('решение — одно на кадр: его читают места и палец', () => {
    expect(decideFar(SCALE_MIN, PHONE, SICILY[0])).toBe(true);
    expect(farFrame()).toBe(true);
    expect(decideFar(SCALE_START, PHONE, SICILY[0])).toBe(false);
    expect(farFrame()).toBe(false);
    // Мира ещё нет — обзор дома по умолчанию.
    expect(decideFar(farBelow(PHONE, HOME_SIGHT) * 0.99, PHONE, null)).toBe(true);
  });
});

describe('сводная метка: одна на клетку экрана', () => {
  interface P {
    sx: number;
    sy: number;
    rank: number;
    id: string;
  }
  const rank = (p: P): number => p.rank;
  const id = (p: P): string => p.id;
  /** Двести мест вперемешку на экране телефона — больше, чем клеток экрана. */
  const crowd = (): P[] => {
    const out: P[] = [];
    let h = 7;
    for (let i = 0; i < 200; i++) {
      h = (h * 1103515245 + 12345) >>> 0;
      out.push({ sx: (h % 3900) / 10, sy: ((h >>> 12) % 8440) / 10, rank: i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0, id: `p${i}` });
    }
    out.push({ sx: 200, sy: 400, rank: 3, id: 'zz-mine' });
    return out;
  };

  it('в каждой клетке остаётся одно место — важнейшее; своё не уступает никому', () => {
    const all = crowd();
    const kept = farPick(all, rank, id);
    const cell = (p: P): string => `${Math.floor(p.sx / FAR_CELL)},${Math.floor(p.sy / FAR_CELL)}`;
    const cells = new Set(all.map(cell));
    expect(all.length, 'точка внутри области: мест больше, чем клеток с местами').toBeGreaterThan(cells.size);
    expect(kept).toHaveLength(cells.size);
    for (const k of kept) {
      const rivals = all.filter((p) => cell(p) === cell(k));
      expect(Math.max(...rivals.map(rank))).toBe(k.rank);
    }
    expect(kept.map(id)).toContain('zz-mine');
  });

  it('порядок входа не меняет выбора: метка не прыгает от кадра к кадру', () => {
    const all = crowd();
    const back = [...all].reverse();
    expect(new Set(farPick(back, rank, id).map(id))).toEqual(new Set(farPick(all, rank, id).map(id)));
  });

  it('места кадра (`placeItems`) на дальнем виде — сводными метками, вблизи — все', () => {
    const view = (i: number, mine = false): SettlementView =>
      ({
        id: `s${i}`,
        x: 700 + (i % 10),
        y: 1300 + Math.floor(i / 10),
        name: `Место ${i}`,
        stage: 'village',
        relation: 'neutral',
        owner: null,
        tribeId: null,
        tribeName: null,
        color: '#8a7a5a',
        mine,
        castle: false,
        visible: true,
        seenAt: null,
        stale: false,
        ruin: false,
        sacked: false,
        besieged: null,
        fell: null,
      }) as unknown as SettlementView;
    const list = Array.from({ length: 100 }, (_, i) => view(i, i === 55));
    const cam: Camera = { cx: 705, cy: 1305, scale: SCALE_MIN };
    decideFar(SCALE_START, PHONE, SICILY[0]);
    const near = placeItems(cam, PHONE, list, 2);
    expect(near, 'точка внутри области: все сто мест на экране').toHaveLength(100);
    decideFar(cam.scale, PHONE, SICILY[0]);
    const far = placeItems(cam, PHONE, list, 2);
    expect(far.length).toBeLessThan(near.length);
    expect(far.some((it) => it.s.mine), 'своё на дальнем виде видно').toBe(true);
    expect(FAR_LABELS).toBeGreaterThan(0);
  });
});
