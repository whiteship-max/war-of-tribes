// Значки над крышами — только беда (решение владельца 03.10.2026, docs/ui_audit.md, 12.8): никого нет на
// работе и кузнецы без заказа. «Можно улучшить» и «есть свободное место» стояли над десятком крыш с первой минуты и
// закрывали город; число построек без рабочих — на «Ратуше» внизу, улучшения и места — в её списке.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ATTENTION_META, type Attention } from '@/game/derived';
import { ROOF_NEW, onRoof } from './Scene';

/** Без комментариев: правило ищется в коде, а не в словах о нём. */
const code = (rel: string): string =>
  readFileSync(join(__dirname, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('значки над крышами', () => {
  // Область правила — все заботы, какие знает игра (`buildingAttention`, `ATTENTION_META`): обходятся все, а не выбранные.
  const ALL = Object.keys(ATTENTION_META) as Attention[];

  it('забот у игры четыре, и правило спрашивается о каждой', () => {
    expect([...ALL].sort()).toEqual(['idle', 'order', 'slot', 'upgrade']);
  });

  it('над крышей только «никого нет» и «кузнецы без заказа»', () => {
    expect(ALL.filter((k) => onRoof(k)).sort()).toEqual(['idle', 'order']);
    expect(Object.keys(ROOF_NEW).sort()).toEqual(['idle', 'order']);
  });

  it('значок заводит одна дверь, и правило спрашивается раньше, чем рисуется значок', () => {
    const scene = code('Scene.ts');
    // Рисунок значка просят ровно в одном месте — в `setMarker`, после проверки правила.
    const calls = [...scene.matchAll(/markerTexture\(kind\)/g)].map((m) => m.index!);
    expect(calls.length, 'рисунок значка просят в одном месте').toBe(1);
    const door = scene.indexOf('protected setMarker(');
    const gate = scene.indexOf('if (!kind || !onRoof(kind)) return;', door);
    expect(door).toBeGreaterThan(0);
    expect(gate, 'правило — в двери значка').toBeGreaterThan(door);
    expect(calls[0], 'значок рисуется после правила').toBeGreaterThan(gate);
    // Город значков не заводит: он только ставит заботу (`setMarker`) и меряет поставленный значок.
    expect(code('city/scene.ts')).not.toMatch(/markerTexture|new THREE\.Sprite\(/);
  });
});
