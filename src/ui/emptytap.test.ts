import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

// Дверь окна по дороге трогает отклик Telegram. Вне браузера окна нет; пустой заглушки хватает, чтобы обёртка
// вернула «клиента нет».
(globalThis as { window?: unknown }).window ??= {};

const { useGame } = await import('@/game/store');

/**
 * Касание по пустой земле закрывает окно постройки (решение владельца 03.10.2026, docs/ui_audit.md, 12.8).
 *
 * В новом виде у шторки нет затемнения (12.2, 9): касание над ней достаётся городу. Судья сцены отдаёт промах мимо
 * всех построек пустым (`null`), холст передаёт его в дверь окна, и она закрывает окно постройки — и только его:
 * шторка племени или дружины — не окно постройки, промах по городу её не трогает. В прежнем виде то же делает
 * затемнение. Касание настоящим пальцем меряет отчёт `tap` («тап в чистое поле при открытом окне»).
 */

const src = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('пустое касание по городу', () => {
  beforeEach(() => {
    useGame.setState({ mapOpen: false, sheet: null });
  });

  it('закрывает окно постройки, другие окна оставляет', () => {
    const id = useGame.getState().s.buildings[0].id;
    useGame.getState().openBuilding(id);
    // Точка внутри области правила: открыто именно окно постройки.
    expect(useGame.getState().sheet).toEqual({ kind: 'building', id });
    useGame.getState().openBuilding(null);
    expect(useGame.getState().sheet).toBeNull();

    useGame.setState({ sheet: { kind: 'tab', tab: 'people' } });
    useGame.getState().openBuilding(null);
    expect(useGame.getState().sheet).toEqual({ kind: 'tab', tab: 'people' });
  });

  it('промах доходит до двери окна: сцена отдаёт пустое касание, холст — в дверь, затемнение нового вида касаний не берёт', () => {
    const scene = src('../render/Scene.ts');
    // Тап мимо всего — тоже тап: сцена зовёт `onPick` с тем, во что целились, а это `null`.
    expect(scene).toMatch(/const end: End = tapped\s*\?\s*this\.aimed === null\s*\?\s*'мимо'/);
    expect(scene).toMatch(/if \(!tapped\) return;[\s\S]{0,400}?this\.onPick\?\.\(this\.aimed\);/);
    expect(src('./GameCanvas.tsx')).toMatch(/scene\.onPick = \(id\) => useGame\.getState\(\)\.openBuilding\(id\);/);
    expect(src('./next/next.css')).toMatch(/\.ui-new \.sheet-backdrop \{[^}]*pointer-events: none;/);
  });
});
