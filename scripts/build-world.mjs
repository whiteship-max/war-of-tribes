// Запекание настоящей географии в атлас мира.
//
// Мир перестал быть шумом по сиду и стал одной картой на всех: Европа, Магриб,
// Анатолия. Земля, горы, пустыни и реки берутся из Natural Earth (общественное
// достояние) — откуда именно и что при этом выведено нами, записано в
// `assets-src/world/SOURCES.md`.
//
// Скрипт запускается руками — `npm run world:build`, — а не сборкой: исходников
// 23 МБ, и качать их на каждый релиз незачем. В репозиторий уезжает только
// результат: `src/world/atlas/data.ts`. Его руками не правят.
//
// Почему растр, а не полигоны в игре: игра спрашивает ландшафт клетки десятки
// тысяч раз за один расчёт пути (`terrainFactor` — до 600 проб на поход,
// `landmasses` — обход всего мира). Точка-в-полигоне на таком потоке не проходит
// по времени ни на каком телефоне.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const root = fileURLToPath(new NodeURL('..', import.meta.url));
const cacheDir = join(root, 'assets-src', 'world', 'cache');
const outFile = join(root, 'src', 'world', 'atlas', 'data.ts');
const snapFile = join(root, 'snaps', 'world-atlas.png');

// ---------- Рамка и проекция ----------

/**
 * Порядок обязан совпасть с `TERRAIN_ORDER` в `src/world/data/terrain.ts`:
 * атлас везёт индекс, а не имя. Сверяет их тест `atlas.test.ts` — по этому же
 * списку, который уезжает в сгенерированный файл.
 */
const TERRAIN = ['plain', 'forest', 'hills', 'water', 'steppe', 'desert'];
const T = Object.fromEntries(TERRAIN.map((n, i) => [n, i]));

/** Биты поверх класса: они же `FEATURE.river`/`FEATURE.ridge` в игре. */
const BIT_RIVER = 8;
const BIT_RIDGE = 16;

const SIZE = Number(process.env.SIZE || 800);
/** Стандартные параллели, осевой меридиан и широта отсчёта — см. SOURCES.md. */
const SP1 = 33, SP2 = 60, LAT0 = 52, LON0 = 15;
/** Рамка в километрах от начала проекции. Квадрат: мир в игре — одно число. */
const FRAME = { x0: -2300, x1: 2600, y0: -2550, y1: 2350 };
/** Русла тоньше этого ранга Natural Earth в преграды не идут: см. SOURCES.md. */
const RIVER_RANK = 7;
/** Окно отсечения в градусах: у конической проекции полюс уходит в бесконечность. */
const WIN = { lon0: -45, lon1: 66, lat0: 8, lat1: 84 };

const R_EARTH = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;

function projection() {
  const f1 = rad(SP1), f2 = rad(SP2);
  const t = (f) => Math.tan(Math.PI / 4 + f / 2);
  const n = Math.log(Math.cos(f1) / Math.cos(f2)) / Math.log(t(f2) / t(f1));
  const F = (Math.cos(f1) * Math.pow(t(f1), n)) / n;
  const rho = (latDeg) => (R_EARTH * F) / Math.pow(t(rad(latDeg)), n);
  const rho0 = rho(LAT0);
  return {
    n,
    fwd(lon, lat) {
      const r = rho(lat);
      const th = n * rad(lon - LON0);
      return [r * Math.sin(th), rho0 - r * Math.cos(th)];
    },
    inv(x, y) {
      const yy = rho0 - y;
      const r = Math.sign(n) * Math.hypot(x, yy);
      const th = Math.atan2(x, yy);
      const lat = 2 * Math.atan(Math.pow((R_EARTH * F) / r, 1 / n)) - Math.PI / 2;
      return [LON0 + ((th / n) * 180) / Math.PI, (lat * 180) / Math.PI];
    },
    /** Масштаб длин: 1 — без искажения. Разброс по рамке и есть честность карты. */
    k(lat) {
      return (n * rho(lat)) / (R_EARTH * Math.cos(rad(lat)));
    },
  };
}

