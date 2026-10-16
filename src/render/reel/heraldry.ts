// Гербы сторон на знамёнах роликов боя и осады (docs/gfx.md, «Знамёна»; docs/polish.md, П-2).
//
// Поле знамени — цвет стороны (`side.ts`: наши в золоте, чужие в красном), на поле — щит герба стороны во всех его
// красках: наш — герб державы, который игрок собрал в профиле; сосед-игрок — его герб из реестра; логово — свой герб по
// номеру; разбойники без логова — топоры на чёрном (`heraldry/arms.BANDIT_ARMS`). Стая знамён не носит.
//
// Рисунок герба один на игру (`heraldry/art`): щиты обеих сторон печёт холст (`heraldry/paint`) в одну текстуру из двух
// клеток — наша слева, их справа, — и полотнище берёт свою клетку. Прежде гербы были фигурами в шейдере (башня и топоры):
// набор из пятнадцати фигур, делений и семи красок шейдером не нарисовать.
//
// Модуль без three: его читает и слой игры (`ui/battle/coats.ts`), текстуру печёт `banners.ts`.
//
// Какой герб у чужих, решает зовущий по записи и донесению (`ui/battle/coats.ts`): показ мира не читает.
import type { Side } from '@/battle/types';
import { BANDIT_ARMS, DEFAULT_ARMS, armsCode } from '@/heraldry/arms';
import { ARMS_ASPECT } from '@/heraldry/paint';

/** Гербы сторон боя строками (`heraldry/arms.armsCode`). */
export type SideCoats = Record<Side, string>;

/** Гербы без знания о сторонах (стенд, старая запись): наш — прежняя башня, чужие — разбойники. */
export const coatsFor = (us: Side, ours: string = armsCode(DEFAULT_ARMS), foe: string = armsCode(BANDIT_ARMS)): SideCoats =>
  (us === 'attacker' ? { attacker: ours, defender: foe } : { attacker: foe, defender: ours }) as SideCoats;

/** Тёмная краска знака рода на золоте и светлая — на красном (линейный свет сцены, три числа). */
export const CHARGE_DARK = 0x2b2219;
export const CHARGE_LIGHT = 0xeee3c8;

/**
 * Окно щита на полотнище в долях `uv` (вверх — +v): высота — 0.56 полотнища, ширина — по пропорции щита на полотнище
 * 1.15 × 1.5 м (`banners.CLOTH_W`, `CLOTH_H`), по середине.
 */
const BOX_H = 0.56;
const BOX_W = (BOX_H * 1.5) / ARMS_ASPECT / 1.15;
export const COAT_BOX = { x0: 0.5 - BOX_W / 2, w: BOX_W, y0: 0.37, h: BOX_H } as const;
