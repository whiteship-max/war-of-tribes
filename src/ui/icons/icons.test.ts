// Набор значков ЗН-1 (docs/icons.md): у каждого значка описи есть рисунок, листы собраны из того же набора, вес в своих
// потолках, и значок в нужных размерах (16 и 20 px) не расплывается в полутон.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { FIRST_CAP_GZIP, SHEET, SHEET_CAP_GZIP, checkSet, sheets } from '../../../scripts/build-icons';
import { ENGRAVE, INK, OUTLINE, art, glint, standaloneSvg, type Art } from '../../../scripts/icons/kit';
import { ART } from '../../../scripts/icons/set';
import { ALIAS, FIRST_SCREEN, drawnOf } from './alias';
import { DRAWN_ICONS, FIRST_ICONS, FIRST_SHEET } from './generated';
import { DAY_PARTS, ICON_GROUPS, ICON_MANIFEST, ICON_PREFIXES, MOOD_STEPS, daypartOf, groupOf, iconName, moodOf } from './registry';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { symbolOf } from './sheet';
import { KIND_META } from '@/battle/names';

/** Растрирование всего набора (`sharp`, две сотни значков в двух размерах) — срок на процессор, а не на работу. */
const RASTER_ALL = 60_000;

/**
 * Чёткость значка в `px`: какая доля закрытых пикселей (непрозрачность больше 10 %) закрыта целиком (больше 90 %), и
 * какую долю поля занимает рисунок. Значок из одних тонких линий в 16 px — сплошной полутон: доля целиком закрытых у него
 * мала, и глаз видит пятно, а не предмет.
 */
async function crisp(a: Art, px: number): Promise<{ solid: number; extent: number }> {
  const { data, info } = await sharp(Buffer.from(standaloneSvg(a, px))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let cov = 0;
  let solid = 0;
  let minX = px;
  let maxX = -1;
  let minY = px;
  let maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const al = data[(y * info.width + x) * 4 + 3];
      if (al > 25) {
        cov++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      if (al > 230) solid++;
    }
  }
  return { solid: cov > 0 ? solid / cov : 0, extent: Math.max(maxX - minX + 1, maxY - minY + 1) / px };
}

/** Порог чёткости: в 16 px — не меньше 45 % закрытых пикселей целиком, в 20 px — 50 %. Поле — не меньше трёх четвертей. */
const SOLID = { 16: 0.45, 20: 0.5 } as const;
const EXTENT = 0.75;

describe('набор значков: опись и рисунки', () => {
  it('набор годен: у каждого имени описи и у каждой ссылки есть рисунок, рисунок — в поле, линии не тоньше порога', () => {
    expect(checkSet()).toEqual([]);
  });

  it('опись собрана из данных игры: здания, войска, запасы, вести — и каждое её имя ведёт к рисунку', () => {
    // Область правила: опись не пуста и в ней все группы, которые игра спрашивает из своих таблиц.
    expect(ICON_MANIFEST.length).toBeGreaterThan(180);
    for (const g of ['res', 'bld', 'troop', 'gear', 'evt', 'letter', 'fig', 'stage']) expect(ICON_GROUPS.some((x) => x.prefix === g), g).toBe(true);
    const drawn = new Set<string>(DRAWN_ICONS);
    for (const name of ICON_MANIFEST) expect(drawn.has(drawnOf(name)), name).toBe(true);
    expect(groupOf('bld-smithy')?.prefix).toBe('bld');
    expect(groupOf('нет')).toBeNull();
    expect(iconName('bld', 'farm')).toBe('bld-farm');
    // Приставки `iconName` — ровно группы описи: группа без приставки или приставка без группы разошлись бы молча.
    expect([...ICON_PREFIXES].sort()).toEqual(ICON_GROUPS.map((g) => g.prefix).sort());
  });

  it('имена из ядра боя (`battle/` без внешних импортов пишет их строкой) — нарисованы', () => {
    for (const k of Object.values(KIND_META)) expect(DRAWN_ICONS, k.name).toContain(drawnOf(k.icon));
  });

  it('ссылки: профессия — своей постройкой, лето — солнцем; символ берётся по нарисованному имени', () => {
    expect(drawnOf('job-woodcutter')).toBe('bld-sawmill');
    expect(drawnOf('season-summer')).toBe('season-sun');
    expect(drawnOf('bld-sawmill')).toBe('bld-sawmill');
    expect(symbolOf('job-woodcutter')).toBe('#i-bld-sawmill');
    // Двор с двумя делами (ЗД-1): у здания свой знак, у каждого дела — свой, и ни одно дело не берёт знак здания.
    for (const type of ['farm', 'hunter_hut', 'mine'] as const) {
      const deeds = BUILDING_BY_ID[type].jobs ?? [];
      expect(deeds.length, type).toBe(2);
      for (const job of deeds) expect(drawnOf(`job-${job}`), `${type}: ${job}`).not.toBe(drawnOf(`bld-${type}`));
      expect(drawnOf(`job-${deeds[0]}`), type).not.toBe(drawnOf(`job-${deeds[1]}`));
    }
    for (const to of Object.values(ALIAS)) expect(DRAWN_ICONS, to).toContain(to);
  });

  it('пороги морали и времени суток выбирают значок, у которого есть рисунок', () => {
    expect(moodOf(90).name).toBe('mood-good');
    expect(moodOf(50).name).toBe('mood-mid');
    expect(moodOf(10).name).toBe('mood-bad');
    expect(daypartOf(0).name).toBe('day-morning');
    for (const n of [...MOOD_STEPS.map((m) => m.name), ...DAY_PARTS.map((d) => d.name)]) expect(DRAWN_ICONS).toContain(drawnOf(n));
  });
});