const P = projection();
const KM = (FRAME.x1 - FRAME.x0) / SIZE;
const toGrid = (lon, lat) => {
  const p = P.fwd(lon, lat);
  return [(p[0] - FRAME.x0) / KM, (FRAME.y1 - p[1]) / KM];
};
const cellLat = (col, row) => P.inv(FRAME.x0 + (col + 0.5) * KM, FRAME.y1 - (row + 0.5) * KM)[1];

// ---------- Исходники ----------

const LAYERS = [
  'ne_10m_land',
  'ne_10m_lakes',
  'ne_10m_rivers_lake_centerlines',
  'ne_10m_geography_regions_polys',
];
const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

function source(name) {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `${name}.geojson`);
  if (!existsSync(file)) {
    process.stdout.write(`качаю ${name}… `);
    execFileSync('curl', ['-sSL', '-o', file, `${BASE}/${name}.geojson`], { stdio: ['ignore', 'ignore', 'inherit'] });
    process.stdout.write('есть\n');
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

const ringsOf = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const linesOf = (g) => (!g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);

// ---------- Растеризация ----------

/**
 * Отсечение кольца по окну в градусах (Сазерленд–Ходжмен). Без него Антарктида
 * из `ne_10m_land` проецируется в бесконечность и рвёт заливку полосами через
 * всю карту — на это уже наступали.
 */
function clipRing(ring) {
  let out = ring;
  const edges = [
    [(p) => p[0] >= WIN.lon0, WIN.lon0, 0],
    [(p) => p[0] <= WIN.lon1, WIN.lon1, 0],
    [(p) => p[1] >= WIN.lat0, WIN.lat0, 1],
    [(p) => p[1] <= WIN.lat1, WIN.lat1, 1],
  ];
  for (const [inside, at, axis] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length];
      const ia = inside(a), ib = inside(b);
      const cut = () => {
        const t = (at - a[axis]) / (b[axis] - a[axis]);
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        p[axis] = at;
        return p;
      };
      if (ia) {
        out.push(a);
        if (!ib) out.push(cut());
      } else if (ib) out.push(cut());
    }
    if (!out.length) return [];
  }
  out.push(out[0]);
  return out;
}

/** Заливка колец по правилу «чёт-нечет», строками. */
function fill(mask, polys) {
  const buckets = Array.from({ length: SIZE }, () => []);
  for (const poly of polys) {
    for (const raw of poly) {
      const ring = clipRing(raw);
      if (ring.length < 4) continue;
      const pts = ring.map((p) => toGrid(p[0], p[1]));
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (!Number.isFinite(a[0]) || !Number.isFinite(a[1]) || !Number.isFinite(b[0]) || !Number.isFinite(b[1])) continue;
        if (a[1] === b[1]) continue;
        const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
        const r0 = Math.max(0, Math.ceil(lo - 0.5)), r1 = Math.min(SIZE - 1, Math.floor(hi - 0.5));
        for (let r = r0; r <= r1; r++) buckets[r].push(a[0], a[1], b[0], b[1]);
      }
    }
  }
  const xs = [];
  for (let r = 0; r < SIZE; r++) {
    const bk = buckets[r];
    if (!bk.length) continue;
    const yc = r + 0.5;
    xs.length = 0;
    for (let i = 0; i < bk.length; i += 4) {
      const ax = bk[i], ay = bk[i + 1], bx = bk[i + 2], by = bk[i + 3];
      if ((ay <= yc) === (by <= yc)) continue;
      xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const c0 = Math.max(0, Math.ceil(xs[i] - 0.5));
      const c1 = Math.min(SIZE - 1, Math.floor(xs[i + 1] - 0.5));
      for (let c = c0; c <= c1; c++) mask[r * SIZE + c] = 1;
    }
  }
}

