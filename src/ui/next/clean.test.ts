// ЗН-3 (docs/ui_v2.md, 5.10): экран чище. Значок профиля справа сверху открывает профиль; «Домой» и точек над крышами издали
// нет; «Подписи» — переключатель в настройках профиля; профиль — свёрнутыми разделами, раскрыт один за раз.
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';

const store = new Map<string, string>();
const g = globalThis as unknown as { window?: unknown; localStorage?: unknown; location?: unknown };
g.window ??= {};
g.location ??= { search: '', hash: '', href: 'https://example.test/' };
// Память устройства до загрузки рычага: «Подписи» включены (по умолчанию — выключены).
store.set('tribe.labels', '1');
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { useGame } = await import('@/game/store');
const { useRealm } = await import('@/ui/realm/open');
const { ProfileBadge } = await import('@/ui/realm/Coat');
const { LabelsRow, ProfilePanel, profileFolds } = await import('@/ui/panels/ProfilePanel');
const { labelsOn } = await import('@/render/sitetags');
const { useLabels } = await import('./labels');
const { LABEL_NEAR, markNear } = await import('@/render/city/labels');

const css = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const rule = (src: string, sel: string): string => src.match(new RegExp(`^${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`, 'm'))![0];

/** Отрисовать компонент и поймать его корневой элемент — с обработчиками: узел без DOM, касание — вызовом `onClick`. */
function caught(fn: () => ReactElement): { html: string; el: ReactElement<{ onClick: () => void }> } {
  let el: ReactElement | null = null;
  const html = renderToStaticMarkup(
    createElement(() => {
      el = fn();
      return el;
    }),
  );
  return { html, el: el! as ReactElement<{ onClick: () => void }> };
}

beforeEach(() => {
  useGame.setState({ s: createInitialState(), sheet: null, mapOpen: false });
  useRealm.setState({ open: false, view: 'decisions' });
});

describe('значок профиля справа сверху', () => {
  it('касание открывает профиль (держава на виде «settings»)', () => {
    const { html, el } = caught(ProfileBadge);
    expect(html).toContain('aria-label="Профиль"');
    expect(html, 'на значке — герб').toContain('<svg');
    expect(useRealm.getState().open).toBe(false);
    el.props.onClick();
    expect(useRealm.getState()).toMatchObject({ open: true, view: 'settings' });
  });

  it('стоит в верхе города зеркально плашке алмазов: та же высота от верха, справа; цель — 44', () => {
    const next = css('./next.css');
    const me = rule(next, '.nx-me');
    const gems = rule(next, '.nx-gems');
    expect(me.match(/top: ([^;]+);/)![1]).toBe(gems.match(/top: ([^;]+);/)![1]);
    expect(me).toContain('right: calc(8px + var(--safe-right))');
    expect(me).toContain('width: var(--tap)');
    expect(me).toContain('height: var(--tap)');
    expect(rule(next, '.nx-me-face')).toContain('height: 32px');
    // Тревоги в том же ряду не заходят под значок.
    expect(rule(next, '.nx-alerts:not(.on-map)')).toContain('var(--tap)');
    const hud = css('./Hud.tsx');
    expect(hud).toContain('<ProfileBadge />');
  });
});

describe('с экрана убрано', () => {
  it('«Домой» и кнопок камеры нет: ни в верхе, ни в стилях, ни просьбы «домой» у камеры', () => {
    expect(css('./Hud.tsx')).not.toMatch(/CityCam|Домой/);
    expect(css('./next.css')).not.toContain('.nx-cam');
    expect(css('../../render/sitetags.ts')).not.toMatch(/'home'|Домой/);
  });

  it('точек над крышами издали нет: метки — только в подписи и только вблизи, и с рычагом тоже', () => {
    expect(css('../../render/city/labels.ts')).not.toContain('city-pip');
    expect(css('../../render/city/deeds.css')).not.toContain('city-pip');
    // Граница области — расстояние `LABEL_NEAR`: точки по обе стороны от неё, и стартовый кадр (520 м) — за ней.
    expect(LABEL_NEAR, 'стартовый кадр дальше порога').toBeLessThan(520);
    expect(markNear({ d: LABEL_NEAR - 1, lit: false })).toBe(true);
    expect(markNear({ d: LABEL_NEAR, lit: false })).toBe(true);
    expect(markNear({ d: LABEL_NEAR + 1, lit: false }), 'дальше порога — без точки').toBe(false);
    expect(markNear({ d: 520, lit: false }), 'стартовый кадр — без точки').toBe(false);
    expect(markNear({ d: 520, lit: true }), 'показанная — с точкой').toBe(true);
    expect(rule(css('../../render/city/deeds.css'), '.city-label.far::before')).toContain('visibility: hidden');
  });
});

describe('«Подписи» — строкой настроек профиля', () => {
  const pressed = (): string => renderToStaticMarkup(createElement(LabelsRow)).match(/aria-pressed="(true|false)"/)![1];

  it('переключатель: строка, рычаг сцены и память устройства — одно', () => {
    // Встал из памяти устройства — и строка, и сцена. (Узел рисует строку по начальному снимку хранилища, поэтому разметка
    // проверяется здесь, до касаний.)
    expect(useLabels.getState().on).toBe(true);
    expect(pressed(), 'строка — из памяти').toBe('true');
    expect(labelsOn(), 'сцена — из памяти').toBe(true);
    const { el } = caught(LabelsRow);
    el.props.onClick();
    expect(useLabels.getState().on).toBe(false);
    expect(labelsOn(), 'сцена видит касание строки').toBe(false);
    expect(store.get('tribe.labels'), 'помнится устройством').toBe('0');
    el.props.onClick();
    expect(labelsOn()).toBe(true);
    expect(store.get('tribe.labels')).toBe('1');
  });

  it('строка стоит в разделе «Настройки» профиля, а рычаг встаёт с верхом города', () => {
    const src = css('../panels/ProfilePanel.tsx');
    expect(src).toMatch(/f\.key === 'settings' && \(\s*<>\s*<LabelsRow \/>/);
    expect(css('./Hud.tsx')).toContain("import './labels';");
  });
});

describe('профиль компактный', () => {
  it('без раскрытых разделов — главное и свёрнутые строки: ни настроек, ни таблиц, ни столбиков', () => {
    const html = renderToStaticMarkup(createElement(ProfilePanel));
    expect(html).toContain('profile-head');
    const folds = profileFolds(useGame.getState().s);
    // Один экран 390 × 844 под шапкой державы: главное и не больше пяти строк по 44+ (снимок `zn3-02-profile-after`).
    expect(folds.length).toBeLessThanOrEqual(5);
    expect(html.match(/class="set-row pf-fold-head"/g)?.length).toBe(folds.length);
    expect(html.match(/aria-expanded="true"/g), 'ни одного раскрытого').toBeNull();
    for (const body of ['set-list', 'kit-table', 'class="trend"', 'Громкость']) expect(html, `тело «${body}» свёрнуто`).not.toContain(body);
    expect(folds.map((f) => f.title)).toEqual(['Настройки', 'Битвы', 'Потери', 'Хозяйство']);
  });

  it('у раздела итог одной строкой — из тех же чисел, что его таблица', () => {
    const s = useGame.getState().s;
    s.stats.battlesWon = 3;
    const f = profileFolds(s);
    expect(f.find((x) => x.key === 'Битвы')!.sum).toContain('выиграно 3');
    expect(f.find((x) => x.key === 'Потери')!.sum).toBe('Потерь нет.');
  });
});
