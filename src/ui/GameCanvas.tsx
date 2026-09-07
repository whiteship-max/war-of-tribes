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
    // Первый кадр диорамы снимает и экран загрузки, и занавес перехода: между
    // конструктором и картинкой лежит компиляция шейдеров, и объявлять сцену
    // готовой по «конструктор вернулся» значило бы показывать пустоту.
    void afterPaint(() => {
      bootDone();
      useGame.getState().curtainUp();
    });
    const unsub = useGame.subscribe((g, prev) => {
      if (g.s !== prev.s) scene.sync(g.s);
      if (g.sheet !== prev.sheet) scene.setSelected(g.sheet?.kind === 'building' ? g.sheet.id : null);
      // Обычно занавес домой поднимает монтирование: диораму выгрузили, и она
      // собирается заново. Под `?keepscene=1` сцена никуда не девалась, монтирования
      // не будет — и поднимать некому. Замер прежнего поведения на этом и вис.
      if (prev.mapOpen && !g.mapOpen) {
        scene.resize();
        void afterPaint(() => useGame.getState().curtainUp());
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