/** Линия по клеткам: шаг в треть клетки, иначе русло рвётся на диагоналях. */
function stroke(mask, segs) {
  for (const line of segs) {
    const keep = line.filter((p) => p[0] >= WIN.lon0 && p[0] <= WIN.lon1 && p[1] >= WIN.lat0 && p[1] <= WIN.lat1);
    if (keep.length < 2) continue;
    const pts = keep.map((p) => toGrid(p[0], p[1]));
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) continue;
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len > SIZE) continue;
      const steps = Math.max(1, Math.ceil(len * 3));
      for (let s = 0; s <= steps; s++) {
        const c = Math.round(x0 + ((x1 - x0) * s) / steps - 0.5);
        const r = Math.round(y0 + ((y1 - y0) * s) / steps - 0.5);
        if (c >= 0 && c < SIZE && r >= 0 && r < SIZE) mask[r * SIZE + c] = 1;
      }
    }
  }
}

/**
 * Утоньшение Чжана–Суня. Хребет обязан быть линией: перевал берётся один на
 * блок клеток, и пятно в сорок клеток шириной перевалом не открыть — через горы
 * тогда просто нет дороги.
 */
function thin(src) {
  const a = Uint8Array.from(src);
  const at = (x, y) => a[y * SIZE + x];
  const marks = [];
  for (let pass = 0; pass < 200; pass++) {
    let changed = false;
    for (let step = 0; step < 2; step++) {
      marks.length = 0;
      for (let y = 1; y < SIZE - 1; y++) {
        for (let x = 1; x < SIZE - 1; x++) {
          if (!at(x, y)) continue;
          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
          const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let cross = 0;
          for (let i = 0; i < 8; i++) if (seq[i] === 0 && seq[i + 1] === 1) cross++;
          if (cross !== 1) continue;
          if (step === 0) {
            if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
          } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
          marks.push(y * SIZE + x);
        }
      }
      if (marks.length) {
        changed = true;
        for (const i of marks) a[i] = 0;
      }
    }
    if (!changed) break;
  }
  return a;
}

// ---------- Лес: единственный выведенный слой ----------

