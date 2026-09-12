/**
 * Сцена предыстории: поляна от первого лица.
 *
 * ВРЕМЕНИ ЗДЕСЬ ДВА, И ГРАНИЦА МЕЖДУ НИМИ ПРОХОДИТ РОВНО ПО ЭТОМУ ФАЙЛУ.
 *
 * Всё, что живёт в этом классе, живёт во **времени сцены** (`performance.now()`,
 * цикл кадров): шаг, поворот головы, замах топора, дрожь пламени, отсвет огня.
 * Ни одно из этих чисел не попадает в сохранение и не переживает выход — да и
 * незачем: игрок вернётся к костру, а не в середину замаха.
 *
 * Всё, что выход переживает, лежит в `PrologueSave` и считается **на чтении**
 * из `serverNow()`: горение костра (`fire.ts`), голод и холод (`body.ts`),
 * зарастание пней (`glade.standing`), сам факт зверя на поляне и срок туши
 * (`hunt.ts`). Сцена их не накапливает и не тикает: каждый кадр она просто
 * **спрашивает** формулу. Поэтому кадр, пропущенный в фоне, ничего не стоит, а
 * двое суток без игры считаются тем же выражением, что и две секунды.
 *
 * Правило, которое из этого следует и которое нельзя размывать: **ни одна
 * величина не должна двигаться и там, и там.** Захочется завтра, чтобы костёр
 * разгорался от подкладывания на глазах, — разгораться будет картинка (высота
 * пламени, яркость света), а число дров останется формулой от времени. Как
 * только число начнут копить в кадре, оно разойдётся с формулой у первого же
 * игрока, свернувшего аппку.
 *
 * ТРИ РОДА МЕСТ, ГДЕ КАДР ВСЁ-ТАКИ КАСАЕТСЯ ЗАПИСИ, И ВСЕ — СОБЫТИЯМИ, А НЕ
 * ВЕЛИЧИНАМИ. Первое: человек пересёк круг — у костра или под крышей дома
 * (`warmth`); от этого зависит, растёт холод или убывает и с какой скоростью, и
 * пересечение закрывает отрезок ровно так же, как подложенные дрова. Второе:
 * стрела долетела (`arrowStep`) — полёт живёт в кадрах целиком, а записью
 * становится одна точка, куда она воткнулась. Третье: волк укусил (`wolfStep`).
 * Во всех случаях кадр только **замечает мгновение**; считает по-прежнему
 * формула, и пересчитать тот же промежуток по частям — значит получить то же
 * число (`body.test.ts`).
 *
 * ОДНА ЖИВАЯ СЦЕНА, ОДИН КОНТЕКСТ WEBGL. Диорама деревни на время предыстории
 * не приостанавливается, а **снимается целиком**: `Prologue.tsx` не рисует
 * `GameCanvas`, тот убирает за собой (`TribeScene.dispose`) и отдаёт контекст.
 * Иначе их было бы два, и на телефоне это кончилось бы тем, что браузер молча
 * отобрал бы старший. По той же причине канву заводит код, а не разметка:
 * отданный контекст элемент не отпускает (подробно — в `ui/GameCanvas.tsx`).
 */
import * as THREE from 'three';
import {
  applyDayNight,
  configureRenderer,
  configureSky,
  createLightRig,
  fitShadow,
  type LightRig,
} from '@/render/lighting';
import { PALETTE } from '@/render/palette';
import { SeasonVisuals } from '@/render/season';
import { Smoke, type SmokeLook } from '@/render/weather';
import { disposeGeometries } from '@/render/kit';
import { swallowGhostClick } from '@/gestures';
import { gestLog } from '@/gestlog';
import { serverNow } from '@/net/clock';
import { wolfHowl } from '@/sound/howl';
import { Keys, KEY_BOW, PITCH_LIMIT, STICK_FULL, Sticks, mergeWalk, typing, type Walk } from './controls';
import {
  BODY_R,
  CHOPS_TO_FELL,
  CHOP_MS,
  EYE,
  FIRE,
  GLADE_R,
  GUEST_FROM,
  HOUSE,
  HOUSE_SHELTER_R,
  MATE_R,
  MATE_SPOT,
  REACH,
  SON_HOUSE,
  SON_SPOT,
  START,
  TENT,
  TREES,
  WALK_SPEED,
  blockers,
  byFire,
  byHouse,
  hash,
  nearest,
  slide,
  standing,
  yawTo,
  VIEW_V_MIN,
  viewFov,
  type Spot,
} from './glade';
import { hearthFill, burnWords, burning, feed, keepHearth, logsTaken, spend } from './fire';
import {
  SPELL_MS,
  darkness,
  gloom,
  isNight,
  nextWeather,
  spellLeftMs,
  sunAt,
  weatherAt,
  weatherWords,
  type Weather,
} from './sky';
import { Dome, newTone, toneAt } from './dome';
import { Surfaces } from './surface';
import { ADDITIVE, BOY_LOOK, LOOKS, MOOD_BLINK, MOOD_CALM, MOOD_WARM, MOOD_WARY, RAIDER_LOOK, bake, glowCanvas, mix, sleeveCanvas, type Mood } from './paint';
import { RAIDER_HAND, arm as armModel, boy as boyModel, raider as raiderModel, setMood, skinOf, woman as womanModel, type Skin } from './people';
import {
  HOWL_LEAD_MS,
  WOLF_EDGE,
  WOLF_FIRE_R,
  WOLF_RUSH,
  WOLF_STALK_R,
  WOLF_STOP,
  WOLF_TROT,
  packAt,
  stalkAfterBite,
  wolfCanBite,
  wolfHit,
  wolfKeepsOut,
  wolfRushes,
  wolfSpot,
} from './wolves';
import {
  bite,
  newBody,
  draining,
  eat,
  fedFill,
  fedWords,
  harmAt,
  healing,
  healthFill,
  healthWords,
  hungerAt,
  setRoof,
  setWarm,
  warming,
  warmthFill,
  warmthWords,
  wearCoat,
  type Death,
} from './body';
import { pack as things, packKey, type Item } from './pack';
import {
  ARROWS_START,
  ARROW_SPEED,
  BUTCHER_MS,
  DEER_ALERT,
  DEER_CALM_MS,
  DEER_RUN,
  DEER_WALK,
  arrowByCarcass,
  carveArrows,
  deerSleeps,
  fleeRange,
  arrowHits,
  arrowLanding,
  deerHome,
  deerLive,
  landArrow,
  liveCarcass,
  nockArrow,
  pickArrow,
  type Pt,
} from './hunt';
import {
  ROAST_COST,
  bow as bowOffer,
  death,
  endTask,
  feedSon,
  logsFromTree,
  meal,
  offer,
  reach,
  roastCount,
  share,
  type Offer,
} from './act';
import {
  Precip,
  Shade,
  Sparks,
  arrow as arrowModel,
  axe as axeModel,
  blob,
  bow as bowModel,
  campfire,
  carcass as carcassModel,
  choppable,
  chopBlock,
  deer as deerModel,
  forest,
  frame as frameModel,
  gladeGround,
  groundShade,
  house as houseModel,
  stump,
  tent,
  undergrowth,
  wolf as wolfModel,
} from './models';
import { KIT_MEAT, revive as reviveSave, savePrologue, type PrologueSave } from './save';
import {
  BEAT,
  BOARDS,
  BUILD_NOTE,
  FAMILY_NOTE,
  FOE_HIT,
  FOE_HIT_GAP,
  FOE_REACH,
  FOE_WALK,
  PASS_AFTER_MS,
  RAIDERS,
  RAIDERS_MELEE,
  RAID_AWAY,
  RAID_FROM,
  RAID_NOTE,
  RAID_SAYS,
  RAID_STAND,
  SON_SAYS,
  SON_THANKS,
  WIFE_SAYS,
  WIFE_THANKS,
  beatFrom,
  beatOf,
  endBegins,
  endOn,
  familyDone,
  familyHere,
  frameDone,
  type Beat,
  type EndStage,
} from './end';
import { applyCheat } from './cheat';
import { CHEAT_NO, cheatOf } from '@/cheats';
import { ARROWS_PER_LOG, COAT_HIDES, buildTake, houseDone } from './craft';
import {
  GUESTS,
  GUEST_NO,
  LOVE_DAYS,
  SHARED,
  WIFE_YES,
  counts,
  guestHere,
  guestOf,
  heirName,
  lineage,
  love,
  loveFull,
  tally,
  welcome,
  wifeSays,
  type BondKind,
  type KinLine,
} from './kin';

/**
 * Что показывает надстройка над сценой. Пересобирается только когда меняется.
 *
 * Плоский набор чисел и строк, а не вложенные объекты, и не для красоты: сцена
 * сравнивает его с показанным на каждом кадре, чтобы не дёргать React
 * шестьдесят раз в секунду, — а сравнивать поле за полем можно только плоское.
 */
export interface PrologueView {
  /** Полнота очага, 0..1, и сколько ещё гореть — словами. */
  fireFill: number;
  fireWords: string;
  /** Сытость, 0..1: полоса запаса. */
  fedFill: number;
  fedWords: string;
  /** Тепло, 0..1: полоса запаса — уходит вдали от огня, возвращается у огня. */
  warmthFill: number;
  warmthWords: string;
  /** Греется ли прямо сейчас — надстройка красит полосу тепла иначе. */
  warming: boolean;
  /** Здоровье, 0..1, и что с ним — словами. */
  healthFill: number;
  healthWords: string;
  /** Тает ли здоровье: какая-то нужда пуста. Надстройка красит полосу тревогой. */
  draining: boolean;
  /** Заживает ли здоровье: ранен, в покое, нужды закрыты. */
  healing: boolean;
  /** Вещи — ровно то, что есть (`pack.ts`). */
  items: readonly Item[];
  /** Что предлагает то, рядом с чем стоим. */
  offer: Offer;
  /** Что предлагает лук: натянуть, пустить или почему нельзя. */
  shot: Offer;
  /** Еда: жареное и сырое, каждое своей кнопкой у мяса в вещах. */
  eatCooked: Offer;
  eatRaw: Offer;
  /** Ночь ли сейчас: надстройка приглушает свои цвета вместе с небом. */
  night: boolean;
  /** Что с погодой — словом. Пусто, когда ясно и портиться нечему. */
  weather: string;
  /** Сколько волков на поляне. Ноль — строки о них нет вовсе. */
  wolves: number;
  /** Натянут ли лук: по этому надстройка ставит перекрестье. */
  drawn: boolean;
  /** Что делаем и сколько раз осталось: рубка или разделка. Пусто — ничего. */
  busy: string;
  busyLeft: number;
  /** Жив ли человек. Не `null` — поверх всего встаёт экран с причиной. */
  dead: Death;
  /** Какая карточка открыта: гостья, жена, имя сына, родословная. Пусто — никакой. */
  panel: Panel;
  /** Кто у огня: гостья, жена или никого. */
  mate: '' | 'guest' | 'wife';
  /** Её имя и что она говорит сейчас. */
  mateName: string;
  mateSays: string;
  /** Любовь, 0..100 — выводится из дней общей жизни (`kin.love`). */
  love: number;
  /** Сколько дней засчитано по каждому делу; в счёт идёт не больше `LOVE_DAYS`. */
  meals: number;
  hugs: number;
  nights: number;
  woods: number;
  /** Засчитано ли дело в эти сутки поляны — карточка ставит отметку. */
  mealToday: boolean;
  hugToday: boolean;
  nightToday: boolean;
  woodToday: boolean;
  /** «Дать мясо»: можно ли и почему нет. */
  give: Offer;
  /** Родословная — ровно те строки, что есть (`kin.lineage`). */
  lineage: readonly KinLine[];
  /** Строка поверх сцены: встреча, ответ, новость. Пусто — ничего. */
  note: string;
  /** Идёт ли объятие: надстройка прячет кнопки, пока камера под крышей. */
  hugging: boolean;
  /** На какой ступени финал (`end.ts`). `none` — обычная поляна. */
  end: EndStage;
  /** Что игрока просят сделать сейчас. Пусто — не просят ничего. */
  task: string;
  /** Имя сына: его зовут и в карточке, и на последнем экране. */
  sonName: string;
  /** Смотрит ли игрок последнюю сцену: надстройка убирает всё, кроме неё. */
  watching: boolean;
  /** Помечена ли поляна кодами (`src/cheats.ts`). */
  cheated: boolean;
}

/**
 * Какая карточка открыта над сценой: разговор, родословная или вещи. Одна за раз.
 * Время сцены: выход из режима её не помнит.
 */
export type Panel = '' | 'guest' | 'wife' | 'name' | 'kin' | 'pack' | 'son' | 'raid';

/**
 * Как часто перекладывается свет.
 *
 * ЧАСЫ НА ПОЛЯНЕ ТЕПЕРЬ ИДУТ, и `applyDayNight` зовётся не один раз, а по мере
 * хода круга. Каждый кадр звать его незачем: он раскладывает лампы и переливает
 * четыре цвета, а круг суток длиной в четыре минуты за кадр проходит три
 * десятитысячных. Две тысячных — это полсекунды хода: на глаз незаметно, а
 * работы в двести раз меньше.
 *
 * Порог второй, по хмурости: небо темнеет перед непогодой быстрее, чем ходит
 * солнце, и ждать от него полсекунды нельзя.
 */
const SKY_STEP = 0.002;
const GLOOM_STEP = 0.015;

/**
 * Туман поляны: где начинается и где добирает цвет.
 *
 * ДЫМКА — ЭТО ГЛУБИНА. Начинается она сразу за поляной и добирает цвет горизонта
 * к краю земли: ближний ряд леса остаётся лесом, второй синеет, третий уходит в
 * небо, — и стена в восемь метров читается чащей, а не декорацией. Цвет у неё —
 * неба над кромкой леса (`dome.haze`), поэтому лес не упирается в небо краем, а
 * растворяется в нём. Сама поляна (13 м) в дымку не попадает.
 *
 * `WET` — то же в дождь. Видно в дождь заметно хуже, и это единственное, чем
 * непогода трогает даль помимо капель: серое небо и близкий край видимости
 * читаются ненастьем сразу, без единого слова на экране.
 */
const FOG_NEAR = 12;
const FOG_FAR = 50;
const FOG_NEAR_WET = 6;
const FOG_FAR_WET = 30;

/**
 * Снег на ветках и мокрая земля: за сколько набираются и сходят.
 *
 * Картинка, а не величина: сколько снега лежит, выводится из того, сколько идёт
 * снегопад (`sky.spellLeftMs`), и в сохранение не попадает. Снег ложится за
 * полминуты и сходит за минуту после; земля мокнет быстрее, чем сохнет.
 */
const SNOW_GROW_MS = 30_000;
const SNOW_MELT_MS = 60_000;
const WET_GROW_MS = 12_000;
const WET_DRY_MS = 70_000;

/**
 * Сколько снега лежит на ветках и крышах зимой без снегопада.
 *
 * Не весь: снегопад обязан быть виден и тем, что ветки белеют сильнее, — иначе
 * между «идёт снег» и «лежит снег» не было бы разницы нигде, кроме хлопьев.
 */
const WINTER_SNOW = 0.6;

/**
 * С какого тепла кадр подёргивается инеем и до какого инея доходит.
 *
 * Иней — картинка из полосы тепла, а не своя величина: сцена переводит в него то
 * же число, что стоит на полосе. С семи десятых тепла он появляется у краёв, к
 * одной десятой закрывает края кадра целиком, а середину не трогает никогда —
 * сквозь иней надо видеть, куда идёшь. Пришедший к огню замёрзшим застаёт его с
 * первого кадра вполсилы: первой версией при четырёх десятых тепла его на снимке
 * было не разглядеть, и «холод давит сразу» держалось одной полосой.
 */
const FROST_FROM = 0.7;
const FROST_FULL = 0.1;

/** С какой любви у жены тёплое лицо. Сама любовь считается в `kin.love`, здесь только порог показа. */
const WARM_FROM = 60;

/** Раз в сколько миллисекунд женщина моргает и сколько длится моргание. */
const BLINK_EVERY = 3900;
const BLINK_MS = 140;

/** За сколько секунд непогода набирает и отпускает силу. Рывком читалась бы сбоем. */
const WET_FADE = 2.4;

/**
 * Чем серится небо в ненастье: у дождя и у снега своё.
 *
 * Цвет из палитры, а не «по месту»: это правило всей графики игры, и погода —
 * не повод его обойти. Первой версией небо в обе непогоды тянулось к дыму — и
 * дождливое небо на снимке вышло **светлее** погожего, то есть читалось не
 * ненастьем, а туманным утром. Дождю нужен тёмный камень, снегу — светлый дым:
 * снежное небо и правда белёсое.
 */
const RAIN_TINT = new THREE.Color(PALETTE.stoneDark);
const SNOW_TINT = new THREE.Color(PALETTE.smoke);

/** Куда светит лампа рига — купол красит небо вокруг этого направления. */
const SUN_DIR = new THREE.Vector3();

/**
 * С какой глубины ночи у волков горят глаза.
 *
 * Треть — это сумерки: днём светящиеся глаза — нелепость, а ночью без них волк
 * на снимке оказался тёмным ящиком на тёмной траве. «Показать издалека» ночью
 * можно только светом, а свет у поляны один — отражённый глазами огонь.
 */
const EYES_FROM = 0.3;

/** Сколько ждать между воями и насколько разбрасывать этот срок. */
const HOWL_GAP_MS = 14_000;
const HOWL_SPREAD_MS = 12_000;

/** Сколько поляны накрывает коробка теней. Ровно поляна: лес теней не отбрасывает. */
const SHADOW_HALF = 20;

/**
 * Отсвет костра: докуда достаёт, как быстро гаснет с расстоянием и во сколько
 * раз ярче ночью.
 *
 * НОЧЬЮ КОСТЁР — НАСТОЯЩИЙ СВЕТ, А НЕ ЛУЖА У НОГ. Прежний отсвет (дальность 14,
 * спад 1.6, ночью ×3.2) заливал землю в двух шагах от огня до жёлтого, а стволы в
 * семи метрах и стены дома в пяти оставались чёрными: огонь читался нарисованным.
 * Числа выведены из того, что должно быть видно, а не подобраны: у ног (полтора
 * метра) — около восьми десятых цвета поверхности, у лица женщины (три метра) —
 * треть, у деревьев поляны (семь с половиной) — десятая. Отсюда мягкий спад 1.25
 * и ночная прибавка втрое, а не яркость, выгорающая у самого огня.
 */
const FIRE_RANGE = 18;
const FIRE_DECAY = 1.25;
const FIRE_NIGHT = 2;

/**
 * Дым костра: свои размеры, а не общие с деревней.
 *
 * `FIRE_LOOK` рассчитан на камеру деревни — она в двадцати метрах, и клуб в
 * тридцать сантиметров там читается дымом. Здесь камера в трёх метрах от огня.
 * Клуб рисуется мягким пятном (`paint.glowCanvas`), а не квадратом: квадраты
 * висели по всему небу на первых снимках этой пачки. Пятно видно меньше своего
 * квадрата, отсюда и размер больше прежнего.
 */
const SMOKE_LOOK: SmokeLook = { size: 0.5, opacity: 0.16 };

/**
 * Куда тянет ветер: дым, искры и волну по кронам. Направление одно на поляну,
 * сила ходит порывами (`weatherStep`).
 */
const WIND_DIR = { x: 0.8, z: -0.6 };

/**
 * Руки игрока: куда от кулака уходит предплечье — к краю экрана, в осях камеры.
 *
 * Топор держат правой: локоть вниз, вправо и к себе. Лук — левой: опущенный держат
 * у бедра, натянутый — на вытянутой руке, и предплечье смотрит почти на камеру.
 * Числа подобраны снимками 375 px, как и места самих вещей.
 */
const ARM_AXE = { grip: [0, -0.005, 0.0], dir: [0.25, -0.9, 0.35], handle: [0, 0, -1] } as const;
const ARM_BOW_LOW = { dir: [-0.15, -0.95, 0.3] } as const;
const ARM_BOW_DRAWN = { dir: [-0.3, -0.55, 0.78] } as const;

/** Насколько поднимается и опускается голова при ходьбе, метры. */
const CAM_BOB = 0.025;

/**
 * Где топор лежит в покое — от него же считается и замах.
 *
 * Рукоять модели лежит вдоль −Z, лезвие у дальнего конца. Поворот по X на
 * +0.9 задирает лезвие вверх, по Y уводит его влево: получается топор, который
 * держат у правого плеча обухом от себя. Знак по X важен — при −0.9 лезвие
 * смотрит вниз, и в руке оказывается не топор, а молоток плашмя.
 */
const AXE_REST = { x: 0.22, y: -0.52, z: -0.95, rx: 0.9, ry: 0.35, rz: 0.2 };

