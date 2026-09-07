import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

// Переходы — это оболочка, и по дороге они трогают отклик Telegram. Вне браузера
// окна нет; пустой заглушки хватает, чтобы обёртка вернула «клиента нет».
(globalThis as { window?: unknown }).window ??= {};

const { useGame } = await import('@/game/store');

/**
 * Занавес перехода между посёлком и картой.
 *
 * Диорама и карта больше не живут в памяти разом. Отсюда два обещания, и оба
 * проверяются здесь: порядок (сначала занавес, потом смена сцены) и то, что
 * выгруженное действительно освобождается — а последнее держится на одной
 * неочевидной строке, которую легко потерять при следующей правке.
 */

const src = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const canvas = src('./GameCanvas.tsx');
const scene = src('../render/Scene.ts');
const curtain = src('./SceneCurtain.tsx');
const app = src('../App.tsx');

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('занавес перехода', () => {
  beforeEach(() => {
    useGame.setState({ mapOpen: false, curtain: null, sheet: null });
  });

  it('сначала занавес, и только потом смена сцены', async () => {
    useGame.getState().openMap();
    // Порядок — не косметика: выгрузка диорамы и сборка карты идут в главном
    // потоке, и всё, что не нарисовано до них, не нарисуется до самого конца.
    expect(useGame.getState().curtain).toBe('march');
    expect(useGame.getState().mapOpen).toBe(false);
    await settle();
    expect(useGame.getState().mapOpen).toBe(true);
  });

  it('домой — свой арт, а не тот же самый', async () => {
    useGame.getState().openMap();
    await settle();
    useGame.getState().curtainUp();
    useGame.getState().closeMap();
    expect(useGame.getState().curtain).toBe('camp');
    expect(useGame.getState().mapOpen).toBe(true);
    await settle();
    expect(useGame.getState().mapOpen).toBe(false);
  });

  it('страховка снимает свой занавес и не трогает следующий', async () => {
    // Занавес перехватывает нажатия: зависший — это запертая игра.
    useGame.getState().openMap();
    await settle();
    useGame.getState().curtainUp();
    useGame.getState().closeMap();
    // Номер перехода сменился, значит страховка первого уже никого не снимет.
    expect(useGame.getState().curtain).toBe('camp');
  });

  it('второй переход не начинается, пока идёт первый', async () => {
    useGame.getState().openMap();
    useGame.getState().closeMap();
    // Занавес уже висит: повторный приказ его не перебивает и сцену не рвёт.
    expect(useGame.getState().curtain).toBe('march');
    await settle();
    expect(useGame.getState().mapOpen).toBe(true);
  });

  it('занавес снимает тот, кто нарисовал кадр, а не таймер', async () => {
    useGame.getState().openMap();
    await settle();
    expect(useGame.getState().curtain).toBe('march');
    useGame.getState().curtainUp();
    expect(useGame.getState().curtain).toBeNull();
    // Никакой таймер занавес не поднимает: время сборки сцены — свойство
    // телефона, а не константа. Таймер в сторе один и он страховочный: снимает
    // занавес через шесть секунд, чтобы игрок не остался заперт под картинкой,
    // если кадр так и не придёт. В обычной игре он не срабатывает никогда.
    expect(src('../game/store.ts')).toMatch(/CURTAIN_MAX_MS = 6000/);
  });

  it('у двух направлений два разных арта и две разные подписи', () => {
    const files = [...curtain.matchAll(/from '\.\/art\/([\w-]+\.webp)'/g)].map((m) => m[1]);
    expect(new Set(files).size).toBe(2);
    const lines = [...curtain.matchAll(/line: '([^']+)'/g)].map((m) => m[1]);
    expect(new Set(lines).size).toBe(2);
  });

  it('арты не входят в первую загрузку: только <img>, никаких предзагрузок', () => {
    // Адрес файла лежит в чанке, сам файл браузер качает, когда <img> впервые
    // встанет в разметку, — то есть при первом переходе.
    expect(curtain).toMatch(/<img/);
    expect(curtain).not.toMatch(/new Image\(|rel="preload"|fetchpriority/);
  });

  it('диорама выгружается на карте, а не встаёт на паузу', () => {
    // Пауза держала память и «одной сцены в памяти» не давала — её больше нет.
    expect(scene).not.toMatch(/\n\s+pause\(\)/);
    expect(scene).not.toMatch(/\n\s+resume\(\)/);
    expect(app).toMatch(/!mapOpen \|\| keepScene\(\)/);
    expect(scene).toMatch(/forceContextLoss/);
  });

  it('сцена выгружается до того, как канва уйдёт из разметки', () => {
    // Единственная строка, на которой держится освобождение памяти.
    // OrbitControls.dispose() снимает слушатель с domElement.getRootNode(); если
    // канву уже вынули, корнем окажется она сама, слушатель останется на
    // документе, и документ будет держать всю сцену. Замеряно снимком кучи:
    // четыре круга на карту и обратно оставляли четыре живые диорамы вместо одной.
    // Вернёшь обычный useEffect — вернёшь утечку, и тест об этом скажет.
    expect(canvas).toMatch(/useLayoutEffect\(\(\) => \{/);
    expect(canvas).not.toMatch(/\buseEffect\(/);
    // Свои подписки на контролы снимаются поимённо — литералом их не снять.
    expect(scene).toMatch(/removeEventListener\('start', this\.onControlStart\)/);
    expect(scene).toMatch(/removeEventListener\('change', this\.leash\)/);
  });

  it('ролик о бое заводит свой контекст, только когда одолжить не у кого', () => {
    // С карты диорамы нет вовсе, и без этого отчёт о бое открывался бы пустым.
    // Двух контекстов разом при этом не бывает ни при каком порядке действий.
    const replay = src('./battle/BattleReplay.tsx');
    expect(replay).toMatch(/if \(scene\) \{\s*renderer = scene\.lend\(true\)/);
    expect(replay).toMatch(/own\.forceContextLoss/);
    expect(replay).toMatch(/ownWrap\?\.remove\(\)/);
  });
});
