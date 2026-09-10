import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { probe } from '@/debug';
// Свой файл стилей, а не строки в общем: он уезжает вместе с чанком режима и
// в первую загрузку игры не входит (почему — в самом файле).
import './prologue.css';
import { deathWords } from './body';
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
 *
 * ТЕСНО ЛИ НА ЭКРАНЕ — вопрос, который решается тем, чего здесь **нет**.
 * Полос три, но видно обычно две: полоса холода поднимается только когда с
 * теплом что-то не так, а пока костёр горит и человек у огня — её нет вовсе.
 * Так же и счётчики: чего нет в руках, того нет и на экране. Внизу всегда ровно
 * две кнопки — действие и лук, — и ни одна из них не переезжает.
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
    /*
     * ПЕРВЫМ УЗЛОМ, А НЕ ПОСЛЕДНИМ, И ЭТО НЕ МЕЛОЧЬ.
     *
     * Канву заводит эффект, а не разметка (причина — выше), и эффект приходит
     * после первого рисования: `appendChild` клал её **последней**. А
     * позиционированные соседи без своего слоя рисуются в порядке разметки —
     * то есть непрозрачный холст закрывал собой всю надстройку целиком: полосы,
     * счётчики, обе кнопки. Поймано глазами на 375 px: на экране была одна
     * поляна и ни одной кнопки.
     *
     * Лечится это одним словом, а не слоями: холст — пол, надстройка над ним,
     * и порядок разметки говорит это сам. Слои пришлось бы помнить каждому
     * новому элементу, а `prepend` не надо помнить никому.
     */
    wrap.prepend(canvas);
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
  const shoot = useCallback(() => sceneRef.current?.doBow(), []);
  const eatCooked = useCallback(() => sceneRef.current?.eatMeal(false), []);
  const eatRaw = useCallback(() => sceneRef.current?.eatMeal(true), []);
  const again = useCallback(() => sceneRef.current?.reviveNow(), []);

  /** Полоса тревоги о холоде видна только тогда, когда с теплом что-то не так. */
  const showCold = !!view && (view.coldFill > 0.005 || view.fireFill <= 0);

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

      {/* Три полосы одной меркой: сколько ещё хватит. Слово справа отвечает на
          тот вопрос, который игрок вправду задаёт, — успею ли вернуться. */}
      <div className="pro-vitals">
        <Vital icon="🔥" kind="fire" fill={view?.fireFill ?? 0} words={view?.fireWords ?? '…'} />
        <Vital icon="🍗" kind="fed" fill={view?.fedFill ?? 1} words={view?.fedWords ?? '…'} />
        {showCold && (
          <Vital
            icon="❄️"
            kind={view?.warming ? 'thaw' : 'cold'}
            fill={view?.coldFill ?? 0}
            words={view?.coldWords ?? ''}
          />
        )}
      </div>

      {/* Что в руках. Чего нет — того и на экране нет: пустые счётчики съедали бы
          ширину, которой на 360 px и так впритык. Мясо при этом кнопка: есть
          можно где угодно, подходить не к чему. */}
      <div className="pro-hands">
        {view?.axe && <span>🪓</span>}
        {view?.bow && <span>🏹 {view.quiver}</span>}
        {/* Дрова — словом, а не значком: 🪵 из Emoji 13.0, и на части систем
            вместо полена рисуется пустой квадрат (об этом сказано в CLAUDE.md,
            и здесь это поймано глазами — квадрат и был). Топор и лук старше и
            рисуются везде. */}
        {!!view?.logs && <span>дрова {view.logs}</span>}
        {!!view?.cooked && (
          <button className="pro-bite" onClick={eatCooked} disabled={!view.eatCooked.can} title={view.eatCooked.why}>
            🍗 {view.cooked}
          </button>
        )}
        {!!view?.raw && (
          <button className="pro-bite raw" onClick={eatRaw} disabled={!view.eatRaw.can} title={view.eatRaw.why}>
            🥩 {view.raw}
          </button>
        )}
      </div>

      {view && view.busy !== '' && (
        <div className="pro-chops">
          {view.busy}
          {view.busyLeft > 0 && `: ${view.busyLeft}`}
        </div>
      )}

      {/* Перекрестье появляется только с натянутым луком — и это единственное
          место в игре, где оно честно: тап не целится, а стрела летит ровно
          сюда. Стояло бы всегда — обещало бы прицел там, где его нет. */}
      {view?.drawn && <div className="pro-cross" aria-hidden="true" />}

      <div className="pro-act">
        {/* Правило то же, что у стройки и писем: кнопка, которая не сработает,
            гаснет и говорит причину. Проваливающихся нажатий не бывает. */}
        <button className="pro-do" onClick={act} disabled={!view?.offer.can}>
          {view?.offer.label ?? 'Осмотрись'}
        </button>
        {/* Лук — своя кнопка, и стоит она под большим пальцем той руки, которая
            смотрит: целиться и пускать одной рукой. */}
        <button
          className={`pro-bow${view?.drawn ? ' drawn' : ''}`}
          onClick={shoot}
          disabled={!view?.shot.can}
          title={view?.shot.why}
        >
          {view?.drawn ? '➹' : '🏹'}
        </button>
      </div>
      {view && !view.offer.can && <div className="pro-why">{view.offer.why}</div>}

      {hint && !view?.dead && (
        <div className="pro-hint">
          <b>Слева — идти, справа — смотреть.</b>
          <span>Тап — действие над тем, к чему подошёл: топор на колоде, пожитки у палатки, дрова в костёр.</span>
          <span>Лук — своей кнопкой: натянуть, навести взглядом, пустить. Оленя тапом не достать.</span>
          <span className="pro-dim">На ПК: WASD или стрелки, мышью тянуть, пробел — действие, F — лук.</span>
        </div>
      )}

      {/* Смерть — экран поверх всего, и он называет причину. Молча начатое
          заново утро игрок прочитал бы как сбой, а не как свою ошибку. */}
      {view?.dead && (
        <div className="pro-dead">
          <b>{deathWords(view.dead)}</b>
          <span>
            {view.dead === 'cold'
              ? 'Костёр прогорел, и греться стало нечем. Уходя, оставляй в очаге дров.'
              : 'Запас кончился раньше, чем ты вернулся. Мясо жарится на костре и хранится дольше сырого.'}
          </span>
          <span className="pro-dim">
            Новое утро: очаг разожжён, топор и лук при тебе. Запас мяса пропал — его придётся добыть.
          </span>
          <button className="pro-do" onClick={again}>
            Снова
          </button>
        </div>
      )}
    </div>
  );
}

/** Одна строка тревог: значок, полоса, срок словами. Три штуки одинаковые. */
function Vital({ icon, kind, fill, words }: { icon: string; kind: string; fill: number; words: string }) {
  return (
    <div className={`pro-vital ${kind}`}>
      <i className="pro-vital-ico">{icon}</i>
      <div className="pro-bar">
        <i style={{ width: `${Math.round(Math.max(0, Math.min(1, fill)) * 100)}%` }} />
      </div>
      <em>{words}</em>
    </div>
  );
}
