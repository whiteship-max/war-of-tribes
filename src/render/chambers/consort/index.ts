// Дверь к супруге (ЛЦ-2, docs/characters.md): свой ленивый кусок внутри покоев — его тянет жизнь покоев при входе
// (`life.ts`), в первую загрузку и в кусок покоев он не едет. Здесь фигура собирается целиком: сетка, листы, материал,
// живость и свет покоев на ней; общее с гонцом — набор персонажа (`kit/`, ЛЦ-3).
import type { V3 } from '../../city/geom';
import type { Gesture } from '../folk';
import type { RoomUniforms } from '../material';
import { GAZE_UV } from '../kit/head';
import { roomLight } from '../kit/light';
import { figureMaterial, sheetTexture, type FigureUniforms } from '../kit/material';
import { SkinBody } from '../kit/skin';
import { paintCloth } from './cloth';
import { paintFace } from './face';
import { buildConsortMesh } from './figure';
import { LOOKS, lookOf, type ConsortId } from './looks';
import { ConsortMotion } from './motion';

export { CONSORT_IDS, LOOKS, BEST, lookOf, type ConsortId } from './looks';

/** Собранная супруга: тело для `folk.Person`, её живость (поза кадра) и свет покоев после отрисовки. */
export interface ConsortKit {
  readonly id: ConsortId;
  readonly body: SkinBody;
  readonly motion: ConsortMotion;
  readonly u: FigureUniforms;
  pose(t: number, phase: number, walk: number, g: Gesture, want: Gesture): { turns: Record<string, [number, number, number]>; lift: V3 };
  drawn(): void;
  dispose(): void;
}

export interface ConsortOptions {
  look?: ConsortId;
  /** Код подсветки касанием (`life.LIFE_CODE.wife`). */
  code?: number;
  /** Ручки покоев: свет сцены и выбор пальцем; без них (стенд) — свет задаёт хозяин (`u.uTint`). */
  room?: RoomUniforms | null;
  /** Глубина — в долю буфера под комнату (в покоях — да, на стенде — нет). */
  inside?: boolean;
}

export function makeConsort(opt: ConsortOptions = {}): ConsortKit {
  const id = opt.look ?? lookOf();
  const look = LOOKS[id];
  const mesh = buildConsortMesh();
  const body = sheetTexture(paintCloth(look).rgba(), 512, `consort-${id}-body`);
  const face = sheetTexture(paintFace(look).rgba(), 512, `consort-${id}-face`);
  const room = opt.room ?? null;
  const { material, u } = figureMaterial(body, face, opt.code ?? 0, opt.inside ?? !!room, room ? { uOrigin: room.uOrigin, uSel: room.uSel, uSelGlow: room.uSelGlow } : undefined, 'chambers-consort');
  const skin = new SkinBody(mesh, material, 'chambers-wife', [GAZE_UV, GAZE_UV]);
  const motion = new ConsortMotion(mesh.sk);
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
