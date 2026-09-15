// Земля под ногами: всё, что читается прямо из атласа и никакого другого знания
// не требует. Вода, русло, хребет, пустыня, пригодность под двор, доля суши
// вокруг клетки и связные куски суши — и больше ничего.
//
// **Почему это отдельный модуль, а не часть `geography.ts`.** Расселение живых
// игроков делает сервер (`netlify/functions/castles.mts`), а серверу нужна
// земля: замок на острове в две клетки — это игрок, с которым никто никогда не
// встретится. Затянуть в функцию `geography.ts` нельзя: он берёт типы из
// `./types`, а тот тянет `@/game` и `@/battle`, которых у серверного проекта
// типов нет вовсе (`netlify/tsconfig.json`: ни `paths`, ни DOM). Скопировать
// правило на вторую сторону — значит завести вторую правду о том, где кончается
// суша, и разойтись с ней в первый же день.
//
// Поэтому земля переехала сюда целиком, а `geography.ts` её зовёт. Одна
// реализация на две стороны — ровно как `netlify/lib/contract.ts` у сохранения.
// Отсюда и запреты, которые нельзя нарушить: **ни одного `@/`-импорта, ни одного
// типа из `world/types`, ни одного обращения к DOM.** Единственный не-ES-глобал
// во всей цепочке — `atob` в `atlas/atlas.ts`, и он есть у Node 22.
//
// Сида здесь нет ни в одной подписи, и это не упрощение: земля одна на всех
// (см. `atlas/`), и сид не решает про неё ничего. У `geography.ts` он в
// подписях остался ради полутора десятков мест вызова.
import { ATLAS_TERRAIN } from './atlas/data';
import { ATLAS_RIDGE, ATLAS_RIVER, ATLAS_WATER, atlasCell, atlasTerrain } from './atlas/atlas';
import { PATH_SAMPLES_PER_CELL, WORLD_ORIGIN, WORLD_SIZE } from './data/tuning';

/**
 * Клетка мира. Тип объявлен здесь, а не взят из `world/types`: этот модуль
 * читает и серверная функция, а `world/types` тянет за собой половину игры.
 * Со здешним `Coord` он совпадает по устройству, и они взаимозаменяемы.
 */
export interface Spot {
  x: number;
  y: number;
}

const DESERT = ATLAS_TERRAIN.indexOf('desert');

/** Клетка внутри сетки мира. За её краем — открытое море. */
export const inWorldCell = (x: number, y: number): boolean =>
  x >= WORLD_ORIGIN.x && y >= WORLD_ORIGIN.y && x < WORLD_ORIGIN.x + WORLD_SIZE && y < WORLD_ORIGIN.y + WORLD_SIZE;

/** Индекс ландшафта в `ATLAS_TERRAIN` (он же `TERRAIN_ORDER`). */
export const terrainCodeAt = (x: number, y: number): number =>
  atlasTerrain(x - WORLD_ORIGIN.x, y - WORLD_ORIGIN.y);

export const isWaterAt = (x: number, y: number): boolean => terrainCodeAt(x, y) === ATLAS_WATER;

export const isDesertAt = (x: number, y: number): boolean => terrainCodeAt(x, y) === DESERT;

/**
 * Русло. Настоящее: Дунай, Рейн, Рона, Луара, Висла, Днепр, Дон, По, Эбро, Тахо,
 * Темза, Евфрат — шесть с половиной сотен отрезков из Natural Earth. Мелкие
 * притоки в преграды не идут (`scalerank` в скрипте запекания): река, которую
 * переходят где угодно, картой не делит ничего, а прямая, случайно легшая вдоль
 * ручья, стоила бы как поход через горы.
 */
export const hasRiver = (x: number, y: number): boolean =>
  (atlasCell(x - WORLD_ORIGIN.x, y - WORLD_ORIGIN.y) & ATLAS_RIVER) !== 0;

/**
 * Хребет — сердцевина горного пятна, линия в одну клетку. Полигон Альп в атласе
 * шириной в сорок клеток; будь хребтом весь он, перевал «один на блок» не открыл
 * бы прохода, и через горы не было бы дороги вовсе. Утоньшение делает скрипт
 * запекания, здесь — только чтение.
 */
export const hasRidge = (x: number, y: number): boolean =>
  (atlasCell(x - WORLD_ORIGIN.x, y - WORLD_ORIGIN.y) & ATLAS_RIDGE) !== 0;

/**
 * Где вообще можно поставить двор: не в воде, не в русле и не на хребте. Правило
 * одно на станы, на поселения и на замки живых игроков — иначе сервер поселил бы
 * игрока туда, куда его собственный мир двор не ставит.
 *
 * Границы мира сюда входят нарочно: за краем сетки атлас отдаёт воду, так что
 * проверка всё равно не пропустит — но сказать это словом честнее, чем полагаться
 * на побочный эффект.
 */
export const settleable = (x: number, y: number): boolean =>
  inWorldCell(x, y) && !isWaterAt(x, y) && !hasRiver(x, y) && !hasRidge(x, y);

/**
 * Доля суши в круге такого-то радиуса — дешёвая отбраковка перед обходом
 * материка. Три сотни клеток против тысяч у настоящего обхода: замок на кончике
 * мыса формально стоит на материке, а живётся на нём как на скале.
 */
