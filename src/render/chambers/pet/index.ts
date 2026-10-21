// Дверь к коту (ЛЦ-4, docs/characters.md): свой ленивый кусок внутри покоев — его тянет жизнь покоев при входе (`life.ts`),
// в первую загрузку и в кусок покоев он не едет; общее с людьми — набор персонажа (`kit/`). Здесь фигура собирается
// целиком: сетка, лист окраса, материал с прозрачными усами, живость и свет покоев на голове; и клубок — шар одной костью и
// нитка лентой, на том же листе. Ходит, спит, прыгает и мяукает кот по прежнему мозгу (`cat.ts`) — меняется только тело.
import * as THREE from 'three';
import type { V3 } from '../../city/geom';
import type { CatFigure, CatRig, CatState } from '../cat';
import type { RoomUniforms } from '../material';
import { Skeleton } from '../rig';
import { roomLight } from '../kit/light';
import { figureMaterial, sheetTexture, type FigureUniforms } from '../kit/material';
import { SkinBody, SkinMesh } from '../kit/skin';
import { paintCat } from './coat';
import { buildCatMesh, GAZE_UV, PX, SHEET } from './figure';
import { CAT_LOOKS, catOf, type CatId } from './looks';
import { CatMotion } from './motion';

export { BEST, CAT_IDS, CAT_LOOKS, catOf, type CatId } from './looks';

/** Собранный кот: тело для мозга (`Cat.dress`), живость, ручки света и клубок на том же листе. */
export interface CatKit extends CatFigure {
  readonly id: CatId;
  readonly body: SkinBody & CatRig;
  readonly motion: CatMotion;
  readonly u: FigureUniforms;
  /** Клубок: сетка (одна кость), лист и материал — кота. */
  yarn(): THREE.Mesh;
}

export interface CatOptions {
  look?: CatId;
  /** Код подсветки касанием (`life.LIFE_CODE.cat`). */
  code?: number;
  /** Ручки покоев: свет сцены и выбор пальцем; без них (стенд) — свет задаёт хозяин (`u.uTint`). */
  room?: RoomUniforms | null;
  inside?: boolean;
  /** Сид живости (своя кость, не мозга). */
  seed?: number;
}

/** Радиус клубка, м (как прежде: `life.BALL_R`). */
export const YARN_R = 0.045;

export function makeCat(opt: CatOptions = {}): CatKit {
  const id = opt.look ?? catOf();
  const look = CAT_LOOKS[id];
  const mesh = buildCatMesh(look.head);
  const sheet = sheetTexture(paintCat(look).rgba(), PX, `cat-${id}`);
  const room = opt.room ?? null;
  const { material, u } = figureMaterial(sheet, sheet, opt.code ?? 0, opt.inside ?? !!room, room ? { uOrigin: room.uOrigin, uSel: room.uSel, uSelGlow: room.uSelGlow } : undefined, 'chambers-cat', true);
  const body = new SkinBody(mesh, material, 'chambers-cat', [GAZE_UV, GAZE_UV]);
  const motion = new CatMotion(opt.seed ?? 4243);
  const cell = (p: number): number => (SHEET.eye.cx[p] - SHEET.eye.cx[0]) / PX;
  const yarns: SkinBody[] = [];
  return {
    id,
    body,
    motion,
    u,
    live(p: { turns: Record<string, [number, number, number]>; lift: V3 }, s: CatState, t: number) {
      motion.live(p, s, t);
      body.gaze(motion.gaze[0], motion.gaze[1]);
      body.cell(cell(motion.pupil), 0);
    },
    drawn() {
      if (room) roomLight(room, body.at('head'), u);
      const c = u.uTint.value;
      motion.lux = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    },
    yarn() {
      // Одна кость в покое: позу не ставим — клубок крутит и катит его сетка целиком.
      const y = new SkinBody(yarnMesh(), material, 'chambers-ball');
      yarns.push(y);
      y.mesh.visible = true;
      return y.mesh;
    },
    dispose() {
      body.dispose();
      for (const y of yarns) y.dispose();
      sheet.dispose();
      material.dispose();
    },
  };
}

/**
 * Клубок: шар витками (8 × 6), одна кость; нитка — тонкая лента: виток поверх шара и хвостик, отошедший от него. Лист —
 * ячейка клубка кота. Крутит и катит его жизнь покоев целиком, как прежде (`mesh.rotation`, `mesh.position`).
 */
export function yarnMesh(): SkinMesh {
  const sk = new Skeleton();
  sk.add('ball', null, [0, 0, 0]);
  const m = new SkinMesh(sk);
  const b = SHEET.yarn;
  const uv = (x: number, y: number): [number, number] => [(b.x0 + 2 + x * (b.x1 - b.x0 - 4)) / PX, (b.y0 + 2 + y * (b.y1 - b.y0 - 4)) / PX];
  const R = YARN_R;
  const rows: number[][] = [];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI;
    const row: number[] = [];
    for (let k = 0; k <= 8; k++) {
      const c = (k / 8) * Math.PI * 2;
      row.push(m.v([Math.sin(a) * Math.cos(c) * R, Math.cos(a) * R, Math.sin(a) * Math.sin(c) * R], uv(k / 8, i / 6), 0, 'ball'));
    }
    rows.push(row);
  }
  m.strip(rows, false, () => [0, 0, 0]);
  // Нитка: виток наискось по шару и хвостик, сходящий на пол.
  const w = 0.0016;
  const path: V3[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = -0.6 + (i / 10) * 2.6;
    path.push([Math.cos(a) * R * 1.03, Math.sin(a) * R * 0.55 * 1.03, Math.sin(a) * R * 0.84 * 1.03]);
  }
  const end = path[path.length - 1];
  path.push([end[0] - 0.012, end[1] - 0.02, end[2] + 0.018], [end[0] - 0.02, end[1] - 0.034, end[2] + 0.04]);
  const strip = path.map((p, i) => {
    const l = Math.hypot(p[0], p[1], p[2]) || 1;
    const n: V3 = [p[0] / l, p[1] / l, p[2] / l];
    const side: V3 = [n[1] * 0.3 - n[2] * 0.2, n[2] * 0.9 - n[0] * 0.3, n[0] * 0.2 - n[1] * 0.9];
    const sl = Math.hypot(side[0], side[1], side[2]) || 1;
    const s: V3 = [(side[0] / sl) * w, (side[1] / sl) * w, (side[2] / sl) * w];
    const t = i / (path.length - 1);
    return [m.v([p[0] + s[0], p[1] + s[1], p[2] + s[2]], uv(t, 0.2), 0, 'ball'), m.v([p[0] - s[0], p[1] - s[1], p[2] - s[2]], uv(t, 0.3), 0, 'ball')];
  });
  for (let i = 0; i + 1 < strip.length; i++) m.quad(strip[i][0], strip[i + 1][0], strip[i + 1][1], strip[i][1], [0, 0, 0]);
  // Кончик нитки сходит на нет (и у клубка есть буфер прозрачности — материал кота его читает).
  for (const v of strip[strip.length - 1]) m.fade.set(v, 0.35);
  return m;
}