describe('набор значков: листы и вес', () => {
  const built = sheets();
  const lazy = readFileSync(SHEET, 'utf8');

  it('собранное совпадает с рисунками: `npm run icons:build` после правки набора не забыли', () => {
    expect([...DRAWN_ICONS].sort()).toEqual(Object.keys(ART).sort());
    expect(FIRST_SHEET).toBe(built.first);
    expect(lazy).toBe(built.rest);
    expect([...FIRST_ICONS].sort()).toEqual([...new Set(FIRST_SCREEN.map(drawnOf))].sort());
  });

  it('каждый значок — в своём листе ровно один раз: первый экран строкой кода, остальное — ленивым листом', () => {
    for (const n of DRAWN_ICONS) {
      const inFirst = FIRST_SHEET.split(`id="i-${n}"`).length - 1;
      const inLazy = lazy.split(`id="i-${n}"`).length - 1;
      expect(inFirst + inLazy, n).toBe(1);
      expect(inFirst === 1, n).toBe((FIRST_ICONS as readonly string[]).includes(n));
    }
  });

  it('вес: первый экран и лист — в своих потолках по сети', () => {
    expect(gzipSync(FIRST_SHEET).length).toBeLessThanOrEqual(FIRST_CAP_GZIP);
    expect(gzipSync(lazy).length).toBeLessThanOrEqual(SHEET_CAP_GZIP);
  });

  it('символ самодостаточен: цвета и контур — атрибутами, без классов, `<defs>` и ссылок наружу', () => {
    for (const text of [FIRST_SHEET, lazy]) {
      expect(text).not.toMatch(/class=|<defs|url\(#|<use|<text|<image/);
      expect(text).toContain(`stroke="${INK}" stroke-width="${OUTLINE}"`);
    }
  });
});

describe('набор значков: чёткость в 16 и 20 px', () => {
  it(
    'каждый значок в 16 и 20 px держит силуэт: закрытые пиксели в основном закрыты целиком, рисунок занимает поле',
    async () => {
      const soft: string[] = [];
      const small: string[] = [];
      for (const [name, make] of Object.entries(ART)) {
        for (const px of [16, 20] as const) {
          const m = await crisp(make(), px);
          if (m.solid < SOLID[px]) soft.push(`${name} @${px}: ${m.solid.toFixed(2)}`);
          if (m.extent < EXTENT) small.push(`${name} @${px}: ${m.extent.toFixed(2)}`);
        }
      }
      expect(soft).toEqual([]);
      expect(small).toEqual([]);
    },
    RASTER_ALL,
  );

  it('мерка ловит то, ради чего написана: значок из волосяных линий и значок в углу поля не проходят', async () => {
    // Внутри области правила: тот же размер 16 px и та же мерка, что выше; брак — одной причиной на образец.
    const hair: Art = art(glint('M4 4L28 28M28 4L4 28M16 2V30', 'or', ENGRAVE));
    const corner: Art = ART['ui-star']().map((sh) => ({ ...sh, d: sh.d.map((sg) => (sg[0] === 'Z' ? sg : (sg.map((v, i) => (i === 0 ? v : (v as number) * 0.4)) as typeof sg))) }));
    const h = await crisp(hair, 16);
    const c = await crisp(corner, 16);
    expect(h.solid).toBeLessThan(SOLID[16]);
    expect(c.extent).toBeLessThan(EXTENT);
    // Годный значок той же меркой проходит — мерка не режет всё подряд.
    const ok = await crisp(ART['bld-town_hall'](), 16);
    expect(ok.solid).toBeGreaterThanOrEqual(SOLID[16]);
    expect(ok.extent).toBeGreaterThanOrEqual(EXTENT);
  });
});
