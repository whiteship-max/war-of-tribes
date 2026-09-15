import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

// Переходы — это оболочка, и по дороге они трогают отклик Telegram. Вне браузера
// окна нет; пустой заглушки хватает, чтобы обёртка вернула «клиента нет».
(globalThis as { window?: unknown }).window ??= {};

const { useGame } = await import('@/game/store');

/**
 * Переход между посёлком и картой.
 *
 * Разделение сцен пробовали и откатили (docs/loading.md, часть 2): переход в обе
 * стороны снова мгновенный, диорама на время карты только перестаёт рисоваться.
 * Здесь проверяется, что этот откат не отъехал обратно и что починка утечки на
 * месте. Последняя к размену отношения не имеет и откату не подлежит: она держится
 * на одной неочевидной строке, которую легко потерять при следующей правке.
 *
 * Занавеса с артом на первый вход больше нет: при пороге показа в 240 мс и первом
 * входе в десятки миллисекунд он не показывался практически никогда.
 */

const src = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const canvas = src('./GameCanvas.tsx');
const scene = src('../render/Scene.ts');
const app = src('../App.tsx');

describe('переход между посёлком и картой', () => {
  beforeEach(() => {
    useGame.setState({ mapOpen: false, sheet: null });
  });

  it('переход мгновенный в обе стороны, и в первый раз тоже', () => {
    // Один тест на всю последовательность нарочно: «первый вход» — состояние
    // сессии, и разложенный по трём тестам он зависел бы от порядка их запуска.
    useGame.getState().openMap();
    expect(useGame.getState().mapOpen).toBe(true);
    useGame.getState().closeMap();
    expect(useGame.getState().mapOpen).toBe(false);
    useGame.getState().openMap();
    expect(useGame.getState().mapOpen).toBe(true);
  });

  it('диорама на карте встаёт на паузу, а не выгружается', () => {
    // Откат размена: выгрузка стоила четверти секунды на каждом возврате домой
    // ради трёх мегабайтов. Числа — в docs/loading.md, часть 2.
    expect(scene).toMatch(/pause\(\): void \{/);
    expect(scene).toMatch(/resume\(\): void \{/);
    expect(app).toMatch(/<GameCanvas \/>/);
    expect(app).not.toMatch(/mapOpen && <GameCanvas/);
    expect(canvas).toMatch(/if \(g\.mapOpen\) scene\.pause\(\);/);
  });

  it('сцена выгружается до того, как канва уйдёт из разметки', () => {
    // Единственная строка, на которой держится освобождение памяти, и к
    // разделению сцен она отношения не имеет: диорама выгружается при уходе с
    // экрана игры, и без этой правки каждый такой уход оставлял бы в памяти
    // целую сцену.
    //
    // Утечку держал OrbitControls: его `dispose()` снимает слушатель с
    // domElement.getRootNode(), и если канву уже вынули, корнем оказывалась она
    // сама — слушатель оставался на документе, а документ держал всю сцену.
    // Замеряно снимком кучи: четыре круга на карту и обратно оставляли четыре
    // живые диорамы вместо одной, +3.6 МБ за круг.
    //
    // Самого OrbitControls в сцене больше нет — он ушёл вместе с поворотом
    // камеры, — но порядок уборки от этого не меняется и откату не подлежит:
    // сцена по-прежнему отдаёт контекст насильно и снимает свои слушатели с
    // канвы, и делать это надо, пока канва в разметке. Вернёшь обычный
    // useEffect — вернёшь тот же класс ошибки, только искать её будет негде.
    expect(canvas).toMatch(/useLayoutEffect\(\(\) => \{/);
    expect(canvas).not.toMatch(/useEffect\(/);
    expect(scene).toMatch(/removeEventListener\('pointerdown', this\.onPointerDown\)/);
    expect(scene).toMatch(/forceContextLoss/);
  });

  it('ролик о бое заводит свой контекст, только когда одолжить не у кого', () => {
    // Диорама теперь всегда на месте, и ветка со своим контекстом не должна
    // срабатывать в игре. Убирать её всё равно нельзя: стенд ролика (?replay=)
    // работает без диорамы, и двух контекстов разом не бывает ни там, ни здесь.
    const replay = src('./battle/BattleReplay.tsx');
    expect(replay).toMatch(/if \(scene\) \{\s*renderer = scene\.lend\(true\)/);
    expect(replay).toMatch(/own\.forceContextLoss/);
    expect(replay).toMatch(/ownWrap\?\.remove\(\)/);
  });
});
