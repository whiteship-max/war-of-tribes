// Дверь к гонцу (ЛЦ-3, docs/characters.md): свой ленивый кусок внутри покоев — его тянет жизнь покоев при входе
// (`life.ts`), в первую загрузку и в кусок покоев он не едет; общее с супругой — набор персонажа (`kit/`, свой общий кусок).
// Здесь фигура собирается целиком: голова облика, сетка, листы, материал, живость и свет покоев на ней. Ходит, стучит,
// кланяется и протягивает письмо гонец по прежним сценам — меняется только тело.
import type { V3 } from '../../city/geom';
import type { Gesture } from '../folk';
import type { RoomUniforms } from '../material';
import { GAZE_UV } from '../kit/head';
import { roomLight } from '../kit/light';
import { figureMaterial, sheetTexture, type FigureUniforms } from '../kit/material';
import { SkinBody } from '../kit/skin';
import { paintHeraldBody } from './cloth';
import { paintHeraldFace } from './face';
import { buildHeraldMesh } from './figure';
import { headOf } from './head';
import { HERALD_LOOKS, heraldOf, type HeraldId } from './looks';
import { HeraldMotion } from './motion';

export { BEST, HERALD_IDS, HERALD_LOOKS, heraldOf, type HeraldId } from './looks';

/** Собранный гонец: тело для `folk.Person`, его живость (поза кадра) и свет покоев после отрисовки. */
export interface HeraldKit {
  readonly id: HeraldId;
  readonly body: SkinBody;
  readonly motion: HeraldMotion;
  readonly u: FigureUniforms;
  pose(t: number, phase: number, walk: number, g: Gesture, want: Gesture): { turns: Record<string, [number, number, number]>; lift: V3 };
  drawn(): void;
  dispose(): void;
}

export interface HeraldOptions {
  look?: HeraldId;
  /** Ливрея: туника и кайма цветов герба державы (`folk.liveryOf`); без неё (стенд) — цвета облика. */
  livery?: { body: number; trim: number };
  /** Код подсветки касанием (`life.LIFE_CODE.herald`). */
  code?: number;
  /** Ручки покоев: свет сцены и выбор пальцем; без них (стенд) — свет задаёт хозяин (`u.uTint`). */
  room?: RoomUniforms | null;
  /** Глубина — в долю буфера под комнату (в покоях — да, на стенде — нет). */
  inside?: boolean;
}

export function makeHerald(opt: HeraldOptions = {}): HeraldKit {
  const id = opt.look ?? heraldOf();
  const look = HERALD_LOOKS[id];
  const head = headOf(look.face);
  const mesh = buildHeraldMesh(head);
  const body = sheetTexture(paintHeraldBody(look, opt.livery).rgba(), 512, `herald-${id}-body`);
  const face = sheetTexture(paintHeraldFace(look, head).rgba(), 512, `herald-${id}-face`);
  const room = opt.room ?? null;
  const { material, u } = figureMaterial(body, face, opt.code ?? 0, opt.inside ?? !!room, room ? { uOrigin: room.uOrigin, uSel: room.uSel, uSelGlow: room.uSelGlow } : undefined, 'chambers-herald');
  const skin = new SkinBody(mesh, material, 'chambers-herald', [GAZE_UV, GAZE_UV]);
  const motion = new HeraldMotion(mesh.sk, head.lidClose());
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
