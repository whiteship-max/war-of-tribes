/**
 * Текстуры поляны: какие наборы есть, откуда они взяты и как их загрузить.
 *
 * ТОЛЬКО CC0, И ИСТОЧНИК КАЖДОГО ФАЙЛА ЗАПИСАН ЗДЕСЬ ЖЕ (решение владельца). Опись
 * ниже — одна на игру и на сборку: `npm run textures:build` (`scripts/build-textures.ts`)
 * по ней качает исходники с Poly Haven и режет их в `public/assets/prologue/`, игра по
 * ней же их грузит, а тест (`textures.test.ts`) сверяет, что в папке лежит ровно то, что
 * в описи, — ни лишнего файла, ни недостающего.
 *
 * НАБОР — ДВА ФАЙЛА, И АЛЬФЫ НИ В ОДНОМ. `-c` — цвет (sRGB) с затенением складок,
 * запечённым в него при сборке; `-d` — данные: нормаль по X и Y (соглашение OpenGL) и
 * шероховатость. Третьей карты нет, а альфу не заводим нарочно: браузер, отдающий
 * картинку с домноженной альфой, домножил бы на шероховатость цвет или нормаль, и
 * поймать это можно было бы только глазом на одном телефоне из десяти.
 *
 * РАЗМЕР — ПО СТУПЕНИ, А НЕ ДРУГОЙ МАТЕРИАЛ (решение владельца). Полной ступени —
 * 1024, телефону и полу — 512: материал тот же, та же проекция и те же числа, меньше
 * только точек в файле. Мипмапы строит видеокарта при загрузке.
 *
 * ЗДЕСЬ НЕТ THREE ПО ИМЕНИ СВЕРХ ТОГО, ЧТО УЖЕ БЕРЁТ ДЕРЕВНЯ (`Texture`, `SRGBColorSpace`),
 * и это про первую загрузку: всякое новое имя дописалось бы в общий чанк `three`
 * (docs/prologue.md, раздел 10). Загрузчика three нет — картинку декодирует браузер
 * (`Image`), константы повтора и фильтра — числа, их значения держит тест.
 */
import * as THREE from 'three';
import type { Tier } from './look';

/** Откуда набор: сайт, ассет, автор и сколько метров на образец по описи ассета. */
export interface Source {
  site: 'polyhaven';
  id: string;
  author: string;
  /** Размер образца в метрах — из описи ассета (`dimensions`), чтобы кора была корой в натуральную величину. */
  meters: number;
}

/** Набор текстур: имя в игре и откуда он. */
export interface TexSet {
  name: SetName;
  source: Source;
}

export type SetName = 'snow' | 'trail' | 'trod' | 'bark' | 'needles' | 'litter' | 'rock' | 'logs';

/**
 * Опись. Лицензия у всех — CC0 (Poly Haven выкладывает только её: https://polyhaven.com/license).
 *
 *   snow     свежий снег поляны — ровный, сыпучий;
 *   trail    снег со следами и тропами — там, где ходят;
 *   trod     утоптанный снег с землёй — у огня и у колоды;
 *   bark     кора сосны — стволы, пни, сухостой, берёза (её цвет — палитры);
 *   needles  опавшая хвоя — рисунок хвои на кронах; цвет кроны свой, из текстуры
 *            берётся только рисунок и рельеф;
 *   litter   лесная подстилка и мох — земля под елью, где снега мало, и зола в очаге;
 *   rock     камень со мхом — валуны, камни очага и палатки;
 *   logs     брёвна сруба — дом.
 */
export const SETS: readonly TexSet[] = [
  { name: 'snow', source: { site: 'polyhaven', id: 'snow_02', author: 'Rob Tuytel', meters: 2 } },
  { name: 'trail', source: { site: 'polyhaven', id: 'snow_01', author: 'Rob Tuytel', meters: 2 } },
  { name: 'trod', source: { site: 'polyhaven', id: 'snow_03', author: 'Rob Tuytel', meters: 2 } },
  { name: 'bark', source: { site: 'polyhaven', id: 'pine_bark', author: 'Dimitrios Savva', meters: 2 } },
  { name: 'needles', source: { site: 'polyhaven', id: 'forrest_ground_03', author: 'Rob Tuytel', meters: 2 } },
  { name: 'litter', source: { site: 'polyhaven', id: 'forest_leaves_02', author: 'Rob Tuytel', meters: 3 } },
  { name: 'rock', source: { site: 'polyhaven', id: 'rock_04', author: 'Rob Tuytel', meters: 1.5 } },
  { name: 'logs', source: { site: 'polyhaven', id: 'wood_trunk_wall', author: 'Amal Kumar', meters: 1.25 } },
];