export function landShare(x: number, y: number, r: number): number {
  let land = 0;
  let all = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      all++;
      if (!isWaterAt(x + dx, y + dy)) land++;
    }
  }
  return all > 0 ? land / all : 0;
}

/**
 * Сколько суши связано с этой клеткой, но не больше потолка. Дешёвый ответ на
 * единственный вопрос, который задают при расстановке: материк это или остров.
 *
 * Полная разметка (`landmasses`) стоит около ста шестидесяти миллисекунд —
 * шестьсот сорок тысяч клеток, — и платить их на каждой генерации мира не за
 * что. Здесь обход останавливается, как только набралось достаточно: на
 * материке это происходит сразу, на острове обход кончается сам.
 *
 * Числа для мерки: материк 365 926 клеток, следующая по величине земля —
 * Британия, 5 695. Потолок между ними и стоит.
 *
 * Ответ — нижняя оценка у самого потолка: обход бросает лишнее, когда стопка
 * полна. Годится он ровно для сравнения «не меньше потолка», и точным размером
 * куска суши его считать нельзя — для этого есть `landmasses`.
 */
export function reachableLand(x: number, y: number, cap: number): number {
  if (!inWorldCell(x, y) || isWaterAt(x, y)) return 0;
  const n = WORLD_SIZE;
  // Отметки — байтовым полем, а не множеством: на двадцати тысячах клеток
  // `Set<number>` стоит вдесятеро дороже самого обхода. Поле выделяется на
  // вызов и обнуляется системой — держать его между вызовами не за чем.
  const seen = new Uint8Array(n * n);
  const stack = new Int32Array(cap * 2 + 16);
  let top = 0;
  const push = (px: number, py: number): void => {
    if (top + 2 > stack.length) return;
    stack[top++] = px;
    stack[top++] = py;
  };
  seen[(y - WORLD_ORIGIN.y) * n + (x - WORLD_ORIGIN.x)] = 1;
  push(x, y);
  let count = 0;
  while (top > 0 && count < cap) {
    const cy = stack[--top];
    const cx = stack[--top];
    count++;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!inWorldCell(nx, ny)) continue;
        const i = (ny - WORLD_ORIGIN.y) * n + (nx - WORLD_ORIGIN.x);
        if (seen[i]) continue;
        if (isWaterAt(nx, ny)) continue;
        seen[i] = 1;
        push(nx, ny);
      }
    }
  }
  return count;
}

/**
 * Доля воды на прямой между двумя клетками.
 *
 * Один кусок суши говорит, что дорога посуху **существует**; это число говорит,
 * насколько она прямая. Два берега залива лежат на одном материке, а идти между
 * ними — вокруг: прямая при этом выглядит короткой, и время похода по ней
 * получается вчетверо больше, чем по такой же прямой на суше.
 *
 * Замеры идут с тем же постоянным шагом, что и у времени пути
 * (`geo.terrainFactor`), и по той же причине: при фиксированном числе проб
 * пролив растворился бы в длине.
 */
export function waterShare(a: Spot, b: Spot, perCell = PATH_SAMPLES_PER_CELL): number {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  const samples = Math.max(3, Math.round(d * perCell));
  let water = 0;
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples;
    if (isWaterAt(Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t))) water++;
  }
  return water / samples;
}

/**
 * Куски суши, размеченные целиком. Нужны там, где важен не размер, а
 * тождество: два замка на одном куске суши соединены сушей, и это единственная
 * честная проверка «дойти можно» — прямая через залив выглядит короткой, а
 * обходить его сутки.
 */
export interface Landmasses {
  /** Номер куска суши в клетке. -1 — вода или за краем мира. */
  at(x: number, y: number): number;
  /** Сколько клеток в куске. */
  sizeOf(id: number): number;
  /** Размеры всех кусков по их номерам. */
  sizes: number[];
}

function buildLandmasses(): Landmasses {
  const n = WORLD_SIZE;
  const id = new Int32Array(n * n).fill(-1);
  const water = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      water[y * n + x] = isWaterAt(WORLD_ORIGIN.x + x, WORLD_ORIGIN.y + y) ? 1 : 0;
    }
  }
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < n * n; start++) {
    if (water[start] || id[start] >= 0) continue;
    const mass = sizes.length;
    let size = 0;
    id[start] = mass;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      size++;
      const ix = i % n;
      const iy = (i - ix) / n;
      // Связность по восьми соседям: по диагонали между двумя озёрами суша
      // всё-таки проходима, и разрывать её там было бы неправдой.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = ix + dx;
          const ny = iy + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const j = ny * n + nx;
          if (water[j] || id[j] >= 0) continue;
          id[j] = mass;
          stack.push(j);
        }
      }
    }
    sizes.push(size);
  }
  return {
    sizes,
    at: (x, y) => (inWorldCell(x, y) ? id[(y - WORLD_ORIGIN.y) * n + (x - WORLD_ORIGIN.x)] : -1),
    sizeOf: (mass) => sizes[mass] ?? 0,
  };
}

let masses: Landmasses | null = null;

/** Разметка суши. Считается один раз на процесс: земля не переезжает. */
export function landmasses(): Landmasses {
  if (!masses) masses = buildLandmasses();
  return masses;
}

/** Считать заново. Нужен тестам и стендам; в игре не зовётся. */
export function dropLand(): void {
  masses = null;
}
