// Дверь к советнику (ЛЦ-5, docs/characters.md): свой ленивый кусок внутри покоев — его тянет жизнь покоев при входе
// (`life.ts`), в первую загрузку и в кусок покоев он не едет; общее с супругой, гонцом и котом — набор персонажа (`kit/`).
// Здесь фигура собирается целиком: голова облика, сетка, листы, материал, живость и свет покоев на ней. Ждёт у стола,
// кланяется и докладывает со свитком советник по прежней сцене — меняется только тело.
import type { V3 } from '../../city/geom';
import type { Gesture } from '../folk';
import type { RoomUniforms } from '../material';
import { GAZE_UV } from '../kit/head';
import { roomLight } from '../kit/light';
import { figureMaterial, sheetTexture, type FigureUniforms } from '../kit/material';
import { SkinBody } from '../kit/skin';
import { paintAdvisorBody } from './cloth';
import { paintAdvisorFace } from './face';
import { buildAdvisorMesh } from './figure';
import { headOf } from './head';
import { ADVISOR_LOOKS, advisorOf, type AdvisorId } from './looks';
import { AdvisorMotion } from './motion';

export { ADVISOR_IDS, ADVISOR_LOOKS, BEST, advisorOf, type AdvisorId } from './looks';

/** Собранный советник: тело для `folk.Person`, его живость (поза кадра) и свет покоев после отрисовки. */
export interface AdvisorKit {
  readonly id: AdvisorId;
  readonly body: SkinBody;
  readonly motion: AdvisorMotion;
  readonly u: FigureUniforms;
  pose(t: number, phase: number, walk: number, g: Gesture, want: Gesture): { turns: Record<string, [number, number, number]>; lift: V3 };
  drawn(): void;
  dispose(): void;
}

export interface AdvisorOptions {
  look?: AdvisorId;
  /** Код подсветки касанием (`life.LIFE_CODE.advisor`). */
  code?: number;
  /** Ручки покоев: свет сцены и выбор пальцем; без них (стенд) — свет задаёт хозяин (`u.uTint`). */
  room?: RoomUniforms | null;
  /** Глубина — в долю буфера под комнату (в покоях — да, на стенде — нет). */
  inside?: boolean;
}

export function makeAdvisor(opt: AdvisorOptions = {}): AdvisorKit {
  const id = opt.look ?? advisorOf();
  const look = ADVISOR_LOOKS[id];
  const head = headOf(look.face);
  const mesh = buildAdvisorMesh(head);
  const body = sheetTexture(paintAdvisorBody(look).rgba(), 512, `advisor-${id}-body`);
  const face = sheetTexture(paintAdvisorFace(look, head).rgba(), 512, `advisor-${id}-face`);
  const room = opt.room ?? null;
  const { material, u } = figureMaterial(body, face, opt.code ?? 0, opt.inside ?? !!room, room ? { uOrigin: room.uOrigin, uSel: room.uSel, uSelGlow: room.uSelGlow } : undefined, 'chambers-advisor');
  const skin = new SkinBody(mesh, material, 'chambers-advisor', [GAZE_UV, GAZE_UV]);
  const motion = new AdvisorMotion(mesh.sk, head.lidClose());
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
