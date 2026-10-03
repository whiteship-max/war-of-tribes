/**
 * Цвет стороны — один на всю игру: **игрок — золото, враг — красный** (решение владельца 03.10.2026,
 * docs/battle_tw.md, раздел 12, вопрос 1).
 *
 * Лежит вне `ui/`, `render/` и `world/` нарочно, как `gestures.ts`: цвет стороны читают все трое — ролик боя
 * (фигуры, щиты, знамёна, полоса сверху, карточка итога — и прежний ролик, и ролик Total War), карта (армии,
 * значки, свои владения — через `RELATION_META` мира и палитры карты) и отчёт о бое (журнал «наши / они»). Волки
 * — враг, и они красные.
 *
 * Второй таблицы цвета стороны нет нигде. Тон под своё средство — приглушённый на карте, краска под светом сцены
 * боя, тень плаща — выводится отсюда функцией (`sideShade`, `sidePaint`), а не подбирается числом заново: так
 * через неделю «золото» карты и боя не разойдутся, как разошлись синий ролика и золото карты до этого решения
 * (тест `side.test.ts` держит, что шестнадцатеричных записей этих цветов вне двери нет).
 */

/** Цвет стороны: свои и чужие. Те же числа — цвет отношений «своё» и «враги» на карте (`RELATION_META`). */
export const SIDE_COLOR = { ours: '#e8a43c', foe: '#e06b5a' } as const;

export const sideColor = (ours: boolean): string => (ours ? SIDE_COLOR.ours : SIDE_COLOR.foe);

const channels = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const hexOf = (c: readonly number[]): string =>
  `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** Цвет стороны с прозрачностью `a` (0..1) — для холста: свечение своего двора, круг обзора своей фигуры. */
export const sideRgba = (ours: boolean, a: number): string => `rgba(${channels(sideColor(ours)).join(', ')}, ${a})`;

/** Цвет темнее в `k` раз по каждому каналу (0..1): тень плаща, теневая половина знамени. */
export const shade = (hex: string, k: number): string => hexOf(channels(hex).map((v) => v * k));

/** Теневая сторона цвета стороны — плащ в тени у отряда на карте: три четверти света. */
export const SIDE_SHADE = 0.75;
export const sideShade = (ours: boolean): string => shade(sideColor(ours), SIDE_SHADE);

/**
 * Краска стороны под светом сцены боя: цвет стороны, чуть темнее. Сцена освещена солнцем и небом и тонирована
 * (`render/lighting`), и чистое золото интерфейса на щите выгорает в жёлтое пятно; краска — тот же цвет на
 * пять шестых света. Число для three (`0xrrggbb`).
 */
export const SIDE_PAINT = 5 / 6;
export const sidePaint = (ours: boolean): number => parseInt(shade(sideColor(ours), SIDE_PAINT).slice(1), 16);

/**
 * Цвета стороны переменными CSS — для разметки, которая красит сторону своими правилами (журнал отчёта о бое, полоса
 * ролика): `var(--side-ours)`, `var(--side-foe)`. Кладутся на корень разметки свойством `style`.
 */
export const SIDE_VARS = { '--side-ours': SIDE_COLOR.ours, '--side-foe': SIDE_COLOR.foe } as Record<string, string>;
