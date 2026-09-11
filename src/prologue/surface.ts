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
 * ни одного вызова отрисовки: копии рисуются там же, где рисовались общие.
 */
import * as THREE from 'three';
import { PALETTE } from '@/render/palette';

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
};

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
 * белеет, мокрая — темнеет и холодеет, а освещает их потом тот же риг.
 */
const FRAG_BODY = /* glsl */ `#include <emissivemap_fragment>
{
  float proUp = dot( normal, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) );
  float proDamp = proWet * proWetK;
  diffuseColor.rgb *= vec3( 1.0 - proDamp, 1.0 - proDamp * 0.92, 1.0 - proDamp * 0.78 );
  diffuseColor.rgb = mix( diffuseColor.rgb, proSnowColor, proSnow * proSnowK * smoothstep( 0.22, 0.68, proUp ) );
}`;

/** Числа, общие на все материалы поляны. Сцена двигает их, материалы только читают. */
export interface SurfaceUniforms {
  time: { value: number };
  wind: { value: number };
  snow: { value: number };
  wet: { value: number };
  snowColor: { value: THREE.Color };
}

export class Surfaces {
  readonly u: SurfaceUniforms = {
    time: { value: 0 },
    wind: { value: 0.6 },
    snow: { value: 0 },
    wet: { value: 0 },
    snowColor: { value: new THREE.Color(PALETTE.snowflake) },
  };

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
    const wind = WIND[role];
    const own = {
      proWindFrom: { value: wind.from },
      proWindGain: { value: wind.gain },
      proSnowK: { value: takes.snow },
      proWetK: { value: takes.wet },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, own, {
        proTime: this.u.time,
        proWind: this.u.wind,
        proSnow: this.u.snow,
        proWet: this.u.wet,
        proSnowColor: this.u.snowColor,
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', VERT_HEAD)
        .replace('#include <begin_vertex>', VERT_BODY);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', FRAG_HEAD)
        .replace('#include <emissivemap_fragment>', FRAG_BODY);
    };
    // Вставка у всех копий одна, значит и программа одна на вид материала:
    // копий много, а компиляций столько же, сколько было.
    mat.customProgramCacheKey = () => 'prologue-surface';
    return mat;
  }

  dispose(): void {
    for (const m of this.made.values()) m.dispose();
    this.made.clear();
  }
}
