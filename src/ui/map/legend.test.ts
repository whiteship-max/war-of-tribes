// Легенда карты не обещает того, чего на карте не бывает.
//
// Случай, из которого тест вырос: легенда показывала «Тракт ×0.62 — дорога между станами
// племён», когда трактов в мире не было ни одного — станов не осталось вместе с поселениями
// ботов. Рядом с ним нашлись ещё строки того же рода: разорённый двор, владения племени,
// союзники и враги, сожжённый город. Механики целы и спят; легенда — нет, она говорит с
// игроком сейчас. Проверка поэтому двусторонняя: строки нет, пока нет того, о чём она, — и
// тест падает, когда оно появится, чтобы строку вернули, а не забыли.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { roadNet } from '@/world/geography';
import { STAGE_BY_ID } from '@/world/data/meta';
import { SIDE_COLOR } from '@/side';
import { HOST_ROWS, PLACE_ROWS } from './tw/legend';
import { hostMarkOf, placeMarkOf } from './tw/scene';
import { badgeLook, type BadgeKind, type MarkLook } from './tw/marks';
import type { SettlementView } from '@/world/types';

const strip = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

// Легенда — окно в `WorldMap.tsx` и строки значков в `tw/legend.ts`: обещания ищутся в обоих.
const map = strip(readFileSync(join(__dirname, 'WorldMap.tsx'), 'utf8') + readFileSync(join(__dirname, 'tw/legend.ts'), 'utf8'));

describe('легенда карты', () => {
  it('трактов в мире нет — и строки «Тракт» в легенде нет', () => {
    // Точки внутри области: на нескольких сидах мира дорог действительно ноль.
    for (const seed of [7, 11, 42]) expect(roadNet(seed).cells.size, `сид ${seed}`).toBe(0);
    expect(map).not.toMatch(/name: 'Тракт'/);
    expect(map).not.toMatch(/COST_ROAD/);
  });

  it('разорённого двора, владений, союзников, врагов и сожжённого города легенда не обещает', () => {
    expect(map).not.toMatch(/sacked: true/);
    expect(map).not.toMatch(/Владения/);
    expect(map).toMatch(/SHOWN_RELATIONS = RELATION_ORDER\.filter\(\(r\) => r !== 'ally' && r !== 'enemy'\)/);
    expect(map).toMatch(/SHOWN_FATES = \(Object\.keys\(FELL_WORDS\) as Fate\[\]\)\.filter\(\(f\) => f !== 'burn'\)/);
    expect(map).not.toMatch(/RELATION_ORDER\.map/);
    expect(map).not.toMatch(/Object\.keys\(FELL_WORDS\) as Fate\[\]\)\.map/);
  });

  it('замок в легенде — город живого игрока, а не крепость с казной', () => {
    expect(map).not.toMatch(/с казной/);
  });
  it('значки легенды — значки самой карты: старых силуэтов нет, каждый вид значка карты в легенде есть', () => {
    expect(map, 'легенда без прежних силуэтов миниатюр').not.toMatch(/silhouetteUrl/);
    const key = (m: MarkLook): string => `${m.glyph}|${m.own ? 1 : 0}|${m.dim ? 1 : 0}`;
    const shown = new Set([...PLACE_ROWS, ...HOST_ROWS].map((r) => key(r.mark)));
    const place = (p: Partial<SettlementView>): MarkLook => placeMarkOf({ stage: 'village', relation: 'neutral', color: '#cbbca6', mine: false, ruin: false, sacked: false, ...p } as SettlementView);
    // Граница области: все виды, что рисует карта сегодня, — стадии соседа, свой город, логово, пепелище, отряд в поле и
    // лагерь, слух, все пять меток у места.
    const drawn: MarkLook[] = [
      ...Object.values(STAGE_BY_ID).map((s) => place({ stage: s.id })),
      place({ mine: true, relation: 'self' }),
      place({ relation: 'barbarian' }),
      place({ relation: 'barbarian', ruin: true }),
      hostMarkOf({ camp: false, color: SIDE_COLOR.ours, size: 2, west: false }),
      hostMarkOf({ camp: true, color: SIDE_COLOR.ours, size: 2, west: false }),
      hostMarkOf({ camp: false, color: SIDE_COLOR.foe, size: 0, west: false }),
      ...(['attack', 'troops', 'siege', 'wolves', 'raiders'] as BadgeKind[]).map(badgeLook),
    ];
    expect(drawn.length).toBe(Object.keys(STAGE_BY_ID).length + 11);
    for (const m of drawn) expect(shown.has(key(m)), `в легенде есть ${key(m)}`).toBe(true);
    // И не обещает разорённого: огня в углу (разорено) ни у одной строки нет.
    for (const r of [...PLACE_ROWS, ...HOST_ROWS]) expect(r.mark.corner, r.name).toBeNull();
  });
});
