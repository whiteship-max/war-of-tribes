// Агенты на карте: четыре разных человека, узнаваемых силуэтом.
//
// Устроено ровно как отряды (`party.ts`), и по той же причине — **закон кадра**:
// чистая часть (`agentKey`, `agentBucket`, `agentUnit`, `fanOffsets`,
// `lineAt`) без canvas, выпечка (`bakeAgent`) на смене вида,
// направления и корзины, кадр — один `drawImage` на фигуру.
//
// ---------------------------------------------------------------------------
// Различаются **силуэтом**, а не цветом и не значком в одинаковом кружке.
//
// Раньше здесь стояли четыре одинаковых кружка с эмодзи внутри, и это ровно та
// ошибка, которую мы уже проходили на значках: цвет у нас занят стороной (свои —
// золото, чужие — красное, `palette.ts`), и вешать на него второе значение
// нельзя, а глиф в кружке на двадцати пикселях читается пятном. Поэтому все
// четыре — одного цвета, а различает их форма, и различает грубо, чтобы
// работать на самом мелком масштабе:
//
//   * разведчик — низкий, наклонён вперёд, **шире всего в шляпе**;
//   * дипломат — **колокол**: подол до земли, шире всего у ног;
//   * лазутчик — **уже всех** и завален назад: плащ в обтяжку и капюшон;
//   * полководец — **высокий**: широкие плечи, гребень на шлеме, меч у ноги.
//
// Проверка простая: если фигуру залить одной краской, четыре пятна обязаны
// остаться различимыми. Отсюда и запрет на «отличим лицом» или «отличим оружием
// в руке» — на двадцати пикселях этого нет.
//
// **Подписей под фигурами больше нет** (их убрали с полотна), и это подняло
// планку ровно здесь: имя закрывало остаток, который силуэт не добирал. Теперь
// не добирать нечего — совпадение пятен меряется числом (`npm run map:report`,
// раздел «агенты»), тем же порогом `SAME`, каким меряются виды бойцов в
// трёхмерной сцене. Имя при этом никуда не делось: оно в панели агентов, в
// подсказке про фигуру в руке и в шапке меню приказов.
//
// Снаряжение, поза и вес — не украшение поверх силуэта, а то, чем фигурка
// отличается от значка: посох воткнут в землю, подол провисает, щит несёт цвет
// стороны, под ногами лежит тень со сгущением в точке опоры. Всё это работает
// на ближних корзинах и молча пропадает на дальних, ничего не ломая, — потому
// что опознание держится не на нём.
//
// Стороны у ключа выпечки нет, и это не упущение: чужих фигур на карте не
// бывает вовсе (мир отдаёт только своих агентов), а писать код под сторону,
// которой нет, — это заводить вторую правду заранее.
import type { FigureId } from '@/world/types';
import { PARTY_OWN } from './palette';
import { SQUASH, TAU } from './village';

type C = CanvasRenderingContext2D;

// ---------- Чистая часть ----------

export interface AgentLook {
  kind: FigureId;
  /** Идёт влево: силуэт печётся зеркально. У стоящего всегда `false`. */
  west: boolean;
}

export const agentKey = (l: AgentLook, bucket: number, dpr: number): string =>
  `${l.kind}|${l.west ? 1 : 0}|${bucket}|${dpr}`;

/**
 * Корзины размера — в **экранных** пикселях на клетку, и лестница у них своя, не
 * та, что у отрядов. Причина: агент обязан быть виден и на пиксельном обзоре,
 * где клетка `SCALE_OVERVIEW` пикселей, а отряд там сходится к наконечнику хода. Поэтому
 * агент рисуется не «в долях клетки», а в долях `agentUnit` — клетки,
 * прижатой к разумному разбегу.
 */
export const AGENT_BUCKETS: number[] = [30, 38, 48, 60];

export const AGENT_MIN = AGENT_BUCKETS[0];
export const AGENT_MAX = AGENT_BUCKETS[AGENT_BUCKETS.length - 1];

