// Погода (docs/city.md, раздел 15): только вид — на игру она не влияет ничем, в сохранении её нет.
//
// **Чистая функция от региона и общих часов.** Своей даты у мира нет: время партии у каждого своё (`s.time`), и сезон
// партии — тоже. Общие часы у всех игроков одни — часы сервера (`net/clock.serverNow`); погода берёт их, переводит дверью
// времени в игровые дни (`pace.gameDaysOfMs`) и режет на «полосы погоды» по полдня игры (`SPELL_DAYS`, четверть часа
// настоящего времени). Каждой полосе региона — свои числа от зерна региона и номера полосы: у всех игроков одного региона
// в один миг один фронт. Чем он выпадет — дождём, снегом или только облаками, — решает климат региона в сезоне партии:
// на Сицилии летом тот же фронт проходит сухими облаками, зимой — дождём.
//
// Между полосами — плавный переход (`BLEND`): дождь начинается и стихает минутами, а не кадром. Вспышки грозы — тоже
// функция часов: у всех в регионе молния бьёт в один миг, а гром приходит следом (`flashes`).
import type { Season } from '@/game/types';
import { gameDaysOfMs } from '@/game/pace';

/** Полоса погоды — полдня игры (15 минут настоящего времени при шкале ×30): заход в игру видит одну погоду, следующий — другую. */
export const SPELL_DAYS = 0.5;
/** Доля полосы, за которую погода переливается в следующую. */
export const BLEND = 0.22;

/** Климатический пояс региона. */
export type Zone = 'med' | 'dry' | 'ocean' | 'land' | 'north';

interface ZoneClimate {
  /** Доля времени с осадками по сезонам. */
  wet: Record<Season, number>;
  /** Доля зимних осадков, выпадающих снегом. */
  snow: number;
  /** Доля дней с утренним туманом. */
  fog: Record<Season, number>;
  /** Доля дождей с грозой. */
  storm: Record<Season, number>;
  /** Облака хорошей погоды: насколько бывает облачно без осадков. */
  fair: Record<Season, number>;
  /** Средняя сила ветра, 0..1. */
  wind: number;
  /** Откуда чаще дует, градусы от севера по часовой. */
  from: number;
  /**
   * Снег лежит всю зиму (1) или только после снегопада (0): север и суша — белые всю зиму, Средиземье — после редкого
   * снегопада (`snowCover`).
   */
  cover: number;
  /** Мёрзнет ли река зимой: лёд у берегов, утки и лодки уходят. Средиземье и сушь — не мёрзнут. */
  frost: number;
}

/**
 * Пояса: Средиземье — сухое лето, дожди зимой, снег редок; суша — снег зимой, грозы летом; океан — дождливо круглый год,
 * ветрено; север — снег почти всегда, когда зимой осадки; сушь — дождь редкость.
 */
export const ZONES: Record<Zone, ZoneClimate> = {
  med: {
    wet: { spring: 0.18, summer: 0.05, autumn: 0.24, winter: 0.34 },
    snow: 0.08,
    fog: { spring: 0.2, summer: 0.08, autumn: 0.3, winter: 0.3 },
    storm: { spring: 0.15, summer: 0.4, autumn: 0.3, winter: 0.08 },
    fair: { spring: 0.35, summer: 0.2, autumn: 0.4, winter: 0.5 },
    wind: 0.38,
    from: 300,
    cover: 0,
    frost: 0,
  },
  dry: {
    wet: { spring: 0.06, summer: 0.01, autumn: 0.05, winter: 0.1 },
    snow: 0.02,
    fog: { spring: 0.05, summer: 0.02, autumn: 0.05, winter: 0.1 },
    storm: { spring: 0.2, summer: 0.3, autumn: 0.2, winter: 0.1 },
    fair: { spring: 0.15, summer: 0.05, autumn: 0.15, winter: 0.3 },
    wind: 0.45,
    from: 0,
    cover: 0,
    frost: 0,
  },
  ocean: {
    wet: { spring: 0.3, summer: 0.22, autumn: 0.38, winter: 0.4 },
    snow: 0.25,
    fog: { spring: 0.3, summer: 0.15, autumn: 0.4, winter: 0.35 },
    storm: { spring: 0.1, summer: 0.25, autumn: 0.12, winter: 0.03 },
    fair: { spring: 0.55, summer: 0.45, autumn: 0.6, winter: 0.7 },
    wind: 0.5,
    from: 250,
    cover: 0,
    frost: 0.4,
  },
  land: {
    wet: { spring: 0.25, summer: 0.22, autumn: 0.25, winter: 0.25 },
    snow: 0.7,
    fog: { spring: 0.25, summer: 0.12, autumn: 0.35, winter: 0.25 },
    storm: { spring: 0.15, summer: 0.4, autumn: 0.08, winter: 0 },
    fair: { spring: 0.45, summer: 0.4, autumn: 0.5, winter: 0.6 },
    wind: 0.35,
    from: 270,
    cover: 1,
    frost: 1,
  },
  north: {
    wet: { spring: 0.25, summer: 0.25, autumn: 0.35, winter: 0.4 },
    snow: 0.92,
    fog: { spring: 0.3, summer: 0.2, autumn: 0.4, winter: 0.25 },
    storm: { spring: 0.08, summer: 0.25, autumn: 0.05, winter: 0 },
    fair: { spring: 0.5, summer: 0.45, autumn: 0.6, winter: 0.65 },
    wind: 0.4,
    from: 240,
    cover: 1,
    frost: 1,
  },
};