const hash2 = (x, y) => {
  let h = (0x9e3779b9 ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
const smooth = (t) => t * t * (3 - 2 * t);
function noise(x, y, scale) {
  const fx = x / scale, fy = y / scale;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = smooth(fx - x0), ty = smooth(fy - y0);
  const a = hash2(x0, y0), b = hash2(x0 + 1, y0), c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

// ---------- Упаковка ----------

/** Прогон: значение, потом длина — один байт до 253, иначе 254 и два байта. */
function rlePack(cells) {
  const out = [];
  let i = 0;
  while (i < cells.length) {
    const v = cells[i];
    let n = 1;
    while (i + n < cells.length && cells[i + n] === v) n++;
    let left = n;
    while (left > 0) {
      const take = Math.min(left, 65535);
      out.push(v);
      if (take < 254) out.push(take);
      else out.push(254, take & 255, take >> 8);
      left -= take;
    }
    i += n;
  }
  return Uint8Array.from(out);
}

function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ---------- Сборка ----------

const started = Date.now();
const land = new Uint8Array(SIZE * SIZE);
fill(land, source('ne_10m_land').features.flatMap((f) => ringsOf(f.geometry)));
const lake = new Uint8Array(SIZE * SIZE);
fill(lake, source('ne_10m_lakes').features.flatMap((f) => ringsOf(f.geometry)));
for (let i = 0; i < land.length; i++) if (lake[i]) land[i] = 0;

const geo = source('ne_10m_geography_regions_polys').features;
/** Natural Earth зовёт её нагорьем, но это полуостров целиком: см. SOURCES.md. */
const NOT_PLATEAU = new Set(['PENÍNSULA IBÉRICA']);
const region = (pred) => {
  const m = new Uint8Array(SIZE * SIZE);
  for (const f of geo) if (pred(f.properties)) fill(m, ringsOf(f.geometry));
  return m;
};
const mountains = region((p) => p.FEATURECLA === 'Range/mtn');
const deserts = region((p) => p.FEATURECLA === 'Desert');
const plateaus = region((p) => p.FEATURECLA === 'Plateau' && !NOT_PLATEAU.has(String(p.NAME)));
const steppes = region((p) => p.FEATURECLA === 'Plain' && /STEPPE|ALF|CASPIAN/i.test(String(p.NAME || '')));
const plains = region((p) => p.FEATURECLA === 'Plain' || p.FEATURECLA === 'Lowland');

const rivers = new Uint8Array(SIZE * SIZE);
let riverCount = 0;
for (const f of source('ne_10m_rivers_lake_centerlines').features) {
  const p = f.properties;
  if (p.featurecla !== 'River' || !(Number(p.scalerank) <= RIVER_RANK)) continue;
  riverCount++;
  stroke(rivers, linesOf(f.geometry));
}
for (let i = 0; i < rivers.length; i++) if (!land[i]) rivers[i] = 0;

const highland = new Uint8Array(SIZE * SIZE);
for (let i = 0; i < highland.length; i++) highland[i] = mountains[i] && land[i] ? 1 : 0;
const ridges = thin(highland);

const cells = new Uint8Array(SIZE * SIZE);
for (let row = 0; row < SIZE; row++) {
  for (let col = 0; col < SIZE; col++) {
    const i = row * SIZE + col;
    if (!land[i]) {
      cells[i] = T.water;
      continue;
    }
    if (deserts[i]) cells[i] = T.desert;
    else if (mountains[i] || plateaus[i]) cells[i] = T.hills;
    else if (steppes[i]) cells[i] = T.steppe;
    else {
      // Лес — единственный выведенный слой: широта, шум и распаханные равнины.
      const lat = cellLat(col, row);
      let p = 0.72;
      if (lat < 43) p = 0.24;
      else if (lat < 47) p = 0.5;
      else if (lat > 65) p = 0.35;
      if (plains[i]) p *= 0.55;
      const n = noise(col, row, 14) * 0.6 + noise(col + 5000, row + 5000, 5) * 0.4;
      cells[i] = n < p ? T.forest : T.plain;
    }
    if (rivers[i]) cells[i] |= BIT_RIVER;
    if (ridges[i]) cells[i] |= BIT_RIDGE;
  }
}

const packed = rlePack(cells);
const b64 = Buffer.from(packed).toString('base64');
const hash = fnv1a(cells);

const header = `// Сгенерирован \`npm run world:build\` из данных Natural Earth (общественное
// достояние). Руками не править — скрипт перезапишет. Откуда что взято и что
// выведено нами — \`assets-src/world/SOURCES.md\`.
//
// Клетка — один байт: младшие три бита это индекс в ATLAS_TERRAIN, бит 3 — река,
// бит 4 — хребет. Байты уложены построчно и сжаты прогонами; распаковывает их
// \`src/world/atlas/atlas.ts\`.
`;

const body = `${header}
/** Сторона квадрата мира в клетках. Обязана совпасть с WORLD_SIZE. */
export const ATLAS_SIZE = ${SIZE};

/** Километров в клетке: рамка ${FRAME.x1 - FRAME.x0} км на ${SIZE} клеток. */
export const ATLAS_KM = ${KM.toFixed(5)};

/** Рамка в километрах от начала проекции — см. ATLAS_PROJ. */
export const ATLAS_FRAME = { x0: ${FRAME.x0}, x1: ${FRAME.x1}, y0: ${FRAME.y0}, y1: ${FRAME.y1} } as const;

/** Коническая равноугольная Ламберта: параллели, осевой меридиан, широта отсчёта. */
export const ATLAS_PROJ = { sp1: ${SP1}, sp2: ${SP2}, lon0: ${LON0}, lat0: ${LAT0} } as const;

/** Порядок классов. Тест сверяет его с TERRAIN_ORDER — атлас везёт индекс. */
export const ATLAS_TERRAIN = ${JSON.stringify(TERRAIN)} as const;

/** FNV-1a распакованных байт: распаковка обязана сойтись, иначе мир не тот. */
export const ATLAS_HASH = ${hash};

/** Байт на клетку, прогонами, base64. */
export const ATLAS_RLE =
  '${b64}';
`;

mkdirSync(join(root, 'src', 'world', 'atlas'), { recursive: true });
writeFileSync(outFile, body, 'utf8');

// ---------- Отчёт ----------

const count = (m) => m.reduce((a, b) => a + b, 0);
const tally = {};
for (const v of cells) {
  const c = v & 7;
  tally[c] = (tally[c] || 0) + 1;
}
const gzip = zlib.gzipSync(Buffer.from(b64), { level: 9 }).length;
const brotli = zlib.brotliCompressSync(Buffer.from(b64), {
  params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
}).length;

// Масштаб длин меряется по всем клеткам суши: разброс по пустому углу рамки
// ничего не говорит о том, что стоит поход.
let kMin = Infinity, kMax = -Infinity, kMinLand = Infinity, kMaxLand = -Infinity;
for (let row = 0; row < SIZE; row += 2) {
  for (let col = 0; col < SIZE; col += 2) {
    const lat = cellLat(col, row);
    if (!Number.isFinite(lat) || lat < 5 || lat > 85) continue;
    const k = P.k(lat);
    kMin = Math.min(kMin, k);
    kMax = Math.max(kMax, k);
    if (!land[row * SIZE + col]) continue;
    kMinLand = Math.min(kMinLand, k);
    kMaxLand = Math.max(kMaxLand, k);
  }
}

console.log('');
console.log(`атлас ${SIZE}×${SIZE} клеток, ${KM.toFixed(2)} км в клетке, собран за ${Date.now() - started} мс`);
console.log(`  ландшафт: ${TERRAIN.map((n, i) => `${n} ${((100 * (tally[i] || 0)) / cells.length).toFixed(1)}%`).join('  ')}`);
console.log(`  русло ${count(rivers)} кл (${riverCount} отрезков рек), хребет ${count(ridges)} кл из ${count(highland)} горных`);
console.log(`  масштаб длин: по рамке ${kMin.toFixed(3)}…${kMax.toFixed(3)}, по суше ${kMinLand.toFixed(3)}…${kMaxLand.toFixed(3)}`);
console.log(`  клетка на суше ${(KM / kMaxLand).toFixed(2)}…${(KM / kMinLand).toFixed(2)} км (номинал ${KM.toFixed(2)})`);
console.log(`  вес: исходник ${(body.length / 1024).toFixed(1)} КБ, по сети ${(gzip / 1024).toFixed(1)} КБ gzip / ${(brotli / 1024).toFixed(1)} КБ brotli`);
console.log(`  ${outFile.slice(root.length)}`);

// Картинка для глаза: ландшафт не описывают словами, на него смотрят.
try {
  const sharp = (await import('sharp')).default;
  const COLOR = {
    [T.water]: [43, 71, 97],
    [T.plain]: [95, 107, 60],
    [T.forest]: [60, 83, 48],
    [T.hills]: [107, 90, 65],
    [T.steppe]: [140, 132, 82],
    [T.desert]: [186, 165, 112],
  };
  const rgb = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) {
    let c = COLOR[cells[i] & 7];
    if (cells[i] & BIT_RIDGE) c = [190, 185, 178];
    if (cells[i] & BIT_RIVER) c = [70, 130, 175];
    rgb[i * 3] = c[0];
    rgb[i * 3 + 1] = c[1];
    rgb[i * 3 + 2] = c[2];
  }
  mkdirSync(join(root, 'snaps'), { recursive: true });
  await sharp(rgb, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toFile(snapFile);
  console.log(`  ${snapFile.slice(root.length)}`);
} catch (e) {
  console.log(`  картинку не собрал: ${e.message}`);
}