/**
 * Во сколько пикселей рисовать агента при таком масштабе. Отдалили карту —
 * фигура не тает вместе с землёй: она и есть то, ради чего на карту смотрят.
 * Приблизили — не раздувается в полэкрана.
 */
export const agentUnit = (scale: number): number => Math.max(AGENT_MIN, Math.min(AGENT_MAX, scale));

export function agentBucket(px: number): number {
  for (const b of AGENT_BUCKETS) if (b >= px) return b;
  return AGENT_MAX;
}

/**
 * Фигуры, стоящие на одной клетке, разводятся в стороны — иначе четверо дома
 * рисуются друг в друге и видно одного. Возвращает смещение каждой в долях
 * `agentUnit`, симметрично относительно клетки; одиночка не смещается вовсе.
 *
 * Ключ — клетка, а не экранная точка: разъезжаться и съезжаться от щипка фигуры
 * не должны.
 */
export function fanOffsets(cells: string[]): number[] {
  const total = new Map<string, number>();
  for (const c of cells) total.set(c, (total.get(c) ?? 0) + 1);
  const seen = new Map<string, number>();
  return cells.map((c) => {
    const n = total.get(c) ?? 1;
    const i = seen.get(c) ?? 0;
    seen.set(c, i + 1);
    return n === 1 ? 0 : (i - (n - 1) / 2) * FAN_STEP;
  });
}

/**
 * Шаг разведения. Шире самой фигуры (`SPAN_W`) — и это тест: силуэты не должны
 * касаться друг друга, потому что с уходом подписей соседство стало единственным,
 * что мешает узнать каждого по форме.
 */
export const FAN_STEP = 0.78;

// ---------- Габариты ----------

/**
 * Спрайт занимает 0.72×1.0 единицы, точка привязки — та, где агент стоит на
 * земле. Вверх места больше: там гребень, шляпа и навершие меча; вширь — плащ
 * за спиной, посох впереди и подол дипломата.
 */
export const SPAN_W = 0.72;
export const SPAN_H = 1.02;
export const ANCHOR_X = 0.36;
export const ANCHOR_Y = 0.92;

export interface AgentSprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  ax: number;
  ay: number;
  /** Единица, под которую выпечено: копию растягивают из неё. */
  unit: number;
}

// ---------- Кисти ----------

const P = PARTY_OWN;

/**
 * Толщина контура в долях единицы. Считается от корзины, а не стоит числом:
 * постоянная доля на нижней корзине даёт полпикселя, и силуэт распадается ровно
 * там, где контур нужнее всего, — а он и есть то, чем фигура держится на мелком
 * масштабе. Внизу лестницы он поэтому толще **в долях** и остаётся тем же
 * волоском **на экране**.
 *
 * Считается один раз при выпечке и дальше едет вниз параметром: спрятать его в
 * переменную модуля нельзя — кисть, зависящая от того, кто её позвал последним,
 * это вторая правда о толщине.
 */
export const lineAt = (unit: number): number => Math.max(0.018, 0.85 / unit);

/**
 * Пятно на земле — оно и даёт вес. Два эллипса, а не один: широкий говорит, что
 * фигура стоит на земле, узкий под самыми ногами — что она к ней прижата. Оба
 * уходят вправо-вниз, потому что свет у нас слева-сверху, как у поселений
 * (`village.shadow`): тень ровно под фигурой читается подставкой, а не тенью.
 */
function ground(ctx: C, x: number, r: number): void {
  ctx.fillStyle = P.shade;
  ctx.beginPath();
  ctx.ellipse(x + r * 0.2, 0.01, r, r * SQUASH * 0.5, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + r * 0.06, 0, r * 0.5, r * SQUASH * 0.28, 0, 0, TAU);
  ctx.fill();
}