/** Пояс региона по его имени в коде (`world/theatre/list.ts`). Регион не назван — умеренная суша. */
const ZONE_OF: Record<string, Zone> = {
  iberia: 'med',
  andalus: 'med',
  italy: 'med',
  greece: 'med',
  byzantium: 'med',
  syria: 'med',
  ifriqiya: 'med',
  morocco: 'med',
  egypt: 'dry',
  libya: 'dry',
  jazira: 'dry',
  caspian: 'dry',
  france: 'ocean',
  britain: 'ocean',
  denmark: 'ocean',
  germany: 'land',
  poland: 'land',
  hungary: 'land',
  serbia: 'land',
  kiev: 'land',
  steppe: 'land',
  vladimir: 'land',
  bulgaria: 'land',
  caucasus: 'land',
  baltic: 'land',
  rum: 'land',
  norway: 'north',
  sweden: 'north',
  finland: 'north',
  karelia: 'north',
  kola: 'north',
  north: 'north',
  novgorod: 'north',
  perm: 'north',
  pechora: 'north',
  yugra: 'north',
};

export const zoneOf = (region: string | null): Zone => (region && ZONE_OF[region]) || 'land';

/** Погода в миг: всё 0..1, кроме направления ветра. */
export interface Weather {
  /** Облачность: тени облаков, серое небо. */
  cloud: number;
  /** Дождь, 0 — сухо. */
  rain: number;
  /** Снегопад. */
  snow: number;
  /** Гроза: сила, с которой бьют молнии. */
  storm: number;
  /** Утренний туман у реки и в низинах. */
  fog: number;
  /** Сила ветра. */
  wind: number;
  /** Откуда дует, градусы от севера по часовой. */
  from: number;
}

export const CLEAR: Weather = { cloud: 0, rain: 0, snow: 0, storm: 0, fog: 0, wind: 0.3, from: 270 };

