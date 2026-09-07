import { useLayoutEffect, useRef } from 'react';
import { useGame } from '@/game/store';
import { TribeScene } from '@/render/Scene';
import { bootDone, bootStage } from '@/boot/stage';
import { afterPaint } from '@/boot/paint';
import { probe } from '@/debug';

export function GameCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TribeScene | null>(null);

  // Именно layout, а не обычный эффект. Дело в уборке: она обязана пройти, пока
  // канва ещё в разметке, иначе OrbitControls снимает свой слушатель не с того
  // узла и документ навсегда остаётся держателем всей сцены (подробно — в
  // `TribeScene.dispose`). Сборка сцены при этом кадр не задерживает: занавес
  // перехода нарисован кадром раньше, и ждать ему нечего.
  useLayoutEffect(() => {
    const canvas = ref.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    bootStage('scene');
    const scene = new TribeScene(canvas);
    sceneRef.current = scene;
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
    void afterPaint(bootDone);
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
    return () => {
      unsub();
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas ref={ref} />
    </div>
  );
}
