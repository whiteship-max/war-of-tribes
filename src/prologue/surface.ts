/**
 * Материалы поляны: свои копии общих — с ветром в кронах, снегом на ветках и
 * крышах и мокрой землёй в дождь.
 *
 * СВОИ КОПИИ, А НЕ ОБЩИЕ МАТЕРИАЛЫ, И ЭТО ПРО ДЕРЕВНЮ. Материалы набора
 * (`render/materials.ts`) — одни на всю игру, их цвет ведёт сезон посёлка.
 * Научи их ветру и снегу на месте — и шейдер деревни поменялся бы вместе с
 * поляной, а снег, севший на ветки здесь, остался бы лежать на крышах посёлка.
 * Поэтому поляна берёт копию каждого материала, который у неё в кадре, и
 * отдаёт копии при выходе (`dispose`); общие материалы не меняются ни на бит.
 *
 * ВСЁ ЭТО КАРТИНКА, А НЕ ВЕЛИЧИНА. Сколько снега на ветках и насколько мокра
 * земля, сцена выводит из того же кольца погод (`sky.ts`), а не копит: вошедший
 * посреди снегопада застаёт ветки белыми, а в сохранение не попадает ничего.
 *
 * Стоит это одной вставки в шейдер Ламберта: сдвиг вершины по синусу времени —
 * ветер, умножение цвета — сырость, подмешивание цвета снега по тому, насколько
 * грань смотрит вверх, — снег. Ни одного нового класса three, ни одного прохода,
 * ни одного вызова отрисовки: копии рисуются там же, где рисовались общие. Вторая
 * вставка — мягкие тени полной ступени (`SOFT_PARS`), и она тоже без прохода: меняется
 * только то, как тень читается из карты.
 */
import * as THREE from 'three';
import { PALETTE } from '@/render/palette';
import {
  LOOKS,
  PBR_FRAG_HEAD,
  PBR_LIGHT_BODY,
  PBR_LIGHT_PARS,
  PBR_OUT,
  PBR_SURFACE,
  PBR_VERT_BODY,
  PBR_VERT_HEAD,
  pbrOf,
  type PbrShared,
} from './pbr';
import { SETS, type SetName, type Textures } from './textures';

/**
 * Чем материал шевелится.
 *
 *   still  не шевелится вовсе: земля, камень, сруб, палатка;
 *   crown  крона: качается выше ствола, у земли стоит;
 *   tuft   трава: качается от самой земли и видна с обеих сторон.
 */
export type Role = 'still' | 'crown' | 'tuft';

/** Откуда начинается качание и насколько сильное на метр высоты. */
const WIND: Record<Role, { from: number; gain: number }> = {
  still: { from: 0, gain: 0 },
  crown: { from: 0.9, gain: 0.013 },
  tuft: { from: 0, gain: 0.16 },
};

/**
 * Насколько материал берёт снег и темнеет от дождя.
 *
 * Снег ложится на то, что смотрит вверх: кроны, крыша сруба, палатка, камни.
 * Земля его не берёт — белеющей в снег земли в режиме нет, и это решение
 * (docs/prologue.md, раздел 14): поляна у ног остаётся читаемой в любую погоду.
 */
const TAKES: Record<string, { snow: number; wet: number }> = {
  leaves: { snow: 0.9, wet: 0.14 },
  leaves2: { snow: 0.9, wet: 0.14 },
  bush: { snow: 0.8, wet: 0.14 },
  grass: { snow: 0, wet: 0.5 },
  trample: { snow: 0, wet: 0.52 },
  trunk: { snow: 0.5, wet: 0.3 },
  rock: { snow: 0.85, wet: 0.32 },
  hide: { snow: 0.9, wet: 0.24 },
  body: { snow: 0.7, wet: 0.22 },
  proStone: { snow: 0.85, wet: 0.32 },
  proWood: { snow: 0.6, wet: 0.3 },
};

/** Строка итога Ламберта, к которой приписывается блик (`pbr.PBR_OUT`). */
const OUTGOING = 'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;';

const VERT_HEAD = /* glsl */ `#include <common>
uniform float proTime;
uniform float proWind;
uniform float proWindFrom;
uniform float proWindGain;`;

/**
 * Ветер. Фаза зависит от места в мире, а не от вершины: соседние ветки одного
 * дерева качаются вместе, а по лесу проходит волна — порыв, а не дрожь.
 */
const VERT_BODY = /* glsl */ `#include <begin_vertex>
{
  vec4 proW = modelMatrix * vec4( transformed, 1.0 );
  float proH = max( 0.0, transformed.y - proWindFrom ) * proWindGain;
  float proPh = proTime * 1.35 + proW.x * 0.23 + proW.z * 0.19;
  float proS = ( sin( proPh ) + 0.35 * sin( proPh * 2.7 + 1.3 ) ) * proWind * proH;
  transformed.x += proS;
  transformed.z += proS * 0.6;
}`;