/** Контур: он держит силуэт там, где фигура мельче двадцати пикселей. */
function outline(ctx: C, L: number): void {
  ctx.strokeStyle = P.line;
  ctx.lineWidth = L;
  ctx.stroke();
}

/** Заливка со своим контуром — четыре пятых всей фигуры собраны из неё. */
function shape(ctx: C, fill: string, L: number): void {
  ctx.fillStyle = fill;
  ctx.fill();
  outline(ctx, L);
}

function head(ctx: C, x: number, y: number, r: number, fill: string, L: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  shape(ctx, fill, L);
}

/** Конечность одним росчерком: на этом размере она и есть вся анатомия. */
function limb(ctx: C, x0: number, y0: number, x1: number, y1: number, w: number, color = P.line): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/**
 * Разведчик: низкий, наклонён вперёд, широкополая шляпа. Шляпа и есть его
 * силуэт — единственная фигура, которая шире всего в голове.
 *
 * Всё остальное — снаряжение ходока: посох воткнут впереди и держит наклон,
 * короткий плащ отброшен за плечо, ремень сумки идёт через грудь. Ни одна из
 * этих подробностей не опознаёт его в одиночку и не должна: на двадцати
 * пикселях их нет, а шляпа есть.
 *
 * Три вещи здесь стоят так, как стоят, и трогать их нельзя. Посох — **перед**
 * ним, а не наискось через корпус: поперёк тела он склеивался с ногами в
 * треногу, и разведчик читался этюдником. Плащ — короткий и прижат к спине:
 * длинный отлетал крылом, и крыло было первым, что видел глаз. И посох, и плащ
 * при этом **близко к телу**: вынесенные, они вместе делали корпус шире шляпы —
 * то есть отбирали у разведчика его собственный признак, и стенд это ловил
 * (`npm run map:report`, столбец «шляпа@»).
 */
function scout(ctx: C, dir: number, L: number): void {
  ground(ctx, 0, 0.155);
  const lean = dir * 0.06;

  // Посох раньше тела: он воткнут впереди, а не лежит на груди. Наклонён назад —
  // на него опираются, а не несут его.
  limb(ctx, dir * 0.19, 0.02, dir * 0.132, -0.55, L * 1.8, P.shaft);

  // Плащ за плечом: он **висит**, а не растопырен. Треугольник, отлетающий в
  // сторону, читался флагом на палке, и флаг был первым, что видел глаз.
  ctx.beginPath();
  ctx.moveTo(-dir * 0.022, -0.42);
  ctx.lineTo(-dir * 0.1, -0.4);
  ctx.lineTo(-dir * 0.125, -0.155);
  ctx.lineTo(-dir * 0.045, -0.185);
  ctx.closePath();
  shape(ctx, P.clothDark, L);

  // Шаг: передняя нога вынесена, задняя отстала.
  limb(ctx, lean * 0.4, -0.2, dir * 0.11, -0.005, L * 2);
  limb(ctx, lean * 0.4, -0.2, -dir * 0.098, -0.02, L * 2);

  // Короткая куртка, а не плащ: он ходит быстро и налегке. Талия у неё уже
  // плеч — прямая коробка читается мешком, а не человеком.
  ctx.beginPath();
  ctx.moveTo(-0.095, -0.175);
  ctx.lineTo(-0.075, -0.29);
  ctx.lineTo(lean - 0.092, -0.425);
  ctx.lineTo(lean + 0.092, -0.425);
  ctx.lineTo(0.075, -0.29);
  ctx.lineTo(0.095, -0.175);
  ctx.closePath();
  shape(ctx, P.cloth, L);
  ctx.beginPath();
  ctx.moveTo(dir * 0.022, -0.175);
  ctx.lineTo(dir * 0.02, -0.29);
  ctx.lineTo(lean + dir * 0.018, -0.425);
  ctx.lineTo(lean + dir * 0.092, -0.425);
  ctx.lineTo(dir * 0.075, -0.29);
  ctx.lineTo(dir * 0.095, -0.175);
  ctx.closePath();
  ctx.fillStyle = P.clothDark;
  ctx.fill();

  // Пояс и ремень сумки: две тёмные черты, которые разбивают куртку и не дают
  // ей стать пятном.
  limb(ctx, -0.08, -0.272, 0.08, -0.272, L * 1.3, P.shaft);
  limb(ctx, lean + dir * 0.07, -0.412, -dir * 0.06, -0.275, L * 1.2, P.shaft);

  // Рука к посоху: она и объясняет, почему посох стоит именно там.
  limb(ctx, lean + dir * 0.05, -0.39, dir * 0.14, -0.33, L * 1.7);

  head(ctx, lean * 1.2, -0.468, 0.05, P.tent, L);

  // Шляпа в два тона: поля тёмные, тулья светлая. Одним эллипсом она читалась
  // блином на палке — тулья и делает из блина шляпу. Поля сидят **выше**
  // макушки: надвинутые на неё, они срезали голову, и под шляпой не оставалось
  // лица.
  ctx.beginPath();
  ctx.moveTo(lean * 1.2 - 0.062, -0.532);
  ctx.quadraticCurveTo(lean * 1.2, -0.625, lean * 1.2 + 0.062, -0.532);
  ctx.closePath();
  shape(ctx, P.cloth, L);
  ctx.beginPath();
  ctx.ellipse(lean * 1.2, -0.528, 0.192, 0.038, 0, 0, TAU);
  shape(ctx, P.clothDark, L);
}

