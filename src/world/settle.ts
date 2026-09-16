// Где встанет замок нового игрока.
//
// Правило одно, и его зовут двое: серверная функция регистрации
// (`netlify/functions/castles.mts`) и генерация мира на клиенте (`gen.ts`),
// когда сервера нет вовсе. Второго правила расселения быть не должно — иначе
// игрок, зашедший без сети, встал бы по одним меркам, а его сосед по другим, и
// объяснить, почему их разделяет море, было бы нечем.
//
// **Место выбирает сервер, а не клиент.** Клиент, выбирающий себе место, —
// это клиент, выбирающий себе соседей: сесть вплотную к слабому, подальше от
// сильного, за рекой от всех сразу. Поэтому координат в теле запроса нет
// вовсе — сервер их не принимает, а назначает.
//
// Модуль читает только `land.ts`, `data/tuning.ts` и генератор чисел из
// `game/sim/random.ts` — ни одного `@/`-импорта, ни одного типа мира, ни DOM.
// Это условие того, что его собирает и серверный проект (см. заголовок
// `land.ts`), и нарушать его нельзя.
import { seeded } from '../game/sim/random';
import {
  isDesertAt,
  landShare,
  landmasses,
  settleable,
  waterShare,
  type Spot,
} from './land';
import {
  HOME_LAND_RADIUS,
  HOME_LAND_SHARE,
  MAINLAND_MIN,
  SETTLE_GAP,
  SETTLE_REACH,
  SETTLE_TRIES,
  SETTLE_WATER_MAX,
  WORLD_ORIGIN,
  WORLD_SIZE,
} from './data/tuning';

export type { Spot };

const dist = (a: Spot, b: Spot): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Годится ли клетка под замок сама по себе — без оглядки на соседей.
 *
 * Три ступени, и порядок у них по цене: сперва признаки самой клетки (пригодна,
 * не пустыня), потом доля суши вокруг — круг радиусом `HOME_LAND_RADIUS`, — и только на прошедших
 * разметка материка. Ступени те же, по которым мир до сих пор ставил замок
 * игрока, и это не совпадение: правило одно, а сервер просто взял его себе.
 */
export function fitToSettle(at: Spot): boolean {
  if (!settleable(at.x, at.y)) return false;
  // Пустыня проходима, но жить в ней нечем: стартовать оттуда — наказание за то,
  // чего игрок не выбирал.
  if (isDesertAt(at.x, at.y)) return false;
  if (landShare(at.x, at.y, HOME_LAND_RADIUS) < HOME_LAND_SHARE) return false;
  return landmasses().sizeOf(landmasses().at(at.x, at.y)) >= MAINLAND_MIN;
}

