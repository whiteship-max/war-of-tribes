/**
 * Договор между игрой и сервером хранения. Один файл на обе стороны нарочно:
 * разъехавшиеся типы клиента и сервера — это отказ, который виден не при сборке,
 * а на телефоне игрока и только в проде.
 *
 * Модуль чистый: ни узла, ни браузера, ни импортов — его читают и `vite`, и
 * сборщик функций.
 *
 * Главное свойство записи: **сервер не понимает, что в ней лежит**. Сохранение
 * племени и сохранение мира — непрозрачные строки, сервер их не разбирает, не
 * проверяет и не судит. Он хранит и раздаёт, а не решает. Отсюда и опись
 * (`SaveCard`): чтобы показать игроку, какие две партии разошлись, кто-то должен
 * знать про день и население — и знает это клиент, который опись и складывает.
 */

/** Краткая опись партии — на случай, когда игрок выбирает между двумя. */
export interface SaveCard {
  /** Имя вождя. */
  name: string;
  /** Игровой день. */
  day: number;
  /** Население: жители, бойцы и новобранцы. */
  pop: number;
  /** Мощь: посёлок плюс дружина. */
  power: number;
  /** Бойцов в дружине. */
  army: number;
}

/** Запись игрока в хранилище. Одна на игрока, переписывается целиком. */
export interface SaveRecord {
  v: 1;
  /** Номер записи: растёт на единицу за каждую. Нужен показу, не логике. */
  rev: number;
  /** Когда записали, по серверным часам. */
  updatedAt: number;
  /** Кто записал: короткий постоянный признак устройства. */
  device: string;
  /** Сохранение племени — та же строка, что лежит в localStorage. */
  game: string;
  /** Сохранение мира. Его может не быть: карту игрок мог ни разу не открыть. */
  world: string | null;
  card: SaveCard;
}

/** Ответ на чтение. `etag` — то, чем потом доказывают, что писали поверх этого. */
export interface PullResponse {
  /** Серверные часы. Приезжают с каждым ответом — отдельного запроса за ними не надо. */
  now: number;
  etag: string | null;
  record: SaveRecord | null;
}

export interface PushBody {
  /** Поверх какой записи пишем. `null` — записи не было вовсе. */
  baseEtag: string | null;
  record: SaveRecord;
}

export interface PushResponse {
  now: number;
  etag: string;
  rev: number;
}

/** Ответ 409: пока мы играли, поверх нашей записи легла чужая. */
export interface ConflictResponse {
  error: 'conflict';
  now: number;
  etag: string | null;
  record: SaveRecord | null;
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length <= max ? v : null;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Разбор записи, пришедшей от клиента. Сервер не верит телу запроса ни в одном
 * поле: лишнее выбрасывается, недостающее — отказ. Возвращается новый объект, а
 * не приведённый тип, — иначе в хранилище уехало бы всё, что прислали.
 */
export function readRecord(v: unknown, limits: { game: number; world: number }): SaveRecord | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const game = str(r.game, limits.game);
  if (game === null || game.length === 0) return null;
  let world: string | null = null;
  if (r.world !== null && r.world !== undefined) {
    // Мир либо строка в пределах потолка, либо отказ. Обрезать или подменять
    // на `null` нельзя: игрок получил бы обратно партию без карты и не узнал бы
    // почему.
    world = str(r.world, limits.world);
    if (world === null) return null;
  }
  const device = str(r.device, 64);
  if (!device) return null;
  const c = (r.card ?? {}) as Record<string, unknown>;
  return {
    v: 1,
    rev: Math.max(0, Math.floor(num(r.rev) ?? 0)),
    // Время ставит сервер, а не клиент: часы телефона тут не при чём, и
    // присланное значение выбрасывается молча.
    updatedAt: 0,
    device,
    game,
    world,
    card: {
      name: str(c.name, 64) ?? '',
      day: Math.max(0, Math.floor(num(c.day) ?? 0)),
      pop: Math.max(0, Math.floor(num(c.pop) ?? 0)),
      power: Math.max(0, Math.floor(num(c.power) ?? 0)),
      army: Math.max(0, Math.floor(num(c.army) ?? 0)),
    },
  };
}
