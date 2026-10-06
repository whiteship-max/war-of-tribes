/**
 * Правила реестра замков — отдельно от разговора по сети.
 *
 * Здесь всё, что можно проверить, не поднимая ни хранилища, ни функции: как
 * строка попадает в реестр, кого он забывает и какой у него потолок. Сама
 * функция (`functions/castles.mts`) остаётся тонкой: подпись, чтение блоба,
 * попытка записи, ответ.
 *
 * **Главное свойство и есть причина, по которой это чистая функция.** Игрок
 * пишет только свою строку. Не «проверяется, что свою» — а не из чего написать
 * чужую: `upsert` получает ключ, выведенный из проверенной подписи, и трогает
 * `rows[key]`, ничего больше. Читается это одним взглядом и держится тестом,
 * который сравнивает весь остальной реестр до и после.
 *
 * Модуль серверный: из `src` его не импортируют, поэтому здесь можно всё, что
 * умеет Node 22. Общие с игрой типы лежат в `contract.ts` — один файл на две
 * стороны, как и у сохранения.
 */
import { placeCastle, settleRandom, type Spot } from '../../src/world/settle.js';
import { SICILY, inSicilyTheatre, type SpawnMode } from '../../src/world/spawn.js';
import { ATLAS_HASH } from '../../src/world/atlas/data.js';
import { cityName, type CastleClaim, type CastleRow, type CastleView, type RosterFile } from './contract.js';

/**
 * Сколько замков помещается в реестр и как долго держится замок того, кто не
 * заходит.
 *
 * Предел нужен не от жадности: реестр едет целиком каждому игроку и
 * переписывается целиком на каждую запись, а строка живёт вечно — иначе карта
 * заросла бы замками, к которым никто никогда не вернётся, и каждый занимал бы
 * свои `SETTLE_GAP` клеток.
 *
 * Три месяца — срок, после которого честнее сказать «мир пошёл дальше», чем
 * держать место. Вернувшийся получает новую клетку, и вместе с ней новую карту:
 * деревня при этом цела, теряется только разведанное. Молчать об этом нельзя, и
 * в `docs/sync.md` про это сказано словами.
 */
export const ROSTER_MAX = 5000;
export const ROSTER_FORGET_MS = 90 * 24 * 60 * 60_000;

/** Ключ реестра в хранилище общего мира: весь реестр лежит одним значением. */
export const ROSTER_KEY = 'roster';

/** Земля, на которой считаны координаты. Сменилась — реестр начинается заново. */
export const rosterEpoch = (): number => ATLAS_HASH;

/** Пустой реестр нынешней земли. */
export const emptyRoster = (): RosterFile => ({ v: 1, epoch: rosterEpoch(), rows: {} });

/**
 * Реестр из того, что лежало в хранилище. Чужая земля, испорченный разбор,
 * непонятная версия — всё это читается одинаково: реестра нет, он начинается
 * заново. Приводить тут нечего, ровно как у сохранения мира: координаты старой
 * земли на новой означают не сбой, а другое место.
 */
export function readRoster(raw: unknown): RosterFile {
  if (!raw || typeof raw !== 'object') return emptyRoster();
  const r = raw as Partial<RosterFile>;
  if (r.v !== 1 || r.epoch !== rosterEpoch() || !r.rows || typeof r.rows !== 'object') return emptyRoster();
  const rows: Record<string, CastleRow> = {};
  for (const [key, row] of Object.entries(r.rows)) {
    if (!row || typeof row !== 'object') continue;
    const c = row as Partial<CastleRow>;
    if (typeof c.x !== 'number' || typeof c.y !== 'number') continue;
    rows[key] = {
      x: Math.round(c.x),
      y: Math.round(c.y),
      name: typeof c.name === 'string' ? c.name : '',
      // Имя города чистится и на чтении: строка могла лечь до правила об имени.
      ...(cityName(c.city) ? { city: cityName(c.city) as string } : {}),
      power: Math.max(0, Math.floor(Number(c.power) || 0)),
      pop: Math.max(0, Math.floor(Number(c.pop) || 0)),
      seenAt: Math.max(0, Math.floor(Number(c.seenAt) || 0)),
    };
  }
  return { v: 1, epoch: rosterEpoch(), rows };
}

/** Где уже стоят замки. Ровно это и получает правило расселения. */
export const spotsOf = (file: RosterFile): Spot[] =>
  Object.values(file.rows).map((r) => ({ x: r.x, y: r.y }));

/**
 * Идентификатор замка наружу. Не телеграмный: соседям знать, кто именно за ним
 * играет, незачем — имя вождь называет сам. Хеш двойной, потому что на одном
 * тридцатидвухбитном `ROSTER_MAX` замков сходились бы в одну строку чаще, чем
 * хочется.
 */