/** Ближайший из уже стоящих замков. null — мир пуст, этот игрок первый. */
function nearest(taken: readonly Spot[], at: Spot): Spot | null {
  let best: Spot | null = null;
  let bestD = Infinity;
  for (const t of taken) {
    const d = dist(t, at);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/**
 * Не слишком ли тесно и не слишком ли далеко.
 *
 * Ближняя граница считается по **всем** замкам: под боком не должно оказаться
 * ни одного. Дальняя — по **ближайшему**: до соседей за краем света игроку дела
 * нет, а вот до ближнего он обязан дойти.
 */
function fitsNeighbours(taken: readonly Spot[], at: Spot): boolean {
  const near = nearest(taken, at);
  if (!near) return true;
  if (dist(near, at) > SETTLE_REACH) return false;
  for (const t of taken) {
    const d = dist(t, at);
    if (d < SETTLE_GAP) return false;
    if (d > SETTLE_REACH) continue;
    // Один кусок суши говорит, что дорога посуху есть; это — что она прямая.
    // Через залив до соседа идти вчетверо дольше, чем по такой же прямой на
    // земле, и «в досягаемости» перестаёт что-либо значить.
    //
    // Считается по **каждому** соседу в пределах дальней границы, а не по
    // ближайшему на эту минуту: ближайший меняется. Пришедший позже становится
    // чьим-то ближним соседом, и если бы проверялась только своя ближняя пара,
    // старожил однажды обнаружил бы, что до нового соседа плыть. Мерка
    // симметрична, поэтому проверенная один раз пара проверена навсегда.
    if (waterShare(t, at) > SETTLE_WATER_MAX) return false;
  }
  return true;
}

/**
 * Тот же кусок суши, что у соседа.
 *
 * Это и есть «земля должна быть проходимой», и мерка тут строже прямой линии:
 * прямая через залив выглядит короткой, а обходить его сутки. Один кусок суши
 * означает, что дорога посуху существует, — большего от расселения и не просят.
 */
const sameLand = (a: Spot, b: Spot): boolean => {
  const land = landmasses();
  const id = land.at(a.x, a.y);
  return id >= 0 && id === land.at(b.x, b.y);
};

/**
 * Место для замка нового игрока.
 *
 * `rng` — детерминированный генератор: у сервера он выводится из проверенного
 * идентификатора игрока, поэтому повторный запрос той же регистрации ищет место
 * теми же бросками. `roster` — где уже стоят замки; порядок строк в нём на
 * ответ не влияет, и это проверяется тестом: перестановка списка не двигает
 * замок, а появление в нём нового замка — двигает, и так и должно быть.
 *
 * Пустой мир: первый садится куда угодно на материке. Непустой: точка берётся
 * кольцом вокруг случайного из уже стоящих — так посёлок игроков растёт наружу,
 * а не выстраивается цепочкой от первого.
 */
export function placeCastle(rng: () => number, roster: readonly Spot[]): Spot {
  const lo = WORLD_ORIGIN;
  const hi = { x: WORLD_ORIGIN.x + WORLD_SIZE, y: WORLD_ORIGIN.y + WORLD_SIZE };
  // Список приходит из хранилища, и порядок в нём — не факт о мире: он зависит
  // от того, кто когда записался и как легли ключи. Якорь выбирается броском по
  // индексу, поэтому порядок обязан быть свой, выведенный из самих клеток, —
  // иначе перестановка строк в реестре двигала бы замок нового игрока.
  const taken = [...roster].sort((a, b) => a.x - b.x || a.y - b.y);

  for (let tries = 0; tries < SETTLE_TRIES; tries++) {
    let at: Spot;
    if (taken.length === 0) {
      at = { x: Math.round(lo.x + rng() * (WORLD_SIZE - 1)), y: Math.round(lo.y + rng() * (WORLD_SIZE - 1)) };
    } else {
      const anchor = taken[Math.min(taken.length - 1, Math.floor(rng() * taken.length))];
      const a = rng() * Math.PI * 2;
      const r = SETTLE_GAP + rng() * (SETTLE_REACH - SETTLE_GAP);
      at = { x: Math.round(anchor.x + Math.cos(a) * r), y: Math.round(anchor.y + Math.sin(a) * r) };
      if (at.x < lo.x || at.y < lo.y || at.x >= hi.x || at.y >= hi.y) continue;
      if (!sameLand(anchor, at)) continue;
    }
    if (!fitToSettle(at)) continue;
    if (!fitsNeighbours(taken, at)) continue;
    return at;
  }

  // Броски не нашли места. Это не «не бывает»: игроков может стать столько, что
  // вокруг каждого якоря тесно, — и тогда правило обязано ответить, а не
  // промолчать. Обход по спирали от ближайшего к середине занятого места
  // конечен и найдёт первую подходящую клетку, если она вообще есть.
  const from = taken.length > 0 ? taken[Math.floor(rng() * taken.length)] : { x: lo.x, y: lo.y };
  const found = spiral(from, taken);
  if (found) return found;

  // Не нашлось ничего. Молча вставать в середину сетки нельзя — там может быть
  // море; поэтому берём первую пригодную клетку материка. Единственный случай,
  // когда сюда можно попасть, — мир, забитый замками до отказа.
  return firstFit();
}

/**
 * Обход по расширяющемуся кольцу. Шаг по кольцу — половина ближней границы:
 * чаще незачем, реже — можно проскочить свободное место между двумя занятыми.
 */
function spiral(from: Spot, taken: readonly Spot[]): Spot | null {
  const step = Math.max(2, Math.round(SETTLE_GAP / 2));
  for (let r = SETTLE_GAP; r <= WORLD_SIZE; r += step) {
    const points = Math.max(8, Math.round((2 * Math.PI * r) / step));
    for (let i = 0; i < points; i++) {
      const a = (i / points) * Math.PI * 2;
      const at = { x: Math.round(from.x + Math.cos(a) * r), y: Math.round(from.y + Math.sin(a) * r) };
      if (!fitToSettle(at)) continue;
      if (!fitsNeighbours(taken, at)) continue;
      return at;
    }
  }
  return null;
}

/** Первая пригодная клетка материка. Запасной путь, и он обязан быть на земле. */
function firstFit(): Spot {
  for (let y = WORLD_ORIGIN.y; y < WORLD_ORIGIN.y + WORLD_SIZE; y++) {
    for (let x = WORLD_ORIGIN.x; x < WORLD_ORIGIN.x + WORLD_SIZE; x++) {
      if (fitToSettle({ x, y })) return { x, y };
    }
  }
  throw new Error('Атлас мира: материка не нашлось ни в одной клетке.');
}

/**
 * Генератор для расселения. Выводится из чего-то постоянного у игрока —
 * у сервера это проверенный подписью идентификатор, — чтобы повторная попытка
 * регистрации искала место теми же бросками, а не бродила по карте.
 */
export const settleRandom = (key: string): (() => number) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return seeded(h >>> 0);
};