const FRAG_HEAD = /* glsl */ `#include <common>
uniform float proSnow;
uniform float proSnowK;
uniform float proWet;
uniform float proWetK;
uniform vec3 proSnowColor;`;

/**
 * Сырость и снег. Вставлено после нормали и до света: грань, смотрящая вверх,
 * белеет, мокрая — темнеет и холодеет, а освещает их потом тот же риг. У материала с
 * текстурами (`pbr.ts`) снег и сырость свои, по рисунку текстуры; эта же ветвь у него
 * остаётся запасной — пока текстуры не приехали или если не приедут вовсе.
 */
const FRAG_BODY = `#include <emissivemap_fragment>${PBR_SURFACE}`;

/**
 * Мягкие тени: тень с контактным ужесточением (PCSS, Fernando 2005) вместо общей.
 *
 * ТЕНЬ У ОСНОВАНИЯ СТВОЛА РЕЗКАЯ, ОТ КРОНЫ В ДЕСЯТИ МЕТРАХ — РАЗМЫТАЯ. Так делает любое
 * солнце: у него есть размер, и чем дальше от тени то, что её бросает, тем шире
 * полутень. Общая тень рига одной ширины на всё — у пня и у стены леса, — и на снегу у
 * костра читалась лесенкой. Здесь сперва ищутся заслоняющие (`PRO_BLOCKERS` выборок в
 * круге поиска), по их средней глубине считается ширина полутени, и уже ею —
 * `PRO_TAPS` выборок сглаживания. Круг поворачивается шумом по точке экрана: полутень
 * зернится, а не полосит.
 *
 * Только на полной ступени и только сборкой (`PRO_SOFT`), а не ветвлением в шейдере:
 * телефон не платит за неё ни такта. Общая тень рига деревни не меняется — вставка
 * живёт в копиях поляны.
 */
const SOFT_PARS = /* glsl */ `#include <shadowmap_pars_fragment>
#if defined( USE_SHADOWMAP ) && defined( PRO_SOFT ) && NUM_DIR_LIGHT_SHADOWS > 0
uniform float proPenumbra;
uniform float proSearch;
float proShadow( sampler2D map, vec2 size, float intensity, float bias, float radius, vec4 coord ) {
  coord.xyz /= coord.w;
  coord.z += bias;
  if ( coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0 ) return 1.0;
  float rot = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) * 6.2831853;
  float sum = 0.0;
  float n = 0.0;
  for ( int i = 0; i < PRO_BLOCKERS; i++ ) {
    float t = ( float( i ) + 0.5 ) / float( PRO_BLOCKERS );
    float a = float( i ) * 2.39996323 + rot;
    float d = unpackRGBAToDepth( texture2D( map, coord.xy + vec2( cos( a ), sin( a ) ) * sqrt( t ) * proSearch ) );
    if ( d < coord.z ) { sum += d; n += 1.0; }
  }
  if ( n < 0.5 ) return 1.0;
  float pen = clamp( ( coord.z - sum / n ) * proPenumbra, 1.2 / size.x, proSearch );
  float lit = 0.0;
  for ( int i = 0; i < PRO_TAPS; i++ ) {
    float t = ( float( i ) + 0.5 ) / float( PRO_TAPS );
    float a = float( i ) * 2.39996323 + rot + 1.3;
    lit += step( coord.z, unpackRGBAToDepth( texture2D( map, coord.xy + vec2( cos( a ), sin( a ) ) * sqrt( t ) * pen ) ) );
  }
  return mix( 1.0, lit / float( PRO_TAPS ), intensity );
}
#define getShadow proShadow
#endif`;

/** Числа, общие на все материалы поляны. Сцена двигает их, материалы только читают. */
export interface SurfaceUniforms {
  time: { value: number };
  wind: { value: number };
  snow: { value: number };
  wet: { value: number };
  snowColor: { value: THREE.Color };
  /** Мягкие тени: сколько полутени (в долях карты) на единицу глубины карты и круг поиска. */
  penumbra: { value: number };
  search: { value: number };
  /** Текстуры приехали (`pbr.ts`): 1 — рисовать ими, 0 — прежним цветом. */
  texOn: { value: number };
}

/** Метров на образец набора — по описи ассета (`textures.SETS`). */
const metersOf = (set: SetName): number => SETS.find((s) => s.name === set)?.source.meters ?? 1;

export class Surfaces {
  readonly u: SurfaceUniforms = {
    time: { value: 0 },
    wind: { value: 0.6 },
    snow: { value: 0 },
    wet: { value: 0 },
    snowColor: { value: new THREE.Color(PALETTE.snowflake) },
    penumbra: { value: 0 },
    search: { value: 0 },
    texOn: { value: 0 },
  };

