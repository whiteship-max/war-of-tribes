import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useGame } from '@/game/store';
import { TribeScene } from '@/render/Scene';
import { bootDone, bootStage } from '@/boot/stage';
import { afterPaint } from '@/boot/paint';
import { probe } from '@/debug';
import { sceneLog } from '@/scenelog';

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
  const rebuild = useCallback(() => setGen((n) => n + 1), []);

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
    const wake = () => scene.wake();
    const onFreeze = () => sceneLog.mark('hide', 'страница заморожена');
    window.addEventListener('pageshow', wake);
    document.addEventListener('resume', wake);
    document.addEventListener('freeze', onFreeze);
    return () => {
      unsub();
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener('pageshow', wake);
      document.removeEventListener('resume', wake);
      document.removeEventListener('freeze', onFreeze);
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
    </div>
  );
}
