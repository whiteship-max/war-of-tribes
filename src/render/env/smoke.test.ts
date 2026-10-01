// Круглые мягкие клубы дыма вида `next` (docs/graphics_world.md, 11.6): правка ложится на настоящий шейдер точек three,
// а накладывает её только приехавший кусок окружения — у прежнего вида дым прежний.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PUFF_GROW, roundSmoke } from './smoke';
import { CHIMNEY_LOOK, HEARTH_LOOK, Smoke } from '../weather';

/** Программа материала точек так, как её соберёт three: шейдер точек и правка `onBeforeCompile`. */
function compiled(mat: THREE.PointsMaterial): { vertexShader: string; fragmentShader: string } {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.points.vertexShader,
    fragmentShader: THREE.ShaderLib.points.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  mat.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

describe('клубы дыма вида next', () => {
  it('клуб круглый и мягкий: прозрачность растёт к краю точки, клуб крупнее квадратного', () => {
    const smoke = new Smoke(HEARTH_LOOK, []);
    const mat = smoke.points.material as THREE.PointsMaterial;
    // Граница области: шейдер точек three — с теми кусками, куда ложится правка.
    expect(THREE.ShaderLib.points.vertexShader).toMatch(/#include <logdepthbuf_vertex>/);
    expect(THREE.ShaderLib.points.fragmentShader).toMatch(/#include <color_fragment>/);
    roundSmoke(mat);
    const s = compiled(mat);
    expect(s.fragmentShader, 'край клуба').toMatch(/diffuseColor\.a \*= smoothstep\( 0\.5, [0-9.]+, length\( gl_PointCoord - 0\.5 \) \);/);
    expect(s.vertexShader, 'клуб крупнее').toContain(`gl_PointSize *= ${PUFF_GROW.toFixed(2)};`);
    expect(PUFF_GROW).toBeGreaterThan(1);
    expect(mat.customProgramCacheKey(), 'своя программа').toBe('smoke-puff');
  });

  it('у прежнего вида дым прежний: без куска окружения правки нет, и сцена накладывает её только из него', () => {
    const plain = new Smoke(CHIMNEY_LOOK, []).points.material as THREE.PointsMaterial;
    expect(plain.customProgramCacheKey()).not.toBe('smoke-puff');
    const s = compiled(plain);
    expect(s.fragmentShader).not.toMatch(/gl_PointCoord/);
    // Сцена зовёт правку в `envArrived` — а кусок окружения едет только к виду `next` — на все три системы дыма.
    const scene = readFileSync(join(__dirname, '..', 'Scene.ts'), 'utf8');
    const arrived = scene.slice(scene.indexOf('private envArrived('), scene.indexOf('private startEnv('));
    expect(arrived).toMatch(/for \(const s of \[this\.smoke, this\.chimneys, this\.hearths\]\) m\.roundSmoke\(/);
    expect(scene.match(/roundSmoke\(/g)).toHaveLength(1);
  });
});
