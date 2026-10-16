/**
 * Конвейер кадра: то, что держит первую загрузку, и то, что держит плавность.
 *
 * Сам кадр смотрится снимками (`npm run prologue:stand`, `LOOK=`) и мерится временем
 * видеокарты там же. Здесь — договор, на котором стоит вес: предыстория едет своим
 * чанком, а общий чанк `three` — первой загрузкой, и всякое имя, впервые взятое у
 * `three` предысторией, дописывается в его экспорт (docs/prologue.md, раздел 10).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ACES, HALF_FLOAT, Post, UNSIGNED_BYTE } from './post';

const SRC = join(__dirname, '..');

const strip = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p);
  }
  return out;
};

/** Какие значения `three` файлы берут по имени — через `THREE.` и через `import { … }`. */
function taken(files: string[]): Set<string> {
  const lib = THREE as unknown as Record<string, unknown>;
  const out = new Set<string>();
  for (const f of files) {
    const src = strip(readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/\bTHREE\.([A-Za-z_]\w*)/g)) if (lib[m[1]] !== undefined) out.add(m[1]);
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'three'/g)) {
      for (const part of m[1].split(',')) {
        if (/^\s*type\s/.test(part)) continue;
        const name = part.split(' as ')[0].trim();
        if (name && lib[name] !== undefined) out.add(name);
      }
    }
  }
  return out;
}

/**
 * Классы, без которых постобработки не бывает: цель и текстура глубины. Их код в общем чанке уже лежит — им
 * пользуется сам рендерер, — и прибавляются два имени в его экспорт. Третий — материал со своим шейдером
 * (`ShaderMaterial`) — с П-3 берёт и игра (осадки города, `render/city/precip.ts`), и он больше не только
 * предыстории. Решение записано здесь, а не угадывается: любое новое имя — это решение, и принимать его вслух.
 */
const POST_NAMES = ['DepthTexture', 'WebGLRenderTarget'];

/**
 * Имя, которое предыстория берёт одна с тех пор, как ушёл посёлок (docs/city.md, «Город — единственный вид»):
 * точечная лампа костра. Прежде её брала и деревня — огонь костра посёлка, — и в общем чанке three она лежала и
 * так; с уходом посёлка чанк three не вырос (опись `npm run build`: three — 125.0 КБ gzip до и после). Решение
 * вслух, как велит правило выше: город точечных ламп не держит (огни ночи — пятнами в шейдере, docs/city.md,
 * раздел 6), а у костра поляны лампа — свет всей сцены.
 */
const KEPT_NAMES_FIRE = ['PointLight'];

/**
 * Линии — с П-3 (docs/polish.md, П-3): дождь города был линиями (`LineSegments`, `LineBasicMaterial`) и стал полосками
 * экземплярами — у линии WebGL толщина всегда пиксель. Линии остались у предыстории (`prologue/models.ts`) и у лески
 * рыбалки; они брали их и до П-3, а имя лежит в общем чанке three, пока его берёт хоть один кусок, — чанк от этого не
 * меняется. Решение вслух: дождю линии не годятся, а нить и леска — линии и есть.
 */
const KEPT_NAMES = [...KEPT_NAMES_FIRE, 'LineBasicMaterial', 'LineSegments'];

describe('первая загрузка', () => {
  it('константы конвейера — те самые константы three, а не похожие числа', () => {
    expect(HALF_FLOAT).toBe(THREE.HalfFloatType);
    expect(UNSIGNED_BYTE).toBe(THREE.UnsignedByteType);
    expect(ACES).toBe(THREE.ACESFilmicToneMapping);
  });

  it('у three предыстория берёт по имени только то, что берёт игра, три класса конвейера и лампу костра', () => {
    const all = walk(SRC);
    const norm = (f: string): string => f.split('\\').join('/');
    // Промыслы (`src/minigames`) — тоже свой кусок на конвейере поляны: новое имя в них дописалось бы в первую загрузку
    // так же молча, поэтому и они считаются здесь, а не «игрой» (docs/minigames.md, 8).
    const lazy = all.filter(
      (f) => norm(f).includes('/src/prologue/') || norm(f).includes('/src/minigames/') || norm(f).endsWith('/src/sound/howl.ts'),
    );
    const game = taken(all.filter((f) => !lazy.includes(f)));
    const extra = [...taken(lazy)].filter((n) => !game.has(n)).sort();
    expect(extra).toEqual([...POST_NAMES, ...KEPT_NAMES].sort());
  });
});

describe('ступени', () => {
  /**
   * Конвейер без видеокарты: цели и материалы three — просто объекты, и до первого
   * кадра рендерер у конвейера не спрашивают ничего. Значит, что у ступени есть,
   * видно по её цене (`cost`), а не по тексту исходника.
   */
  const at = (tier: 'full' | 'lite' | 'base') => {
    const post = new Post({} as THREE.WebGLRenderer, tier);
    post.setSize(750, 1624);
    return post.cost();
  };

  it('телефонная ступень не держит ни затенения складок, ни глубины резкости, ни выборок', () => {
    // Три самые дорогие вещи — на полной ступени и только на ней; `lite` платит за
    // дымку, лучи и свечение, и больше ни за что.
    const lite = at('lite');
    expect(lite.ao).toBe(false);
    expect(lite.dof).toBe(false);
    expect(lite.samples).toBe(0);
    const full = at('full');
    expect(full.ao).toBe(true);
    expect(full.dof).toBe(true);
    expect(full.samples).toBeGreaterThan(0);
  });

  it('телефонная ступень держит в целях меньше пятой доли полной, пол — ничего', () => {
    // Цена в памяти — тоже плавность: на телефоне видеопамять общая с системой.
    expect(at('lite').mb).toBeLessThan(at('full').mb / 5);
    expect(at('base').mb).toBe(0);
    expect(at('base').passes).toBe(1);
  });
});
