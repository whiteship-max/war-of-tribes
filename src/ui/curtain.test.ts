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
 * Здесь проверяется, что этот откат не отъехал обратно, что занавес остался
 * ровно на одном случае — и что починка утечки на месте. Последняя к размену
 * отношения не имеет и откату не подлежит: она держится на одной неочевидной
 * строке, которую легко потерять при следующей правке.
 */

const src = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const canvas = src('./GameCanvas.tsx');
const scene = src('../render/Scene.ts');
const curtain = src('./SceneCurtain.tsx');
const app = src('../App.tsx');

describe('переход между посёлком и картой', () => {
  beforeEach(() => {
    useGame.setState({ mapOpen: false, curtain: null, sheet: null });
  });

  it('переход мгновенный, а занавес заводится только на первый вход', () => {
    // Один тест на всю последовательность нарочно: «первый вход» — состояние
    // сессии, и разложенный по трём тестам он зависел бы от порядка их запуска.
    //
    // Никаких «сначала занавес, кадр, потом сцена»: ждать нечего, диорама на
    // месте. Разделение сцен пробовали и откатили — размен памяти на задержку
    // оказался невыгодным (docs/loading.md, часть 2).
    useGame.getState().openMap();
    expect(useGame.getState().mapOpen).toBe(true);
    expect(useGame.getState().curtain).toBe('map');
    useGame.getState().curtainUp();

    useGame.getState().closeMap();
    expect(useGame.getState().mapOpen).toBe(false);
    // Домой занавеса нет вовсе и быть не должно.
    expect(useGame.getState().curtain).toBeNull();

    // Второй раз земля уже испечена: ждать нечего, и объяснять нечего.
    useGame.getState().openMap();
    expect(useGame.getState().mapOpen).toBe(true);
    expect(useGame.getState().curtain).toBeNull();
  });

  it('занавес не показывается, пока не пройден порог мелькания', () => {
    // Он заводится сразу — чтобы браузер успел стянуть арт, — но виден только
    // если переход затянулся. Порог тот же, что у экрана загрузки.
    expect(curtain).toMatch(/const SHOW_AFTER_MS = 240/);
    expect(curtain).toMatch(/visible && curtain \? ' on' : ''/);
    // Замер: первый вход укладывается в 71 мс, то есть на быстрой машине
    // занавеса не видно никогда. Это исход, а не недоработка.
  });

  it('арт не входит в первую загрузку: только <img>, никаких предзагрузок', () => {
    // Адрес файла лежит в чанке, сам файл браузер качает, когда <img> впервые
    // встанет в разметку, — то есть при первом входе на карту.
    expect(curtain).toMatch(/<img/);
    expect(curtain).not.toMatch(/new Image\(|rel="preload"|fetchpriority/);
  });

  it('страховка снимает свой занавес и не трогает следующий', () => {
    // Занавес перехватывает нажатия: зависший — это запертая игра. Таймер в
    // сторе один и он страховочный; поднимает занавес нарисованный кадр.
    expect(src('../game/store.ts')).toMatch(/CURTAIN_MAX_MS = 6000/);
    useGame.setState({ curtain: 'map' });
    useGame.getState().curtainUp();
    expect(useGame.getState().curtain).toBeNull();
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
    // OrbitControls.dispose() снимает слушатель с domElement.getRootNode(); если
    // канву уже вынули, корнем окажется она сама, слушатель останется на
    // документе, и документ будет держать всю сцену. Замеряно снимком кучи:
    // четыре круга на карту и обратно оставляли четыре живые диорамы вместо
    // одной, +3.6 МБ за круг. Вернёшь обычный useEffect — вернёшь утечку.
    expect(canvas).toMatch(/useLayoutEffect\(\(\) => \{/);
    expect(canvas).not.toMatch(/useEffect\(/);
    // Своих подписок на контролы больше нет: ввод у OrbitControls отобран
    // (`enabled = false`), панораму и поворот ведёт сама сцена, а привязку к
    // деревне она ставит там же, где двигает камеру. Значит и снимать нечего —
    // но `dispose` обязан пройти при канве, ещё лежащей в разметке: он снимает
    // слушатель с `getRootNode()`, и вынутая канва оставила бы его на документе.
    expect(scene).not.toMatch(/controls\.addEventListener/);
    expect(scene).toMatch(/this\.controls\.dispose\(\)/);
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
