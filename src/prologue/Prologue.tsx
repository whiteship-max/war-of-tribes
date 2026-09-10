import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { probe } from '@/debug';
// Свой файл стилей, а не строки в общем: он уезжает вместе с чанком режима и
// в первую загрузку игры не входит (почему — в самом файле).
import './prologue.css';
import { HEARTH_CAP } from './fire';
import { loadPrologue } from './save';
import { PrologueScene, type PrologueView } from './scene';

/**
 * Предыстория: оболочка вокруг сцены.
 *
 * КАНВУ ЗАВОДИТ ЭФФЕКТ, А НЕ РАЗМЕТКА, и уборка идёт в `useLayoutEffect` — обе
 * причины те же, что у диорамы (`ui/GameCanvas.tsx`), и обе стоили дорого,
 * чтобы их выяснить: отданный контекст WebGL элемент не отпускает, а уборка
 * обычного эффекта идёт уже после удаления канвы из разметки.
 *
 * ДИОРАМЫ ПОД ЭТИМ ЭКРАНОМ НЕТ ВОВСЕ. `App` не рисует `GameCanvas`, пока открыта
 * предыстория, — то есть деревня не приостановлена, а разобрана, и контекст
 * WebGL в игре по-прежнему один. Приостановки тут было бы мало: две живые сцены
 * на телефоне кончаются тем, что браузер молча отбирает контекст у старшей, и
 * игрок возвращается из предыстории к чёрному прямоугольнику вместо деревни.
 *
 * Возврат стоит пересборки диорамы — четверть секунды, и она проходит за
 * стартовым экраном, на который игрок и возвращается. Это тот самый размен,
 * который для карты мира был признан невыгодным (docs/loading.md, часть 3), а
 * здесь выгоден: на карту ходят десятки раз за партию, в предысторию — один.
 *
 * Надстройка над сценой перерисовывается не каждый кадр: сцена присылает
 * `PrologueView` только когда в нём что-то изменилось (`scene.refresh`). Стик
 * ходьбы — исключение: он ездит за пальцем, и его сцена двигает сама, минуя
 * React, иначе React перерисовывался бы шестьдесят раз в секунду ради кружка.
 */
export function Prologue({ onExit }: { onExit: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PrologueScene | null>(null);
  const [view, setView] = useState<PrologueView | null>(null);
  /** Показывать ли подсказку об управлении. Уходит с первого касания сцены. */
  const [hint, setHint] = useState(true);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'pro-canvas';
    wrap.appendChild(canvas);
    const scene = new PrologueScene(canvas, loadPrologue());
    sceneRef.current = scene;
    scene.onView = setView;
    scene.stickEl = stickRef.current;
    // Первую надпись берём сразу, не дожидаясь кадра: в скрытом вебвью кадра не
    // будет вовсе, и игрок увидел бы многоточие вместо костра.
    setView(scene.snapshot());
    // Замер: сцену надо достать из консоли — в собранном бандле её неоткуда
    // взять. Только по флагу `?probe=1`, как и диораму (см. `src/debug.ts`).
    if (probe()) (window as unknown as { __pro?: PrologueScene }).__pro = scene;
    const drop = (): void => setHint(false);
    canvas.addEventListener('pointerdown', drop, { once: true });
    const onResize = (): void => scene.resize();
    const ro = new ResizeObserver(onResize);
    ro.observe(wrap);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      canvas.removeEventListener('pointerdown', drop);
      scene.onView = null;
      scene.stickEl = null;
      // Порядок тот же, что у диорамы: сцена прибирается при канве, ещё лежащей
      // в разметке, и только потом канва уходит.
      scene.dispose();
      canvas.remove();
      sceneRef.current = null;
    };
  }, []);

  const act = useCallback(() => sceneRef.current?.doAct(), []);

  const fuel = view ? view.fill * HEARTH_CAP : 0;

  return (
    <div className="pro" ref={wrapRef}>
      {/* Стик ходьбы. Сидит в разметке всегда и прячется прозрачностью: заводить
          и убирать узел на каждое касание дороже, чем подвинуть готовый. */}
      <div className="pro-stick" ref={stickRef} aria-hidden="true">
        <i />
      </div>

      <button className="pro-out" onClick={onExit}>
        ← Выход
      </button>

      <div className="pro-hearth">
        <div className="pro-bar">
          <i style={{ width: `${Math.round((view?.fill ?? 0) * 100)}%` }} />
        </div>
        <div className="pro-hearth-say">
          Костёр: {view?.words ?? '…'}
          {fuel > 0 && <span className="pro-dim"> · {fuel.toFixed(1)} из {HEARTH_CAP} полен</span>}
        </div>
      </div>

      <div className="pro-hands">
        {view?.axe && <span>🪓 топор</span>}
        <span>🪵 дров: {view?.logs ?? 0}</span>
      </div>

      {view && view.chops > 0 && <div className="pro-chops">Ещё ударов: {view.chops}</div>}

      <div className="pro-act">
        {/* Правило то же, что у стройки и писем: кнопка, которая не сработает,
            гаснет и говорит причину. Проваливающихся нажатий не бывает. */}
        <button className="pro-do" onClick={act} disabled={!view?.offer.can}>
          {view?.offer.label ?? 'Осмотрись'}
        </button>
        {view && !view.offer.can && <div className="pro-why">{view.offer.why}</div>}
      </div>

      {hint && (
        <div className="pro-hint">
          <b>Слева — идти, справа — смотреть.</b>
          <span>Тап — действие: подойди к пню за топором, свали дерево, положи дрова в костёр.</span>
          <span className="pro-dim">На ПК: WASD или стрелки, мышью тянуть, пробел — действие.</span>
        </div>
      )}
    </div>
  );
}
