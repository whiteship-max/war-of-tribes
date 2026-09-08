import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useGame } from '@/game/store';
import { TribeScene } from '@/render/Scene';
import { bootDone, bootStage } from '@/boot/stage';
import { afterPaint } from '@/boot/paint';
import { probe } from '@/debug';
import { diagnose, sceneLog, type Verdict } from '@/scenelog';
import { SceneTrouble } from './SceneTrouble';
import { applyViewport } from '@/telegram/webapp';

/**
 * Как часто сторож спрашивает сцену, идут ли кадры. Две секунды: чаще незачем —
 * остановка меряется секундой с четвертью, — а реже игрок успеет решить, что
 * игра сломалась насовсем.
 */
const WATCH_EVERY = 2000;

/**
 * Сколько после пересборки она считается свежей. Потеря контекста сразу после
 * пересборки означает, что брать его бесполезно: чинить нечем, надо говорить.
 */
const REBUILD_COOLDOWN = 30_000;

export function GameCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TribeScene | null>(null);
  /**
   * Номер сборки диорамы. Меняется — и React делает **новую** канву, а эффект
   * собирает на ней новую сцену из состояния игры.
   *
   * Новую, а не ту же: потерянный контекст WebGL к прежнему элементу больше не
   * возвращается, и `getContext` на нём отдаёт тот же мёртвый. Поэтому ключ
   * стоит на самой канве — только так пересборка бывает настоящей.
   */
  const [gen, setGen] = useState(0);
  /**
   * Приговор, с которым сцену уже не поднять самой. Пока он null, экрана-заглушки
   * нет: чинящаяся сцена не должна пугать игрока сообщением о поломке.
   */
  const [trouble, setTrouble] = useState<Verdict | null>(null);
  /** Когда пересобирали в последний раз — по нему видно, что пересборка не помогла. */
  const rebuiltAt = useRef(0);

  const rebuild = useCallback(() => {
    rebuiltAt.current = performance.now();
    setTrouble(null);
    setGen((n) => n + 1);
  }, []);

  // Именно layout, а не обычный эффект. Дело в уборке: она обязана пройти, пока
  // канва ещё в разметке, иначе OrbitControls снимает свой слушатель не с того
  // узла и документ навсегда остаётся держателем всей сцены (подробно — в
  // `TribeScene.dispose`). Сборка сцены при этом кадр не задерживает: занавес
  // перехода нарисован кадром раньше, и ждать ему нечего.
  useLayoutEffect(() => {
    const canvas = ref.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    // Стадия загрузки и её снятие бывают раз за партию: пересборка диораму
    // меняет, а экран загрузки давно ушёл, и звать его обратно незачем.
    if (gen === 0) bootStage('scene');
    const scene = new TribeScene(canvas);
    sceneRef.current = scene;
    sceneLog.mark(gen === 0 ? 'scene' : 'rebuild', `сборка №${gen + 1}`);
    // Тап по зданию открывает его панель; тап по пустому месту закрывает открытую.
    scene.onPick = (id) => useGame.getState().openBuilding(id);
    // Замер: сцену надо достать из консоли, в собранном бандле её неоткуда взять.
    if (probe()) (window as unknown as { __scene?: TribeScene }).__scene = scene;
    const g0 = useGame.getState();
    scene.sync(g0.s);
    scene.setSelected(g0.sheet?.kind === 'building' ? g0.sheet.id : null);
    // Пока открыта карта мира, диорама не рисуется — но и не выгружается:
    // sync продолжает идти, поэтому возврат показывает уже актуальный посёлок сразу.
    if (g0.mapOpen) scene.pause();
    // Экран загрузки уходит не по «сцена создана», а по первому её кадру:
    // между конструктором и картинкой лежит компиляция шейдеров.
    if (gen === 0) void afterPaint(bootDone);
    // Прибор подключается к живой сцене: без этого он честно говорит «не знаю».
    const wired = { vitals: () => scene.vitals(), revive: rebuild };
    sceneLog.attach(wired);

    /**
     * Контекст не вернулся в срок. Первая попытка — пересобрать сцену молча: у
     * новой канвы будет новый контекст, а диорама соберётся из состояния игры,
     * и игрок не увидит ничего, кроме мигнувшей картинки.
     *
     * Пересборка следом за пересборкой — уже не лечение, а карусель: значит,
     * контекст отбирают быстрее, чем мы успеваем его брать. Тогда молчать
     * нельзя, и на экране появляется, что случилось, и кнопка.
     */
    scene.onLost = () => {
      const fresh = performance.now() - rebuiltAt.current < REBUILD_COOLDOWN;
      if (fresh) {
        sceneLog.mark('watch', 'пересборка не помогла — показываем экран восстановления');
        setTrouble('lost');
        return;
      }
      rebuild();
    };

    /**
     * Сторож. Всё, что выше, лечит три известные болезни; сторож — про
     * четвёртую, которой мы ещё не видели: кадры не идут, а причина не названа.
     *
     * Он не спешит: сперва будит сцену тем же `wake`, что и возвращение из фона,
     * и только если через две секунды кадров по-прежнему нет, показывает
     * игроку, что случилось. Секунда с четвертью без кадра — уже остановка
     * (`STALL_MS`), но одна проверка могла попасть на тяжёлый кадр.
     */
    let nudged = false;
    const watch = window.setInterval(() => {
      const verdict = diagnose(scene.vitals());
      if (verdict === 'ok' || verdict === 'map' || verdict === 'hidden') {
        nudged = false;
        return;
      }
      // Потерю контекста лечит свой срок и своя пересборка — сторожу тут не место.
      if (verdict === 'lost') return;
      if (!nudged) {
        nudged = true;
        sceneLog.mark('watch', `сторож: ${verdict} — будим сцену`);
        wake();
        return;
      }
      sceneLog.mark('watch', `сторож: ${verdict} после побудки — показываем экран восстановления`);
      setTrouble(verdict);
    }, WATCH_EVERY);
    const unsub = useGame.subscribe((g, prev) => {
      if (g.s !== prev.s) scene.sync(g.s);
      if (g.sheet !== prev.sheet) scene.setSelected(g.sheet?.kind === 'building' ? g.sheet.id : null);
      if (g.mapOpen !== prev.mapOpen) {
        if (g.mapOpen) scene.pause();
        else {
          scene.resume();
          scene.resize();
        }
      }
    });
    // Высота приходит из --app-h (viewportStableHeight Telegram), поэтому слушаем
    // размер элемента, а не только resize окна.
    const onResize = () => scene.resize();
    const ro = new ResizeObserver(onResize);
    ro.observe(wrap);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    /**
     * Возвращение из фона. `visibilitychange` сцена слушает сама, а эти события
     * ей не видны — и полагаться на какое-то одно из них нельзя: вебвью
     * Телеграма на Android присылает их по-разному от версии к версии, а иногда
     * не присылает ничего, кроме `pageshow`. Все ведут в один и тот же `wake`,
     * и звать его лишний раз ничего не стоит.
     */
    const wake = () => {
      // Сперва вьюпорт, потом холст: `--app-h` задаёт высоту всему приложению,
      // и пересчитанный до него холст померил бы старую раскладку. Клиент мог не
      // прислать viewportChanged вовсе — тогда это единственное место, где
      // высота обновится.
      applyViewport();
      scene.wake();
    };
    const onFreeze = () => sceneLog.mark('hide', 'страница заморожена');
    // Видимость сцена слушает сама — ей это про кадры. Здесь то же событие
    // слушается про другое: высота приложения приходит из клиента Телеграма, и
    // пересчитать её надо тому, кто про Телеграм знает.
    const onVisible = () => {
      if (document.visibilityState === 'visible') wake();
    };
    window.addEventListener('pageshow', wake);
    document.addEventListener('resume', wake);
    document.addEventListener('freeze', onFreeze);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsub();
      clearInterval(watch);
      scene.onLost = null;
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener('pageshow', wake);
      document.removeEventListener('resume', wake);
      document.removeEventListener('freeze', onFreeze);
      document.removeEventListener('visibilitychange', onVisible);
      sceneLog.detach(wired);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [gen, rebuild]);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      {/* Ключ — не украшение: пересборка обязана дать новый элемент канвы,
          иначе мёртвый контекст WebGL достанется и новой сцене. */}
      <canvas key={gen} ref={ref} />
      {trouble && <SceneTrouble verdict={trouble} onRetry={rebuild} />}
    </div>
  );
}
