// Сцена города (docs/city.md, 11.1 и 11.9): то, что не проверить без WebGL, — числами и по исходнику.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { citySunAt } from './camera';

const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('город: сцена', () => {
  it('солнце стоит над целью камеры по направлению светила, а не там, куда смотрит камера', () => {
    const target = { x: 40, y: 6, z: -16 };
    const p = citySunAt(target, { x: 3, y: 4, z: 0 });
    // Направление от цели — то же, что у рига, расстояние — 600 м.
    expect(p.x - target.x).toBeCloseTo(360, 6);
    expect(p.y - target.y).toBeCloseTo(480, 6);
    expect(p.z - target.z).toBeCloseTo(0, 6);
    // Вход не портится (находка проверки: `normalize` отдавал сам вектор позиции, и солнце уходило за 10 км).
    const from = { x: 3, y: 4, z: 0 };
    citySunAt(target, from);
    expect(from).toEqual({ x: 3, y: 4, z: 0 });
    const src = strip(readFileSync(join(__dirname, 'scene.ts'), 'utf8'));
    expect(src).toMatch(/citySunAt\(this\.target, sun\.position\)/);
  });

  it('сторож плавности города не пишет память устройства — она общая с посёлком', () => {
    const src = strip(readFileSync(join(__dirname, 'scene.ts'), 'utf8'));
    // Своё суждение сторожа у города есть, и в нём нет записи в общую память (`gfx.rememberAutoCap`).
    expect(src).toMatch(/protected override watch\(gap: number\): void \{/);
    expect(src).not.toMatch(/rememberAutoCap/);
  });
});