/** Насколько уменьшен топор в руке при прежних 72°; шире угол — на `viewK` больше. */
const AXE_SCALE = 0.62;

/** Где рука висит на вещи: место, поворот и размер в осях самой вещи. */
type ArmPose = { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 };

/**
 * Посадить руку на вещь.
 *
 * Считается один раз, в осях вещи, из того, как вещь лежит в осях камеры: кулак —
 * на месте хвата (`grip`, в осях вещи), предплечье — вдоль `dir` (в осях камеры, к
 * краю экрана), ручка проходит сквозь кулак вдоль `handle` (в осях вещи). Дальше
 * рука — ребёнок вещи и ходит вместе с ней: замах топора уводит и руку.
 */
function armPose(
  rest: { x: number; y: number; z: number; rx: number; ry: number; rz: number },
  scale: number,
  grip: readonly number[],
  dir: readonly number[],
  handle: readonly number[],
): ArmPose {
  const item = new THREE.Matrix4().compose(
    new THREE.Vector3(rest.x, rest.y, rest.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rest.rx, rest.ry, rest.rz)),
    new THREE.Vector3(scale, scale, scale),
  );
  const at = new THREE.Vector3(grip[0], grip[1], grip[2]).applyMatrix4(item);
  const along = new THREE.Vector3(handle[0], handle[1], handle[2]).transformDirection(item);
  const elbow = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize().add(at);
  const m = new THREE.Matrix4().lookAt(elbow, at, along).setPosition(at);
  const pose: ArmPose = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
  item.invert().multiply(m).decompose(pose.p, pose.q, pose.s);
  return pose;
}

/**
 * Лук в левой руке: опущенный и натянутый.
 *
 * Числа той же природы, что у топора, и подобраны тем же способом — на экране
 * 375×812 при прежних 72°, где по горизонтали оставалось ±18.5°; при нынешнем
 * угле они раздвинуты на `viewK`, как у топора. Опущенный лук стоит у левого
 * края и повёрнут плашмя; натянутый выходит к середине и встаёт прямо, но не в
 * саму середину: перекрестье должно остаться видно, а рука — не заслонить
 * зверя, в которого целятся.
 */
const BOW_LOW = { x: -0.26, y: -0.46, z: -0.86, rx: 0.15, ry: 0.5, rz: 0.85 };
const BOW_DRAWN = { x: -0.125, y: -0.12, z: -0.70, rx: 0, ry: 0.85, rz: 0.04 };

/** За сколько миллисекунд лук выходит из опущенного в натянутый. Время сцены. */
const DRAW_MS = 260;

/**
 * Насколько уменьшен лук в руке.
 *
 * Меньше топора, и не по прихоти: топор висит сбоку и заслоняет угол, а
 * натянутый лук выходит к середине — туда, где игрок целится. Дуга в полэкрана
 * закрывала бы собой зверя, ради которого её и подняли.
 */
const BOW_SCALE = 0.38;

/** Как часто складываем на диск. Записывать каждый кадр незачем: пара чисел. */
const SAVE_EVERY = 4000;

/**
 * Как часто пересобирается надпись надстройки.
 *
 * Не каждый кадр, и это замер, а не бережливость: `snapshot` строит четыре
 * предложения и три строки со сроками, то есть с десяток мелких объектов
 * шестьдесят раз в секунду. На телефоне это стоило кадров — медиана уезжала за
 * шестнадцать и семь.
 *
 * Ждать при этом нечего: **всё, что случается по воле игрока, зовёт `refresh`
 * само** — взял, срубил, положил, натянул, съел. Через этот промежуток видно
 * только то, что меняется от времени и от шага: полосы (у них шаг в часы) и
 * надпись на кнопке, когда подошёл к новому предмету. Восьмая доля секунды на
 * это — не задержка, а незаметность.
 */
const VIEW_EVERY = 120;

/** Сколько идёт объятие, миллисекунды. Время сцены целиком. */
const HUG_MS = 3200;

/**
 * Доли объятия: когда гаснет кадр, когда камера под крышей, когда виден знак.
 *
 * Затемнение закрывает оба перескока камеры — из-под неба под крышу и обратно:
 * переезд на глазах читался бы сбоем картинки, а не приёмом. Взгляд к потолку
 * поднимается уже под крышей, плавно, — это и есть «камера уходит вверх».
 */
const HUG = {
  dim: 0.08,
  cutIn: 0.18,
  clear: 0.28,
  up: 0.46,
  heartIn: 0.4,
  heartOut: 0.74,
  redim: 0.76,
  cutOut: 0.86,
  back: 0.96,
};

/** Докуда поднимается взгляд под крышей: на фронтон и сходящиеся над ним скаты. */
const HUG_PITCH = 0.8;

/** На какой высоте под крышей камера: ниже глаз стоящего — в доме сидят. */
const HUG_EYE = 1.2;

/**
 * На сколько камера отступает от середины дома к одному фронтону — лицом к другому.
 *
 * ЛИЦОМ ВДОЛЬ КОНЬКА, А НЕ ПОПЕРЁК, и это поймано снимком. Смотревшая поперёк
 * камера упиралась в один скат, и потолок выходил ровным коричневым полем, в
 * котором дома не узнать. Вдоль конька в кадре оба ската сходятся над головой, а
 * впереди стоит треугольник фронтона над венцами стены: это читается потолком.
 */
const HUG_BACK = 0.8;

/**
 * Насколько ярок отсвет огня под крышей на время объятия.
 *
 * Своё число, а не отсвет костра как есть: с ним снимок вышел тёмным полем, в
 * котором скаты и фронтон едва различимы, — до кровли свет доходит ослабленным
 * расстоянием. С этим числом видно, что над головой потолок.
 */
const HUG_GLOW = 7;

/** Сколько висит строка поверх сцены. Время сцены: выход её не помнит. */
const NOTE_MS = 6500;

/** Шаг женщины, м/с. Спокойный: она пришла, а не бежит. */
const MATE_WALK = 1.1;

/** С какого расстояния она оборачивается к подошедшему и перестаёт хлопотать у огня. */
const MATE_NEAR = 4.5;

/**
 * Насколько дальше досягаемости карточка разговора ещё держится открытой.
 *
 * Шаг назад разговора не обрывает — обрывает уход. Без запаса карточка мигала бы
 * у самой границы досягаемости, пока палец чуть водит стик.
 */
const TALK_SLACK = 0.6;

/** Как то, до чего дотянулись, называется в журнале касаний. */
const SPOT_WORDS: Record<Spot['kind'], string> = {
  tree: 'дерево',
  fire: 'костёр',
  axe: 'топор',
  tent: 'палатка',
  carcass: 'туша',
  arrow: 'стрела',
  wolf: 'волк',
  house: 'дом',
  mate: 'женщина',
  son: 'сын',
  frame: 'дом сына',
  foe: 'разбойник',
};

/** Что делается руками и длится: рубка, разделка, шкура, замах в драке. */
type Work = 'chop' | 'butcher' | 'skin' | 'fight';

/** Что делает зверь. Живёт во времени сцены и никуда не пишется. */
type Beast = { x: number; z: number; yaw: number; homeX: number; homeZ: number; fleeUntil: number; fleeYaw: number; gait: number };

/**
 * Женщина в кадре. Целиком время сцены: в записи о ней имя и минута, а где она
 * стоит, куда смотрит и как наклонилась к огню, не переживает выхода.
 */
interface Figure {
  obj: THREE.Group;
  /** Тело с лицом: по нему меняется выражение (`people.setMood`). */
  body: THREE.Mesh | null;
  arms: THREE.Object3D | null;
  /** Пятно тени под ногами: наклон к огню оно не повторяет. */
  blob: THREE.Object3D | null;
  /** Которая это из гостий — по номеру облика. От него же её моргание. */
  seed: number;
  x: number;
  z: number;
  yaw: number;
  /** Наклон к огню: хлопочет — наклонилась, говорит — выпрямилась. */
  bend: number;
  /** Фаза шага. */
  gait: number;
}

/**
 * Волк в кадре. Тоже целиком время сцены: в записи о нём одно число, и то не о
 * нём, а о том, когда стаю отбили (`wolves.ts`, шапка).
 */
interface Wolf {
  obj: THREE.Group;
  legs: THREE.Object3D | null;
  /** Глаза: светятся ночью и только ночью. */
  eyes: THREE.Object3D | null;
  x: number;
  z: number;
  yaw: number;
  /** Куда он тянется, пока человек в безопасности: своё место у опушки. */
  homeX: number;
  homeZ: number;
  /** В какую сторону кружит: двое не должны идти ноздря в ноздрю. */
  spin: number;
  /** Фаза намёта. */
  gait: number;
}

/**
 * Пришедший из леса — в кадре.
 *
 * Целиком время сцены, как волк и как женщина: в записи о нём нет ни одного
 * поля. Где он стоит, куда идёт, ударил ли, положили ли его — всё это живёт
 * ровно столько, сколько открыт режим (`end.ts`, шапка).
 */
interface Foe {
  obj: THREE.Group;
  body: THREE.Mesh | null;
  arms: THREE.Object3D | null;
  /** Топор или лук в руке. */
  weapon: THREE.Object3D | null;
  /** С луком — значит, он из тех двоих, кто стреляет. */
  bow: boolean;
  x: number;
  z: number;
  yaw: number;
  gait: number;
  /** Номер в ватаге: от него идёт и рост, и черёд моргать. */
  seed: number;
  /** Положен топором: лежит и больше ничего не делает. */
  down: boolean;
  /** Когда ударил в последний раз, время сцены. */
  hitAt: number;
}

/** Стрела в полёте: тоже целиком время сцены — приземлившись, она станет записью. */
interface Flight {
  obj: THREE.Object3D;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  flown: number;
  range: number;
  land: Pt;
}

/** Одинаковы ли два предложения — по тому, что видно на кнопке. */
const sameOffer = (a: Offer, b: Offer): boolean => a.label === b.label && a.can === b.can && a.why === b.why;

/** Родословная одной строкой — сравнивать её надо по значению, как и всё остальное. */
const kinKey = (lines: readonly KinLine[]): string => lines.map((l) => `${l.who}:${l.name}:${l.note}`).join('|');

/** Доля отрезка `[a, b]`, пройденная к `k`: до него ноль, после — единица. */
const ramp = (k: number, a: number, b: number): number => THREE.MathUtils.clamp((k - a) / (b - a), 0, 1);

const smooth = (k: number): number => k * k * (3 - 2 * k);

/** Повернуться к углу коротким путём — долей `k` за шаг. */
const turnToward = (from: number, to: number, k: number): number =>
  from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * Math.min(1, k);

/**
 * Изменилось ли то, что показано.
 *
 * Полосы сравниваются с допуском: они ползут непрерывно, и точное сравнение
 * означало бы перерисовку каждый кадр — то есть ровно то, ради чего эта функция
 * и написана. Допуск взят по пикселю полосы: две тысячных её ширины на экране
 * не видно ни на одном телефоне.
 */
function same(a: PrologueView, b: PrologueView): boolean {
  return (
    Math.abs(a.fireFill - b.fireFill) < 0.002 &&
    Math.abs(a.fedFill - b.fedFill) < 0.002 &&
    Math.abs(a.warmthFill - b.warmthFill) < 0.002 &&
    Math.abs(a.healthFill - b.healthFill) < 0.002 &&
    a.fireWords === b.fireWords &&
    a.fedWords === b.fedWords &&
    a.warmthWords === b.warmthWords &&
    a.healthWords === b.healthWords &&
    a.warming === b.warming &&
    a.draining === b.draining &&
    a.healing === b.healing &&
    a.night === b.night &&
    a.weather === b.weather &&
    a.wolves === b.wolves &&
    packKey(a.items) === packKey(b.items) &&
    a.drawn === b.drawn &&
    a.busy === b.busy &&
    a.busyLeft === b.busyLeft &&
    a.dead === b.dead &&
    a.panel === b.panel &&
    a.mate === b.mate &&
    a.mateName === b.mateName &&
    a.mateSays === b.mateSays &&
    a.love === b.love &&
    a.meals === b.meals &&
    a.hugs === b.hugs &&
    a.nights === b.nights &&
    a.woods === b.woods &&
    a.mealToday === b.mealToday &&
    a.hugToday === b.hugToday &&
    a.nightToday === b.nightToday &&
    a.woodToday === b.woodToday &&
    a.note === b.note &&
    a.hugging === b.hugging &&
    a.end === b.end &&
    a.task === b.task &&
    a.sonName === b.sonName &&
    a.watching === b.watching &&
    a.cheated === b.cheated &&
    kinKey(a.lineage) === kinKey(b.lineage) &&
    sameOffer(a.give, b.give) &&
    sameOffer(a.offer, b.offer) &&
    sameOffer(a.shot, b.shot) &&
    sameOffer(a.eatCooked, b.eatCooked) &&
    sameOffer(a.eatRaw, b.eatRaw)
  );
}

/**
 * Сколько длится затемнение перехода «вышел из палатки», миллисекунды.
 *
 * Столько же, сколько уходит и приходит кадр в объятии: приём один, и два
 * разных срока у него читались бы двумя разными приёмами.
 */
const DIM_MS = 900;

/** Где глаз упавшего и куда он смотрит: с земли и чуть вверх. */
const FALL_EYE = 0.34;
const FALL_PITCH = 0.18;

/**
 * Как закрываются веки: дважды приоткрываются и только потом смыкаются.
 *
 * Ровно в эти доли секунды человек и видит, как уводят сына, — а закрывшиеся
 * разом глаза были бы просто затемнением. `u` — доля такта, ответ — насколько
 * веки сошлись, 0..1.
 */
function blink(u: number): number {
  if (u < 0.18) return smooth(u / 0.18) * 0.8;
  if (u < 0.3) return 0.8 - smooth((u - 0.18) / 0.12) * 0.55;
  if (u < 0.5) return 0.25 + smooth((u - 0.3) / 0.2) * 0.65;
  if (u < 0.62) return 0.9 - smooth((u - 0.5) / 0.12) * 0.5;
  return 0.4 + smooth((u - 0.62) / 0.38) * 0.6;
}