/** Два размера файла: полной ступени и всем остальным. */
export const SIZES = [1024, 512] as const;
export type Size = (typeof SIZES)[number];

/** Сколько точек в файле у ступени. */
export const sizeOf = (tier: Tier): Size => (tier === 'full' ? 1024 : 512);

/**
 * Анизотропная выборка по ступени: снег под ногами уходит к опушке почти вдоль взгляда,
 * и без неё он в пяти метрах мылится в серое. Полной — восемь, телефону — две, полу —
 * без неё: это не другой материал, а та же выборка с меньшим числом отсчётов. Телефону
 * две, а не четыре: видеокарта телефона платит за каждый лишний отсчёт по всей земле в
 * кадре, а снег у опушки, где анизотропия и нужна, и так в дымке.
 */
export const anisoOf = (tier: Tier, max: number): number => Math.max(1, Math.min(max, tier === 'full' ? 8 : tier === 'lite' ? 2 : 1));

/** Где лежит файл набора. `kind`: `c` — цвет, `d` — данные. */
export const fileOf = (name: SetName, kind: 'c' | 'd', size: Size): string => `${name}-${kind}-${size}.webp`;
export const DIR = '/assets/prologue/';

/** `THREE.RepeatWrapping`, `LinearMipmapLinearFilter`, `LinearFilter`: числа, а не имена (первая загрузка). */
export const REPEAT = 1000;
export const MIP_LINEAR = 1008;
export const LINEAR = 1006;

/**
 * Две текстуры набора. Пока файл не приехал, в текстуре картинки нет, и материал с
 * ней не рисуется вовсе (`ready`): сцена ждёт наборы перед первым кадром.
 */
export interface SetTex {
  color: THREE.Texture;
  data: THREE.Texture;
}

function blank(srgb: boolean): THREE.Texture {
  const t = new THREE.Texture();
  t.wrapS = t.wrapT = REPEAT as THREE.Wrapping;
  t.minFilter = MIP_LINEAR as THREE.MinificationTextureFilter;
  t.magFilter = LINEAR as THREE.MagnificationTextureFilter;
  t.generateMipmaps = true;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Загрузить картинку. По событию загрузки, а не по `decode()`: в странице, которую
 * не рисуют (вебвью в фоне, скрытая панель), обещание `decode()` висит, пока её не
 * покажут, — и поляна ждала бы своих восьми секунд, уже имея все файлы.
 */
function image(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(`текстура не загрузилась: ${url}`));
    img.src = url;
  });
}

/**
 * Все наборы поляны одного размера.
 *
 * Текстуры заведены сразу, а картинки приезжают потом: материалам нужны объекты
 * текстур при сборке шейдеров, а файлы — только к кадру. `ready` — все файлы на
 * месте; не приехал хоть один — обещание отвергается, и сцена рисует без текстур
 * (`surface.ts`), а не ждёт вечно.
 */
export class Textures {
  readonly sets = new Map<SetName, SetTex>();
  readonly ready: Promise<void>;
  private anisotropy = 1;
  size: Size;

  constructor(size: Size, anisotropy: number) {
    this.size = size;
    this.anisotropy = anisotropy;
    for (const s of SETS) {
      const color = blank(true);
      const data = blank(false);
      color.anisotropy = data.anisotropy = anisotropy;
      this.sets.set(s.name, { color, data });
    }
    this.ready = this.load(size);
  }

  /** Сменить размер (ступень опустилась): те же объекты текстур, новые картинки. */
  resize(size: Size, anisotropy: number): Promise<void> {
    if (anisotropy !== this.anisotropy) {
      this.anisotropy = anisotropy;
      for (const t of this.sets.values()) {
        t.color.anisotropy = t.data.anisotropy = anisotropy;
        // Анизотропия ставится при загрузке в видеокарту — перезалить то, что уже там.
        if (t.color.image) t.color.needsUpdate = true;
        if (t.data.image) t.data.needsUpdate = true;
      }
    }
    if (size === this.size) return Promise.resolve();
    this.size = size;
    return this.load(size);
  }

  private load(size: Size): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const s of SETS) {
      const t = this.sets.get(s.name)!;
      for (const [kind, tex] of [
        ['c', t.color],
        ['d', t.data],
      ] as const) {
        jobs.push(
          image(DIR + fileOf(s.name, kind, size)).then((img) => {
            if (this.size !== size) return;
            tex.image = img;
            tex.anisotropy = this.anisotropy;
            tex.needsUpdate = true;
          }),
        );
      }
    }
    return Promise.all(jobs).then(() => undefined);
  }

  get(name: SetName): SetTex {
    return this.sets.get(name)!;
  }

  dispose(): void {
    for (const t of this.sets.values()) {
      t.color.dispose();
      t.data.dispose();
    }
  }
}