/**
 * Дипломат: подол до земли, шире всего у ног. **Ног не видно вовсе** — и это не
 * поза, а единственный признак, которого нет больше ни у кого: он не ходит, он
 * приезжает. Свиток поперёк груди и пелерина на плечах — всё, что на нём есть.
 */
function diplomat(ctx: C, dir: number, L: number): void {
  ground(ctx, 0, 0.195);

  // Подол колоколом, и низ у него провисает дугой: прямой срез читался конусом,
  // то есть шатром, а не одеждой.
  ctx.beginPath();
  ctx.moveTo(-0.25, -0.012);
  ctx.quadraticCurveTo(-0.19, -0.26, -0.088, -0.475);
  ctx.lineTo(0.088, -0.475);
  ctx.quadraticCurveTo(0.19, -0.26, 0.25, -0.012);
  ctx.quadraticCurveTo(0, 0.062, -0.25, -0.012);
  ctx.closePath();
  shape(ctx, P.cloth, L);

  // Теневая половина подола: объём без градиента — градиент дорог и при выпечке.
  ctx.beginPath();
  ctx.moveTo(dir * 0.028, 0.034);
  ctx.lineTo(dir * 0.026, -0.475);
  ctx.lineTo(dir * 0.088, -0.475);
  ctx.quadraticCurveTo(dir * 0.19, -0.26, dir * 0.25, -0.012);
  ctx.quadraticCurveTo(dir * 0.145, 0.046, dir * 0.028, 0.034);
  ctx.closePath();
  ctx.fillStyle = P.clothDark;
  ctx.fill();

  // Две складки: они и говорят, что это ткань, а не колокол из жести.
  limb(ctx, -0.09, -0.35, -0.152, -0.025, L * 1.1, P.clothDark);
  limb(ctx, 0.09, -0.35, 0.152, -0.025, L * 1.1, P.clothDark);

  // Свиток: светлая поперечина с тёмными кистями рук по краям. Горизонталь на
  // вертикальном силуэте видна раньше, чем разбирается, что это.
  limb(ctx, -0.1, -0.33, 0.1, -0.33, L * 2.6, P.tent);
  limb(ctx, -0.105, -0.33, -0.092, -0.33, L * 3.1, P.shaft);
  limb(ctx, 0.092, -0.33, 0.105, -0.33, L * 3.1, P.shaft);

  // Пелерина: она даёт плечи, без которых колокол остаётся колоколом, а не
  // человеком в одежде до земли.
  ctx.beginPath();
  ctx.moveTo(-0.152, -0.43);
  ctx.quadraticCurveTo(0, -0.362, 0.152, -0.43);
  ctx.lineTo(0.102, -0.518);
  ctx.lineTo(-0.102, -0.518);
  ctx.closePath();
  shape(ctx, P.clothDark, L);

  head(ctx, 0, -0.552, 0.054, P.tent, L);

  // Шапка с валиком: плоская и широкая. Она держит верх силуэта и не даёт
  // колоколу сойтись кверху в точку — тогда он читался бы шатром лагеря.
  ctx.beginPath();
  ctx.ellipse(0, -0.6, 0.056, 0.032, 0, 0, TAU);
  shape(ctx, P.clothDark, L);
  ctx.beginPath();
  ctx.ellipse(0, -0.582, 0.088, 0.028, 0, 0, TAU);
  shape(ctx, P.clothDark, L);
}

