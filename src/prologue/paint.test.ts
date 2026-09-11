/**
 * Рисунки поляны: то, что проверяется числами, а не глазами.
 *
 * Сами лица и одежда смотрятся снимками (docs/prologue.md, раздел 14) — тест их
 * не заменяет. Он держит договор, на котором снимки стоят: у каждой гостьи своё
 * лицо, соседние не совпадают, развёртка атласа не вылезает за холст, и холст не
 * перепекается в кадре.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GUESTS } from './kin';
import { ADDITIVE, ATLAS_H, ATLAS_W, FACE_CELL, LOOKS, MOOD_BLINK, REGION, faceRect, mix, rectUv, swatchUv } from './paint';

describe('первая загрузка', () => {
  it('сложение цветов — та самая константа three, а не похожее число', () => {
    expect(ADDITIVE).toBe(THREE.AdditiveBlending);
  });

  it('предыстория не зовёт по имени констант, которых деревня из three не берёт', () => {
    // Имя, впервые взятое из общего чанка, дописывается в его экспорт — то есть в
    // первую загрузку (`paint.ADDITIVE`). Список здесь — те, что уже ловились.
    for (const file of ['scene.ts', 'models.ts', 'dome.ts', 'people.ts', 'surface.ts', 'paint.ts']) {
      const src = strip(readFileSync(join(__dirname, file), 'utf8'));
      expect(src, `${file}: AdditiveBlending по имени`).not.toContain('AdditiveBlending');
      expect(src, `${file}: SHADE деревни`).not.toMatch(/\bSHADE\b|GROUND_SHADE/);
    }
  });
});

const strip = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('шесть гостий — шесть лиц', () => {
  it('облик есть у каждой гостьи и лежит в том же порядке', () => {
    expect(LOOKS.length).toBe(GUESTS.length);
  });

  it('никакие две не выглядят одинаково — ни издалека, ни вблизи', () => {
    // Издалека видно волосы и рубаху; вблизи — глаза и их разрез. Пара, совпавшая
    // и в том, и в другом, — это «ещё одна женщина», а не «пришла другая».
    for (let i = 0; i < LOOKS.length; i++) {
      for (let j = i + 1; j < LOOKS.length; j++) {
        const a = LOOKS[i];
        const b = LOOKS[j];
        expect(a.hair === b.hair && a.shirt === b.shirt, `${GUESTS[i].name} и ${GUESTS[j].name} издалека одинаковы`).toBe(false);
        expect(a.eyes === b.eyes && a.shape === b.shape, `${GUESTS[i].name} и ${GUESTS[j].name} вблизи одинаковы`).toBe(false);
      }
    }
  });

  it('соседние по кругу различаются волосами — это видно от опушки', () => {
    for (let i = 0; i < LOOKS.length; i++) {
      const next = LOOKS[(i + 1) % LOOKS.length];
      expect(LOOKS[i].hair, `${GUESTS[i].name} → следующая`).not.toBe(next.hair);
    }
  });
});

describe('атлас', () => {
  it('клетки лиц, одежда и образцы лежат внутри холста и не налезают друг на друга', () => {
    const rects = [faceRect(0), faceRect(1), faceRect(2), faceRect(MOOD_BLINK), REGION.shirt, REGION.skirt, REGION.fur];
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(ATLAS_W);
      expect(r.y + r.h).toBeLessThanOrEqual(ATLAS_H);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${i} и ${j} налезают`).toBe(true);
      }
    }
    expect(faceRect(MOOD_BLINK).x + FACE_CELL).toBeLessThanOrEqual(ATLAS_W);
  });

  it('развёртка перевёрнута так, как её кладёт текстура: верх холста — это v = 1', () => {
    const face = rectUv(faceRect(0));
    expect(face.v1).toBe(1);
    expect(face.v0).toBeCloseTo(1 - FACE_CELL / ATLAS_H, 12);
    for (const s of ['skin', 'hair', 'band', 'neck', 'hairDark', 'shirt', 'lips', 'fur'] as const) {
      const [u, v] = swatchUv(s);
      // Образцы лежат в правом нижнем углу — под мехом накидки.
      expect(u).toBeGreaterThan(REGION.fur.x / ATLAS_W);
      expect(v).toBeLessThan(1 - (REGION.fur.y + REGION.fur.h) / ATLAS_H);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('оттенки выводятся из палитры смесью, а не пишутся числом', () => {
    expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mix(0x102030, 0x102030, 0.7)).toBe(0x102030);
    const src = strip(readFileSync(join(__dirname, 'paint.ts'), 'utf8'));
    // Ни одного hex-цвета по месту: всё из `PALETTE` и смесей.
    expect(src.match(/0x[0-9a-fA-F]{6}/g) ?? [], 'цвет по месту').toEqual([]);
  });
});

describe('рисунки печёт вход, а не кадр', () => {
  it('сцена печёт холсты только при создании моделей', () => {
    // Холст, перерисованный в кадре, — это загрузка текстуры шестьдесят раз в
    // секунду. Лица меняются перекладкой развёртки (`people.setMood`), а не
    // перерисовкой.
    const scene = strip(readFileSync(join(__dirname, 'scene.ts'), 'utf8'));
    const loop = scene.slice(scene.indexOf('private step('), scene.indexOf('private warmth('));
    for (const word of ['womanAtlas', 'sleeveCanvas', 'glowCanvas', 'bake(', 'needsUpdate = true']) {
      expect(loop, `в кадре печётся: ${word}`).not.toContain(word);
    }
  });
});