/** Хеш трёх целых в 0..1 — одинаковый на любом устройстве (целочисленный, без `Math.random`). */
function h01(a: number, b: number, c: number): number {
  let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

/** Зерно региона — от его имени: одно на всех игроков региона. */
export function regionSeed(region: string | null): number {
  const s = region ?? 'land';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Утро для тумана по фазе солнца партии (0 — рассвет): от предрассветья до первой трети утра. */
export const fogMorning = (solar: number): number => {
  const s = ((solar % 1) + 1) % 1;
  const d = s > 0.5 ? s - 1 : s;
  return smooth(-0.1, -0.03, d) * (1 - smooth(0.08, 0.16, d));
};

/** Погода одной полосы — без утра (туман здесь — «туманный ли день»). */
function spell(seed: number, i: number, c: ZoneClimate, season: Season): Weather {
  const front = h01(seed, i, 1);
  const wet = c.wet[season];
  const thr = 1 - wet;
  // Осадки — верх фронта; чем выше над порогом, тем гуще.
  const on = smooth(thr, thr + 0.03, front);
  const heavy = wet > 0 ? clamp01((front - thr) / wet) : 0;
  const fall = on * (0.45 + 0.55 * heavy);
  // Облака: тучи перед дождём и облака хорошей погоды своим числом.
  const gather = smooth(thr - 0.3, thr, front);
  const cloud = Math.max(gather * 0.85 + on * 0.15, h01(seed, i, 2) * c.fair[season] * 0.8);
  const cold = season === 'winter' && h01(seed, i, 4) < c.snow ? 1 : 0;
  const storm = cold ? 0 : fall > 0 && h01(seed, i, 3) < c.storm[season] ? fall : 0;
  const fogDay = h01(seed, i, 5) < c.fog[season] ? 0.55 + 0.45 * h01(seed, i, 8) : 0;
  const wind = clamp01(c.wind * (0.5 + h01(seed, i, 6)) + 0.2 * fall + 0.35 * storm - 0.25 * fogDay);
  const from = (c.from + (h01(seed, i, 7) - 0.5) * 140 + 360) % 360;
  return { cloud: clamp01(cloud), rain: cold ? 0 : fall, snow: cold ? fall : 0, storm, fog: fogDay, wind, from };
}

/** Смешать направления по короткой дуге. */
function mixAngle(a: number, b: number, k: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * k + 360) % 360;
}

/**
 * Погода, сдвинутая к цели на долю `k` (0..1): числа — прямой, ветер — по короткой дуге. Ею сцена переливает погоду
 * кадра к погоде часов (docs/polish.md, П-3): скачок цели (адрес, регион, вход) наплывает, а не щёлкает.
 */
export function easeWeather(from: Weather, to: Weather, k: number): Weather {
  if (k >= 1) return to;
  if (k <= 0) return from;
  const m = (a: number, b: number): number => a + (b - a) * k;
  return {
    cloud: m(from.cloud, to.cloud),
    rain: m(from.rain, to.rain),
    snow: m(from.snow, to.snow),
    storm: m(from.storm, to.storm),
    fog: m(from.fog, to.fog),
    wind: m(from.wind, to.wind),
    from: mixAngle(from.from, to.from, k),
  };
}

/**
 * Погода региона `region` в миг `ms` общих часов (`serverNow`) при сезоне партии `season`; `solar` — фаза солнца партии
 * (туман — по утрам её суток).
 */
export function weatherAt(region: string | null, ms: number, season: Season, solar: number): Weather {
  const seed = regionSeed(region);
  const c = ZONES[zoneOf(region)];
  const x = gameDaysOfMs(ms) / SPELL_DAYS;
  const i = Math.floor(x);
  const k = smooth(1 - BLEND, 1, x - i);
  const a = spell(seed, i, c, season);
  const b = k > 0 ? spell(seed, i + 1, c, season) : a;
  const mix = (p: number, q: number): number => p + (q - p) * k;
  return {
    cloud: mix(a.cloud, b.cloud),
    rain: mix(a.rain, b.rain),
    snow: mix(a.snow, b.snow),
    storm: mix(a.storm, b.storm),
    fog: mix(a.fog, b.fog) * fogMorning(solar),
    wind: mix(a.wind, b.wind),
    from: mixAngle(a.from, b.from, k),
  };
}

// ---------- Снег на земле ----------

/** Снег после снегопада лежит игровые сутки и тает полсуток (полчаса и четверть часа настоящего времени). */
export const SNOW_HOLD_DAYS = 1;
export const SNOW_MELT_DAYS = 0.5;
/** Снегопад, после которого снег ложится. */
const SNOW_FALLS = 0.15;

/**
 * Сколько снега лежит зимой, 0..1, — функция региона и общих часов, как погода: в поясе, где снег лежит всю зиму, — 1;
 * в остальных — от снегопадов последних полутора суток (ложится за десятую долю суток, лежит `SNOW_HOLD_DAYS` после
 * конца снегопада, тает `SNOW_MELT_DAYS`). Сезон здесь — всегда зима: летом снега нет, и его гасит перелив сезона сцены.
 */
export function snowCover(region: string | null, ms: number): number {
  const c = ZONES[zoneOf(region)];
  if (c.cover >= 1) return 1;
  const seed = regionSeed(region);
  const x = gameDaysOfMs(ms) / SPELL_DAYS;
  const i = Math.floor(x);
  const back = Math.ceil((SNOW_HOLD_DAYS + SNOW_MELT_DAYS) / SPELL_DAYS) + 1;
  let lying = c.cover;
  for (let k = 0; k <= back; k++) {
    const j = i - k;
    const fall = spell(seed, j, c, 'winter').snow;
    if (fall < SNOW_FALLS) continue;
    const since = (x - j) * SPELL_DAYS;
    const after = since - SPELL_DAYS;
    const melt = 1 - smooth(SNOW_HOLD_DAYS, SNOW_HOLD_DAYS + SNOW_MELT_DAYS, after);
    lying = Math.max(lying, Math.min(1, 0.55 + 0.45 * fall) * smooth(0, 0.1, since) * melt);
  }
  return lying;
}

/** Снег на земле с погодой адресом: снегопад адресом — бело сразу, иначе — как лежит в поясе всю зиму. */
export function lyingSnow(region: string | null, ms: number, forced: Weather | null): number {
  if (!forced) return snowCover(region, ms);
  return Math.max(ZONES[zoneOf(region)].cover, forced.snow > SNOW_FALLS ? 1 : 0);
}

/** Куда дует, в осях мира (x — восток, вторая ось — юг): единичный вектор. */
export const windTo = (from: number): { x: number; z: number } => {
  const r = (from * Math.PI) / 180;
  return { x: -Math.sin(r), z: Math.cos(r) };
};

// ---------- Гроза ----------

/** Окно молнии в секундах общих часов: в каждом — не больше одной вспышки. */
export const FLASH_SLOT = 7;
/** Гром — через столько секунд после вспышки: от близкого до дальнего. */
const THUNDER_MIN = 1.2;
const THUNDER_MAX = 5;

export interface Flash {
  /** Миг вспышки, мс общих часов. */
  at: number;
  /** Сила, 0..1. */
  power: number;
  /** Миг грома, мс. */
  thunder: number;
}

/** Вспышка окна `slot`, если в нём бьёт молния. */
function slotFlash(region: string | null, season: Season, slot: number): Flash | null {
  const ms = slot * FLASH_SLOT * 1000;
  const storm = weatherAt(region, ms, season, 0.25).storm;
  if (storm <= 0.02) return null;
  const seed = regionSeed(region) ^ 0x5bd1e995;
  if (h01(seed, slot, 11) > 0.6 * storm) return null;
  const at = ms + h01(seed, slot, 12) * (FLASH_SLOT - 2) * 1000;
  const power = (0.55 + 0.45 * h01(seed, slot, 13)) * Math.min(1, storm * 1.3);
  return { at, power, thunder: at + (THUNDER_MIN + (THUNDER_MAX - THUNDER_MIN) * h01(seed, slot, 14)) * 1000 };
}

/** Вспышки, чьи миги лежат в `[from, to)` мс общих часов. */
export function flashes(region: string | null, season: Season, from: number, to: number): Flash[] {
  const out: Flash[] = [];
  const s0 = Math.floor(from / 1000 / FLASH_SLOT);
  const s1 = Math.floor(to / 1000 / FLASH_SLOT);
  for (let s = s0; s <= s1; s++) {
    const f = slotFlash(region, season, s);
    if (f && f.at >= from && f.at < to) out.push(f);
  }
  return out;
}

/**
 * Свет вспышки через `dt` секунд после неё: мягкий подъём за пятую долю секунды, спад за полсекунды и слабый второй
 * отблеск — без резкого мигания (подъём не круче `FLASH_RISE` за кадр).
 */
export function flashGlow(dt: number): number {
  if (dt <= 0 || dt > 3) return 0;
  const first = smooth(0, 0.18, dt) * Math.exp(-dt / 0.55);
  const second = dt > 0.38 ? 0.4 * smooth(0.38, 0.56, dt) * Math.exp(-(dt - 0.38) / 0.5) : 0;
  return first + second;
}

/** Свет молнии в миг `ms`: сумма отблесков вспышек последних трёх секунд, 0..1. */
export function flashAt(region: string | null, season: Season, ms: number): number {
  let v = 0;
  for (const f of flashes(region, season, ms - 3000, ms + 1)) v += flashGlow((ms - f.at) / 1000) * f.power;
  return Math.min(1, v);
}

// ---------- Слова ----------

const POINTS = ['с севера', 'с северо-востока', 'с востока', 'с юго-востока', 'с юга', 'с юго-запада', 'с запада', 'с северо-запада'];

/** Откуда ветер словами: «с моря», если с той стороны у дома море (`seaFrom`), иначе по сторонам света. */
export function windWords(w: Weather, seaFrom?: (from: number) => boolean): string {
  if (w.wind < 0.18) return 'тихо';
  const strength = w.wind > 0.72 ? 'сильный ветер' : w.wind > 0.42 ? 'ветер' : 'ветерок';
  const where = seaFrom?.(w.from) ? 'с моря' : POINTS[Math.round(w.from / 45) % 8];
  return `${strength} ${where}`;
}

/** Небо словами: одно главное. */
export function skyWords(w: Weather, night = false): string {
  if (w.storm > 0.25) return 'Гроза';
  if (w.snow > 0.15) return w.snow > 0.75 && w.wind > 0.6 ? 'Метель' : 'Снег';
  if (w.rain > 0.15) return w.rain > 0.8 ? 'Ливень' : 'Дождь';
  if (w.fog > 0.3) return 'Туман';
  if (w.cloud > 0.62) return 'Пасмурно';
  if (w.cloud > 0.3) return 'Облачно';
  return night ? 'Ясная ночь' : 'Ясно';
}

/** «Дождь, ветер с моря» — подсказка погоды в верхней полосе. */
export const weatherWords = (w: Weather, seaFrom?: (from: number) => boolean, night = false): string =>
  `${skyWords(w, night)}, ${windWords(w, seaFrom)}`;

// ---------- Погода адресом ----------

/**
 * Погода, поставленная адресом (`?weather=rain`): стенду — снять её, телефону — проверить вид, не дожидаясь фронта.
 * Только вид: на игру не влияет, как и настоящая.
 */
export const WEATHER_LOOKS: Record<string, Weather> = {
  clear: { cloud: 0, rain: 0, snow: 0, storm: 0, fog: 0, wind: 0.3, from: 300 },
  cloud: { cloud: 0.55, rain: 0, snow: 0, storm: 0, fog: 0, wind: 0.45, from: 300 },
  overcast: { cloud: 0.9, rain: 0, snow: 0, storm: 0, fog: 0, wind: 0.4, from: 250 },
  rain: { cloud: 0.92, rain: 0.8, snow: 0, storm: 0, fog: 0, wind: 0.55, from: 220 },
  storm: { cloud: 1, rain: 1, snow: 0, storm: 1, fog: 0, wind: 0.85, from: 240 },
  snow: { cloud: 0.85, rain: 0, snow: 0.8, storm: 0, fog: 0, wind: 0.35, from: 20 },
  fog: { cloud: 0.35, rain: 0, snow: 0, storm: 0, fog: 1, wind: 0.08, from: 300 },
  wind: { cloud: 0.35, rain: 0, snow: 0, storm: 0, fog: 0, wind: 1, from: 300 },
};

/** Погода из адреса страницы; не задана или незнакома — `null` (настоящая). */
export function forcedWeather(search: string): Weather | null {
  const v = new URLSearchParams(search).get('weather');
  return v !== null && v in WEATHER_LOOKS ? WEATHER_LOOKS[v] : null;
}

/** Вспышки погоды адресом «гроза»: раз в девять секунд, гром — через две с половиной (стенд и проверка на телефоне). */
export function forcedFlashes(storm: number, from: number, to: number): Flash[] {
  if (storm <= 0) return [];
  const out: Flash[] = [];
  for (let k = Math.floor(from / 9000); k * 9000 < to; k++) {
    const at = k * 9000 + 2000;
    if (at >= from && at < to) out.push({ at, power: storm, thunder: at + 2500 });
  }
  return out;
}
