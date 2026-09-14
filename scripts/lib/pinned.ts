/**
 * Закреплённый мир для стендов карты: один сид, один дом, одна земля под камерой.
 *
 * Заведено после ошибки, и ошибка стоит того, чтобы её назвать. Стенд поднимает
 * Chrome с чистым профилем, игра строит мир со случайным сидом, и два прогона
 * одного отчёта смотрят на **разную землю**: у одного камера над лесом, у
 * другого над морем, а море печётся быстрым путём почти даром. Так в документ
 * однажды попало «выпечка подорожала втрое» — сравнивались два мира, а не два
 * коммита. На закреплённом мире то же сравнение дало +16…+50%, смотря по земле.
 *
 * Здесь только то, что общее у `map:shots` и `map:report`: как положить мир и
 * как войти в карту теми же дверями, что игрок. Что мерить — дело самого стенда.
 */
import { sleep, Tab } from './chrome';
import { cellOf } from '@/world/atlas/project';
import { WORLD_ORIGIN } from '@/world/data/tuning';

/** Клетка мира по долготе и широте. Земля настоящая, значит и адреса настоящие. */
export function cellAt(lon: number, lat: number): { x: number; y: number } {
  const c = cellOf(lon, lat);
  return { x: Math.round(c.col) + WORLD_ORIGIN.x, y: Math.round(c.row) + WORLD_ORIGIN.y };
}

/** Дом закреплён: Бавария, лес с равниной и рекой рядом. */
export const PINNED_HOME = cellAt(11.5, 48.5);
/** Сид закреплён тем же и по той же причине: иначе соседи и логова переезжают. */
export const PINNED_SEED = 20260912;

/** Щуп, без которого закрепить мир нечем: готовность, дом, заморозка пульса. */
const PIN_PROBE = `
(() => {
  const W = () => window.__world;
  window.__freeze = () => {
    W().setState({ pulse: async () => {} });
    return JSON.stringify('ok');
  };
  window.__ready = () => JSON.stringify({ map: window.__game.getState().mapOpen, world: !!window.__world && !!W().getState().info });
  window.__homeOrNull = () => JSON.stringify(window.__world ? (W().getState().info || {}).home || null : null);
  return JSON.stringify('ok');
})()
`;

/**
 * Кладёт закреплённый мир, входит в игру и открывает карту.
 *
 * Сохранение кладётся в цикле, и не по перестраховке: вкладка открывается сразу
 * на адресе игры, игра успевает построить свой мир со случайным сидом и записать
 * его — иногда раньше нашей записи, иногда позже. Гонка настоящая, ловится одним
 * вопросом («тот ли дом?») и лечится повтором. Не сошлось трижды — падаем:
 * замер на чужом мире хуже отсутствующего.
 *
 * Стартовый экран и проводка первых шагов снимаются теми же кнопками, что у
 * игрока, — стенд ходит теми же дверями, а не заводит себе вторые.
 */
export async function openPinnedMap(
  tab: Tab,
  opts: {
    home?: { x: number; y: number };
    seed?: number;
    onLog?: (s: string) => void;
    /**
     * Готовое сохранение мира вместо пустого — для замеров на мире, где что-то уже
     * случилось (осада, взятый город). Сид и дом в нём обязаны быть закреплёнными: по
     * ним и проверяется, что мир не уехал.
     */
    world?: string;
  } = {},
): Promise<void> {
  const home = opts.home ?? PINNED_HOME;
  const seed = opts.seed ?? PINNED_SEED;
  const world = opts.world ?? JSON.stringify({ v: 8, seed, home });
  for (let attempt = 1; ; attempt++) {
    await tab.eval<string>(
      `(() => { try { localStorage.clear(); localStorage.setItem('tribe.world.v1', ${JSON.stringify(
        world,
      )}); } catch (e) {} return JSON.stringify('ok'); })()`,
    );
    await tab.send('Page.reload');
    await sleep(4500);
    await tab.eval<string>(PIN_PROBE);
    await tab.eval<string>(
      '(() => { const b = document.querySelector(".start-go"); if (b) b.click(); return JSON.stringify(!!b); })()',
    );
    await sleep(1200);
    await tab.eval<string>('(() => { window.__game.getState().skipTutorial(); return JSON.stringify("ok"); })()');
    await tab.eval<string>('(() => { window.__game.getState().openMap(); return JSON.stringify("ok"); })()');
    for (let i = 0; i < 120; i++) {
      await sleep(100);
      const r = await tab.eval<{ map: boolean; world: boolean }>('window.__ready()');
      if (r.map && r.world) break;
    }
    const at = await tab.eval<{ x: number; y: number } | null>('window.__homeOrNull()');
    if (at && at.x === home.x && at.y === home.y) break;
    if (attempt >= 3) {
      throw new Error(`мир не закрепился: дом ${at ? `${at.x}|${at.y}` : 'не приехал'} вместо ${home.x}|${home.y}`);
    }
    opts.onLog?.(`  (мир уехал на ${at ? `${at.x}|${at.y}` : '—'}, кладём сохранение заново)`);
  }
  await tab.eval<string>('window.__freeze()');
}
