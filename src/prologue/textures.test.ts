/**
 * Текстуры поляны: опись, папка и таблица материалов.
 *
 * Как текстуры выглядят, решают снимки (`npm run prologue:stand`, `LOOK=`). Здесь — договор,
 * на котором они стоят: в папке ровно то, что в описи, у каждого набора записан источник, а
 * материал не ссылается на набор, которого нет.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MATERIAL_KEYS } from '@/render/materials';
import { LOOKS, PRO_MATS } from './pbr';
import { LINEAR, MIP_LINEAR, REPEAT, SETS, SIZES, anisoOf, fileOf, sizeOf } from './textures';

const OUT = join(__dirname, '..', '..', 'public', 'assets', 'prologue');

describe('опись текстур', () => {
  it('в папке ровно то, что в описи: ни лишнего файла, ни недостающего', () => {
    const want = SETS.flatMap((s) => SIZES.flatMap((px) => [fileOf(s.name, 'c', px), fileOf(s.name, 'd', px)])).sort();
    expect(readdirSync(OUT).sort()).toEqual(want);
  });

  it('у каждого набора записаны сайт, ассет, автор и размер образца', () => {
    for (const s of SETS) {
      // Только Poly Haven: всё там — CC0 (решение владельца — только CC0).
      expect(s.source.site).toBe('polyhaven');
      expect(s.source.id).toMatch(/^[a-z0-9_]+$/);
      expect(s.source.author.length).toBeGreaterThan(2);
      expect(s.source.meters).toBeGreaterThan(0);
    }
    expect(new Set(SETS.map((s) => s.name)).size).toBe(SETS.length);
  });

  it('константы повтора и фильтра — те самые константы three, а не похожие числа', () => {
    expect(REPEAT).toBe(THREE.RepeatWrapping);
    expect(MIP_LINEAR).toBe(THREE.LinearMipmapLinearFilter);
    expect(LINEAR).toBe(THREE.LinearFilter);
  });
});

describe('ступени: меньше точек и отсчётов, а не другой материал', () => {
  it('полной ступени — крупные файлы, телефону и полу — мелкие', () => {
    expect(sizeOf('full')).toBe(1024);
    expect(sizeOf('lite')).toBe(512);
    expect(sizeOf('base')).toBe(512);
  });

  it('анизотропия не растёт вниз по ступеням и не выходит за то, что умеет видеокарта', () => {
    expect(anisoOf('full', 16)).toBeGreaterThanOrEqual(anisoOf('lite', 16));
    expect(anisoOf('lite', 16)).toBeGreaterThanOrEqual(anisoOf('base', 16));
    for (const t of ['full', 'lite', 'base'] as const) {
      expect(anisoOf(t, 1)).toBe(1);
      expect(anisoOf(t, 2)).toBeLessThanOrEqual(2);
    }
  });
});

describe('таблица материалов', () => {
  it('каждый материал с текстурой — настоящий материал поляны и берёт набор из описи', () => {
    const names = new Set<string>([...MATERIAL_KEYS, 'body', ...Object.values(PRO_MATS).map((m) => m.name)]);
    const sets = new Set(SETS.map((s) => s.name));
    for (const [name, look] of Object.entries(LOOKS)) {
      expect(names.has(name), name).toBe(true);
      expect(sets.has(look.set), `${name}: ${look.set}`).toBe(true);
    }
  });

  it('земля одна: тропы, утоптанное и подстилку знает только материал земли', () => {
    expect(Object.entries(LOOKS).filter(([, l]) => l.ground).map(([n]) => n)).toEqual(['grass']);
  });
});