  /** Текстуры поляны (`textures.ts`): без них копии остаются прежними, Ламбертом палитры. */
  private shared: PbrShared | null = null;

  /**
   * Дать копиям текстуры. Зовётся до первой копии: набор и проекция — определения
   * шейдера, и копия, снятая раньше, осталась бы без них до выхода.
   */
  useTextures(tex: Textures): void {
    this.shared = { tex, texOn: this.u.texOn };
    tex.ready.then(
      () => {
        this.u.texOn.value = 1;
      },
      () => {
        // Не приехал хоть один файл — рисуем прежним цветом: поляна без текстур лучше,
        // чем поляна с чёрными дырами на месте коры.
        this.u.texOn.value = 0;
      },
    );
  }

  /** Мягкие ли тени у копий (`SOFT_PARS`): меняется со ступенью и пересобирает шейдеры. */
  private soft = false;

  /** Включить или снять мягкие тени у всех копий. Пересборка — один раз, на смене ступени. */
  setSoft(on: boolean): void {
    if (on === this.soft) return;
    this.soft = on;
    for (const m of this.made.values()) {
      const defs = (m.defines ??= {}) as Record<string, string | number>;
      if (on) {
        defs.PRO_SOFT = '';
        defs.PRO_BLOCKERS = 12;
        defs.PRO_TAPS = 20;
      } else {
        delete defs.PRO_SOFT;
        delete defs.PRO_BLOCKERS;
        delete defs.PRO_TAPS;
      }
      m.needsUpdate = true;
    }
  }

  /** Копии по роли и исходному материалу: одна копия на пару, сколько бы мешей её ни брали. */
  private made = new Map<string, THREE.Material>();

  /** Переодеть всё, что в группе, в копии поляны. Живое и светящееся не трогается. */
  adopt<T extends THREE.Object3D>(root: T, role: Role = 'still'): T {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => this.of(m, role))
        : this.of(mesh.material, role);
    });
    return root;
  }

  private of(m: THREE.Material, role: Role): THREE.Material {
    const src = m as THREE.MeshLambertMaterial;
    if (!src.isMeshLambertMaterial || !(m.name in TAKES)) return m;
    const key = `${role}:${m.uuid}`;
    let out = this.made.get(key);
    if (!out) {
      out = this.make(src, role);
      this.made.set(key, out);
    }
    return out;
  }

  private make(src: THREE.MeshLambertMaterial, role: Role): THREE.Material {
    const mat = src.clone();
    if (role === 'tuft') mat.side = THREE.DoubleSide;
    const takes = TAKES[src.name];
    // Трава качается и видна с обеих сторон — ей текстура ни к чему: травинка тоньше
    // точки образца. Остальное с набором в `LOOKS` — с текстурами.
    const look = role === 'tuft' ? undefined : LOOKS[src.name];
    const pbr = look && this.shared ? pbrOf(mat, look, this.shared, metersOf) : {};
    const wind = WIND[role];
    const own = {
      proWindFrom: { value: wind.from },
      proWindGain: { value: wind.gain },
      proSnowK: { value: takes.snow },
      proWetK: { value: takes.wet },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, own, pbr, {
        proTime: this.u.time,
        proWind: this.u.wind,
        proSnow: this.u.snow,
        proWet: this.u.wet,
        proSnowColor: this.u.snowColor,
        proPenumbra: this.u.penumbra,
        proSearch: this.u.search,
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', VERT_HEAD + PBR_VERT_HEAD)
        .replace('#include <begin_vertex>', VERT_BODY)
        .replace('#include <project_vertex>', `#include <project_vertex>${PBR_VERT_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', FRAG_HEAD + PBR_FRAG_HEAD)
        .replace('#include <emissivemap_fragment>', FRAG_BODY)
        .replace('#include <lights_lambert_pars_fragment>', PBR_LIGHT_PARS)
        .replace('#include <lights_lambert_fragment>', PBR_LIGHT_BODY)
        .replace(OUTGOING, PBR_OUT)
        .replace('#include <shadowmap_pars_fragment>', SOFT_PARS);
    };
    // Вставка у всех копий одна, значит и программа одна на вид материала:
    // копий много, а компиляций столько же, сколько было. Мягкие тени — вторая
    // программа, и выбирает её ступень.
    mat.customProgramCacheKey = () => (this.soft ? 'prologue-surface-soft' : 'prologue-surface');
    if (this.soft) mat.defines = { ...(mat.defines ?? {}), PRO_SOFT: '', PRO_BLOCKERS: 12, PRO_TAPS: 20 };
    return mat;
  }

  dispose(): void {
    for (const m of this.made.values()) m.dispose();
    this.made.clear();
  }
}
