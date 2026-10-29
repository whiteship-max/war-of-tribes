// Руины (ПН-3, docs/gdd/path_of_sword.md, 3.5.1 и «Решения ПН-3»): общие точки мира, где отряд бродяги встаёт лагерем в укрытии.
//
// **Общие, а не свои.** Руины прячут от живых игроков (3.5.4, ПН-4у), значит стоят у всех в одном месте: клиент, сервер и
// любой другой игрок видят одни и те же руины на одних клетках. Поэтому они не разыгрываются сидом партии или мира, а выводятся
// из земли постоянной солью — так же, как переправы и перевалы (`geography.GEO_SALT`): одни руины на квадрат земли, и в квадрате —
// та годная клетка, у которой хеш с солью меньше всех. Правило детерминированное и не зависит от того, с какой стороны к
// квадрату подошли; сменить соль — сменить руины у всех разом, и это тест (`roam.test.ts`, «руины общие»).
//
// Годная клетка — та, где может стоять двор (`land.settleable`: суша, не русло, не хребет): руины — остатки построек.
// Густота (`RUIN_BLOCK`) и вместимость (`RUIN_CAP`) — вывод заметности (ПН-4у, `world/data/sight.ts`, раздел `roam:report`
// «Доля обнаружений по видам лагеря»). Читают руины только двери пути (за `roamOn`): у лорда на карте их нет.
//
// Модуль чистый и без `@/`: его собирает сервер (лагерь в руинах и место выхода проверяет реестр).
import { hash2 } from './geography';
import { inWorldCell, settleable } from './land';
import { RUIN_BLOCK, RUIN_CAP } from './data/sight';

/**
 * Соль руин — своё постоянное число, не соль переправ: выбор «какая клетка квадрата» у руин и у мостов независим, и руины не
 * садятся на берег у каждого брода. Сид игрока сюда не попадает — у двоих руины разъехались бы.
 */
export const RUIN_SALT = 0x5a1d;

/** Вид руин — для слов и для будущих моделей (ГДД 5.3: башня, часовня, вилла, стена). Решает тот же хеш со своей солью. */
export type RuinKind = 'tower' | 'chapel' | 'villa' | 'wall';
export const RUIN_KINDS: readonly RuinKind[] = ['tower', 'chapel', 'villa', 'wall'];
export const RUIN_NAME: Readonly<Record<RuinKind, string>> = {
  tower: 'Разрушенная башня',
  chapel: 'Часовня без крыши',
  villa: 'Старая вилла',
  wall: 'Обломки крепостной стены',
};

export interface Ruin {
  x: number;
  y: number;
  kind: RuinKind;
  /** Сколько человек прячут руины (`RUIN_CAP`): больший отряд лагерем в них не встаёт. */
  cap: number;
}

/** Где вообще бывают руины: там, где мог стоять двор. */
export const ruinFit = (x: number, y: number): boolean => settleable(x, y);

const floorTo = (v: number, block: number): number => Math.floor(v / block) * block;

/** Кэш квадратов: ключ — угол квадрата и его размер (вывод густоты пробует разные — старые квадраты не годятся). */
const blocks = new Map<string, Ruin | null>();

/** Руины квадрата с углом `bx|by`; нет годной клетки — `null`. */
function ruinOfBlock(bx: number, by: number, block: number): Ruin | null {
  const key = `${block}:${bx}|${by}`;
  const have = blocks.get(key);
  if (have !== undefined) return have;
  let best: { x: number; y: number } | null = null;
  let bestH = Infinity;
  for (let y = by; y < by + block; y++) {
    for (let x = bx; x < bx + block; x++) {
      if (!inWorldCell(x, y) || !ruinFit(x, y)) continue;
      const h = hash2(RUIN_SALT, x, y);
      if (h < bestH) {
        bestH = h;
        best = { x, y };
      }
    }
  }
  const ruin = best
    ? { ...best, kind: RUIN_KINDS[Math.floor(hash2(RUIN_SALT + 7, best.x, best.y) * RUIN_KINDS.length) % RUIN_KINDS.length], cap: RUIN_CAP }
    : null;
  blocks.set(key, ruin);
  return ruin;
}

/** Руины в клетке или `null`. `block` — густота: игра и сервер зовут без неё, вывод густоты (`roam:report`) пробует свои. */
export function ruinAt(x: number, y: number, block: number = RUIN_BLOCK): Ruin | null {
  const r = ruinOfBlock(floorTo(x, block), floorTo(y, block), block);
  return r && r.x === Math.round(x) && r.y === Math.round(y) ? r : null;
}

/** Руины в прямоугольнике `[x0, x1) × [y0, y1)` — для карты и прибора. */
export function ruinsIn(x0: number, y0: number, x1: number, y1: number, block: number = RUIN_BLOCK): Ruin[] {
  const out: Ruin[] = [];
  for (let by = floorTo(y0, block); by < y1; by += block) {
    for (let bx = floorTo(x0, block); bx < x1; bx += block) {
      const r = ruinOfBlock(bx, by, block);
      if (r && r.x >= x0 && r.x < x1 && r.y >= y0 && r.y < y1) out.push(r);
    }
  }
  return out;
}

/** Ближайшие руины не дальше `r` клеток от `at`; нет — `null`. */
export function nearestRuin(at: { x: number; y: number }, r: number, block: number = RUIN_BLOCK): Ruin | null {
  let best: Ruin | null = null;
  let bestD = Infinity;
  for (const ruin of ruinsIn(at.x - r, at.y - r, at.x + r + 1, at.y + r + 1, block)) {
    const d = Math.hypot(ruin.x - at.x, ruin.y - at.y);
    if (d <= r && d < bestD) {
      bestD = d;
      best = ruin;
    }
  }
  return best;
}

/** Забыть посчитанное (тесты и вывод густоты). */
export function dropRuins(): void {
  blocks.clear();
}