export function castleIdOf(key: string): string {
  const mix = (salt: number): string => {
    let h = salt >>> 0;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36).padStart(7, '0');
  };
  return `c${mix(0x811c9dc5)}${mix(0x9e3779b1)}`;
}

/** Реестр глазами игрока: строки с опознавательным номером вместо ключа. */
export const viewOf = (file: RosterFile): CastleView[] =>
  Object.entries(file.rows).map(([key, row]) => ({ id: castleIdOf(key), ...row }));

/**
 * Положить свою строку.
 *
 * Клетка выбирается **здесь и только для новой строки**: у стоящего замка она
 * не меняется никогда, и поля для неё в `claim` не существует. Место ищет
 * `place`, а не сам `upsert`, по одной причине — расселение зависит от того,
 * кто уже стоит, а «кто уже стоит» может измениться между чтением и записью.
 * Поэтому зовут его на каждой попытке записи, с тем реестром, который только
 * что прочитали.
 *
 * Возвращается новый реестр. Прежний не трогается: сравнить «что было» и «что
 * стало» — это и есть проверка того, что чужие строки целы.
 */
export function upsert(file: RosterFile, key: string, claim: CastleClaim, now: number, mode: SpawnMode | null = null): RosterFile {
  const had = file.rows[key];
  const at: Spot = had ?? placeNew(file, key, mode);
  return {
    v: 1,
    epoch: file.epoch,
    rows: {
      ...file.rows,
      [key]: {
        x: at.x,
        y: at.y,
        name: claim.name,
        ...(cityName(claim.city) ? { city: cityName(claim.city) as string } : {}),
        power: claim.power,
        pop: claim.pop,
        seenAt: now,
      },
    },
  };
}

/**
 * Клетка для новой строки.
 *
 * Обычный режим — правило расселения (`settle.placeCastle`). Режим `sicily` (docs/test_world.md) — первое свободное из
 * двенадцати мест острова по порядку списка (`world/spawn.SICILY`); занято место, на котором уже стоит чья-то строка.
 * Свободных нет — обычное правило, но только в регионе острова: новичок обязан мочь воевать с теми, кто на острове.
 *
 * Зовут её внутри цикла записи, на только что прочитанном реестре (`routes/castles.ts`): двое, вошедших разом, не займут
 * одно место — второй проиграет условную запись, перечитает реестр и увидит место занятым.
 */
export function placeNew(file: RosterFile, key: string, mode: SpawnMode | null): Spot {
  const taken = spotsOf(file);
  if (mode === 'sicily') {
    const busy = new Set(taken.map((t) => `${t.x}|${t.y}`));
    const free = SICILY.find((s) => !busy.has(`${s.x}|${s.y}`));
    if (free) return { x: free.x, y: free.y };
    return placeCastle(settleRandom(key), taken, inSicilyTheatre);
  }
  return placeCastle(settleRandom(key), taken);
}

/**
 * Убрать забытые замки и лишние сверх потолка.
 *
 * Порядок важен: сперва по сроку, потом по потолку, и всегда по «последний раз
 * был в игре» — самые старые уходят первыми. Своя строка от прополки защищена
 * отдельно: игрок, который прямо сейчас пишет, не может оказаться забытым, как
 * бы ни разошлись часы.
 */
export function prune(file: RosterFile, now: number, keep: string): RosterFile {
  const alive = Object.entries(file.rows).filter(
    ([key, row]) => key === keep || now - row.seenAt <= ROSTER_FORGET_MS,
  );
  const left =
    alive.length <= ROSTER_MAX
      ? alive
      : [...alive]
          // Своя строка идёт первой и потому переживает срез при любом потолке;
          // дальше — по свежести, и уходят самые давние.
          .sort((a, b) => (a[0] === keep ? -1 : b[0] === keep ? 1 : b[1].seenAt - a[1].seenAt))
          .slice(0, ROSTER_MAX);
  if (left.length === Object.keys(file.rows).length) return file;
  return { v: 1, epoch: file.epoch, rows: Object.fromEntries(left) };
}

/**
 * Стоит ли вообще писать. Строка переписывается ради трёх вещей — имени, мощи и
 * отметки «был в игре»; если ничего из этого не сдвинулось заметно, а с
 * прошлой записи прошло меньше срока, запись не нужна вовсе.
 *
 * Это не бережливость, а прямая защита общего блоба: реестр один на всех, и
 * каждая лишняя запись — это ещё одна гонка за право его переписать.
 */
export function worthWriting(file: RosterFile, key: string, claim: CastleClaim, now: number, quiet: number): boolean {
  const had = file.rows[key];
  if (!had) return true;
  const sameCity = (cityName(had.city) ?? '') === (cityName(claim.city) ?? '');
  if (had.name !== claim.name || !sameCity || had.power !== claim.power || had.pop !== claim.pop) {
    return true;
  }
  return now - had.seenAt >= quiet;
}
