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
    // Над тем, куда смотрит кадр по земле: в городе — цель камеры; в покоях (docs/city_v3.md, Г-4, Г-9) — середина коробки
    // теней от стены донжона вперёд, на сетке её текселей.
    expect(src).toMatch(/const c = this\.inside \? shadowSnap\(this\.shadowAt, sun\.position, [^;]+\) : this\.eye;\s*const at = citySunAt\(c, sun\.position\);/);
    expect(src, 'в городе — цель камеры').toMatch(/get eye\(\): THREE\.Vector3 \{\s*return this\.inside \? this\.aim : this\.target;/);
  });

  it('сторож плавности города — общий сторож сцены: судит встающий город, опускает плотность и помнит уровень неделю', () => {
    // Прежде город своим суждением не писал память устройства: она была общей с посёлком (docs/city.md, 11.9). Посёлка
    // нет — память теперь города, и сторож у него общий (docs/city.md, «Город — единственный вид», решение 12).
    const city = strip(readFileSync(join(__dirname, 'scene.ts'), 'utf8'));
    expect(city, 'своего сторожа у города нет').not.toMatch(/\bwatch\(/);
    const shell = strip(readFileSync(join(__dirname, '../Scene.ts'), 'utf8'));
    const from = shell.indexOf('protected watch(gap: number): void {');
    expect(from, 'общий сторож есть').toBeGreaterThan(0);
    const watch = shell.slice(from, shell.indexOf('\n  }\n', from));
    expect(watch, 'судит, когда город встал').toMatch(/if \(!this\.steady \|\| !this\.settled\(\)\) return;/);
    // Опускает одной дверью с роликом боя (`lowerTo`, ГФ-1): сторож ролика опускает тот же уровень города.
    expect(watch, 'опускает дверью lowerTo').toMatch(/this\.lowerTo\(next\);/);
    const at = shell.indexOf('  lowerTo(next: Quality): void {');
    expect(at, 'дверь опускания есть').toBeGreaterThan(0);
    const lower = shell.slice(at, shell.indexOf('\n  }\n', at));
    expect(lower, 'плотность — сразу').toMatch(/this\.dprLevel = next;/);
    expect(lower, 'уровень — в память устройства').toMatch(/rememberAutoCap\(next, serverNow\(\)\)/);
    // И читает её, когда собирается: уровень по устройству — не выше памяти сторожа.
    expect(shell, 'память читается при сборке').toMatch(/capQuality\(autoQuality\(deviceCaps\(gpuName\(this\.renderer\.getContext\(\)\)\)\), autoCap\(serverNow\(\)\)\)/);
  });
});
