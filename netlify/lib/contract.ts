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

// ---------- Реестр замков ----------
//
// Вторая запись, которую держит сервер, и она устроена **не так**, как первая.
// Сохранение партии — непрозрачная строка: сервер её не читает. Реестр замков
// прочитан насквозь: имя, мощь, население и клетка. Это осознанное сужение
// правила «сервер хранит и не судит», и оно ровно одно.
//
// Судьёй сервер от этого не становится. Он не проверяет ни имени, ни мощи, ни
// населения — что игрок о себе написал, то и раздаётся соседям. Он делает одну
// вещь, которую клиенту доверить нельзя: **выбирает клетку**. Клиент,
// выбирающий себе место, — это клиент, выбирающий себе соседей, и потому
// координат в теле запроса нет вовсе.

/** Замок игрока в общем реестре. */
export interface CastleRow {
  /** Клетка. Её назначает сервер; из тела запроса она не принимается никогда. */
  x: number;
  y: number;
  /** Имя вождя — то же, что стоит в описи партии. */
  name: string;
  /** Мощь: посёлок плюс дружина. Ровно то, что о себе написал владелец. */
  power: number;
  /** Население: жители, бойцы и новобранцы. */
  pop: number;
  /** Когда владелец последний раз был в игре, по серверным часам. */
  seenAt: number;
}

/**
 * Реестр целиком. Ключ строки — проверенный подписью идентификатор, и писать
 * можно только свою.
 *
 * `epoch` — отпечаток земли, на которой считались координаты (`ATLAS_HASH`).
 * Без него пересборка атласа оставила бы старые клетки лежать как ни в чём не
 * бывало, а замок, стоявший на 541|822, оказался бы посреди залива — та же беда,
 * ради которой у сохранения мира нижняя граница версии равна верхней.
 */
export interface RosterFile {
  v: 1;
  epoch: number;
  rows: Record<string, CastleRow>;
}

/**
 * Что игрок сообщает о себе. Координат здесь нет и завести их нельзя: тип —
 * это и есть запрет, а `readClaim` собирает новый объект, а не приводит тип.
 */
export interface CastleClaim {
  name: string;
  power: number;
  pop: number;
}

/**
 * Чужой замок глазами игрока. Идентификатор здесь **не** телеграмный: он
 * выведен из ключа хешем и наружу уходит только он. Кто именно играет за этот
 * замок, соседям знать незачем, а имя вождь называет сам.
 */
export interface CastleView extends CastleRow {
  id: string;
}

/** Ответ реестра. Один на чтение и на запись: обе стороны хотят одного и того же. */
export interface RosterResponse {
  now: number;
  epoch: number;
  /** Своя клетка. `null` — замок ещё не поставлен. */
  mine: { x: number; y: number } | null;
  castles: CastleView[];
}

/** Потолки полей строки. Реестр читают все, и раздувать его никому нельзя. */
export const CASTLE_LIMITS = { name: 64, power: 1e9, pop: 1e9 } as const;

/**
 * Разбор того, что игрок сообщил о себе. Как и у записи партии, возвращается
 * **новый объект**, а не приведённый тип: иначе в реестр уехало бы всё, что
 * прислали, — включая координаты, которых игрок называть не вправе.
 */
export function readClaim(v: unknown): CastleClaim | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const cap = (raw: unknown, max: number): number => Math.min(max, Math.max(0, Math.floor(num(raw) ?? 0)));
  return {
    name: str(r.name, CASTLE_LIMITS.name) ?? '',
    power: cap(r.power, CASTLE_LIMITS.power),
    pop: cap(r.pop, CASTLE_LIMITS.pop),
  };
}