export class PrologueScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private rig: LightRig;
  private season = new SeasonVisuals();
  private smoke: Smoke;
  private fireLight: THREE.PointLight;
  private flame: THREE.Object3D | null = null;
  private flameInner: THREE.Object3D | null = null;

  /** Деревья и пни — по одному объекту на место; меняются местами при рубке. */
  private trees: (THREE.Object3D | null)[] = TREES.map(() => null);
  private stumps: (THREE.Object3D | null)[] = TREES.map(() => null);
  private axeInBlock: THREE.Object3D | null = null;
  private axeInHand: THREE.Object3D | null = null;
  private bowInHand: THREE.Object3D | null = null;
  private nock: THREE.Object3D | null = null;

  /** Олень: четыре меша, потому что он единственный, кто здесь движется сам. */
  private deer: THREE.Group | null = null;
  private deerHead: THREE.Object3D | null = null;
  private deerLegsF: THREE.Object3D | null = null;
  private deerLegsB: THREE.Object3D | null = null;
  private beast: Beast = { x: 0, z: 0, yaw: 0, homeX: 0, homeZ: 0, fleeUntil: 0, fleeYaw: 0, gait: 0 };
  private carcass: THREE.Object3D | null = null;
  /** Сруб и сколько брёвен в нём показано: пересобирается только на стройке. */
  private house: THREE.Object3D | null = null;
  private houseShown = -1;

  /** Стая. Пусто — обычное дело: волки приходят не каждую ночь. */
  private pack: Wolf[] = [];
  /**
   * Сколько волков этой стаи уже положили.
   *
   * Нужно затем, чтобы убитый не появлялся обратно в следующем же кадре:
   * `packAt` отвечает, сколько волков **в стае**, а не сколько их осталось. Как
   * только положили всех, минута уезжает в запись (`wolvesBeatenAt`), и счётчик
   * обнуляется — дальше тишину держит уже формула.
   */
  private downed = 0;
  /** Когда провыть в следующий раз. Время сцены: звук выхода не переживает. */
  private howlAt = 0;
  /**
   * С какой минуты стая кружит вокруг человека. 0 — не кружит, человек у огня.
   *
   * **Один отсчёт на всю стаю**, а не по отсчёту на волка: бросается и кусает
   * один, укусил — отскакивает вся стая (`wolves.wolfRushes`). Отсюда и
   * обещание «раньше `EARLIEST_DEATH_MS` не загрызут» — для пары так же, как для
   * одиночки. Начинается отсчёт не с выхода стаи из леса, а с той минуты, в
   * которую человек вышел из круга у костра: окно «увидел и решил» игрок
   * получает **каждый раз**, а не однажды за ночь.
   */
  private stalkFrom = 0;

  /** Женщина у огня: гостья или жена. Есть ли она — решает род, где стоит — кадр. */
  private mate: Figure | null = null;
  /** Гостья, получившая отказ: уходит к опушке и пропадает. Только картинка. */
  private leaving: Figure | null = null;
  /** Какая карточка открыта. Время сцены: выход из режима её не помнит. */
  private panel: Panel = '';
  /** Что она ответила только что — держится, пока открыта карточка. */
  private said = '';
  /** Строка поверх сцены и до какого кадра она стоит. */
  private note = '';
  private noteUntil = 0;
  /** Когда началось объятие, время сцены. 0 — не идёт. */
  private hugAt = 0;

  // ---------- Финал ----------
  //
  // ВСЁ ЗДЕСЬ — ВРЕМЯ СЦЕНЫ, И НИ ОДНО ИЗ ЭТИХ ЧИСЕЛ НЕ ПОПАДАЕТ В ЗАПИСЬ. В
  // записи лежит ступень и что на ней сделано (`end.EndState`); всё, что
  // тянется, живёт здесь и умирает вместе с режимом. Вышел посреди последней
  // сцены — вернулся к её началу, и это решение, а не пропуск.

  /** Сын у огня. Есть ли он — правило финала, где он стоит — кадр. */
  private son: Figure | null = null;
  /** Пришедшие из леса. Пусто — их нет или ещё не вышли. */
  private foes: Foe[] = [];
  /** Общий холст ватаги: один на пятерых (`people.skinOf`). */
  private foeSkin: Skin | null = null;
  /** Дом сына и сколько досок в нём показано. */
  private frameObj: THREE.Object3D | null = null;
  private frameShown = -1;
  /** Когда чёрный экран перехода: ставится в минуту имени сына. 0 — не ждём. */
  private passAt = 0;
  /** Когда началась последняя сцена, время сцены. */
  private raidAt = 0;
  /** Когда игрок ответил пришедшим. 0 — ещё не ответил. */
  private answerAt = 0;
  /** Сколько длится драка: укорачивается, когда положили всех троих. */
  private fightMs: number = BEAT.fightMs;
  /** Какой такт шёл в прошлом кадре: по смене такта делается то, что делается раз. */
  private beat: Beat | '' = '';
  /** Затемнение перехода «вышел из палатки»: когда началось, время сцены. */
  private dimAt = 0;
  /** Стрелы последней сцены: две, и они не запись — картинка. */
  private shots: THREE.Object3D[] = [];
  /**
   * Кого поляна показала тапу в этот раз.
   *
   * Номер спота — это место в **этом** списке, а не в стае: положенные из него
   * выпадают, и считать их вторым способом значило бы завести вторую правду о
   * том, кто где стоит. Так же устроен и разбор тапа по волку.
   */
  private foeList: Foe[] = [];

  /** Небо куполом: градиент, светило и звёзды (`dome.ts`), и цвет часа для него. */
  private dome = new Dome();
  private tone = newTone();
  /** Свои копии материалов поляны: ветер в кронах, снег на ветках, мокрая земля. */
  private surfaces = new Surfaces();
  /** Сила ветра прямо сейчас — картинка: качает кроны, тянет дым и искры. */
  private wind = 0.6;
  /**
   * Мягкое пятно света: отсвет костра, клубы дыма, искры и глаза волков.
   * Печётся один раз при входе (`paint.glowCanvas`) и одно на всех.
   */
  private glowTex = bake(glowCanvas());
  /** Рукава игрока: лён и мех. Сшита одежда — у рук меняется материал, а не рисунок. */
  private sleeveTex = [bake(sleeveCanvas(false)), bake(sleeveCanvas(true))];
  private sleeveMat = this.sleeveTex.map((map) => new THREE.MeshLambertMaterial({ map }));
  /** Глаза волков ночью: пятно света цвета нутра огня. */
  private eyeMat = new THREE.MeshBasicMaterial({
    map: this.glowTex,
    color: mix(PALETTE.fireInner, PALETTE.thatch, 0.3),
    transparent: true,
    blending: ADDITIVE,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  /** Свечение над огнём: без него пламя — оранжевый конус, а не огонь. */
  private fireGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: this.glowTex,
      color: PALETTE.fireLight,
      blending: ADDITIVE,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  private sparks = new Sparks(this.glowTex);
  /**
   * Во сколько раз шире прежних 72° угол обзора — по вертикали, в тангенсах.
   * На это число раздвигаются вещи в руках: на экране они остаются там же и того
   * же размера, каким их подобрали снимками.
   */
  private viewK = 1;
  /** Насколько человек идёт, сглажено: по нему качаются вещи в руках. */
  private walkK = 0;
  private bobX = 0;
  private bobY = 0;
  /** Руки на топоре и на луке. Висят на вещах и ходят вместе с ними. */
  private axeArm: THREE.Group | null = null;
  private bowArm: THREE.Group | null = null;
  private bowArmPose: { low: ArmPose; drawn: ArmPose } | null = null;
  /** Какой рукав надет на руки сейчас: мех — когда сшита одежда. */
  private armFur = false;

  /** Непогода: дождь чертами и снег точками, видна одна за раз. */
  private precip = new Precip();
  /** Насколько непогода вступила, 0..1. Картинка, а не величина. */
  private wet = 0;
  /** Что именно идёт. Держится, пока непогода дотухает: ясной погоде вида нет. */
  private wetKind: 'rain' | 'snow' = 'rain';
  /** Что уже разложено светом — по этому видно, надо ли перекладывать. */
  private skySolar = -1;
  private skyGloom = -1;

  /** Стрелы в траве — по одной на запись в сохранении. */
  private stuck: THREE.Object3D[] = [];
  private flight: Flight | null = null;
  /** Натянут ли лук. Время сцены: выход опускает его сам собой. */
  private drawn = false;
  /** Когда начали натягивать, время сцены. Только для картинки. */
  private drawAt = 0;

  private sticks = new Sticks();
  private keys = new Keys();
  private frame = 0;
  private last = 0;
  private stopped = false;

  /** Где стоит игрок и куда смотрит. Время сцены: в сохранение не идёт. */
  private px = START.x;
  private pz = START.z;
  private yaw = START.yaw;
  private pitch = -0.06;
  /** Фаза покачивания при ходьбе. */
  private bob = 0;

  /** Сколько ударов осталось до падения и по какому дереву бьём. */
  private chopsLeft = 0;
  private chopTree = -1;
  /**
   * Что делается прямо сейчас и когда начато — время сцены.
   *
   * Дел, которые длятся, три: удар топором, снятие куска с туши и снятие
   * шкуры (замах в драке — картинка, см. `act`). Все живут в кадрах и никуда
   * не пишутся: брошенное на середине дерево при следующем заходе стоит целым,
   * а недорезанная туша — целой. В сохранении лежит только то, что случилось,
   * а не то, что начинали.
   */
  private work: { kind: Work; at: number } | null = null;

  private savedAt = 0;
  private viewedAt = 0;
  /** Что показано сейчас — по нему видно, изменилось ли что-нибудь. */
  private shown: PrologueView | null = null;

  /** Кому сказать, что надпись изменилась. */
  onView: ((v: PrologueView) => void) | null = null;

  /**
   * Кружок стика ходьбы. Сцена двигает его сама, минуя React: он ездит за
   * пальцем каждый кадр, а перерисовывать ради этого дерево компонентов
   * шестьдесят раз в секунду незачем.
   */
  stickEl: HTMLElement | null = null;

  /**
   * Затемнение и знак объятия. Двигает их сцена, минуя React, — по той же
   * причине, что стик: они живут кадрами, и доли объятия у камеры и у затемнения
   * обязаны быть одним числом, а не двумя таблицами — в коде и в стилях.
   * Первый ребёнок — затемнение, второй — знак.
   */
  hugEl: HTMLElement | null = null;

  /**
   * Иней по краям кадра. Двигает его сцена, минуя React: число у него то же, что у
   * полосы тепла, и второй раз его не считает никто (`frostShow`).
   */
  frostEl: HTMLElement | null = null;

  /**
   * Меркнущее зрение последней сцены: дымка по краям, веки и чернота.
   *
   * Двигает их сцена, минуя React, — по той же причине, что стик и объятие: они
   * живут кадрами, и доли у затемнения и у камеры обязаны быть одним числом.
   * Первый ребёнок — дымка, второй и третий — веки, четвёртый — чернота.
   */
  blindEl: HTMLElement | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private save: PrologueSave,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    configureRenderer(this.renderer);
    configureSky(this.scene);
    /*
     * Туман. Прежние 16–34 съедали лес целиком: дальние стволы выцветали до
     * белого уже во втором ряду, и стена читалась не лесом, а дымкой с ёлками.
     * Теперь дымка начинается там, где кончается поляна, и добирает цвет к
     * самому краю земли — деревья за спиной у ближних остаются деревьями.
     */
    this.scene.fog = new THREE.Fog(PALETTE.fog, FOG_NEAR, FOG_FAR);

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 90);
    this.camera.position.set(this.px, EYE, this.pz);

    this.rig = createLightRig(this.scene);
    fitShadow(this.rig, SHADOW_HALF);
    // ПРЕДЫСТОРИЯ ИДЁТ ЗИМОЙ. Сезон общий на всю игру — материалы одни, — поэтому
    // поляна ставит свою зиму мгновенно, до того как снять копии материалов
    // (`surfaces.adopt` ниже берёт цвет уже зимним), а деревня вернёт свой сезон тем
    // же `jump` при пересборке. Цвета зимы — те же, что у деревни (`SEASON_OVERRIDES`):
    // своей второй зимы у поляны нет.
    this.season.jump('winter');

    // Небо — первым: купол рисуется раньше всего и глубину не пишет.
    this.scene.add(this.dome.root);
    // Всё неподвижное — в свои копии материалов (`surface.ts`): кроны качает
    // ветер, на ветки и крыши ложится снег, земля в дождь темнеет. Общие материалы
    // деревни при этом не меняются.
    const growth = undergrowth();
    // Пятна тени — одним мешем на весь лес и на всё, что стоит на поляне.
    const shade = new Shade();
    this.scene.add(
      this.surfaces.adopt(gladeGround()),
      this.surfaces.adopt(forest(shade), 'crown'),
      this.surfaces.adopt(tent()),
      this.surfaces.adopt(chopBlock()),
      this.surfaces.adopt(growth.sway, 'tuft'),
      this.surfaces.adopt(growth.still),
    );
    groundShade(shade);
    this.scene.add(shade.mesh());
    const fire = this.surfaces.adopt(campfire());
    this.flame = fire.getObjectByName('flame') ?? null;
    this.flameInner = fire.getObjectByName('flameInner') ?? null;
    this.scene.add(fire);

    this.fireLight = new THREE.PointLight(PALETTE.fireLight, 0.9, FIRE_RANGE, FIRE_DECAY);
    this.fireLight.position.set(0, 0.9, 0);
    this.scene.add(this.fireLight);
    this.fireGlow.position.set(FIRE.x, 0.62, FIRE.z);
    this.fireGlow.visible = false;
    this.scene.add(this.fireGlow, this.sparks.points);

    this.smoke = new Smoke(SMOKE_LOOK);
    // Клуб дыма — мягкое пятно, а не квадрат точки: квадраты висели по всему небу.
    const smokeMat = this.smoke.points.material as THREE.PointsMaterial;
    smokeMat.map = this.glowTex;
    smokeMat.needsUpdate = true;
    this.scene.add(this.smoke.points);

    // Часы поляны идут, и свет за ними — но не каждый кадр, а по мере хода
    // круга (`SKY_STEP`). Первый раз обязательно здесь: до первого кадра сцена
    // уже может попасть на снимок, а ночь, разложенная кадром позже, читалась
    // бы вспышкой.
    this.applySky(serverNow());

    this.scene.add(this.precip.root);

    // Камера состоит в графе сцены: иначе топор, висящий на ней, не обойдётся
    // обходом и не нарисуется вовсе.
    this.scene.add(this.camera);
    this.syncTrees();
    this.syncAxe();
    this.syncBow();
    this.syncArrows();
    this.syncHouse();
    this.syncBeast(true);
    this.syncPack(performance.now());
    this.syncMate(true);
    /*
     * Финал начинается сам, как только у сына есть имя. Здесь — на входе: игрок,
     * назвавший сына и вышедший, возвращается уже в финал, и ждать ему нечего.
     * Внутри одного захода то же делает `endStep`, но с выдержкой в `PASS_AFTER_MS`:
     * там игрок стоит на поляне и читает строку о рождении.
     */
    if (endBegins(this.save.wife, this.save.heir) && this.save.end.stage === 'none') {
      this.save.end = { ...this.save.end, stage: 'passed' };
    }
    this.syncEnd(true);
    // Встреча: что стало с огнём, пока человека не было, — первой строкой.
    // Отлучка — сколько прошло с последней записи: отметка человека на диске и
    // есть минута, в которую его видели здесь последний раз.
    const met = serverNow();
    const hello = welcome(this.save, this.save.hearth, met, met - this.save.body.at);
    if (hello) this.say(hello);

    this.resize();
    this.wire();
    this.last = performance.now();
    this.loop();
  }

  // ---------- Ввод ----------

  private wire(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onCancel);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Координата внутри холста: жесты считаются от него, а не от страницы. */
  private local(e: PointerEvent): { x: number; y: number; w: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width };
  }

  private onDown = (e: PointerEvent): void => {
    // Нажатие — это и есть тот жест, которым открывается звук: в вебвью
    // Telegram он сам не откроется. При выключенной музыке `arm` не делает
    // ничего и не качает ни байта, поэтому звать его можно свободно; `await`
    // здесь нельзя ни одного — активация теряется.
    wolfHowl.arm();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* захват не обязателен */
    }
    const p = this.local(e);
    this.sticks.down(e.pointerId, p.x, p.y, performance.now(), p.w);
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.local(e);
    this.sticks.move(e.pointerId, p.x, p.y, performance.now());
  };

  private onUp = (e: PointerEvent): void => {
    const now = performance.now();
    const done = this.sticks.up(e.pointerId, now);
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* захвата могло и не быть */
    }
    if (!done) return;
    const spot = this.aim();
    // Журнал касаний общий на все холсты игры: жалоба «на карте работает, а
    // здесь нет» разбирается только сравнением в одном списке. Пишем измеренное:
    // сдвиг картинки здесь не меряется вовсе, и это честное «не знаю», а не ноль.
    gestLog.add({
      where: 'предыстория',
      fingers: this.sticks.fingerCount + 1,
      ms: now - done.press.t,
      far: done.press.far,
      path: done.press.path,
      end: done.tap ? (spot ? 'тап' : 'мимо') : 'ведение',
      hit: done.tap ? (spot ? SPOT_WORDS[spot.kind] : null) : null,
      drift: null,
    });
    if (!done.tap) return;
    // Тот же призрачный щелчок, что и в деревне: следом за касанием придёт
    // синтезированный `click`, а над сценой стоят кнопки надстройки.
    swallowGhostClick();
    this.act();
  };

  private onCancel = (e: PointerEvent): void => {
    this.sticks.cancel(e.pointerId);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    // Имя сына печатают в поле, и буквы имени — не шаг и не действие: без этой
    // строки «а» натягивала бы лук, а пробел клал бы дрова (`controls.typing`).
    if (typing(e.target)) return;
    if (e.repeat) return;
    if (this.keys.down(e.code)) {
      e.preventDefault();
      return;
    }
    if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') {
      e.preventDefault();
      this.act();
      return;
    }
    // У лука своя клавиша по той же причине, по какой у него своя кнопка: тап
    // и выстрел — разные вещи, и делить одну кнопку им нельзя.
    if (e.code === KEY_BOW) {
      e.preventDefault();
      this.doBow();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => this.keys.up(e.code);

  /** Ушли с окна — отпускаем всё: иначе клавиша остаётся зажатой навсегда. */
  private onBlur = (): void => {
    this.keys.clear();
    this.sticks.clear();
  };

  private onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      // Кадров в фоне не было, и первый после возвращения обязан быть коротким:
      // иначе `dt` в двое суток унесёт игрока через весь лес одним шагом.
      this.last = performance.now();
      return;
    }
    this.onBlur();
    this.persist(true);
  };

  // ---------- Действие ----------

  /** По чему сейчас работает тап. Досягаемость, а не прицел (см. `controls.ts`). */
  private aim(): Spot | null {
    const now = serverNow();
    // Волки едут в поляну отсюда: где они стоят, знает только кадр, и второго
    // источника этому нет и быть не может.
    return nearest(this.px, this.pz, reach(this.save, now, this.pack, this.matePt(), this.sonPt(), this.foePts()), now);
  }

  /** Где женщина — поляне: тап по ней заговаривает. Уходящая с отказом не в счёт. */
  private matePt(): Pt | null {
    return this.mate ? { x: this.mate.x, z: this.mate.z } : null;
  }

  /** Где сын — тем же путём и по той же причине. */
  private sonPt(): Pt | null {
    return this.son ? { x: this.son.x, z: this.son.z } : null;
  }

  /**
   * Где стоят пришедшие — поляне, и только те, кого можно тронуть.
   *
   * Положенные из списка выпадают: топор по лежащему — то самое «ничего не
   * произошло», которого в режиме не бывает. Стрелки не выпадают: их можно
   * достать, пока идёт драка, — и это единственное, чем игрок может им ответить.
   */
  private foePts(): Pt[] {
    this.foeList = !this.answerAt || this.beat !== 'fight' ? [] : this.foes.filter((f) => !f.down);
    return this.foeList.map((f) => ({ x: f.x, z: f.z }));
  }

  /** Мёртвому не делают ничего: экран смерти стоит поверх всего, и это не запрет, а правда. */
  private alive(now: number): boolean {
    return death(this.save, now) === null;
  }

  /**
   * Сделать то, что предлагает поляна.
   *
   * Дел, которые длятся, три — удар топором, снятие куска с туши и снятие
   * шкуры, — и все заводятся здесь одинаково: `work` с отметкой кадрового
   * времени. Остальное случается сразу, и ремесло тоже: стройка, шитьё и
   * строгание — тапом, а не работой. Их цена уже заплачена деревом и шкурой, а
   * ожидание сверху было бы беготнёй, которую ремесло обещало снимать.
   */
  private act(): void {
    const now = serverNow();
    if (!this.alive(now)) return;
    // Пока идёт объятие, камера не у человека, и делать ему нечего.
    if (this.hugAt) return;
    const spot = this.aim();
    const what = offer(this.save, spot, now);
    if (!what.can || !spot) return;
    if (what.deed === 'talk') return this.talk(spot.kind === 'son');
    /*
     * Доска в дом сына. Дверь та же, что у бревна в свой дом, и правило то же:
     * положил — стало больше. Пятая кончает стройку и начинает последнюю сцену,
     * и это единственное место, откуда она начинается.
     */
    if (what.deed === 'board') {
      const e = this.save.end;
      if (e.stage !== 'build' || frameDone(e)) return;
      this.save.end = { ...e, boards: e.boards + 1 };
      this.syncFrame();
      this.work = { kind: 'chop', at: performance.now() };
      this.chopTree = -1;
      this.chopsLeft = 1;
      if (frameDone(this.save.end)) this.beginRaid();
      return this.done();
    }
    // Отбиться от пришедшего. Правило волка целиком: валится с одного удара и
    // сразу, замах идёт своим чередом (`slay`).
    if (what.deed === 'fight-foe') {
      this.downFoe(spot.index);
      this.work = { kind: 'fight', at: performance.now() };
      this.refresh();
      return;
    }
    if (what.deed === 'kin') {
      this.panel = 'kin';
      this.said = '';
      this.refresh();
      return;
    }
    if (what.deed === 'take-axe') {
      this.save.axe = true;
      this.syncAxe();
      return this.done();
    }
    if (what.deed === 'take-kit') {
      // Один свёрток: лук, стрелы и вяленое мясо. Разбирается один раз за
      // поляну и после смерти не возвращается — почему, написано в `save.ts`.
      this.save.kit = true;
      this.save.quiver += ARROWS_START;
      this.save.meat.cooked += KIT_MEAT;
      this.syncBow();
      return this.done();
    }
    if (what.deed === 'take-arrow') {
      // Стрела не размножается: считает это одна чистая операция на всю игру
      // (`hunt.pickArrow`), и она же проверена тестом.
      this.stow(pickArrow(this.save, spot.index));
      return this.done();
    }
    if (what.deed === 'feed') {
      const put = logsTaken(this.save.hearth, now, this.save.logs);
      if (put <= 0) return;
      this.save.hearth = feed(this.save.hearth, now, put);
      this.save.logs -= put;
      // Дрова в общий очаг — «достроенное вместе»: дом стоит, а очаг держат вдвоём.
      this.together('wood', now);
      return this.done();
    }
    if (what.deed === 'roast') {
      // Огонь и греет, и кормит — и за второе платят первым: полполена на кусок.
      const n = roastCount(this.save, now);
      if (n <= 0) return;
      this.save.hearth = spend(this.save.hearth, now, n * ROAST_COST);
      this.save.meat.raw -= n;
      this.save.meat.cooked += n;
      return this.done();
    }
    if (what.deed === 'build') {
      // В стену уходит ровно то, что ушло из рук (`craft.buildTake`): дом не
      // растёт ни на полено больше и не строится из воздуха.
      const put = buildTake(this.save.house, this.save.logs);
      if (put <= 0) return;
      this.save.logs -= put;
      this.save.house += put;
      // Легло последнее бревно — от этой минуты идёт первая гостья (`kin.guestAt`).
      if (houseDone(this.save.house)) this.save.builtAt = now;
      this.syncHouse();
      // Первое бревно делает место стройки преградой: стоявший на разметке
      // выходит из сруба сразу, а не с первым шагом.
      const p = slide(this.px, this.pz, blockers(this.save.felled, now, true));
      this.px = p.x;
      this.pz = p.z;
      return this.done();
    }
    if (what.deed === 'sew') {
      this.save.hides -= COAT_HIDES;
      this.save.body = wearCoat(this.save.body, this.save.hearth, now);
      return this.done();
    }
    if (what.deed === 'carve') {
      // Полено из рук — две стрелы в колчан: единственное действие, которое
      // меняет число стрел (`hunt.carveArrows`).
      this.save.logs -= 1;
      this.stow(carveArrows(this.save, ARROWS_PER_LOG));
      return this.done();
    }
    if (this.work) return;
    /*
     * Волк. Валится с одного удара и **сразу**, а не по концу замаха: зверь в
     * шаге от лица ждать не станет, и «ударил, а он ещё кусает» игрок прочтёт
     * поломкой. Замах при этом идёт своим чередом — он тут украшение, и это
     * единственное дело режима, где картинка отстаёт от записи, а не наоборот.
     */
    if (what.deed === 'fight') {
      this.slay(spot.index, now);
      this.work = { kind: 'fight', at: performance.now() };
      this.refresh();
      return;
    }
    if (what.deed === 'butcher' || what.deed === 'skin') {
      this.work = { kind: what.deed, at: performance.now() };
      this.refresh();
      return;
    }
    // Рубка. Замах идёт своим чередом, дерево падает на последнем ударе.
    if (this.chopTree !== spot.index) {
      this.chopTree = spot.index;
      this.chopsLeft = CHOPS_TO_FELL;
    }
    this.work = { kind: 'chop', at: performance.now() };
    this.refresh();
  }

  /** Сделано: сложить на диск и обновить надпись. Одна строка на все действия. */
  private done(): void {
    this.persist(true);
    this.refresh();
  }

  /** Дело доделано: удар состоялся, кусок срезан или шкура снята. */
  private landWork(kind: Work): void {
    // Драка уже случилась в тот кадр, когда по ней тапнули: замах — картинка.
    if (kind === 'fight') return this.done();
    if (kind === 'skin') {
      const c = liveCarcass(this.save.hunt, serverNow());
      if (!c || c.skinned) return this.done();
      c.skinned = true;
      this.save.hides += 1;
      this.syncBeast(false);
      return this.done();
    }
    if (kind === 'butcher') {
      const now = serverNow();
      const c = liveCarcass(this.save.hunt, now);
      if (!c) return this.done();
      c.taken += 1;
      this.save.meat.raw += 1;
      this.syncBeast(false);
      return this.done();
    }
    this.chopsLeft -= 1;
    if (this.chopsLeft > 0) {
      this.refresh();
      return;
    }
    const i = this.chopTree;
    this.chopTree = -1;
    if (i < 0) return;
    this.save.felled[i] = serverNow();
    this.save.logs += logsFromTree();
    this.syncTrees();
    this.done();
  }

  /**
   * Лук: натянуть или пустить.
   *
   * Своя дверь, отдельная от тапа, и это главное правило охоты: **тап не
   * целится, выстрел целится.** Смешай их — и лук станет второй кнопкой
   * действия, а зверь, до которого нельзя дотянуться, станет недостижим вовсе.
   */
  doBow(): void {
    const now = serverNow();
    if (!this.alive(now)) return;
    const what = bowOffer(this.save, this.drawn);
    if (!what.can) return;
    if (what.deed === 'draw') {
      this.drawn = true;
      this.drawAt = performance.now();
      this.refresh();
      return;
    }
    this.loose();
  }

  /**
   * Пустить стрелу.
   *
   * Направление — то же, куда смотрит камера, и другого способа целиться в игре
   * нет. Куда она воткнётся, знает правило (`hunt.arrowLanding`), а не сцена:
   * дальность и край поляны — это игра, а не картинка.
   */
  private loose(): void {
    if (this.save.quiver <= 0) return;
    this.drawn = false;
    this.stow(nockArrow(this.save));
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const land = arrowLanding(this.px, this.pz, dir, EYE);
    const flat = Math.hypot(dir.x, dir.z);
    // Сколько метров стрела пролетит: до земли или до предела — что раньше.
    const range = flat > 1e-4 ? Math.hypot(land.x - this.px, land.z - this.pz) / flat : 0.5;
    const obj = arrowModel();
    obj.position.set(this.px, EYE - 0.1, this.pz);
    obj.quaternion.copy(this.camera.quaternion);
    this.scene.add(obj);
    this.flight = {
      obj,
      x: this.px,
      y: EYE - 0.1,
      z: this.pz,
      dx: dir.x,
      dy: dir.y,
      dz: dir.z,
      flown: 0,
      range,
      land,
    };
    this.done();
  }

  /** Съесть кусок: жареный или сырой. Своя дверь — подходить тут не к чему. */
  eatMeal(raw: boolean): void {
    const now = serverNow();
    if (!this.alive(now)) return;
    const body = this.save.body;
    if (!meal(this.save, hungerAt(body, now), harmAt(body, this.save.hearth, now), raw).can) return;
    this.save.body = eat(this.save.body, this.save.hearth, now, raw);
    if (raw) this.save.meat.raw -= 1;
    else this.save.meat.cooked -= 1;
    this.done();
  }

  /**
   * Новое утро после смерти.
   *
   * Поляну и человека пересобирает чистое правило (`save.revive`), сцена только
   * догоняет: ставит игрока к палатке и переставляет то, что видно.
   */
  reviveNow(): void {
    // Стрела, застигнутая в полёте, кладётся на землю: `revive` собирает с
    // поляны все до одной, а летящая не лежит нигде и пропала бы навсегда.
    this.groundFlight();
    this.save = reviveSave(this.save, serverNow());
    this.px = START.x;
    this.pz = START.z;
    this.yaw = START.yaw;
    this.pitch = -0.06;
    this.drawn = false;
    this.work = null;
    this.chopTree = -1;
    this.dropFlight();
    this.syncTrees();
    this.syncAxe();
    this.syncBow();
    this.syncArrows();
    this.syncBeast(true);
    // `revive` уводит волков на `WOLF_GAP_MS` — иначе загрызенный открывал бы
    // глаза в двух шагах от той же пары зубов (объяснение — в `save.ts`).
    this.downed = 0;
    this.syncPack(performance.now());
    // Род остаётся (`save.revive`), а разговор и объятие — нет: они жили кадрами.
    this.panel = '';
    this.said = '';
    this.hugAt = 0;
    this.hugShow(0, 0);
    this.fireLight.position.set(0, 0.9, 0);
    this.done();
  }

  // ---------- Род ----------

  /**
   * Заговорить: с гостьей — о том, откуда она; с женой — о доме и сыне; с сыном
   * — о том, что он голоден.
   *
   * Дверь одна и та же (`act.offer` отдаёт `talk` и на мать, и на сына), а
   * карточки разные: у сына нет ни шкалы, ни объятия, у него одно дело.
   */
  private talk(son: boolean): void {
    const s = this.save;
    this.said = '';
    if (son) this.panel = 'son';
    else this.panel = !s.wife ? 'guest' : !s.heir && loveFull(s.bond) ? 'name' : 'wife';
    this.refresh();
  }

  /**
   * Принять гостью. С этой минуты она жена и бережёт огонь.
   *
   * Мера очага меняется событием, а не задним числом: отрезок закрывается прежней
   * мерой, дальше горит её (`fire.keepHearth`).
   */
  acceptGuest(): void {
    const now = serverNow();
    const s = this.save;
    if (!this.alive(now) || this.panel !== 'guest' || s.wife || !guestHere(s, now)) return;
    s.wife = { name: guestOf(s.refused).name, at: now };
    s.hearth = keepHearth(s.hearth, now);
    this.panel = 'wife';
    this.said = WIFE_YES;
    this.done();
  }

  /** Отказать. Она уходит к опушке; следующая придёт через сутки поляны (`kin.GUEST_GAP_MS`). */
  refuseGuest(): void {
    const now = serverNow();
    const s = this.save;
    if (!this.alive(now) || this.panel !== 'guest' || s.wife || !guestHere(s, now)) return;
    const g = guestOf(s.refused);
    s.refused += 1;
    s.refusedAt = now;
    this.panel = '';
    this.said = '';
    this.say(`${g.name}: «${GUEST_NO}»`);
    this.syncMate(false);
    this.done();
  }

  /** Дать жене мясо — разделённая еда. Цена и запреты — `act.share`. */
  shareMeat(): void {
    const now = serverNow();
    const s = this.save;
    if (!this.alive(now) || this.panel !== 'wife' || !share(s, now).can) return;
    if (s.meat.raw > 0) s.meat.raw -= 1;
    else s.meat.cooked -= 1;
    // В финале это не дело общей жизни, а задание ступени: любовь полна давно, и
    // считать её второй раз нечем. Благодарит она своими словами (`end.ts`).
    if (s.end.stage === 'family') {
      s.end = { ...s.end, wife: true };
      this.said = WIFE_THANKS;
      this.done();
      return;
    }
    this.said = SHARED;
    this.together('meal', now);
    this.done();
  }

  /** Дать мясо сыну. Своя дверь: у сына своя карточка и свои запреты (`act.feedSon`). */
  feedSonMeat(): void {
    const now = serverNow();
    const s = this.save;
    if (!this.alive(now) || this.panel !== 'son' || !feedSon(s).can) return;
    if (s.meat.raw > 0) s.meat.raw -= 1;
    else s.meat.cooked -= 1;
    s.end = { ...s.end, son: true };
    this.said = SON_THANKS;
    this.done();
  }

  /**
   * Тап по чёрному экрану «Прошло много дней…».
   *
   * Экран ждёт человека, а не часов: он переводит дух, а не смотрит заставку.
   */
  passOn(): void {
    if (this.save.end.stage !== 'passed') return;
    this.beginFamily();
  }

  /** Ответ пришедшим. Он один, и после него игрок только смотрит. */
  answerRaid(): void {
    if (this.save.end.stage !== 'raid' || this.answerAt) return;
    this.answerAt = performance.now();
    this.panel = '';
    this.said = '';
    this.drawn = false;
    this.refresh();
  }

  /**
   * Набранный код (`src/cheats.ts`). Возвращает строку ответа — её показывает
   * панель, а не сцена: игрок смотрит в поле, в которое печатал.
   */
  cheat(code: string): string {
    const found = cheatOf(code, 'prologue');
    if (!found) return CHEAT_NO;
    const out = applyCheat(this.save, found.id, serverNow());
    this.save = out.save;
    this.syncAxe();
    this.syncBow();
    this.syncHouse();
    this.syncMate(false);
    this.done();
    return out.said;
  }

  /** Обнять. Камера уходит под крышу и вверх, знак, обычный вид — и больше ничего (`hugStep`). */
  hug(): void {
    const now = serverNow();
    if (!this.alive(now) || this.panel !== 'wife' || !this.save.wife || this.hugAt) return;
    this.panel = '';
    this.said = '';
    this.drawn = false;
    this.hugAt = performance.now();
    this.together('hug', now);
    this.done();
  }

  /**
   * Назвать сына. Возвращает причину отказа; пусто — имя принято и записано.
   *
   * Правило имени одно — `kin.heirName`, — и спрашивается оно здесь ещё раз, а не
   * берётся на веру у кнопки: погашенную кнопку обходит Enter в поле.
   */
  nameHeir(raw: string): string {
    const now = serverNow();
    const s = this.save;
    const named = heirName(raw);
    if (named.why) return named.why;
    if (!this.alive(now) || !s.wife || s.heir || !loveFull(s.bond)) return 'Рано';
    s.heir = { name: named.name, at: now };
    this.panel = '';
    this.said = '';
    this.say(`Родился сын — ${named.name}. Род записан в доме.`);
    // Отсюда начинается финал — но не сию секунду: строка о рождении обязана
    // дочитаться, а чёрный экран поверх неё оборвал бы её на полуслове.
    this.passAt = performance.now() + PASS_AFTER_MS;
    this.done();
    return '';
  }

  /**
   * Вещи: открыть окно или закрыть, если открыто.
   *
   * Карточка одна за раз — окно вещей встаёт на место разговора, а не поверх: две
   * карточки над одним рядом кнопок закрывали бы полэкрана и друг друга. Мёртвому и
   * посреди объятия вещей нет, как нет и разговора.
   */
  togglePack(): void {
    if (!this.alive(serverNow()) || this.hugAt) return;
    this.panel = this.panel === 'pack' ? '' : 'pack';
    this.said = '';
    this.refresh();
  }

  /** Закрыть карточку: разговор, родословную или вещи. */
  closePanel(): void {
    if (!this.panel) return;
    this.panel = '';
    this.said = '';
    this.refresh();
  }

  // ---------- Сцена ----------

  /** Что стоит на местах деревьев: ствол, пень или ничего. */
  private syncTrees(): void {
    const now = serverNow();
    TREES.forEach((t, i) => {
      const up = standing(this.save.felled[i] ?? 0, now);
      if (up && !this.trees[i]) {
        this.trees[i] = this.surfaces.adopt(choppable(i), 'crown');
        this.scene.add(this.trees[i]!);
      }
      if (!up && this.trees[i]) {
        this.drop(this.trees[i]!);
        this.trees[i] = null;
      }
      if (!up && !this.stumps[i]) {
        this.stumps[i] = this.surfaces.adopt(stump(t.x, t.z, i));
        this.scene.add(this.stumps[i]!);
      }
      if (up && this.stumps[i]) {
        this.drop(this.stumps[i]!);
        this.stumps[i] = null;
      }
    });
  }

  /**
   * Сруб: сколько брёвен в записи, столько и видно.
   *
   * Пересобирается только когда число изменилось — то есть на стройке, по тапу.
   * Модель склеена в один меш (`models.house`), и пересборка стоит меньше кадра.
   * Материалы у него поляны (`surface.ts`): на крышу ложится снег.
   */
  private syncHouse(): void {
    if (this.houseShown === this.save.house) return;
    this.houseShown = this.save.house;
    if (this.house) this.drop(this.house);
    this.house = this.surfaces.adopt(houseModel(this.save.house));
    this.scene.add(this.house);
  }

  /** Где топор: в колоде или в руке. */
  private syncAxe(): void {
    if (this.save.axe) {
      if (this.axeInBlock) {
        this.drop(this.axeInBlock);
        this.axeInBlock = null;
      }
      if (!this.axeInHand) {
        const a = axeModel();
        /*
         * Топор висит на камере: он часть взгляда, а не мира, и ездит с ним без
         * единой строки в цикле кадров.
         *
         * Числа — от портрета, и подобраны замером, а не на глаз. Угол обзора у
         * камеры **вертикальный**, а экран телефона узкий: при 72° по вертикали
         * и стороне 375×812 по горизонтали остаётся всего 37°, то есть ±18.5° от
         * середины. Поэтому вещь в руке приходится и отодвигать (иначе она
         * заслоняет полкадра), и держать ближе к середине (иначе уезжает за
         * край): при x = 0.42 и z = −1 топор оказывался ровно за кромкой экрана
         * и был не виден вовсе.
         *
         * Подобраны числа при прежних 72°. Угол на портрете теперь шире
         * (`glade.viewFov`), и место с размером раздвинуты на `viewK`: на экране
         * топор стоит там же и того же размера.
         */
        a.scale.setScalar(AXE_SCALE * this.viewK);
        a.castShadow = false;
        this.axeInHand = a;
        this.restAxe();
        this.camera.add(a);
        // Рука на топорище: кулак на хвате, предплечье к правому нижнему углу.
        const hand = armModel(this.sleeveMat[0]);
        const pose = armPose(AXE_REST, AXE_SCALE, ARM_AXE.grip, ARM_AXE.dir, ARM_AXE.handle);
        hand.position.copy(pose.p);
        hand.quaternion.copy(pose.q);
        hand.scale.copy(pose.s);
        a.add(hand);
        this.axeArm = hand;
        this.dressArms();
      }
      return;
    }
    if (this.axeInHand) {
      this.camera.remove(this.axeInHand);
      disposeGeometries(this.axeInHand);
      this.axeInHand = null;
      this.axeArm = null;
    }
    if (!this.axeInBlock) {
      const a = axeModel();
      // Всажен в колоду: лезвие прикушено верхом, рукоять торчит вверх и к
      // игроку. Высота подобрана так, чтобы обух было видно над срезом, — иначе
      // на колоде торчит одна палка, и первая же цель режима не читается.
      a.position.set(2.42, 0.92, 2.05);
      a.rotation.set(-1.25, 0.55, 0);
      this.axeInBlock = a;
      this.scene.add(a);
    }
  }

  /**
   * Лук в левой руке — и стрела на тетиве, пока он натянут.
   *
   * Висит на камере, как топор: обе вещи — часть взгляда, а не мира. Стрела на
   * тетиве — отдельный меш нарочно: её видно только с натянутым луком, и это
   * единственное, чем показ отличает «держит» от «целится».
   */
  private syncBow(): void {
    if (!this.save.kit) return;
    if (this.bowInHand) return;
    const b = bowModel();
    b.scale.setScalar(BOW_SCALE * this.viewK);
    const nock = arrowModel();
    // Стрела своего размера, а не луковьего: она вложена в лук, и его
    // уменьшение пришлось бы делить. Лежит она вдоль −Z, то есть смотрит туда
    // же, куда камера, — поворачивать её не надо ничем.
    nock.scale.setScalar(0.5 / BOW_SCALE);
    nock.visible = false;
    b.add(nock);
    this.nock = nock;
    // Левая рука на рукояти. Где у неё локоть, у опущенного лука и у натянутого
    // своё: опущенный держат у бедра, натянутый — на вытянутой руке.
    const hand = armModel(this.sleeveMat[0]);
    this.bowArmPose = {
      low: armPose(BOW_LOW, BOW_SCALE, [0, 0, 0], ARM_BOW_LOW.dir, [0, 1, 0]),
      drawn: armPose(BOW_DRAWN, BOW_SCALE, [0, 0, 0], ARM_BOW_DRAWN.dir, [0, 1, 0]),
    };
    b.add(hand);
    this.bowArm = hand;
    this.dressArms();
    this.bowInHand = b;
    this.camera.add(b);
  }

  /**
   * Рукав на обеих руках: лён, пока одежда не сшита, и мех — когда сшита.
   *
   * Меняется материал, а не рисунок и не модель: оба рукава испечены при входе.
   */
  private dressArms(): void {
    const fur = this.save.body.coat;
    this.armFur = fur;
    for (const hand of [this.axeArm, this.bowArm]) {
      const mesh = hand?.children[0] as THREE.Mesh | undefined;
      if (!mesh) continue;
      mesh.material = this.sleeveMat[fur ? 1 : 0];
      // Мех пышнее льна: рукав толще, длина та же.
      mesh.scale.set(fur ? 1.14 : 1, fur ? 1.14 : 1, 1);
    }
  }

  /** Стрелы в траве: по одной на запись. Их немного, поэтому просто пересобираем. */
  private syncArrows(): void {
    for (const o of this.stuck) this.drop(o);
    this.stuck = [];
    for (let i = 0; i < this.save.arrows.length; i++) {
      const a = this.save.arrows[i];
      const o = arrowModel();
      // Воткнулась под углом и торчит оперением вверх: лежащую в траве стрелу
      // не видно вовсе, а найти её надо глазом, а не перебором поляны ногами.
      o.position.set(a.x, 0.3, a.z);
      o.rotation.set(-1.15, hash(i, 71) * Math.PI * 2, 0);
      this.scene.add(o);
      this.stuck.push(o);
    }
  }

  /**
   * Зверь и туша: что из них сейчас на поляне.
   *
   * `fresh` — ставить ли оленя заново на его место. Так при входе и после
   * смерти он оказывается там, где его назвало правило (`deerHome`), а при
   * снятии куска с туши — остаётся где ходил.
   */
  private syncBeast(fresh: boolean): void {
    const now = serverNow();
    const live = deerLive(this.save.hunt, now);
    if (live && !this.deer) {
      const d = deerModel();
      d.add(blob(0.4, 0.72));
      this.deerHead = d.getObjectByName('head') ?? null;
      this.deerLegsF = d.getObjectByName('legsFront') ?? null;
      this.deerLegsB = d.getObjectByName('legsBack') ?? null;
      this.deer = d;
      this.scene.add(d);
      fresh = true;
    }
    if (!live && this.deer) {
      this.drop(this.deer);
      this.deer = null;
      this.deerHead = null;
      this.deerLegsF = null;
      this.deerLegsB = null;
    }
    if (live && fresh) {
      const home = deerHome(this.save.hunt);
      this.beast = { x: home.x, z: home.z, yaw: 0, homeX: home.x, homeZ: home.z, fleeUntil: 0, fleeYaw: 0, gait: 0 };
    }
    const c = liveCarcass(this.save.hunt, now);
    if (c && !this.carcass) {
      const m = carcassModel();
      m.position.set(c.x, 0, c.z);
      m.rotation.y = hash(this.save.hunt.killedAt * 0.001, 83) * Math.PI * 2;
      this.carcass = m;
      this.scene.add(m);
    }
    if (!c && this.carcass) {
      this.drop(this.carcass);
      this.carcass = null;
    }
  }

  /**
   * Записать новое состояние стрел и переставить те, что в траве.
   *
   * Одна дверь на все четыре случая — выстрел, приземление, подбор и
   * строгание, — потому что обещание у них общее: стрел не становится ни больше,
   * ни меньше, кроме выстроганных. Считает это `hunt.ts` чистыми операциями;
   * сцене остаётся положить ответ на место.
   */
  private stow(next: { quiver: number; arrows: readonly Pt[] }): void {
    this.save.quiver = next.quiver;
    this.save.arrows = next.arrows as Pt[];
    this.syncArrows();
  }

  /**
   * Положить летящую стрелу на землю там, где она должна была воткнуться.
   *
   * Нужно на двух выходах, где полёт обрывается не своим чередом: уход из
   * режима и новое утро после смерти. Из колчана она уже вычтена, на земле её
   * ещё нет — не приземли её здесь, и стрела пропала бы навсегда.
   */
  private groundFlight(): void {
    if (!this.flight) return;
    this.stow(landArrow(this.save, this.flight.land));
    this.dropFlight();
  }

  /** Убрать летящую стрелу, ничего не записывая: она никуда не долетела. */
  private dropFlight(): void {
    if (!this.flight) return;
    this.drop(this.flight.obj);
    this.flight = null;
  }

  private drop(o: THREE.Object3D): void {
    o.removeFromParent();
    disposeGeometries(o);
  }

  // ---------- Кадр ----------

  private loop = (): void => {
    if (this.stopped) return;
    this.frame = requestAnimationFrame(this.loop);
    const t = performance.now();
    // Потолок шага: вкладка могла простоять в фоне, и без него первый кадр
    // после возвращения был бы прыжком через полполяны.
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;

    this.step(dt, t);
    this.renderer.render(this.scene, this.camera);
  };

  private step(dt: number, t: number): void {
    const look = this.sticks.takeLook();
    // Пока идёт объятие, разговор с пришедшими или последняя сцена, взгляд и шаг
    // не принимаются: камера не у человека — или человек уже ничего не решает, и
    // сдвинутый за эти секунды взгляд вернулся бы не туда, откуда уходил.
    const held = this.hugAt > 0 || this.panel === 'raid' || this.watching();
    if (!held) {
      this.yaw += look.yaw;
      this.pitch = THREE.MathUtils.clamp(this.pitch + look.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    }

    const walk: Walk = held ? { forward: 0, strafe: 0 } : mergeWalk(this.sticks.walk(), this.keys.walk());
    const speed = Math.hypot(walk.forward, walk.strafe);
    if (speed > 0) {
      // Экранное «вперёд» — туда, куда смотрит голова, но по земле: задранный
      // взгляд не должен уводить шаг в небо.
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      const dx = (-sin * walk.forward + cos * walk.strafe) * WALK_SPEED * dt;
      const dz = (-cos * walk.forward - sin * walk.strafe) * WALK_SPEED * dt;
      const blocks = blockers(this.save.felled, serverNow(), this.save.house > 0, this.save.end.boards > 0);
      // Сквозь женщину не проходят: камера внутри человека — не разговор, а сбой.
      if (this.mate) blocks.push({ x: this.mate.x, z: this.mate.z, r: MATE_R });
      // Сквозь сына и пришедших — тем же правилом и по той же причине.
      if (this.son) blocks.push({ x: this.son.x, z: this.son.z, r: MATE_R });
      for (const f of this.foes) if (!f.down) blocks.push({ x: f.x, z: f.z, r: MATE_R });
      const p = slide(this.px + dx, this.pz + dz, blocks);
      this.px = p.x;
      this.pz = p.z;
      this.bob += speed * dt * 9;
    }
    this.walkK += (Math.min(1, speed) - this.walkK) * Math.min(1, dt * 6);
    // Вещи в руках качаются вдвое реже шага и заметнее камеры: качается рука, а не мир.
    this.bobX = Math.sin(this.bob * 0.5) * 0.014 * this.walkK;
    this.bobY = -Math.abs(Math.sin(this.bob * 0.5)) * 0.02 * this.walkK;

    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    /*
     * Покачивание при ходьбе — слабое, и проверено трезво, а не на глаз. Камера
     * ходит только вверх-вниз, на `CAM_BOB` (два с половиной сантиметра), с
     * частотой шага — полтора раза в секунду на полном ходу, — и без крена и
     * кивка: укачивают поворот горизонта и кивок взгляда, а подъём головы на два
     * сантиметра — это на трёх метрах меньше половины градуса. Сглажено ходом:
     * остановка не обрывает качание рывком. Стоит нисколько: два синуса на кадр.
     */
    const sway = Math.sin(this.bob) * CAM_BOB * this.walkK;
    this.camera.position.set(this.px, EYE + sway, this.pz);
    if (this.save.body.coat !== this.armFur) this.dressArms();

    const now = serverNow();
    this.surfaces.u.time.value = t / 1000;
    this.warmth();
    this.swing(t);
    this.aimBow(t);
    this.applySky(now);
    this.weatherStep(dt, t, now);
    this.beastStep(dt, t, now);
    this.syncPack(t);
    this.wolfStep(dt, t, now);
    this.howlStep(t, now);
    this.syncMate(false);
    this.mateStep(dt, t, now);
    this.homeNight(now);
    this.panelStep(now);
    this.arrowStep(dt);
    this.fire(t, dt);
    // Последним нарочно: объятие перекладывает камеру и отсвет огня поверх того,
    // что разложили шаг и костёр.
    this.hugStep(t);
    // И финал — за ним, по той же причине: последняя сцена кладёт камеру на
    // землю, а знать о ней шагу и костру незачем.
    this.endStep(dt, t, now);
    // Купол ездит за глазом — и за глазом под крышей в объятии тоже.
    this.dome.follow(this.camera.position);
    this.stick();
    this.persist(false);
    // Кадровая пересборка надписи — единственная, которую можно проредить: всё
    // остальное зовёт `refresh` само, в ту же минуту, когда случилось.
    if (t - this.viewedAt >= VIEW_EVERY) {
      this.viewedAt = t;
      this.refresh();
    }
  }

  /**
   * Вошёл в круг у огня или вышел из него.
   *
   * ЗДЕСЬ ГРАНИЦА ВРЕМЕНИ ПРОХОДИТ ЧЕРЕЗ САМОЕ УЗКОЕ МЕСТО ВСЕЙ ПАЧКИ, и потому
   * сказано подробно. Холод — величина, которая переживает выход, и считать её в
   * кадре нельзя. Но растёт она по-разному в зависимости от того, где стоит
   * человек, а где он стоит — это кадр и ничто иное.
   *
   * Мирит их вот что: **положение важно не само по себе, а моментом, когда оно
   * меняет знак.** Пересечение круга — это событие, такое же, как подложенные
   * дрова: отрезок закрывается формулой, отметка переезжает на текущую минуту, и
   * дальше опять считает формула. Кадр здесь только замечает событие; величину
   * он не двигает ни на волос.
   *
   * Отсюда и `if`: без него отметка переписывалась бы шестьдесят раз в секунду.
   * Числа от этого не поехали бы — разбиение у `coldAt` точное, — но на диск
   * уходила бы запись за записью, и «величина, которая копится в кадре» стала бы
   * правдой на вид, а такой правды в этом файле быть не должно.
   */
  private warmth(): void {
    const warm = byFire(this.px, this.pz);
    // Крыша — второй такой круг, и устроена она так же: пересёк — отрезок
    // закрыт. Крышей она становится только у достроенного дома: сруб без крыши
    // не укрывает.
    const roof = houseDone(this.save.house) && byHouse(this.px, this.pz);
    if (warm === this.save.body.warm && roof === this.save.body.roof) return;
    const now = serverNow();
    const b = setWarm(this.save.body, this.save.hearth, now, warm);
    this.save.body = setRoof(b, this.save.hearth, now, roof);
    this.persist(true);
  }

  /**
   * Показать, где сейчас стик ходьбы.
   *
   * Стик плавающий — появляется там, где лёг палец, а не стоит в углу: на
   * 375 px большой палец ложится куда дотянулся, и нарисованный заранее кружок
   * он промахивает. Значит, нарисовать его надо там же, где палец, и подвинуть
   * ободок туда, куда палец увели.
   */
  private stick(): void {
    const el = this.stickEl;
    if (!el) return;
    const s = this.sticks.stick;
    if (!s) {
      if (el.dataset.on === '1') {
        el.dataset.on = '0';
        el.style.opacity = '0';
      }
      return;
    }
    if (el.dataset.on !== '1') {
      el.dataset.on = '1';
      el.style.opacity = '1';
    }
    el.style.transform = `translate(${s.ox}px, ${s.oy}px)`;
    const knob = el.firstElementChild as HTMLElement | null;
    if (!knob) return;
    const dx = s.x - s.ox;
    const dy = s.y - s.oy;
    const len = Math.hypot(dx, dy);
    // Ободок не убегает за край стика: дальше полного отклонения он всё равно
    // ничего не значит, а уехавший кружок читается как поломка.
    const k = len > STICK_FULL ? STICK_FULL / len : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }

  /** Топор в покое: у правого края взгляда, лезвием вниз. */
  private restAxe(): void {
    const a = this.axeInHand;
    if (!a) return;
    // Раздвинуто на `viewK`: при шире угле топор стоит на экране там же, где стоял.
    a.position.set((AXE_REST.x + this.bobX) * this.viewK, (AXE_REST.y + this.bobY) * this.viewK, AXE_REST.z);
    a.rotation.set(AXE_REST.rx, AXE_REST.ry, AXE_REST.rz);
  }

  /**
   * Замах топора: подъём, удар, возврат. Целиком во времени сцены.
   *
   * Удар засчитывается **один раз** — по истечении замаха, а не по кадру, в
   * котором топор оказался внизу: кадры идут неровно, и «внизу» их бывает
   * несколько. Отсюда и порядок: сперва закрыть замах, потом звать `landChop`.
   */
  private swing(t: number): void {
    const w = this.work;
    if (!w) {
      this.restAxe();
      return;
    }
    // Нож, а не топор: кусок и шкуру снимают без замаха.
    const knife = w.kind === 'butcher' || w.kind === 'skin';
    const span = knife ? BUTCHER_MS : CHOP_MS;
    const k = (t - w.at) / span;
    if (k >= 1) {
      this.work = null;
      this.restAxe();
      this.landWork(w.kind);
      return;
    }
    const a = this.axeInHand;
    if (!a || knife) return;
    // Подъём, удар, возврат — три доли одного замаха.
    const up = Math.min(1, k / 0.35);
    const hit = Math.max(0, Math.min(1, (k - 0.35) / 0.25));
    const back = Math.max(0, (k - 0.6) / 0.4);
    a.rotation.set(AXE_REST.rx + up * 0.8 - hit * 2.4 + back * 1.6, AXE_REST.ry, AXE_REST.rz);
    a.position.set(AXE_REST.x * this.viewK, (AXE_REST.y + up * 0.22 - hit * 0.42 + back * 0.2) * this.viewK, AXE_REST.z);
  }

  /**
   * Лук в руке: опущен или поднят.
   *
   * Переход занимает четверть секунды, и это не украшение: мгновенно
   * появившийся посреди экрана лук игрок читает как сбой картинки, а не как
   * своё действие. Число никуда не пишется — время сцены целиком.
   */
  private aimBow(t: number): void {
    const b = this.bowInHand;
    if (!b) return;
    const k = this.drawn ? Math.min(1, (t - this.drawAt) / DRAW_MS) : 0;
    const at = (lo: number, hi: number): number => lo + (hi - lo) * k;
    // Натянутый лук не качается: в него целятся.
    const loose = 1 - k;
    const v = this.viewK;
    b.position.set(
      (at(BOW_LOW.x, BOW_DRAWN.x) + this.bobX * loose) * v,
      (at(BOW_LOW.y, BOW_DRAWN.y) + this.bobY * loose) * v,
      at(BOW_LOW.z, BOW_DRAWN.z),
    );
    b.rotation.set(at(BOW_LOW.rx, BOW_DRAWN.rx), at(BOW_LOW.ry, BOW_DRAWN.ry), at(BOW_LOW.rz, BOW_DRAWN.rz));
    if (this.bowArm && this.bowArmPose) {
      const { low, drawn } = this.bowArmPose;
      // Опущенный лук держат у бедра, и кулак ниже края кадра: в углу экрана он
      // читался комом, а не рукой. Рука появляется, когда лук поднимают.
      this.bowArm.visible = k > 0.08;
      this.bowArm.position.lerpVectors(low.p, drawn.p, k);
      this.bowArm.quaternion.slerpQuaternions(low.q, drawn.q, k);
      this.bowArm.scale.lerpVectors(low.s, drawn.s, k);
    }
    if (this.nock) {
      this.nock.visible = this.drawn;
      /*
       * Стрела смотрит туда же, куда камера, а не туда, куда повёрнут лук.
       *
       * Лук развёрнут к экрану нарочно: дуга, стоящая к игроку ребром, читается
       * палкой, а не луком — она же и есть окружность в плоскости взгляда.
       * Но стрела лежит НА тетиве и обязана указывать в цель, иначе картинка
       * врёт о том, куда полетит. Разворот у них поэтому взаимно гасится: лук
       * повёрнут по Y, стрела — на столько же обратно.
       */
      this.nock.rotation.y = -b.rotation.y;
      // Стрела уходит назад по мере натяжения: тетива тянется к щеке, а
      // наконечник остаётся у самой дуги — так держат натянутый лук.
      this.nock.position.set(-0.17 * k, 0.02, 0.05 + k * 0.3);
    }
    // Топор с натянутым луком в руках не держат. Прятать его надо не ради
    // правды жизни, а ради кадра: он висит там же, где целятся.
    if (this.axeInHand) this.axeInHand.visible = !this.drawn;
  }

  /**
   * Сколько волков должно стоять на поляне — и столько и ставит.
   *
   * Сколько их в стае, решает формула (`wolves.packAt`); сколько осталось —
   * формула минус положенные (`downed`). Разводить это надо: `packAt` отвечает
   * на вопрос «какая эта ночь», а не «кого ещё не убили», и без вычитания
   * зарубленный волк появлялся бы обратно в следующем же кадре.
   */
  private syncPack(t: number): void {
    // В финал волки не приходят вовсе: последняя сцена написана про людей, и
    // стая, вышедшая посреди неё, была бы не опасностью, а помехой (`act.death`
    // по той же причине не даёт умереть от голода и холода).
    if (endOn(this.save.end)) {
      for (const w of this.pack) this.drop(w.obj);
      this.pack = [];
      return;
    }
    const now = serverNow();
    const size = packAt(now, this.save.wolvesBeatenAt);
    if (size <= 0) this.downed = 0;
    const want = Math.max(0, size - this.downed);
    while (this.pack.length > want) {
      const w = this.pack.pop();
      if (w) this.drop(w.obj);
    }
    if (want > 0 && this.pack.length === 0) {
      // Стая только что вышла — вой обязан прийти раньше зубов.
      this.howlAt = t + HOWL_LEAD_MS;
      this.stalkFrom = 0;
    }
    while (this.pack.length < want) {
      const n = this.pack.length;
      const home = wolfSpot(now, n);
      const g = wolfModel(this.eyeMat);
      g.add(blob(0.3, 0.55));
      g.position.set(home.x, 0, home.z);
      this.scene.add(g);
      this.pack.push({
        obj: g,
        legs: g.getObjectByName('legs') ?? null,
        eyes: g.getObjectByName('eyes') ?? null,
        x: home.x,
        z: home.z,
        yaw: 0,
        homeX: home.x,
        homeZ: home.z,
        spin: n % 2 === 0 ? 1 : -1,
        gait: 0,
      });
    }
  }

  /** Волка положили: убрать из стаи и, если это был последний, записать минуту. */
  private slay(i: number, now: number): void {
    const w = this.pack[i];
    if (!w) return;
    this.drop(w.obj);
    this.pack.splice(i, 1);
    this.downed += 1;
    if (this.downed >= packAt(now, this.save.wolvesBeatenAt)) {
      // Стая отбита. Дальше тишину держит формула, а не этот счётчик.
      this.save.wolvesBeatenAt = now;
      this.downed = 0;
    }
    this.persist(true);
  }

  /**
   * Волки.
   *
   * ВРЕМЯ СЦЕНЫ ЦЕЛИКОМ, кроме одного события — укуса (`body.bite`), и оно
   * устроено так же, как пересечённый круг у костра и долетевшая стрела: кадр
   * замечает мгновение, величину считает формула.
   *
   * Состояний три, и они не про волка, а про **человека**:
   *
   *   человек у огня   волк бродит у своей опушки и к костру не подходит вовсе
   *                    (`wolfKeepsOut`). Отсчёт кружения сброшен;
   *   человек вышел    волк кружит вокруг него на `WOLF_STALK_R` — семь секунд,
   *                    на виду и с воем. Это и есть всё предупреждение;
   *   время вышло      бросается. Догнать человека он может (`WOLF_RUSH` против
   *                    2.6 м/с), но у костра всё равно остановится.
   *
   * Отсчёт начинается с минуты, в которую человек вышел из круга, а не с выхода
   * волка из леса: значит окно «увидел и решил» игрок получает каждый раз, а не
   * однажды за ночь.
   */
  private wolfStep(dt: number, t: number, now: number): void {
    if (!this.pack.length) return;
    const lit = burning(this.save.hearth, now);
    const home = houseDone(this.save.house);
    const safe = wolfKeepsOut(this.px, this.pz, lit, home);
    const glow = darkness(now) > EYES_FROM;
    if (safe) this.stalkFrom = 0;
    else if (!this.stalkFrom) this.stalkFrom = t;
    for (let i = this.pack.length - 1; i >= 0; i--) {
      const w = this.pack[i];
      if (w.eyes) w.eyes.visible = glow;
      // Спрашивается на каждом волке заново, а не один раз до цикла: укусивший
      // сдвигает отсчёт, и остальные в том же кадре уже не бросаются.
      const rush = wolfRushes(this.stalkFrom, t);
      let speed = 0;
      if (safe) {
        // Бродит у своей опушки — по той же кривой из двух синусов, что и
        // пасущийся олень: на глаз она не повторяется, а стоит нисколько.
        const s = t / 1000;
        const tx = w.homeX + Math.sin(s * 0.21 + i) * 2.4;
        const tz = w.homeZ + Math.sin(s * 0.13 + i * 2.1) * 2;
        speed = this.wolfGo(w, tx, tz, WOLF_TROT, dt);
      } else {
        if (rush) {
          // К человеку, но не сквозь него: встаёт в `WOLF_STOP` — оттуда и
          // кусает, а камера не оказывается внутри волка.
          const dx = this.px - w.x;
          const dz = this.pz - w.z;
          const d = Math.hypot(dx, dz) || 1;
          const go = Math.max(0, d - WOLF_STOP);
          speed = this.wolfGo(w, w.x + (dx / d) * go, w.z + (dz / d) * go, WOLF_RUSH, dt);
        } else {
          // Кружит: держится на своём радиусе и обходит человека боком.
          const a = Math.atan2(w.z - this.pz, w.x - this.px) + w.spin * dt * 0.5;
          const tx = this.px + Math.cos(a) * WOLF_STALK_R;
          const tz = this.pz + Math.sin(a) * WOLF_STALK_R;
          speed = this.wolfGo(w, tx, tz, WOLF_TROT, dt);
        }
      }
      // К горящему костру и в достроенный дом не подходят ни при каком шаге:
      // правило одно на сцену и на тест, и живёт оно в `wolves.ts`.
      this.keepOut(w, lit, home);
      const edge = Math.hypot(w.x, w.z);
      if (edge > WOLF_EDGE) {
        w.x = (w.x / edge) * WOLF_EDGE;
        w.z = (w.z / edge) * WOLF_EDGE;
      }
      w.gait += speed * dt * 4.2;
      const rushing = speed > WOLF_TROT;
      w.obj.position.set(w.x, Math.abs(Math.sin(w.gait)) * (rushing ? 0.05 : 0.015), w.z);
      w.obj.rotation.y = w.yaw;
      if (w.legs) w.legs.rotation.x = speed > 0 ? Math.sin(w.gait) * (rushing ? 0.7 : 0.35) : 0;
      if (!safe && rush && wolfCanBite(w.x, w.z, this.px, this.pz, lit, home)) {
        // Укус. Дальше отскакивает и кружит заново вся стая (`stalkAfterBite`).
        this.stalkFrom = stalkAfterBite(t);
        this.save.body = bite(this.save.body, this.save.hearth, now);
        this.done();
      }
    }
  }

  /**
   * Вытолкнуть волка из кругов, куда ему нельзя.
   *
   * Кругов два — у горящего огня и у достроенного дома, — и они перекрываются:
   * вытолкнутый из одного может оказаться в другом. Поэтому толчков несколько за
   * кадр, пока правило (`wolfKeepsOut`) не скажет «снаружи».
   */
  private keepOut(w: Wolf, lit: boolean, home: boolean): void {
    for (let k = 0; k < 4 && wolfKeepsOut(w.x, w.z, lit, home); k++) {
      const r = Math.hypot(w.x, w.z);
      if (lit && r < WOLF_FIRE_R) {
        const s = WOLF_FIRE_R / (r || 1);
        w.x *= s;
        w.z *= s;
      }
      if (home && byHouse(w.x, w.z)) {
        const dx = w.x - HOUSE.x;
        const dz = w.z - HOUSE.z;
        const s = (HOUSE_SHELTER_R + 0.01) / (Math.hypot(dx, dz) || 1);
        w.x = HOUSE.x + dx * s;
        w.z = HOUSE.z + dz * s;
      }
    }
  }

  /** Шагнуть волком к точке. Возвращает скорость шага — по ней идёт намёт. */
  private wolfGo(w: Wolf, tx: number, tz: number, speed: number, dt: number): number {
    const dx = tx - w.x;
    const dz = tz - w.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return 0;
    const step = Math.min(len, speed * dt);
    w.x += (dx / len) * step;
    w.z += (dz / len) * step;
    // Модель волка смотрит вдоль +Z, как и олень: поворот тот же.
    w.yaw = Math.atan2(dx, dz);
    return speed;
  }

  /**
   * Вой.
   *
   * ЗВУК ЖИВЁТ В КАДРЕ, И ЭТО НЕ РАЗМЫВАЕТ ГРАНИЦУ, А ПОДТВЕРЖДАЕТ ЕЁ: воя нет
   * в сохранении и быть не может — он не переживает даже сворачивания вкладки.
   * На чтении считается **есть ли волки**, а провыть некому, если их нет.
   *
   * Идёт он через общий переключатель звука и молчит, пока игрок не включил его
   * сам: выключенный звук не открывает контекста вовсе (`sound/howl.ts`).
   */
  private howlStep(t: number, now: number): void {
    if (!this.pack.length || t < this.howlAt) return;
    const seed = Math.floor(now / 1000);
    wolfHowl.howl(seed);
    this.howlAt = t + HOWL_GAP_MS + hash(seed, 99) * HOWL_SPREAD_MS;
  }

  /**
   * Непогода: дождь чертами, снег точками — одна видна за раз.
   *
   * Сила набирается и отпускается за `WET_FADE` — это картинка и только она.
   * Что дождь делает с очагом и снег с холодом, считают формулы (`sky.ts`), и
   * этому кадру о них знать нечего.
   */
  private weatherStep(dt: number, t: number, now: number): void {
    const here = weatherAt(now);
    if (here !== 'clear') this.wetKind = here;
    const want = here === 'clear' ? 0 : 1;
    const step = dt / WET_FADE;
    this.wet = want > this.wet ? Math.min(want, this.wet + step) : Math.max(want, this.wet - step);
    this.precip.update(dt, this.wetKind, this.wet, this.px, this.pz, this.yaw);
    // Снег на ветках и мокрая земля — из того же кольца погод, а не накоплением.
    // Зимой снег лежит на ветках всегда, снегопад только добавляет (`WINTER_SNOW`).
    this.surfaces.u.snow.value = Math.max(WINTER_SNOW, this.cover(now, 'snow', SNOW_GROW_MS, SNOW_MELT_MS));
    this.surfaces.u.wet.value = this.cover(now, 'rain', WET_GROW_MS, WET_DRY_MS);
    // Ветер порывами: два синуса разных частот, в дождь сильнее, в снег тише.
    const s = t / 1000;
    const gust = 0.5 + 0.5 * Math.sin(s * 0.37) * Math.sin(s * 0.23 + 1.7);
    this.wind = (here === 'rain' ? 1 : here === 'snow' ? 0.55 : 0.62) * (0.55 + 0.45 * gust);
    this.surfaces.u.wind.value = this.wind;
  }

  /**
   * Насколько легла непогода: снег на ветки или сырость на землю, 0..1.
   *
   * ЧИТАЕТСЯ ИЗ ЧАСОВ, А НЕ КОПИТСЯ В КАДРАХ. Сколько уже идёт снегопад, знает
   * кольцо погод (`sky.spellLeftMs`), и вошедший посреди снегопада застаёт ветки
   * белыми, а не голыми. После непогоды покров сходит за `fade`. В сохранение не
   * идёт ничего: это картинка.
   */
  private cover(now: number, kind: Weather, grow: number, fade: number): number {
    const into = SPELL_MS - spellLeftMs(now);
    const ease = (k: number): number => k * k * (3 - 2 * k);
    if (weatherAt(now) === kind) {
      let start = now - into;
      for (let i = 0; i < 16 && weatherAt(start - 1) === kind; i++) start -= SPELL_MS;
      return ease(Math.min(1, (now - start) / grow));
    }
    if (weatherAt(now - into - 1) !== kind) return 0;
    return ease(Math.max(0, 1 - into / fade));
  }

  /**
   * Свет по часу поляны и по погоде.
   *
   * `applyDayNight` — общий на всю игру риг, и про погоду он не знает нарочно:
   * он раскладывает лампы по часу, а ненастье гасится **поверх** него. Иначе
   * пришлось бы учить деревню и бой понятию «хмурится», которого у них нет.
   *
   * Перекладывается не каждый кадр, а по порогу: круг суток за кадр проходит
   * три десятитысячных, и переливать четыре цвета шестьдесят раз в секунду ради
   * этого незачем.
   */
  private applySky(now: number): void {
    const solar = sunAt(now);
    const g = gloom(now);
    if (Math.abs(solar - this.skySolar) < SKY_STEP && Math.abs(g - this.skyGloom) < GLOOM_STEP) return;
    this.skySolar = solar;
    this.skyGloom = g;
    applyDayNight(this.rig, this.scene, solar, this.season);
    // Цвет часа поверх рига: холодное утро, белый полдень, рыжий закат (`dome.ts`).
    const tone = toneAt(solar, this.tone);
    this.rig.sun.color.lerp(tone.light, tone.lightK);
    /*
     * Сумерки без солнца. Общий риг держит свет и после заката — деревне так
     * длиннее вечер, — и на поляне красный свет из-под горизонта красил кроны в
     * бежевое на розовом небе: лес выцветал, а не темнел. Здесь в сумерках лампа
     * гаснет: солнце ушло, луна ещё не встала, и лес стоит силуэтом против зари.
     * К глухой ночи свет возвращается — светит уже луна.
     */
    const elev = Math.sin(solar * Math.PI * 2);
    const dusk = 1 - Math.min(1, Math.abs(elev + 0.08) / 0.15);
    this.rig.sun.intensity *= 1 - 0.75 * dusk * dusk * (3 - 2 * dusk);
    // И низкое солнце слабее полуденного: у рига оно светит в полную силу до самого
    // горизонта, и кроны на закате выгорали в золото вместо того, чтобы теплеть.
    if (elev > 0) this.rig.sun.intensity *= 0.7 + 0.3 * Math.min(1, elev / 0.3);
    this.rig.sun.intensity *= 1 - 0.55 * g;
    this.rig.hemi.intensity *= 1 - 0.2 * g;
    // Какая непогода: та, что идёт, или та, что вот-вот придёт.
    const here = weatherAt(now);
    const tint = (here === 'clear' ? nextWeather(now) : here) === 'snow' ? SNOW_TINT : RAIN_TINT;
    this.dome.paint(tone, SUN_DIR.copy(this.rig.sun.position).normalize(), darkness(now), g, tint);
    // Туман и фон — цвета неба у горизонта: лес уходит в небо, а не упирается в него.
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.dome.haze);
    (this.scene.background as THREE.Color).copy(this.dome.horizon);
    // В дождь край видимости придвигается: лес тонет в серой мороси.
    fog.near = FOG_NEAR - (FOG_NEAR - FOG_NEAR_WET) * g;
    fog.far = FOG_FAR - (FOG_FAR - FOG_FAR_WET) * g;
  }

  /**
   * Олень.
   *
   * ВСЁ ЭТО — ВРЕМЯ СЦЕНЫ, И НИ ОДНО ЧИСЛО ОТСЮДА НЕ ПОПАДАЕТ В СОХРАНЕНИЕ.
   * Есть ли зверь на поляне и где он вышел — решает правило (`hunt.ts`); где он
   * стоит через двадцать секунд — решают кадры. Игрок, вернувшийся завтра,
   * застанет его не там, где оставил, и это правильно: зверь не стоит на паузе,
   * пока на него не смотрят.
   *
   * СЛУЧАЙНОСТИ ЗДЕСЬ НЕТ НИ ОДНОЙ, а предсказуемым олень всё равно не выходит,
   * и вот почему: пасётся он по плавной кривой из двух синусов разной частоты —
   * она не повторяется на глаз, — а срывается **от человека**. Куда он побежит,
   * зависит от того, с какой стороны подошли; значит, неопределённость даёт
   * игрок, а не бросок кости. Для охоты этого довольно: угадать нечего, потому
   * что зверь отвечает на твоё же движение.
   */
  private beastStep(dt: number, t: number, now: number): void {
    const d = this.deer;
    if (!d) return;
    const b = this.beast;
    const gap = Math.hypot(this.px - b.x, this.pz - b.z);
    const s = t / 1000;
    // Ночью зверь спит: срывается вдвое ближе и никуда не бродит. Считается это
    // на чтении (`hunt.deerSleeps`), кадр только смотрит на ответ.
    const asleep = deerSleeps(now);
    const flee = fleeRange(now);

    if (gap < flee && t > b.fleeUntil) {
      // Сорвался: бежит от человека и не разбирает дороги, пока не отдышится.
      b.fleeUntil = t + DEER_CALM_MS;
      b.fleeYaw = Math.atan2(b.x - this.px, b.z - this.pz);
    }
    const fleeing = t < b.fleeUntil;
    let speed = 0;
    if (fleeing) {
      let dx = Math.sin(b.fleeYaw);
      let dz = Math.cos(b.fleeYaw);
      // У края поляны бежит вдоль опушки, а не в стену: зверь, упёршийся в
      // невидимую границу, читается сломанным.
      const ahead = Math.hypot(b.x + dx * 2, b.z + dz * 2);
      if (ahead > GLADE_R - 1.4) {
        // Доворачивает на ходу — примерно полтора оборота в секунду вбок.
        b.fleeYaw += 2.7 * dt;
        dx = Math.sin(b.fleeYaw);
        dz = Math.cos(b.fleeYaw);
      }
      speed = DEER_RUN;
      b.x += dx * speed * dt;
      b.z += dz * speed * dt;
      b.yaw = Math.atan2(dx, dz);
    } else if (asleep) {
      // Спит: стоит на месте, голову не поднимает. Разбудить его можно только
      // подойдя — и тогда сработает ветка выше, а не эта.
      b.yaw += Math.sin(s * 0.3) * dt * 0.2;
    } else if (gap > DEER_ALERT) {
      // Пасётся: бродит вокруг своего места по кривой из двух синусов.
      const tx = b.homeX + Math.sin(s * 0.17) * 3.0;
      const tz = b.homeZ + Math.sin(s * 0.11 + 1.7) * 2.4;
      const dx = tx - b.x;
      const dz = tz - b.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.15) {
        speed = DEER_WALK;
        b.x += (dx / len) * speed * dt;
        b.z += (dz / len) * speed * dt;
        b.yaw = Math.atan2(dx, dz);
      }
    } else {
      // Заметил: стоит, подняв голову, и смотрит на человека.
      b.yaw = Math.atan2(this.px - b.x, this.pz - b.z);
    }
    if (!fleeing && b.fleeUntil > 0 && t >= b.fleeUntil) {
      // Отдышался — пасётся там, куда прибежал.
      b.homeX = b.x;
      b.homeZ = b.z;
      b.fleeUntil = 0;
    }
    const r = Math.hypot(b.x, b.z);
    if (r > GLADE_R - 1.0) {
      b.x = (b.x / r) * (GLADE_R - 1.0);
      b.z = (b.z / r) * (GLADE_R - 1.0);
    }

    b.gait += speed * dt * 3.4;
    d.position.set(b.x, 0, b.z);
    d.rotation.y = b.yaw;
    const swing = speed > 0 ? Math.sin(b.gait) * (fleeing ? 0.62 : 0.32) : 0;
    if (this.deerLegsF) this.deerLegsF.rotation.x = swing;
    if (this.deerLegsB) this.deerLegsB.rotation.x = -swing;
    // Голова: опущена в траву, пока пасётся, и вскинута, как только заметил.
    if (this.deerHead) {
      const want = asleep && !fleeing ? 0.98 : gap > DEER_ALERT && !fleeing ? 0.82 : -0.05;
      this.deerHead.rotation.x += (want - this.deerHead.rotation.x) * Math.min(1, dt * 7);
    }
  }

  /**
   * Стрела в полёте.
   *
   * Попадание проверяется на отрезке одного кадра, а не по прямой целиком: зверь
   * движется, и «пролетела мимо, потому что он успел шагнуть» — законный промах,
   * а не потерянное попадание.
   */
  private arrowStep(dt: number): void {
    const f = this.flight;
    if (!f) return;
    const step = ARROW_SPEED * dt;
    f.flown += step;
    f.x += f.dx * step;
    f.y += f.dy * step;
    f.z += f.dz * step;
    f.obj.position.set(f.x, f.y, f.z);
    if (this.deer && arrowHits(f.x, f.y, f.z, this.beast)) return this.hitBeast();
    // Волк — вторая цель стрелы, и порядок между ними ни на что не влияет: зверь
    // и волк не бывают в одной точке.
    for (let i = 0; i < this.pack.length; i++) {
      const w = this.pack[i];
      if (wolfHit(f.x, f.y, f.z, w.x, w.z)) return this.hitWolf(i);
    }
    if (f.flown < f.range && f.y > 0.05) return;
    // Долетела: воткнулась в землю там, где кончился полёт.
    this.stow(landArrow(this.save, f.land));
    this.dropFlight();
    this.done();
  }

  /**
   * Стрела нашла волка.
   *
   * Одной стрелы довольно, как и одного удара топором: волк — не крепость, а
   * опасность, и второй выстрел в него был бы не сложностью, а задержкой. Стрела
   * ложится рядом с телом тем же правилом, каким ложится у туши, — иначе
   * `nearest` выбирал бы между мясом и стрелой за игрока.
   */
  private hitWolf(i: number): void {
    const now = serverNow();
    const w = this.pack[i];
    const at = { x: w.x, z: w.z };
    this.slay(i, now);
    this.stow(landArrow(this.save, arrowByCarcass(at, this.save.arrows.length)));
    this.dropFlight();
    this.done();
  }

  /** Стрела нашла зверя. Один точный выстрел валит оленя, второго не нужно. */
  private hitBeast(): void {
    const now = serverNow();
    const at = { x: this.beast.x, z: this.beast.z };
    this.save.hunt = { killedAt: now, carcass: { x: at.x, z: at.z, taken: 0, skinned: false } };
    // Стрела остаётся рядом с тушей: мясо и стрелу берут порознь, иначе
    // `nearest` выбирал бы между ними за игрока.
    this.stow(landArrow(this.save, arrowByCarcass(at, this.save.arrows.length)));
    this.dropFlight();
    this.syncBeast(false);
    this.done();
  }

  /**
   * Огонь.
   *
   * Высота пламени и яркость отсвета идут от того, **сколько дров сейчас** —
   * то есть от формулы, а не от накопленного в кадре числа. Дрожь при этом
   * своя, кадровая: она ничего не значит и никуда не пишется.
   */
  private fire(t: number, dt: number): void {
    const now = serverNow();
    const fill = hearthFill(this.save.hearth, now);
    const alive = fill > 0;
    const s = t / 1000;
    // Даже полный костёр не вырастает вдвое: пламя — свеча масштаба, а не полоса.
    const size = alive ? 0.55 + fill * 0.55 : 0;
    if (this.flame) {
      this.flame.visible = alive;
      const f = size * (1 + Math.sin(s * 11) * 0.09);
      this.flame.scale.set(f, size * (1 + Math.sin(s * 9) * 0.13), f);
      this.flame.rotation.y = s * 2;
    }
    if (this.flameInner) {
      this.flameInner.visible = alive;
      this.flameInner.scale.setScalar(size);
      this.flameInner.rotation.y = -s * 3;
    }
    /*
     * НОЧЬЮ КОСТЁР — НАСТОЯЩИЙ СВЕТ. Днём отсвет почти не виден (солнце ярче в
     * разы), ночью он и есть освещение поляны: достаёт до стволов, до сруба и до
     * лица у очага (`FIRE_NIGHT`, `FIRE_DECAY`). Дрожь — три синуса разных частот,
     * и в яркости, и в месте: тени от огня живые, а не мигающие.
     */
    const night = darkness(now);
    const flick = 1 + Math.sin(s * 13.1) * 0.1 + Math.sin(s * 23.7 + 1.3) * 0.06 + Math.sin(s * 7.3 + 2.1) * 0.05;
    this.fireLight.intensity = alive ? (0.5 + fill * 0.9) * (1 + night * FIRE_NIGHT) * flick : 0;
    this.fireLight.position.set(FIRE.x + Math.sin(s * 5.3) * 0.06, 0.85 + Math.sin(s * 8.1) * 0.05, FIRE.z + Math.cos(s * 6.7) * 0.06);
    this.fireGlow.visible = alive;
    if (alive) {
      this.fireGlow.material.opacity = (0.12 + night * 0.58) * (0.85 + 0.15 * flick);
      this.fireGlow.scale.setScalar((0.95 + fill * 0.85) * (0.96 + 0.04 * flick));
    }
    const wx = WIND_DIR.x * this.wind;
    const wz = WIND_DIR.z * this.wind;
    this.sparks.update(s, alive, 0.2 + night * 0.8, wx, wz, size);
    this.smoke.points.visible = alive;
    if (alive) {
      this.smoke.update(dt, 0);
      // Ночью дым почти не виден: светит ему только сам огонь. Плотность у дыма
      // общая с деревней и лежит в материале, поэтому гасится она после `update`,
      // который её выставляет каждый кадр.
      const smokeMat = this.smoke.points.material as THREE.PointsMaterial;
      smokeMat.opacity *= 1 - night * 0.85;
      // Ветер тянет дым: чем выше клуб, тем дальше снесло. Место клуба `update`
      // пишет заново каждый кадр, поэтому снос не копится.
      const attr = this.smoke.points.geometry.attributes.position as THREE.BufferAttribute;
      const p = attr.array as Float32Array;
      for (let i = 0; i < attr.count; i++) {
        const up = Math.max(0, p[i * 3 + 1] - 0.8) / 5.5;
        p[i * 3] += wx * up * up * 2.4;
        p[i * 3 + 2] += wz * up * up * 2.4;
      }
      attr.needsUpdate = true;
    }
  }

  /**
   * Кто стоит у огня — и столько и ставит.
   *
   * Есть ли женщина, решает род на чтении (`kin.guestHere`, жена в записи); откуда
   * она взялась в кадре — сцена. Застал её, войдя, — стоит у очага (`fresh`):
   * пришла, пока человека не было. Пришла при нём — выходит из леса и идёт к огню.
   * Получила отказ — уходит тем же путём, и это уже только картинка: в записи её
   * нет с той минуты, когда прозвучал отказ.
   */
  private syncMate(fresh: boolean): void {
    const here = !!this.save.wife || guestHere(this.save, serverNow());
    if (here && !this.mate) {
      // Облик — той, кто это: жена остаётся той гостьей, которую приняли.
      const seed = this.lookOf();
      const g = womanModel(LOOKS[seed], seed);
      g.rotation.order = 'YXZ';
      const shade = blob(0.36, 0.32);
      g.add(shade);
      const at = fresh ? MATE_SPOT : GUEST_FROM;
      g.position.set(at.x, 0, at.z);
      this.scene.add(g);
      this.mate = {
        obj: g,
        body: (g.getObjectByName('body') as THREE.Mesh | undefined) ?? null,
        arms: g.getObjectByName('arms') ?? null,
        blob: shade,
        seed,
        x: at.x,
        z: at.z,
        yaw: 0,
        bend: 0,
        gait: 0,
      };
      if (!fresh) this.say('К огню вышла женщина.');
    }
    if (!here && this.mate) {
      if (this.leaving) this.dropFigure(this.leaving);
      this.leaving = this.mate;
      this.mate = null;
      if (this.panel === 'guest' || this.panel === 'wife' || this.panel === 'name') this.panel = '';
    }
  }

  /** Которая из гостий у огня: жена — по записанному имени, гостья — по числу отказов. */
  private lookOf(): number {
    const s = this.save;
    if (s.wife) {
      const name = s.wife.name;
      const i = GUESTS.findIndex((g) => g.name === name);
      return i < 0 ? 0 : i;
    }
    return Math.max(0, GUESTS.indexOf(guestOf(s.refused)));
  }

  /** Убрать женщину из кадра — вместе с её холстом и материалом. */
  private dropFigure(f: Figure): void {
    this.drop(f.obj);
    (f.obj.userData.release as (() => void) | undefined)?.();
  }

  /**
   * Лицо: какое выражение сейчас и не моргнула ли.
   *
   * Гостья настороже — чужой огонь, чужой человек. Жена спокойна, а когда любви
   * много — теплеет. Выражение выводится из записи (`kin.love`), моргание — из
   * времени сцены; ни то, ни другое никуда не пишется. Каждая моргает в свой
   * черёд: две женщины, моргнувшие разом, читались бы механизмом.
   */
  private face(f: { body: THREE.Mesh | null; seed: number }, t: number, wary: boolean): void {
    if (!f.body) return;
    const cycle = BLINK_EVERY + f.seed * 370;
    const blink = (t + f.seed * 1234) % cycle < BLINK_MS;
    const mood: Mood = blink ? MOOD_BLINK : wary ? MOOD_WARY : love(this.save.bond) >= WARM_FROM ? MOOD_WARM : MOOD_CALM;
    setMood(f.body, mood);
  }

  /**
   * Женщина в кадре: идёт к очагу, хлопочет у него, оборачивается к подошедшему.
   *
   * ВСЁ ЭТО ВРЕМЯ СЦЕНЫ. Хлопочет она, только когда есть над чем: жена у горящего
   * огня, и человек не рядом. У погасшего очага стоит лицом к нему и ждёт дров;
   * гостья к чужому огню не притрагивается. Подошёл человек — выпрямляется и
   * поворачивается к нему: это и есть «встречает», сказанное телом, а не словом.
   */
  private mateStep(dt: number, t: number, now: number): void {
    const m = this.mate;
    // Пока её уводят, шаг ей задаёт последняя сцена, а не этот разбор: иначе он
    // тянул бы её обратно к очагу из рук того, кто её взял.
    if (this.beat === 'lead' || this.beat === 'blind' || this.beat === 'over') return;
    if (m) {
      const toSpot = Math.hypot(MATE_SPOT.x - m.x, MATE_SPOT.z - m.z);
      const toMe = Math.hypot(this.px - m.x, this.pz - m.z);
      let speed = 0;
      // В человека она не входит: встала и ждёт, пока он отойдёт с дороги.
      if (toSpot > 0.05 && toMe > MATE_R + BODY_R + 0.25) speed = this.mateGo(m, MATE_SPOT.x, MATE_SPOT.z, dt);
      const near = toMe < MATE_NEAR;
      const tend = speed === 0 && !near && !!this.save.wife && burning(this.save.hearth, now);
      if (speed === 0) {
        const want = near ? Math.atan2(this.px - m.x, this.pz - m.z) : Math.atan2(FIRE.x - m.x, FIRE.z - m.z);
        m.yaw = turnToward(m.yaw, want, dt * 3);
      }
      m.bend += ((tend ? 0.28 : 0) - m.bend) * Math.min(1, dt * 4);
      const s = t / 1000;
      const arm =
        speed > 0
          ? Math.sin(m.gait) * 0.22
          : tend
            ? -0.85 + Math.sin(s * 2.2) * 0.2
            : near && this.save.wife
              ? -0.18
              : Math.sin(s * 1.3) * 0.03;
      if (m.arms) m.arms.rotation.x += (arm - m.arms.rotation.x) * Math.min(1, dt * 6);
      m.obj.position.set(m.x, speed > 0 ? Math.abs(Math.sin(m.gait)) * 0.03 : 0, m.z);
      m.obj.rotation.set(m.bend, m.yaw, 0);
      // Пятно тени лежит на земле, а не наклоняется к огню вместе с ней.
      if (m.blob) m.blob.rotation.x = -m.bend;
      this.face(m, t, !this.save.wife);
    }
    const l = this.leaving;
    if (!l) return;
    if (Math.hypot(GUEST_FROM.x - l.x, GUEST_FROM.z - l.z) < 0.3) {
      this.dropFigure(l);
      this.leaving = null;
      return;
    }
    this.mateGo(l, GUEST_FROM.x, GUEST_FROM.z, dt);
    if (l.arms) l.arms.rotation.x = Math.sin(l.gait) * 0.22;
    l.obj.position.set(l.x, Math.abs(Math.sin(l.gait)) * 0.03, l.z);
    l.obj.rotation.set(0, l.yaw, 0);
    this.face(l, t, true);
  }

  /** Шагнуть женщиной к точке. Возвращает скорость шага — по ней идёт покачивание. */
  private mateGo(f: Figure, tx: number, tz: number, dt: number): number {
    const dx = tx - f.x;
    const dz = tz - f.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return 0;
    const step = Math.min(len, MATE_WALK * dt);
    f.x += (dx / len) * step;
    f.z += (dz / len) * step;
    f.yaw = Math.atan2(dx, dz);
    f.gait += step * 5.5;
    return MATE_WALK;
  }

  // ---------- Финал ----------

  /**
   * Смотрит ли игрок последнюю сцену — то есть перестал ли он в ней решать.
   *
   * С этой минуты шаг и взгляд не принимаются, надстройка убирает кнопки, а
   * камера принадлежит сцене. Считается по такту, а не по ступени: пока идёт
   * драка, игрок ещё решает, и отнимать у него ход нельзя.
   */
  private watching(): boolean {
    if (this.save.end.stage !== 'raid' || !this.answerAt) return false;
    return this.beat === 'fall' || this.beat === 'take' || this.beat === 'lead' || this.beat === 'blind' || this.beat === 'over';
  }

  /**
   * Что стоит на поляне из финала: сын, сруб сына, пришедшие.
   *
   * `fresh` — вход в режим: тогда сын уже стоит на месте, а не выходит, и
   * последняя сцена начинается сначала (`end.ts`, шапка).
   */
  private syncEnd(fresh: boolean): void {
    const e = this.save.end;
    const wantSon = familyHere(e) && this.save.heir !== null;
    if (wantSon && !this.son) {
      const g = boyModel(BOY_LOOK, 7);
      g.rotation.order = 'YXZ';
      const shade = blob(0.26, 0.24);
      g.add(shade);
      g.position.set(SON_SPOT.x, 0, SON_SPOT.z);
      this.scene.add(g);
      this.son = {
        obj: g,
        body: (g.getObjectByName('body') as THREE.Mesh | undefined) ?? null,
        arms: g.getObjectByName('arms') ?? null,
        blob: shade,
        seed: 7,
        x: SON_SPOT.x,
        z: SON_SPOT.z,
        yaw: Math.atan2(FIRE.x - SON_SPOT.x, FIRE.z - SON_SPOT.z),
        bend: 0,
        gait: 0,
      };
    }
    if (!wantSon && this.son) {
      this.dropFigure(this.son);
      this.son = null;
    }
    // Жена в финале стоит у огня всегда: ступень «Семья» с пустым местом рядом с
    // сыном читалась бы поломкой, а не сценой.
    if (familyHere(e)) this.syncMate(fresh);
    this.syncFrame();
    if (e.stage === 'raid' && fresh) this.beginRaid();
  }

  /** Сруб сына: пересобирается только когда досок стало больше. */
  private syncFrame(): void {
    const e = this.save.end;
    const want = e.stage === 'build' || e.stage === 'raid' ? Math.min(BOARDS, e.boards) : -1;
    if (want === this.frameShown) return;
    if (this.frameObj) this.drop(this.frameObj);
    this.frameObj = null;
    this.frameShown = want;
    if (want < 0) return;
    this.frameObj = this.surfaces.adopt(frameModel(want));
    this.scene.add(this.frameObj);
  }

  /**
   * «Прошло много дней…» — и семья у огня.
   *
   * ЧТО ЗДЕСЬ ПОДСТАВЛЕНО И ПОЧЕМУ ЭТО ЧЕСТНО. Человек входит в финал целым,
   * сытым и в тепле, у огня низко горит, а в руках у него два полена и два куска
   * жареного. Это не подарок за код: прошло много дней, и всё это время семья
   * жила — ходила за дровами, коптила мясо, топила очаг. Не подставить их
   * значило бы начать последнюю сцену с похода за дровами, то есть с того, что
   * игрок уже делал два часа, а задание ступени («подложить дров, накормить
   * обоих») стало бы невыполнимым у того, кто вошёл в финал с пустыми руками.
   */
  private beginFamily(): void {
    const now = serverNow();
    const s = this.save;
    s.end = { ...s.end, stage: 'family', wood: false, wife: false, son: false };
    s.body = { ...newBody(now), coat: s.body.coat };
    // Очаг низкий нарочно: «подложить дров» — задание, и оно обязано быть
    // выполнимым. Полный очаг сказал бы «и так полон» на первое же нажатие.
    s.hearth = { fuel: 1.2, at: now, ...(s.hearth.kept ? { kept: true as const } : {}) };
    s.logs = Math.max(s.logs, 2);
    s.meat = { cooked: Math.max(s.meat.cooked, 2), raw: s.meat.raw };
    this.px = START.x;
    this.pz = START.z;
    this.yaw = yawTo(START.x, START.z, FIRE.x, FIRE.z);
    this.pitch = -0.06;
    this.panel = '';
    this.said = '';
    this.blindShow(0);
    this.syncEnd(true);
    this.say(FAMILY_NOTE);
    this.done();
  }

  /**
   * Вышел из палатки: новое дело, новый день.
   *
   * Затемнение здесь того же рода, что в объятии, и того же размера: переезд
   * человека от огня к палатке на глазах читался бы сбоем, а не утром.
   */
  private beginBuild(): void {
    const s = this.save;
    s.end = { ...s.end, stage: 'build' };
    // От палатки, лицом к месту будущего сруба: он там, куда человек и смотрит.
    const dx = FIRE.x - TENT.x;
    const dz = FIRE.z - TENT.z;
    const len = Math.hypot(dx, dz);
    const out = TENT.r + BODY_R + 0.1;
    this.px = TENT.x + (dx / len) * out;
    this.pz = TENT.z + (dz / len) * out;
    this.yaw = yawTo(this.px, this.pz, SON_HOUSE.x, SON_HOUSE.z);
    this.pitch = -0.06;
    this.panel = '';
    this.said = '';
    this.dimAt = performance.now();
    this.syncFrame();
    this.say(BUILD_NOTE);
    this.done();
  }

  /**
   * Пришли пятеро.
   *
   * Отсюда и до конца всё живёт в кадрах: в записи стоит одна ступень `raid`, и
   * вернувшийся после выхода смотрит сцену сначала. Ватага выходит **не оттуда,
   * откуда приходила гостья**: из леса за спиной у дома, то есть со стороны, куда
   * человек в эту минуту не смотрит, — он ставит сруб.
   */
  private beginRaid(): void {
    this.save.end = { ...this.save.end, stage: 'raid', boards: BOARDS };
    this.raidAt = performance.now();
    this.answerAt = 0;
    this.fightMs = BEAT.fightMs;
    this.beat = '';
    this.panel = '';
    this.said = '';
    this.drawn = false;
    this.blindShow(0);
    for (const f of this.foes) this.drop(f.obj);
    this.foes = [];
    this.foeList = [];
    if (!this.foeSkin) this.foeSkin = skinOf(RAIDER_LOOK, 3);
    for (let i = 0; i < RAIDERS; i++) {
      const at = RAID_FROM[i];
      // Рост — из того же хеша, что и весь разброс поляны: случайности здесь нет
      // ни одной, и ватага у всех игроков одна и та же.
      const tall = 0.94 + hash(i, 91) * 0.12;
      const g = raiderModel(this.foeSkin.mat, tall);
      g.rotation.order = 'YXZ';
      g.add(blob(0.34, 0.3));
      g.position.set(at.x, 0, at.z);
      // Троим топор, двоим лук: по этому их и различают в кадре.
      const bow = i >= RAIDERS_MELEE;
      const weapon = bow ? bowModel() : axeModel();
      weapon.scale.setScalar(bow ? 0.9 : 0.8);
      weapon.position.set(RAIDER_HAND.x, RAIDER_HAND.y * tall, RAIDER_HAND.z);
      weapon.rotation.set(bow ? 0 : -0.5, bow ? Math.PI / 2 : 0, bow ? 0.2 : 0.4);
      g.add(weapon);
      this.scene.add(g);
      this.foes.push({
        obj: g,
        body: (g.getObjectByName('body') as THREE.Mesh | undefined) ?? null,
        arms: g.getObjectByName('arms') ?? null,
        weapon,
        bow,
        x: at.x,
        z: at.z,
        yaw: 0,
        gait: 0,
        seed: i,
        down: false,
        hitAt: 0,
      });
    }
    this.say(RAID_NOTE);
    this.done();
  }

  /**
   * Положить пришедшего.
   *
   * Правило волка целиком: валится с одного удара и **сразу**, а не по концу
   * замаха. Положенный ложится на землю и больше не делает ничего — ни встаёт,
   * ни исчезает: тело на поляне и есть то, что игрок успел сделать.
   */
  private downFoe(i: number): void {
    const f = this.foeList[i];
    if (!f || f.down) return;
    f.down = true;
    f.obj.rotation.set(-Math.PI / 2.2, f.yaw, 0);
    f.obj.position.y = 0.16;
    if (f.weapon) f.weapon.visible = false;
    // Всех троих положили — драка кончилась, и ждать её срока незачем: двое с
    // луками поднимают их сразу.
    const standing = this.foes.filter((o) => !o.bow && !o.down).length;
    if (standing === 0 && this.answerAt) {
      this.fightMs = Math.min(this.fightMs, performance.now() - this.answerAt + 900);
    }
  }

  /**
   * Финал, кадр за кадром.
   *
   * Ступени переключает то, что сделал игрок (`act`), а здесь только то, что
   * тянется: переход после имени сына, затемнение выхода из палатки, шаг сына у
   * огня и вся последняя сцена по тактам (`end.beatOf`).
   */
  private endStep(dt: number, t: number, now: number): void {
    const e = this.save.end;
    if (e.stage === 'none') {
      // Имя сыну дали только что: строка о рождении ещё висит, и обрывать её
      // чёрным экраном на полуслове нельзя.
      if (this.passAt && t >= this.passAt) {
        this.passAt = 0;
        this.save.end = { ...e, stage: 'passed' };
        this.done();
      }
      return;
    }
    if (this.dimAt) {
      const k = (t - this.dimAt) / DIM_MS;
      if (k >= 1) {
        this.dimAt = 0;
        this.endShow(0);
      } else {
        this.endShow(1 - smooth(k));
      }
    }
    if (e.stage === 'passed' || e.stage === 'over') return;
    this.kinStep(dt, t);
    if (e.stage === 'family') {
      if (familyDone(e)) this.beginBuild();
      return;
    }
    if (e.stage === 'build') return;
    this.raidStep(dt, t, now);
  }

  /** Сын у огня: стоит, оборачивается к подошедшему, дышит. Время сцены целиком. */
  private kinStep(dt: number, t: number): void {
    const m = this.son;
    if (!m) return;
    // Пока его уводят, шаг ему задаёт последняя сцена, а не этот разбор.
    if (this.beat === 'lead' || this.beat === 'blind' || this.beat === 'over') return;
    const toMe = Math.hypot(this.px - m.x, this.pz - m.z);
    const want = toMe < MATE_NEAR ? Math.atan2(this.px - m.x, this.pz - m.z) : Math.atan2(FIRE.x - m.x, FIRE.z - m.z);
    m.yaw = turnToward(m.yaw, want, dt * 3);
    if (m.arms) {
      const arm = Math.sin(t / 1000 * 1.6) * 0.05;
      m.arms.rotation.x += (arm - m.arms.rotation.x) * Math.min(1, dt * 6);
    }
    m.obj.position.set(m.x, 0, m.z);
    m.obj.rotation.set(0, m.yaw, 0);
    this.face(m, t, false);
  }

  /** Последняя сцена: приход, разговор, драка, стрелы, падение, уход. */
  private raidStep(dt: number, t: number, now: number): void {
    if (!this.answerAt) {
      const ms = t - this.raidAt;
      for (let i = 0; i < this.foes.length; i++) {
        const f = this.foes[i];
        const at = RAID_STAND[i];
        this.foeGo(f, at.x, at.z, dt, t);
      }
      if (ms >= BEAT.talk && this.panel !== 'raid') {
        this.panel = 'raid';
        this.said = '';
        this.refresh();
      }
      return;
    }
    const ms = t - this.answerAt;
    const b = beatOf(ms, this.fightMs);
    if (b !== this.beat) {
      this.beat = b;
      if (b === 'loose') this.shoot();
      if (b === 'over') {
        this.save.end = { ...this.save.end, stage: 'over' };
        this.dropShots();
        this.done();
        return;
      }
      this.refresh();
    }
    const into = ms - beatFrom(b, this.fightMs);
    if (b === 'fight') this.foeFight(dt, t, now);
    else this.foeAfter(b, into, dt, t);
    this.endCamera(b, into);
    this.blindShow(this.blindK(b, into));
  }

  /** Драка: трое идут к человеку и бьют, двое стоят с луками. */
  private foeFight(dt: number, t: number, now: number): void {
    for (let i = 0; i < this.foes.length; i++) {
      const f = this.foes[i];
      if (f.down) continue;
      if (f.bow) {
        this.foeFace(f, dt);
        continue;
      }
      const d = Math.hypot(this.px - f.x, this.pz - f.z);
      if (d > FOE_REACH) {
        this.foeGo(f, this.px, this.pz, dt, t);
        continue;
      }
      this.foeFace(f, dt);
      if (t - f.hitAt < FOE_HIT_GAP) continue;
      f.hitAt = t;
      // Удар — событие, ровно как укус волка: отрезок закрывается формулой, урон
      // растёт на удар, отметка переезжает. Убить он не может — в финале не
      // умирают (`act.death`), — и бьёт он в двенадцать раз слабее зубов.
      this.save.body = bite(this.save.body, this.save.hearth, now, FOE_HIT);
      if (f.arms) f.arms.rotation.x = -1.5;
      this.persist(true);
      this.refresh();
    }
  }

  /** После драки: целятся, стреляют, подходят к своим и уводят. */
  private foeAfter(b: Beat, into: number, dt: number, t: number): void {
    for (let i = 0; i < this.foes.length; i++) {
      const f = this.foes[i];
      if (f.down) continue;
      if (b === 'aim' || b === 'loose' || b === 'fall') {
        this.foeFace(f, dt);
        // Лук поднят: руки вперёд и вверх. Топорники стоят.
        if (f.bow && f.arms) f.arms.rotation.x += (-1.35 - f.arms.rotation.x) * Math.min(1, dt * 6);
        continue;
      }
      if (b === 'take') {
        // Двое с луками идут к жене и сыну; остальные стоят.
        if (!f.bow) continue;
        const who = i === RAIDERS_MELEE ? this.mate : this.son;
        if (who) this.foeGo(f, who.x + 0.9, who.z + 0.2, dt, t);
        continue;
      }
      // Уводят. Жена и сын идут рядом с теми, кто их взял.
      this.foeGo(f, RAID_AWAY.x, RAID_AWAY.z, dt, t);
      if (!f.bow) continue;
      const who = i === RAIDERS_MELEE ? this.mate : this.son;
      if (!who) continue;
      this.leadAway(who, f, dt, t);
    }
  }

  /** Ведомый идёт за тем, кто его взял, и оборачивается назад — на поляну. */
  private leadAway(who: Figure, by: Foe, dt: number, t: number): void {
    const tx = by.x + 0.85;
    const tz = by.z + 0.25;
    const dx = tx - who.x;
    const dz = tz - who.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.05) {
      const step = Math.min(len, FOE_WALK * 0.92 * dt);
      who.x += (dx / len) * step;
      who.z += (dz / len) * step;
      who.gait += step * 5.2;
      who.yaw = turnToward(who.yaw, Math.atan2(dx, dz), dt * 4);
    }
    if (who.arms) who.arms.rotation.x = Math.sin(who.gait) * 0.2;
    who.obj.position.set(who.x, Math.abs(Math.sin(who.gait)) * 0.03, who.z);
    who.obj.rotation.set(0, who.yaw, 0);
    this.face(who, t, true);
  }

  /** Повернуться лицом к человеку. */
  private foeFace(f: Foe, dt: number): void {
    f.yaw = turnToward(f.yaw, Math.atan2(this.px - f.x, this.pz - f.z), dt * 4);
    f.obj.rotation.set(0, f.yaw, 0);
    if (f.arms) f.arms.rotation.x += (0 - f.arms.rotation.x) * Math.min(1, dt * 4);
  }

  /** Шагнуть пришедшим к точке. Возвращает скорость — по ней идёт покачивание. */
  private foeGo(f: Foe, tx: number, tz: number, dt: number, t: number): number {
    const dx = tx - f.x;
    const dz = tz - f.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.08) {
      this.foeFace(f, dt);
      f.obj.position.set(f.x, 0, f.z);
      return 0;
    }
    const step = Math.min(len, FOE_WALK * dt);
    f.x += (dx / len) * step;
    f.z += (dz / len) * step;
    f.yaw = turnToward(f.yaw, Math.atan2(dx, dz), dt * 5);
    f.gait += step * 4.6;
    if (f.arms) f.arms.rotation.x = Math.sin(f.gait) * 0.24;
    f.obj.position.set(f.x, Math.abs(Math.sin(f.gait)) * 0.035, f.z);
    f.obj.rotation.set(0, f.yaw, 0);
    this.face(f, t, true);
    return FOE_WALK;
  }

  /** Две стрелы: они не запись и не охота — картинка на девять десятых секунды. */
  private shoot(): void {
    this.dropShots();
    for (const f of this.foes) {
      if (!f.bow || f.down) continue;
      const o = arrowModel();
      o.position.set(f.x, 1.2, f.z);
      this.scene.add(o);
      this.shots.push(o);
    }
  }

  private dropShots(): void {
    for (const o of this.shots) this.drop(o);
    this.shots = [];
  }

  /**
   * Камера последней сцены: человек падает и смотрит с земли на то, как уводят.
   *
   * Взгляд сам идёт за сыном — это и есть последний кадр режима, и наводить его
   * игроку нечем: рук у него больше нет.
   */
  private endCamera(b: Beat, into: number): void {
    if (b === 'fight' || b === 'aim' || b === 'loose') {
      for (const o of this.shots) {
        // Стрела летит к человеку: доля такта и есть её путь.
        const k = Math.min(1, into / BEAT.loose);
        o.position.set(o.position.x + (this.px - o.position.x) * k * 0.35, 1.2 - k * 0.2, o.position.z + (this.pz - o.position.z) * k * 0.35);
      }
      return;
    }
    const k = b === 'fall' ? smooth(Math.min(1, into / BEAT.fall)) : 1;
    const eye = EYE + (FALL_EYE - EYE) * k;
    this.camera.position.set(this.px, eye, this.pz);
    // Взгляд поворачивается к сыну: последнее, что человек видит, — как он
    // уходит. Медленно: рывком голова лежащего не двигается.
    const who = this.son ?? this.mate;
    if (who) this.yaw = turnToward(this.yaw, yawTo(this.px, this.pz, who.x, who.z), 0.02);
    this.pitch = this.pitch + (FALL_PITCH - this.pitch) * 0.03;
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (this.axeInHand) this.axeInHand.visible = false;
    if (this.bowInHand) this.bowInHand.visible = false;
    if (this.shots.length) this.dropShots();
  }

  /** Насколько померкло зрение на этом такте. */
  private blindK(b: Beat, into: number): number {
    if (b === 'fall') return 0.1 + 0.15 * Math.min(1, into / BEAT.fall);
    if (b === 'take') return 0.25 + 0.12 * Math.min(1, into / BEAT.take);
    if (b === 'lead') return 0.37 + 0.23 * Math.min(1, into / BEAT.lead);
    if (b === 'blind' || b === 'over') return 0.6 + 0.4 * Math.min(1, into / BEAT.blind);
    return 0;
  }

  /**
   * Меркнущее зрение: дымка по краям, веки и чернота.
   *
   * Веки закрываются не разом: дважды приоткрываются — и в эти доли секунды
   * человек и видит, как сын уходит вдаль. Кривая одна и живёт здесь, а не в
   * стилях: доли у век и у дымки обязаны быть одним числом.
   */
  private blindShow(k: number): void {
    const el = this.blindEl;
    if (!el) return;
    const haze = Math.min(0.92, k * 1.5);
    const u = Math.max(0, (k - 0.6) / 0.4);
    const lid = k < 0.6 ? 0 : blink(u);
    const black = Math.max(0, (k - 0.94) / 0.06);
    el.style.visibility = k > 0 ? 'visible' : 'hidden';
    const dim = el.children[0] as HTMLElement | undefined;
    const top = el.children[1] as HTMLElement | undefined;
    const bot = el.children[2] as HTMLElement | undefined;
    const out = el.children[3] as HTMLElement | undefined;
    if (dim) dim.style.opacity = haze.toFixed(3);
    if (top) top.style.height = `${(lid * 52).toFixed(2)}%`;
    if (bot) bot.style.height = `${(lid * 52).toFixed(2)}%`;
    if (out) out.style.opacity = black.toFixed(3);
  }

  /** Затемнение перехода «вышел из палатки»: тот же узел, четвёртым ребёнком. */
  private endShow(veil: number): void {
    const el = this.blindEl;
    if (!el) return;
    const out = el.children[3] as HTMLElement | undefined;
    el.style.visibility = veil > 0 ? 'visible' : 'hidden';
    if (out) out.style.opacity = veil.toFixed(3);
  }

  /**
   * Засчитать дело общей жизни — если в эти сутки поляны оно ещё не засчитано.
   *
   * Любовь при этом не считается здесь ни на волос: копятся дни (`kin.tally`),
   * любовь из них выводится (`kin.love`). Дошла до ста — жена хочет что-то
   * сказать, и об этом говорится сразу: в открытом разговоре — самим разговором,
   * без него — строкой поверх сцены.
   */
  private together(kind: BondKind, now: number): void {
    const w = this.save.wife;
    if (!w) return;
    const was = loveFull(this.save.bond);
    const next = tally(this.save.bond[kind], now);
    if (next === this.save.bond[kind]) return;
    this.save.bond = { ...this.save.bond, [kind]: next };
    if (was || this.save.heir || !loveFull(this.save.bond)) return;
    if (this.panel === 'wife') {
      this.panel = 'name';
      this.said = '';
    } else {
      this.say(`${w.name} хочет тебе что-то сказать.`);
    }
  }

  /**
   * Ночь застала дома — четвёртое место, где кадр касается записи, и тоже событием.
   *
   * «Пережитая вместе ночь» — ночь, которую человек встретил у своего огня или под
   * своей крышей, пока в доме жена. Где он стоит, знает только кадр — ровно как в
   * `warmth`, — поэтому кадр замечает мгновение, а в запись ложится одно:
   * засчитанный день (`kin.tally`), не чаще раза в сутки поляны. Ночи, прошедшие
   * без игрока, не засчитываются: вместе — значит вместе.
   */
  private homeNight(now: number): void {
    const s = this.save;
    if (!s.wife || !isNight(now) || !counts(s.bond.night, now)) return;
    if (!byFire(this.px, this.pz) && !byHouse(this.px, this.pz)) return;
    if (!this.alive(now)) return;
    this.together('night', now);
    this.done();
  }

  /** Карточка закрывается сама, когда от разговора ушли: шаг назад — нет, уход — да. */
  private panelStep(now: number): void {
    if (!this.panel) return;
    // Вещи при себе, где ни стой: окно вещей закрывает только смерть — и сам игрок.
    const gone = !this.alive(now)
      ? true
      : this.panel === 'pack' || this.panel === 'raid'
        ? false
        : this.panel === 'kin'
        ? Math.hypot(this.px - HOUSE.x, this.pz - HOUSE.z) - HOUSE.r > REACH + TALK_SLACK
        : this.panel === 'son'
          ? !this.son || Math.hypot(this.px - this.son.x, this.pz - this.son.z) - MATE_R > REACH + TALK_SLACK
          : !this.mate || Math.hypot(this.px - this.mate.x, this.pz - this.mate.z) - MATE_R > REACH + TALK_SLACK;
    if (!gone) return;
    this.panel = '';
    this.said = '';
    this.refresh();
  }

  /**
   * Объятие: кадр гаснет, камера оказывается под крышей и поднимает взгляд к
   * потолку, над ним встаёт знак, кадр гаснет снова — и обычный вид.
   *
   * ПРИЁМ ИЗВЕСТНЫЙ, И НИЧЕГО СВЕРХ НЕГО: ни фигур под крышей, ни слов. Время сцены
   * целиком. В запись ложится одно — день объятия (`together`), и ложится он в
   * минуту нажатия. Где человек стоит, объятие не меняет: уходит под крышу и
   * возвращается камера, а он остаётся там, где стоял.
   */
  private hugStep(t: number): void {
    if (!this.hugAt) return;
    const k = (t - this.hugAt) / HUG_MS;
    if (k >= 1) {
      this.hugAt = 0;
      this.hugShow(0, 0);
      this.fireLight.position.set(0, 0.9, 0);
      this.fireLight.decay = FIRE_DECAY;
      this.precip.root.visible = true;
      if (this.bowInHand) this.bowInHand.visible = true;
      this.refresh();
      return;
    }
    const inside = k >= HUG.cutIn && k < HUG.cutOut;
    const veil =
      k < HUG.cutIn
        ? ramp(k, HUG.dim, HUG.cutIn)
        : inside
          ? Math.max(1 - ramp(k, HUG.cutIn, HUG.clear), ramp(k, HUG.redim, HUG.cutOut))
          : 1 - ramp(k, HUG.cutOut, HUG.back);
    const sign = ramp(k, HUG.heartIn, HUG.heartIn + 0.06) * (1 - ramp(k, HUG.heartOut - 0.06, HUG.heartOut));
    this.hugShow(veil, sign);
    // Вещи в руках висят на камере: под крышей с топором у лица не обнимаются.
    if (this.axeInHand) this.axeInHand.visible = false;
    if (this.bowInHand) this.bowInHand.visible = false;
    // Непогода стоит полем над всей поляной и крыши не знает: под ней дождя нет.
    this.precip.root.visible = !inside;
    // Снаружи отсвет стоит у огня: его каждый кадр ставит `fire`, со своей дрожью.
    if (!inside) {
      this.fireLight.decay = FIRE_DECAY;
      return;
    }
    // Конёк лежит вдоль оси X модели (`models.house`), повёрнутой вместе с домом;
    // камера без поворота смотрит вдоль −Z, отсюда четверть оборота в рыскании.
    const ax = Math.cos(HOUSE.rot);
    const az = -Math.sin(HOUSE.rot);
    this.camera.position.set(HOUSE.x - ax * HUG_BACK, HUG_EYE, HOUSE.z - az * HUG_BACK);
    this.camera.rotation.set(smooth(ramp(k, HUG.cutIn, HUG.up)) * HUG_PITCH, HOUSE.rot - Math.PI / 2, 0, 'YXZ');
    // Под крышей темно, а новый источник света пересобрал бы материалы на кадр:
    // на время объятия в дом переходит тот же отсвет огня.
    // Свет — от пола, как от очага в доме, и с крутым спадом: низ стен тёплый, конёк
    // тонет в темноте. С мягким спадом огня поляны сруб изнутри выходил ровным
    // коричневым полем, в котором не видно ни венцов, ни скатов.
    this.fireLight.position.set(HOUSE.x, 0.4, HOUSE.z);
    this.fireLight.decay = 2;
    this.fireLight.intensity = Math.max(this.fireLight.intensity, HUG_GLOW);
  }

  /** Затемнение и знак объятия: сцена двигает их сама, по долям одного числа. */
  private hugShow(veil: number, sign: number): void {
    const el = this.hugEl;
    if (!el) return;
    el.style.visibility = veil > 0 || sign > 0 ? 'visible' : 'hidden';
    const dim = el.children[0] as HTMLElement | undefined;
    const heart = el.children[1] as HTMLElement | undefined;
    if (dim) dim.style.opacity = veil.toFixed(3);
    if (heart) {
      heart.style.opacity = sign.toFixed(3);
      heart.style.transform = `rotate(45deg) scale(${(0.7 + sign * 0.3).toFixed(3)})`;
    }
  }

  /** Строка поверх сцены: встреча, ответ, новость. Висит `NOTE_MS` и уходит сама. */
  private say(text: string): void {
    this.note = text;
    this.noteUntil = performance.now() + NOTE_MS;
    this.refresh();
  }

  /** Раз в несколько секунд складываем пару чисел на диск. */
  private persist(force: boolean): void {
    const t = performance.now();
    if (!force && t - this.savedAt < SAVE_EVERY) return;
    this.savedAt = t;
    savePrologue(this.save);
  }

  /**
   * Что показывать надстройке прямо сейчас.
   *
   * Считается на месте и ничего не помнит — это и позволяет спросить её до
   * первого кадра. Спрашивать надо: **кадра может не быть вовсе.** В скрытом
   * вебвью `requestAnimationFrame` не вызывается ни разу, и надстройка,
   * ждущая первого кадра, показала бы игроку многоточие вместо костра. Та же
   * причина, по которой не ждёт кадра экран загрузки (`boot/paint.ts`).
   */
  snapshot(): PrologueView {
    const now = serverNow();
    const s = this.save;
    const hunger = hungerAt(s.body, now);
    const harm = harmAt(s.body, s.hearth, now);
    const busy = this.work?.kind ?? '';
    return {
      fireFill: hearthFill(s.hearth, now),
      fireWords: burnWords(s.hearth, now),
      fedFill: fedFill(s.body, now),
      fedWords: fedWords(s.body, now),
      warmthFill: warmthFill(s.body, s.hearth, now),
      warmthWords: warmthWords(s.body, s.hearth, now),
      warming: warming(s.body, s.hearth, now),
      healthFill: healthFill(s.body, s.hearth, now),
      healthWords: healthWords(s.body, s.hearth, now),
      draining: draining(s.body, s.hearth, now),
      healing: healing(s.body, s.hearth, now),
      night: isNight(now),
      weather: weatherWords(now),
      wolves: this.pack.length,
      items: things(s),
      offer: offer(s, this.aim(), now),
      shot: bowOffer(s, this.drawn),
      eatCooked: meal(s, hunger, harm, false),
      eatRaw: meal(s, hunger, harm, true),
      drawn: this.drawn,
      busy: busy === 'chop' ? 'Ещё ударов' : busy === 'butcher' ? 'Срезает' : busy === 'skin' ? 'Снимает шкуру' : busy === 'fight' ? 'Отбивается' : '',
      busyLeft: busy === 'chop' && this.chopTree >= 0 ? this.chopsLeft : 0,
      dead: death(s, now),
      panel: this.panel,
      mate: s.wife ? 'wife' : this.mate ? 'guest' : '',
      mateName: this.panel === 'son' ? (s.heir?.name ?? '') : s.wife?.name ?? (this.mate ? guestOf(s.refused).name : ''),
      mateSays:
        this.said ||
        (this.panel === 'raid'
          ? RAID_SAYS
          : this.panel === 'son'
            ? SON_SAYS
            : s.end.stage === 'family' && s.wife && !s.end.wife
              ? WIFE_SAYS
              : s.wife
                ? wifeSays(s, s.hearth, now)
                : this.mate
                  ? guestOf(s.refused).story
                  : ''),
      love: love(s.bond),
      meals: Math.min(s.bond.meal.n, LOVE_DAYS),
      hugs: Math.min(s.bond.hug.n, LOVE_DAYS),
      nights: Math.min(s.bond.night.n, LOVE_DAYS),
      woods: Math.min(s.bond.wood.n, LOVE_DAYS),
      mealToday: !counts(s.bond.meal, now),
      hugToday: !counts(s.bond.hug, now),
      nightToday: !counts(s.bond.night, now),
      woodToday: !counts(s.bond.wood, now),
      give: this.panel === 'son' ? feedSon(s) : share(s, now),
      lineage: lineage(s.wife, s.heir),
      note: performance.now() < this.noteUntil ? this.note : '',
      hugging: this.hugAt > 0,
      end: s.end.stage,
      task: endTask(s.end),
      sonName: s.heir?.name ?? '',
      watching: this.watching(),
      cheated: s.cheated,
    };
  }

  /**
   * Сказать надстройке, если что-то изменилось.
   *
   * Сравнение по значению нарочно: `onView` ведёт в React, и звать его каждый
   * кадр значило бы перерисовывать надстройку шестьдесят раз в секунду ради
   * строки, которая меняется раз в минуту.
   */
  private refresh(): void {
    const next = this.snapshot();
    this.frostShow(next.dead ? 0 : next.warmthFill);
    if (this.shown && same(this.shown, next)) return;
    this.shown = next;
    this.onView?.(next);
  }

  /**
   * Иней по краям кадра — из того же числа, что на полосе тепла.
   *
   * Пишется в разметку только когда поменялся на сотую: полоса тепла ползёт часами,
   * и стиль, переписанный каждые сто двадцать миллисекунд, стоил бы пересчёта слоя
   * ни за что. Невидимый иней снят со слоя вовсе — поверх холста он ничего не стоит.
   */
  private frostShow(warmth: number): void {
    const el = this.frostEl;
    if (!el) return;
    const k = THREE.MathUtils.clamp((FROST_FROM - warmth) / (FROST_FROM - FROST_FULL), 0, 1);
    const v = Math.round(smooth(k) * 100) / 100;
    if (el.dataset.k === String(v)) return;
    el.dataset.k = String(v);
    el.style.opacity = v.toFixed(2);
    el.style.visibility = v > 0 ? 'visible' : 'hidden';
  }

  /** Кнопка действия в надстройке — та же дверь, что и тап по сцене. */
  doAct(): void {
    this.act();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Угол — от формы экрана: на портрете горизонталь не уже `VIEW_H_MIN` (`glade.viewFov`).
    this.camera.fov = viewFov(w / h);
    this.camera.updateProjectionMatrix();
    this.viewK = Math.tan((this.camera.fov * Math.PI) / 360) / Math.tan((VIEW_V_MIN * Math.PI) / 360);
    if (this.axeInHand) this.axeInHand.scale.setScalar(AXE_SCALE * this.viewK);
    if (this.bowInHand) this.bowInHand.scale.setScalar(BOW_SCALE * this.viewK);
  }

  /**
   * Где стоит игрок и куда смотрит — замеру.
   *
   * Стенд (`npm run prologue:report`) водит пальцем и обязан спрашивать
   * положение у самой сцены, а не считать его вторым способом: иначе он мерил
   * бы своё представление о ходьбе, а не ходьбу.
   */
  where(): { x: number; z: number; yaw: number } {
    return { x: this.px, z: this.pz, yaw: this.yaw };
  }

  /**
   * Где сейчас зверь — замеру.
   *
   * Стенд обязан спрашивать положение у самой сцены, а не считать его вторым
   * способом: положение оленя живёт во времени кадров, и второго источника у
   * него нет и быть не может. `null` — зверя на поляне нет.
   */
  deerAt(): { x: number; z: number } | null {
    return this.deer ? { x: this.beast.x, z: this.beast.z } : null;
  }

  /**
   * Где стоят волки — замеру.
   *
   * Тем же правилом, что зверь: их положение живёт во времени кадров, второго
   * источника у него нет, и стенд обязан спрашивать сцену, а не считать сам.
   */
  wolvesAt(): { x: number; z: number }[] {
    return this.pack.map((w) => ({ x: w.x, z: w.z }));
  }

  /** Где лежит туша — замеру: к ней надо дойти, а лежит она там, где упал зверь. */
  carcassAt(): { x: number; z: number } | null {
    const c = liveCarcass(this.save.hunt, serverNow());
    return c ? { x: c.x, z: c.z } : null;
  }

  /** Сколько стрел лежит на поляне — замеру: их не должно становиться больше. */
  arrowCount(): number {
    return this.save.arrows.length;
  }

  /** Сколько брёвен в доме и под крышей ли человек — замеру: стенд строит пальцем. */
  craft(): { house: number; roof: boolean } {
    return { house: this.save.house, roof: this.save.body.roof };
  }

  /**
   * Что в руках — замеру, из самой записи.
   *
   * Надстройка этих чисел больше не показывает россыпью: они живут в окне вещей
   * (`pack.ts`). Стенду же нужны числа, а не разметка окна, — и берёт он их у
   * сцены, а не считает сам.
   */
  hands(): { logs: number; axe: boolean; bow: boolean; quiver: number; cooked: number; raw: number; hides: number; coat: boolean; harm: number } {
    const s = this.save;
    return {
      logs: s.logs,
      axe: s.axe,
      bow: s.kit,
      quiver: s.quiver,
      cooked: s.meat.cooked,
      raw: s.meat.raw,
      hides: s.hides,
      coat: s.body.coat,
      harm: harmAt(s.body, s.hearth, serverNow()),
    };
  }

  /** Где женщина — замеру. Её место живёт в кадрах, как у зверя, и второго источника нет. */
  mateAt(): { x: number; z: number } | null {
    return this.matePt();
  }

  /** Род и камера объятия — замеру: стенд проверяет, что взгляд ушёл под крышу и вернулся. */
  kin(): { refused: number; wife: string; heir: string; love: number; kept: boolean; camY: number; camPitch: number } {
    return {
      refused: this.save.refused,
      wife: this.save.wife?.name ?? '',
      heir: this.save.heir?.name ?? '',
      love: love(this.save.bond),
      kept: this.save.hearth.kept === true,
      camY: this.camera.position.y,
      camPitch: this.camera.rotation.x,
    };
  }

  /**
   * Финал — замеру: ступень, сделанное, такт и то, что видно на экране.
   *
   * Стенд обязан спрашивать это у самой сцены, а не считать вторым способом:
   * такт и положение фигур живут в кадрах, и второго источника у них нет.
   */
  finale(): {
    stage: EndStage;
    wood: boolean;
    wife: boolean;
    son: boolean;
    boards: number;
    beat: string;
    foes: number;
    downed: number;
    sonAt: { x: number; z: number } | null;
    camY: number;
  } {
    const e = this.save.end;
    return {
      stage: e.stage,
      wood: e.wood,
      wife: e.wife,
      son: e.son,
      boards: e.boards,
      beat: this.answerAt ? this.beat : this.raidAt ? 'come' : '',
      foes: this.foes.length,
      downed: this.foes.filter((f) => f.down).length,
      sonAt: this.son ? { x: this.son.x, z: this.son.z } : null,
      camY: this.camera.position.y,
    };
  }

  /** Показания для замера: вызовы отрисовки и треугольники. */
  stats(): { calls: number; triangles: number } {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles };
  }

  /**
   * Уборка. Порядок тот же, что у диорамы: снять слушатели, освободить
   * геометрию, отдать контекст — и всё это, пока канва ещё в разметке.
   */
  dispose(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    // Летящая стрела кладётся на землю до записи: из колчана она вычтена, и
    // уход из режима посреди выстрела не должен стоить игроку стрелы.
    this.groundFlight();
    this.persist(true);
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    // Топор висит на камере, а она — в сцене: обход достанет и его. Дым — не
    // меш, `disposeGeometries` его не видит, поэтому он убирается руками.
    disposeGeometries(this.scene);
    this.smoke.points.geometry.dispose();
    (this.smoke.points.material as THREE.Material).dispose();
    // Непогода — тоже не меш: обход её не видит, и убирается она руками.
    this.precip.dispose();
    // Всё, что поляна испекла и склонировала сама: холсты, копии материалов,
    // купол, искры. Общие материалы деревни поляна не трогала — и не отдаёт.
    for (const f of [this.mate, this.leaving, this.son]) if (f) (f.obj.userData.release as (() => void) | undefined)?.();
    // Холст ватаги один на пятерых, и отдаётся он один раз.
    this.foeSkin?.release();
    this.dome.dispose();
    this.sparks.dispose();
    this.surfaces.dispose();
    this.glowTex.dispose();
    for (const tex of this.sleeveTex) tex.dispose();
    for (const mat of this.sleeveMat) mat.dispose();
    this.eyeMat.dispose();
    this.fireGlow.material.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