/**
 * Лазутчик: узкий и завален назад. Плащ в обтяжку до колен, капюшон надвинут
 * вместо головы, шеи нет. Самая маленькая фигура из четырёх — он и должен
 * теряться взглядом.
 *
 * Капюшон **округлый, с коротким козырьком вперёд**, а не конус. Конус читался
 * колпаком: остриё выше плеч вдвое перевешивало всю остальную фигуру, и
 * лазутчик выходил не скрытным, а ряженым. Узость и наклон он держит и без
 * острия — и держит их лучше, потому что теперь у него есть плечи.
 *
 * Ноги из-под плаща видны нарочно: без них он сводился к треугольнику и на
 * мелком масштабе сходился с дипломатом. Теперь их разводит и это — у одного
 * подол до земли и ног нет вовсе, у другого голенища и плащ выше колена.
 */
function spy(ctx: C, dir: number, L: number): void {
  ground(ctx, 0, 0.125);

  // Хвост плаща по земле за спиной — он и делает силуэт несимметричным.
  ctx.beginPath();
  ctx.moveTo(-dir * 0.05, -0.31);
  ctx.lineTo(-dir * 0.225, -0.005);
  ctx.lineTo(-dir * 0.025, -0.11);
  ctx.closePath();
  shape(ctx, P.clothDark, L);

  // Ноги: тонкие, шаг короткий. Он крадётся, а не идёт.
  limb(ctx, -dir * 0.008, -0.19, -dir * 0.058, -0.005, L * 1.7);
  limb(ctx, dir * 0.034, -0.19, dir * 0.076, -0.005, L * 1.7);

  // Плащ в обтяжку, до колен и завален назад: плечи уже подола, но и то и
  // другое вдвое уже дипломата.
  ctx.beginPath();
  ctx.moveTo(-dir * 0.098, -0.17);
  ctx.lineTo(-dir * 0.072, -0.415);
  ctx.lineTo(dir * 0.056, -0.435);
  ctx.lineTo(dir * 0.088, -0.16);
  ctx.closePath();
  shape(ctx, P.clothDark, L);

  // Подбой плаща — единственная полоса цвета стороны на нём. Тёмная фигура без
  // неё читается чужой: цвет у нас и есть сторона.
  ctx.beginPath();
  ctx.moveTo(dir * 0.056, -0.435);
  ctx.lineTo(dir * 0.088, -0.16);
  ctx.lineTo(dir * 0.04, -0.166);
  ctx.lineTo(dir * 0.024, -0.43);
  ctx.closePath();
  ctx.fillStyle = P.cloth;
  ctx.fill();

  // Нож у пояса: короткий блик поперёк плаща. Он и говорит, что этот идёт не с
  // письмом.
  limb(ctx, -dir * 0.028, -0.285, -dir * 0.098, -0.225, L * 1.4, P.steel);

  // Капюшон: округлый затылок, козырёк надвинут вперёд и вниз.
  ctx.beginPath();
  ctx.moveTo(-dir * 0.086, -0.395);
  ctx.quadraticCurveTo(-dir * 0.1, -0.555, dir * 0.012, -0.552);
  ctx.quadraticCurveTo(dir * 0.09, -0.535, dir * 0.076, -0.4);
  ctx.closePath();
  shape(ctx, P.clothDark, L);

  // Тень под капюшоном: лица нет и быть не должно.
  ctx.beginPath();
  ctx.ellipse(dir * 0.024, -0.452, 0.034, 0.03, 0, 0, TAU);
  ctx.fillStyle = P.mass;
  ctx.fill();
}

