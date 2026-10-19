// ЗН-3 (docs/ui_v2.md, 5.10): экран чище. Значок профиля справа сверху открывает профиль; «Домой» и точек над крышами издали
// нет; «Подписи» — переключатель в настройках профиля; профиль — свёрнутыми разделами, раскрыт один за раз.
// ЗН-4 (5.11): на значке — фигурка, а не второй герб; профиль — своё окно, в державе его нет; «Сообщить об ошибке» — в
// профиле рядом с настройками; подписи — все разом около середины приближения, рычаг выключен — их нет.
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@/game/state';

// Окно в строку читает стор с начального состояния (zustand на сервере); хранилище окон — с живым состоянием, настоящим API.
vi.mock('@/ui/realm/open', async (orig) => {
  const real = await orig<typeof import('@/ui/realm/open')>();
  type R = ReturnType<typeof real.useRealm.getState>;
  const useRealm = Object.assign(<T,>(sel: (r: R) => T): T => sel(real.useRealm.getState()), real.useRealm);
  return { ...real, useRealm };
});

const store = new Map<string, string>();
const g = globalThis as unknown as { window?: unknown; localStorage?: unknown; location?: unknown };
g.window ??= {};
g.location ??= { search: '', hash: '', href: 'https://example.test/' };
// Память устройства до загрузки рычага: «Подписи» выключены (по умолчанию — включены, ЗН-4).
store.set('tribe.labels', '0');
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
const { RealmNew } = await import('@/ui/realm/RealmNew');
const { coatView } = await import('@/ui/realm/open');
const { symbolOf } = await import('@/ui/icons/sheet');

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
  it('на значке — фигурка человека, а не второй герб; касание открывает окно «Профиль»', () => {
    const { html, el } = caught(ProfileBadge);
    expect(html).toContain('aria-label="Профиль"');
    expect(html, 'на значке — фигурка').toContain(`href="${symbolOf('ui-person')}"`);
    expect(css('../realm/Coat.tsx').split('export function ProfileBadge')[1], 'герба на значке нет').not.toContain('CoatArt');
    expect(useRealm.getState().open).toBe(false);
    el.props.onClick();
    expect(useRealm.getState()).toMatchObject({ open: true, view: 'settings' });
    const win = renderToStaticMarkup(createElement(RealmNew));
    expect(win, 'окно называется «Профиль»').toContain('aria-label="Профиль"');
    expect(win, 'в окне — профиль').toContain('profile-head');
    expect(win, 'вкладок державы нет').not.toContain('nx-rtabs');
    expect(win, 'очков правителя нет').not.toContain('nx-points');
    expect(win, 'имени города державы нет').not.toContain('Сменить имя города');
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

  it('точек над крышами нет: метка — только в подписи, и второго порога у неё нет', () => {
    expect(css('../../render/city/labels.ts')).not.toContain('city-pip');
    expect(css('../../render/city/deeds.css')).not.toContain('city-pip');
    // Подписи проявляются одним порогом на весь слой (`camera.labelsAlpha`); точка в подписи своего порога не держит.
    expect(css('../../render/city/labels.ts')).not.toMatch(/LABEL_NEAR|markNear|'far'/);
    expect(css('../../render/city/deeds.css')).not.toContain('.city-label.far');
  });
});

describe('в державе профиля нет (ЗН-4)', () => {
  it('держава — без кнопки профиля, без вкладки профиля и без «Сообщить об ошибке»', () => {
    useRealm.setState({ open: true, view: 'government' });
    const html = renderToStaticMarkup(createElement(RealmNew));
    expect(html).toContain('aria-label="Держава"');
    expect(html, 'вкладки державы на месте').toContain('nx-rtabs');
    expect(html).not.toMatch(/aria-label="Профиль/);
    expect(html).not.toContain(`href="${symbolOf('ui-person')}"`);
    expect(html).not.toContain('profile-head');
    const src = css('../realm/RealmNew.tsx');
    expect(src, 'ни кнопки к профилю').not.toMatch(/go\('settings'\)/);
    expect(src, 'ни письма об ошибке').not.toMatch(/useBugReport|ui-bug/);
    expect(html.match(/role="tab"/g)?.length, 'пять вкладок: правитель, указы, технологии, вера, задания').toBe(5);
  });

  it('герб после профиля открывает державу, а не профиль', () => {
    const s = useGame.getState().s;
    expect(coatView(s, true, 'settings')).toBe('government');
    expect(coatView(s, false, 'settings')).toBe('government');
    expect(coatView(s, true, 'tech'), 'прочие разделы помнятся').toBeUndefined();
  });

  it('все входы в профиль ведут в то же окно: значок и печать в покоях', () => {
    expect(css('../realm/Coat.tsx')).toContain("show('settings')");
    expect(css('../chambers/doors.ts')).toContain("show('settings')");
  });

  it('«Сообщить об ошибке» — в профиле строкой рядом с «Настройками», и только раз', () => {
    const w = g as unknown as { window: { Telegram?: unknown } };
    w.window.Telegram = { WebApp: { initDataUnsafe: { user: { id: 1 } } } };
    try {
      const html = renderToStaticMarkup(createElement(ProfilePanel));
      expect(html.match(/Сообщить об ошибке/g)?.length, 'строка одна').toBe(1);
      const settings = html.indexOf('Настройки');
      const bug = html.indexOf('Сообщить об ошибке');
      const next = html.indexOf('Битвы');
      expect(settings).toBeGreaterThan(-1);
      expect(bug, 'после «Настроек»').toBeGreaterThan(settings);
      expect(bug, 'до следующего раздела').toBeLessThan(next);
      // Раскрытые настройки строку не повторяют.
      expect(css('../panels/ProfilePanel.tsx')).toContain('<Settings bug={false} />');
    } finally {
      delete w.window.Telegram;
    }
  });
});

describe('«Подписи» — строкой настроек профиля', () => {
  const pressed = (): string => renderToStaticMarkup(createElement(LabelsRow)).match(/aria-pressed="(true|false)"/)![1];

  it('переключатель: строка, рычаг сцены и память устройства — одно', () => {
    // Встал из памяти устройства — и строка, и сцена. (Узел рисует строку по начальному снимку хранилища, поэтому разметка
    // проверяется здесь, до касаний.)
    expect(useLabels.getState().on).toBe(false);
    expect(pressed(), 'строка — из памяти').toBe('false');
    expect(labelsOn(), 'сцена — из памяти').toBe(false);
    const { el } = caught(LabelsRow);
    el.props.onClick();
    expect(useLabels.getState().on).toBe(true);
    expect(labelsOn(), 'сцена видит касание строки').toBe(true);
    expect(store.get('tribe.labels'), 'помнится устройством').toBe('1');
    el.props.onClick();
    expect(labelsOn()).toBe(false);
    expect(store.get('tribe.labels')).toBe('0');
  });

  it('по умолчанию включён: без памяти устройства подписи есть', async () => {
    store.delete('tribe.labels');
    vi.resetModules();
    const fresh = await import('./labels');
    const board = await import('@/render/sitetags');
    expect(fresh.useLabels.getState().on).toBe(true);
    expect(board.labelsOn()).toBe(true);
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
