// Дверь к служанке (ЛЦ-6, docs/characters.md): свой ленивый кусок внутри покоев — его тянет жизнь покоев при входе
// (`life.ts`), в первую загрузку и в кусок покоев он не едет; общее с супругой, гонцом, советником и котом — набор персонажа
// (`kit/`). Здесь фигура собирается целиком: голова облика, сетка, листы, материал, живость и свет покоев на ней. Поднимается
// с кувшином, наливает вино в кубок, приседает и говорит служанка по прежним сценам — меняется только тело; кувшин рисует
// жизнь покоев, а где он в руке — говорит фигура (`jug`).
import type { V3 } from '../../city/geom';
import type { Gesture } from '../folk';
import type { RoomUniforms } from '../material';
import { GAZE_UV } from '../kit/head';
import { roomLight } from '../kit/light';
import { figureMaterial, sheetTexture, type FigureUniforms } from '../kit/material';
import { norm } from '../kit/body';
import { SkinBody, sub } from '../kit/skin';
import { paintMaidBody } from './cloth';
import { paintMaidFace } from './face';
import { buildMaidMesh } from './figure';
import { headOf } from './head';
import { MAID_LOOKS, maidOf, type MaidId } from './looks';
import { MaidMotion } from './motion';

export { BEST, MAID_IDS, MAID_LOOKS, maidOf, type MaidId } from './looks';

/** Кувшин в правой руке: точка у горла (там его держит кулак) и оси — носик, верх, третья; всё — в осях сцены покоев. */
export interface JugFrame {
  at: V3;
  spout: V3;
  up: V3;
  side: V3;
}

/** Собранная служанка: тело для `folk.Person`, её живость (поза кадра), кувшин в руке и свет покоев после отрисовки. */
export interface MaidKit {
  readonly id: MaidId;
  readonly body: SkinBody;
  readonly motion: MaidMotion;
  readonly u: FigureUniforms;
  pose(t: number, phase: number, walk: number, g: Gesture, want: Gesture): { turns: Record<string, [number, number, number]>; lift: V3 };
  /** Где кувшин в правой руке этого кадра (после `body.pose`). */
  jug(): JugFrame;
  drawn(): void;
  dispose(): void;
}

export interface MaidOptions {
  look?: MaidId;
  /** Код подсветки касанием (`life.LIFE_CODE.maid`). */
  code?: number;
  /** Ручки покоев: свет сцены и выбор пальцем; без них (стенд) — свет задаёт хозяин (`u.uTint`). */
  room?: RoomUniforms | null;
  /** Глубина — в долю буфера под комнату (в покоях — да, на стенде — нет). */
  inside?: boolean;
}

/** Хват кувшина в покое кисти (оси кисти — оси фигуры): горло — в кулаке у ладони, верх — против пальцев, носик — вперёд. */
const JUG_GRIP = 0.075;
const JUG_PALM = 0.03;

export function makeMaid(opt: MaidOptions = {}): MaidKit {
  const id = opt.look ?? maidOf();
  const look = MAID_LOOKS[id];
  const head = headOf(look.face);
  const mesh = buildMaidMesh(head);
  const body = sheetTexture(paintMaidBody(look).rgba(), 512, `maid-${id}-body`);
  const face = sheetTexture(paintMaidFace(look, head).rgba(), 512, `maid-${id}-face`);
  const room = opt.room ?? null;
  const { material, u } = figureMaterial(body, face, opt.code ?? 0, opt.inside ?? !!room, room ? { uOrigin: room.uOrigin, uSel: room.uSel, uSelGlow: room.uSelGlow } : undefined, 'chambers-maid');
  const skin = new SkinBody(mesh, material, 'chambers-maid', [GAZE_UV, GAZE_UV]);
  const motion = new MaidMotion(mesh.sk, head.lidClose());
  // Хват в осях кисти (в покое оси кисти — оси фигуры): пальцы — от запястья, ладонь правой — к телу (+x).
  const sk = mesh.sk;
  const fingers = norm(sub(sk.bones[sk.of('handR')].j, sk.bones[sk.of('foreR')].j));
  const grip: V3 = [fingers[0] * JUG_GRIP + JUG_PALM, fingers[1] * JUG_GRIP, fingers[2] * JUG_GRIP];
  const upL: V3 = [-fingers[0], -fingers[1], -fingers[2]];
  // Носик — вперёд (к большому пальцу), без доли вдоль верха.
  const f0: V3 = [0, 0, 1];
  const d = f0[0] * upL[0] + f0[1] * upL[1] + f0[2] * upL[2];
  const spoutL = norm([f0[0] - upL[0] * d, f0[1] - upL[1] * d, f0[2] - upL[2] * d]);
  const toWorld = (R: Float64Array, v: V3): V3 => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
  return {
    id,
    body: skin,
    motion,
    u,
    pose(t, phase, walk, g, want) {
      const p = motion.pose(t, phase, walk, g, want);
      skin.gaze(motion.gaze[0], motion.gaze[1]);
      return p;
    },
    jug() {
      const R = skin.axes('handR');
      const up = toWorld(R, upL);
      const spout = toWorld(R, spoutL);
      const side: V3 = [spout[1] * up[2] - spout[2] * up[1], spout[2] * up[0] - spout[0] * up[2], spout[0] * up[1] - spout[1] * up[0]];
      return { at: skin.at('handR', grip), spout, up, side };
    },
    drawn() {
      if (room) roomLight(room, skin.at('chest'), u);
    },
    dispose() {
      body.dispose();
      face.dispose();
      material.dispose();
    },
  };
}