/**
 * Полководец: высокий, плечи широкие, гребень на шлеме, меч у ноги. Меч, а не
 * копьё, — нарочно: копья носит колонна за его спиной, и повторять её древко
 * значило бы потерять вожака в собственном войске.
 *
 * Щит **за спиной**, а не на груди: перед корпусом он съедал плечи, то есть
 * ровно тот признак, которым полководец и опознаётся. Из-за спины он выходит
 * половиной диска и работает наоборот — расширяет силуэт. Он же его знак
 * стороны: плащ у полководца тёмный, шлем и меч серые, и цвета на нём остаётся
 * меньше всех.
 *
 * Гребень — перо, заваленное назад, а не купол над шлемом: купол читался второй
 * головой, а рост давал тот же. Перо и выше, и уже, и по нему видно, куда он
 * повёрнут.
 */
function general(ctx: C, dir: number, L: number): void {
  ground(ctx, 0, 0.185);

  // Плащ за спиной раньше всего: он лежит под фигурой и добавляет ей массы.
  // Висит от плеча до земли и книзу шире — треугольник, отброшенный вбок,
  // читался стягом, а стяг у нас носит колонна, и путать их нельзя.
  ctx.beginPath();
  ctx.moveTo(-dir * 0.05, -0.545);
  ctx.lineTo(-dir * 0.168, -0.512);
  ctx.lineTo(-dir * 0.215, -0.045);
  ctx.lineTo(-dir * 0.042, -0.095);
  ctx.closePath();
  shape(ctx, P.clothDark, L);

  // Щит из-за спины: половина диска. Внутреннюю половину закроет корпус,
  // нарисованный следом, — так он и читается щитом за плечом, а не блюдом.
  ctx.beginPath();
  ctx.ellipse(-dir * 0.148, -0.36, 0.078, 0.098, 0, 0, TAU);
  shape(ctx, P.cloth, L);
  ctx.beginPath();
  ctx.ellipse(-dir * 0.148, -0.36, 0.048, 0.062, 0, 0, TAU);
  ctx.strokeStyle = P.clothDark;
  ctx.lineWidth = L * 1.4;
  ctx.stroke();

  // Меч у ноги: клинок, крестовина, навершие. Крестовина и отличает его от
  // древка на десяти пикселях.
  limb(ctx, dir * 0.2, -0.02, dir * 0.198, -0.49, L * 1.7, P.steel);
  limb(ctx, dir * 0.148, -0.462, dir * 0.248, -0.462, L * 1.9, P.shaft);
  ctx.beginPath();
  ctx.arc(dir * 0.198, -0.525, 0.025, 0, TAU);
  shape(ctx, P.shaft, L);

  // Ноги расставлены и толще, чем у прочих: это и есть вес.
  limb(ctx, -0.066, -0.24, -0.103, 0, L * 2.3);
  limb(ctx, 0.066, -0.24, 0.103, 0, L * 2.3);

  // Плечи вдвое шире пояса: этим он и отличается от всех остальных. Талия
  // перехвачена — прямая трапеция от плеч до бёдер читалась ведром.
  ctx.beginPath();
  ctx.moveTo(-0.098, -0.21);
  ctx.lineTo(-0.086, -0.3);
  ctx.lineTo(-0.142, -0.45);
  ctx.lineTo(-0.166, -0.555);
  ctx.lineTo(0.166, -0.555);
  ctx.lineTo(0.142, -0.45);
  ctx.lineTo(0.086, -0.3);
  ctx.lineTo(0.098, -0.21);
  ctx.closePath();
  shape(ctx, P.cloth, L);
  ctx.beginPath();
  ctx.moveTo(dir * 0.028, -0.21);
  ctx.lineTo(dir * 0.026, -0.3);
  ctx.lineTo(dir * 0.03, -0.555);
  ctx.lineTo(dir * 0.166, -0.555);
  ctx.lineTo(dir * 0.142, -0.45);
  ctx.lineTo(dir * 0.086, -0.3);
  ctx.lineTo(dir * 0.098, -0.21);
  ctx.closePath();
  ctx.fillStyle = P.clothDark;
  ctx.fill();
  limb(ctx, -0.09, -0.262, 0.09, -0.262, L * 1.4, P.shaft);

  // Наплечники: две железные дольки, посаженные на концы плеч. Они и делают его
  // самым широким в плечах, а не просто самым высоким.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * 0.148, -0.524, 0.047, 0.033, s * 0.3, 0, TAU);
    shape(ctx, P.steel, L);
  }

  head(ctx, 0, -0.618, 0.053, P.steel, L);

  // Гребень: он и делает силуэт выше всех прочих — на две головы выше
  // дипломата, и это видно даже там, где сам шлем уже пятно.
  ctx.beginPath();
  ctx.moveTo(dir * 0.044, -0.65);
  ctx.quadraticCurveTo(dir * 0.058, -0.778, -dir * 0.016, -0.845);
  ctx.quadraticCurveTo(-dir * 0.032, -0.775, -dir * 0.054, -0.646);
  ctx.closePath();
  shape(ctx, P.cloth, L);
}

