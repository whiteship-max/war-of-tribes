// Ориентация в городе (ОР-1, docs/ui_v2.md, 5.9): «Показать в городе» в подсказке и в ратуше ведёт одной дверью
// (`kit/nav.showInCity`), кнопки камеры — «Подписи» и «Домой» — цели 44, «Домой» — только когда есть куда возвращаться.
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildingTypeId, GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { producersOf } from '@/ui/kit/sources';
import type { TipGo } from './hudTips';

(globalThis as { window?: unknown }).window ??= {};

/** Живая сцена — подставная: дверь зовёт её `showBuilding`, а WebGL тесту не нужен. */
const shown: BuildingTypeId[] = [];
vi.mock('@/render/Scene', () => ({
  activeScene: () => ({ showBuilding: (t: BuildingTypeId) => (shown.push(t), true), cameraHome: () => undefined }),
}));

const { useGame } = await import('@/game/store');
const { useRealm } = await import('@/ui/realm/open');
const { showInCity, tipGo } = await import('@/ui/kit/nav');
const { resTip } = await import('./hudTips');
const { TipView } = await import('./TipLayer');
const { CityCamView } = await import('./CityCam');

const css = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const PHONE = { w: 390, h: 844 };

describe('«Показать в городе» — одна дверь', () => {
  beforeEach(() => {
    shown.length = 0;
    useGame.setState({ s: createInitialState(), sheet: null, mapOpen: false });
  });

  it('окна над городом уходят, камера летит к постройке', () => {
    const s = useGame.getState().s;
    const hall = s.buildings.find((b) => b.type === 'town_hall')!;
    // Шторка (ратуша) — без карты и державы: и то и другое закрыло бы шторку само (`useRealm.show` встаёт вместо неё).
    useGame.setState({ sheet: { kind: 'building', id: hall.id } });
    showInCity('farm');
    expect(useGame.getState().sheet).toBeNull();
    expect(shown).toEqual(['farm']);
  });

  it('держава уходит', () => {
    useRealm.getState().show('decisions');
    showInCity('farm');
    expect(useRealm.getState().open).toBe(false);
    expect(shown).toEqual(['farm']);
  });

  it('с карты — в город', () => {
    useGame.setState({ mapOpen: true });
    showInCity('farm');
    expect(useGame.getState().mapOpen).toBe(false);
    expect(shown).toEqual(['farm']);
  });

  it('постройки в городе нет — дверь молчит и окна не трогает', () => {
    const s = useGame.getState().s;
    s.buildings = s.buildings.filter((b) => b.type !== 'farm');
    const hall = s.buildings.find((b) => b.type === 'town_hall')!;
    useGame.setState({ s: { ...s }, sheet: { kind: 'building', id: hall.id } });
    showInCity('farm');
    expect(shown).toEqual([]);
    expect(useGame.getState().sheet).not.toBeNull();
  });
});

describe('подсказка: рядом с главной кнопкой постройки — метка места', () => {
  // Область: подсказка еды на новой партии — все её постройки стоят (`createInitialState`), и одна снесена.
  const tipOf = (s: GameState, go: TipGo) => resTip(s, 'food', null, go);

  it('у каждой стоящей постройки — своя кнопка, и ведёт она в эту постройку', () => {
    const s = createInitialState();
    const go = tipGo();
    const t = tipOf(s, go);
    expect(t.makers!.length).toBe(producersOf('food').length);
    for (const m of t.makers!) expect(m.show, m.label).toBeTypeOf('function');
    shown.length = 0;
    t.makers![0].show!();
    expect(shown).toHaveLength(1);
    expect(t.makers![0].label).toContain(t.rows![0].label);
  });

  it('постройки нет — «построить» без метки места', () => {
    const s = createInitialState();
    s.buildings = s.buildings.filter((b) => b.type !== 'farm');
    const t = tipOf(s, tipGo());
    const build = t.makers!.filter((m) => m.build);
    expect(build).toHaveLength(1);
    expect(build[0].show).toBeUndefined();
  });

  it('без двери показа — главные кнопки как прежде, без метки', () => {
    const s = createInitialState();
    const bare: TipGo = { tab: () => undefined, building: () => undefined, realm: () => undefined };
    expect(tipOf(s, bare).makers!.every((m) => m.show === undefined)).toBe(true);
  });

  it('разметка: метка — отдельная кнопка рядом, не внутри главной; столбцом', () => {
    const s = createInitialState();
    const t = tipOf(s, tipGo());
    const html = renderToStaticMarkup(createElement(TipView, { tip: { ...t, at: { x: 100, y: 90, w: 40, h: 32 } }, view: PHONE, busy: false, modal: false, hide: () => {} }));
    expect(html.match(/class="nx-tip-show"/g)!.length).toBe(t.makers!.length);
    expect(html).toContain('aria-label="Показать в городе: ');
    // Кнопка в кнопке недопустима (раздел 2.5): главная закрывается раньше, чем начинается метка.
    expect(html).toMatch(/<span class="nx-tip-mk"><button class="nx-tip-maker[^"]*"[^>]*>.*?<\/button><button class="nx-tip-show"/);
    expect(html).toContain('class="nx-tip-makers one"');
  });

  it('метка места — цель касания 44', () => {
    const rule = css('./next.css').match(/\.nx-tip \.nx-tip-show \{[^}]*\}/)![0];
    expect(rule).toContain('width: var(--tap)');
    expect(rule).toContain('min-height: var(--tap)');
  });
});

describe('кнопки камеры', () => {
  const view = (on: boolean, moved: boolean): string => renderToStaticMarkup(createElement(CityCamView, { on, moved, toggle: () => {}, home: () => {} }));

  it('«Подписи» — переключатель, «Домой» — только когда камера ушла с дома', () => {
    expect(view(false, false)).toContain('aria-pressed="false"');
    expect(view(true, false)).toContain('aria-pressed="true"');
    expect(view(false, false)).not.toContain('Домой');
    expect(view(false, true)).toContain('aria-label="Домой"');
  });

  it('цели касания — 44 и шире', () => {
    const rule = css('./next.css').match(/\.nx-cam button \{[^}]*\}/)![0];
    expect(rule).toContain('min-height: var(--tap)');
    expect(Number(rule.match(/width: (\d+)px/)![1])).toBeGreaterThanOrEqual(44);
  });

  it('слой подписей касаний не берёт — палец доходит до постройки', () => {
    const rule = css('../../render/city/deeds.css').match(/^\.city-labels \{[^}]*\}/m)![0];
    expect(rule).toContain('pointer-events: none');
    expect(css('../../render/city/deeds.css')).not.toMatch(/\.city-(label|pip)[^{]*\{[^}]*pointer-events: auto/);
  });
});
