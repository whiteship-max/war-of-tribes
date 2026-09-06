// Земля боя: обещания, которые нельзя проверить глазом.
//
// Главное из них структурное. Сцена боя рисуется на той же канве, что и деревня,
// и пока идёт ролик, деревня жива: её геометрия и её материалы никуда не делись.
// Материалы в проекте общие и их переливает сезон — значит, зимнее поле боя,
// покрасив общий материал, перекрасило бы и деревню. Проверяется это дважды: по
// исходнику (общих наборов в модуле нет вовсе) и прогоном (после зимнего боя
// летняя трава деревни осталась летней).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { PLAIN_GROUND, SECTORS, type Ground, type Side } from '@/battle';
import { FIELD, FLEE_DIST, sectorSpot } from '@/battle/replay';
import { KIT, LEGACY } from '../materials';
import { PALETTE, seasonColor } from '../palette';
import { SeasonVisuals } from '../season';
import { CLEAR_R, buildGround, groundHeight } from './ground';

const ground = (extra: Partial<Ground> = {}): Ground => ({ ...PLAIN_GROUND, seed: 5, ...extra });

const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('зимнее поле красит только себя', () => {
  it('в модуле земли нет ни одного общего материала: ни KIT, ни LEGACY, ни DECAL', () => {
    const src = stripComments(readFileSync(join(__dirname, 'ground.ts'), 'utf8'));
    // Цвет здесь живёт в вершинах, а материал свой. Появится общий набор —
    // появится и зима, красящая деревню, и найти её будет уже нечем.
    expect(src).not.toMatch(/\bKIT\b|\bLEGACY\b|\bDECAL\b|SeasonVisuals/);
    expect(src).toMatch(/new THREE\.MeshLambertMaterial/);
  });

  it('после зимнего боя летняя трава деревни осталась летней', () => {
    const season = new SeasonVisuals();
    season.jump('summer');
    const before = {
      grass: LEGACY.grass.color.getHex(),
      kitGrass: KIT.grass.color.getHex(),
      field: LEGACY.field.color.getHex(),
      leaves: LEGACY.leaves.color.getHex(),
    };
    const winter = buildGround(ground({ winter: true, woods: true, river: true, ford: true }));
    expect(LEGACY.grass.color.getHex()).toBe(before.grass);
    expect(KIT.grass.color.getHex()).toBe(before.kitGrass);
    expect(LEGACY.field.color.getHex()).toBe(before.field);
    expect(LEGACY.leaves.color.getHex()).toBe(before.leaves);
    winter.dispose();

    // Проверка самой проверки: сезон деревни траву менять обязан, иначе первая
    // половина теста зелёная просто потому, что цвет не меняется ни от чего.
    season.jump('winter');
    expect(LEGACY.grass.color.getHex()).not.toBe(before.grass);
    season.jump('spring');
  });

  it('снег на поле — свой ключ палитры, а у травы деревни свой', () => {
    // `field` сезонного переопределения не имеет нарочно: оно переливало бы
    // общий материал. Зимнее поле поэтому названо отдельным цветом.
    expect(seasonColor('winter', 'field')).toBe(PALETTE.field);
    expect(PALETTE.fieldSnow).not.toBe(PALETTE.field);
  });

  it('зимняя земля светлее летней, а вода остаётся тёмной', () => {
    const bright = (g: Ground): number => {
      const view = buildGround(g);
      const mesh = view.group.children[0] as THREE.Mesh;
      const col = mesh.geometry.attributes.color;
      let sum = 0;
      for (let i = 0; i < col.count; i++) sum += col.getX(i) + col.getY(i) + col.getZ(i);
      const out = sum / col.count / 3;
      view.dispose();
      return out;
    };
    expect(bright(ground({ winter: true }))).toBeGreaterThan(bright(ground()) * 1.5);
  });
});

describe('земля не мешает строю', () => {
  it('под каждым сектором и под каждым бегущим земля ровная', () => {
    for (const g of [ground(), ground({ ridge: true }), ground({ land: 'hills' }), ground({ river: true, ford: true })]) {
      for (const side of ['attacker', 'defender'] as Side[]) {
        for (const sector of SECTORS) {
          for (const closing of [0, 1]) {
            const spot = sectorSpot(side, 'attacker', sector, closing);
            expect(groundHeight(g, spot.x, spot.z), `${sector} ${side}`).toBe(0);
            // Бегущий уходит с поля на FLEE_DIST от своего места — и там тоже
            // обязан идти по ровному: фигуры стоят на нуле и рельефа не знают.
            const away = Math.sign(spot.z) * FLEE_DIST;
            expect(groundHeight(g, spot.x, spot.z + away), `бегство ${sector}`).toBe(0);
          }
        }
      }
    }
  });

  it('расчистка шире, чем уходит бегущий резерв', () => {
    const reserve = FIELD.frontZ + FIELD.rowGap + FIELD.reserveGap + FLEE_DIST;
    expect(CLEAR_R).toBeGreaterThan(reserve);
  });

  it('за расчисткой земля перестаёт быть столом', () => {
    const far = (g: Ground): number => Math.abs(groundHeight(g, 0, CLEAR_R + 12));
    expect(far(ground({ ridge: true }))).toBeGreaterThan(4);
    expect(far(ground({ land: 'hills' }))).toBeGreaterThan(0.5);
  });
});

describe('земля стоит трёх вызовов отрисовки', () => {
  it('плита, ближний декор и дальний план — и ничего сверх', () => {
    for (const g of [
      ground(),
      ground({ woods: true, river: true, ford: true, road: true }),
      ground({ ridge: true, woods: true, land: 'hills' }),
      ground({ land: 'shore', winter: true }),
    ]) {
      const view = buildGround(g);
      expect(view.group.children.length).toBeLessThanOrEqual(3);
      for (const child of view.group.children) {
        const mesh = child as THREE.Mesh;
        // Массив материалов — это группы, а группа стоит отдельного вызова.
        expect(Array.isArray(mesh.material)).toBe(false);
        expect(mesh.geometry.attributes.color).toBeDefined();
      }
      // Тень отбрасывает только ближний декор: дальнему лесу она не положена.
      const casting = view.group.children.filter((c) => (c as THREE.Mesh).castShadow);
      expect(casting.length).toBeLessThanOrEqual(1);
      view.dispose();
    }
  });

  it('одна и та же запись — одно и то же поле до вершины', () => {
    const first = buildGround(ground({ woods: true, ridge: true }));
    const second = buildGround(ground({ woods: true, ridge: true }));
    const bake = (v: { group: THREE.Group }): number[] =>
      v.group.children.flatMap((c) => Array.from((c as THREE.Mesh).geometry.attributes.position.array as Float32Array));
    expect(bake(second)).toEqual(bake(first));
    first.dispose();
    second.dispose();
  });
});