// ---------- Выпечка ----------

export function bakeAgent(look: AgentLook, unit: number, dpr: number): AgentSprite {
  const w = SPAN_W * unit;
  const h = SPAN_H * unit;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext('2d');
  const sprite: AgentSprite = { canvas, w, h, ax: ANCHOR_X * unit, ay: ANCHOR_Y * unit, unit };
  if (!ctx) return sprite;

  const u = unit * dpr;
  ctx.setTransform(u, 0, 0, u, ANCHOR_X * u, ANCHOR_Y * u);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const dir = look.west ? -1 : 1;
  const L = lineAt(unit);
  switch (look.kind) {
    case 'scout':
      scout(ctx, dir, L);
      break;
    case 'diplomat':
      diplomat(ctx, dir, L);
      break;
    case 'spy':
      spy(ctx, dir, L);
      break;
    case 'general':
      general(ctx, dir, L);
      break;
  }
  return sprite;
}

const cache = new Map<string, AgentSprite>();
/** Четыре вида на два направления — восемь на корзине; дюжина держит и щипок. */
const CACHE_MAX = 12;

export function agentSprite(look: AgentLook, px: number, dpr: number): AgentSprite {
  const bucket = agentBucket(px);
  const key = agentKey(look, bucket, dpr);
  const have = cache.get(key);
  if (have) {
    cache.delete(key);
    cache.set(key, have);
    return have;
  }
  const made = bakeAgent(look, bucket, dpr);
  cache.set(key, made);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return made;
}

/** Кадр: одно копирование. cx, cy — где агент стоит на земле, в CSS-пикселях. */
export function drawAgent(ctx: C, look: AgentLook, px: number, dpr: number, cx: number, cy: number): void {
  const sp = agentSprite(look, px, dpr);
  const k = px / sp.unit;
  ctx.drawImage(sp.canvas, cx - sp.ax * k, cy - sp.ay * k, sp.w * k, sp.h * k);
}

export function dropAgents(): void {
  cache.clear();
}
