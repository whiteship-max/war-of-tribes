import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useGame } from '@/game/store';
import { SCENES, setMarkerArt, type MarkerArt, type TribeScene } from '@/render/Scene';
import { onSheet, sheetReady, symbolOf } from '@/ui/icons/sheet';
import { bootDone, bootStage } from '@/boot/stage';
import { afterPaint } from '@/boot/paint';
import { castlePainted } from '@/boot/warm';
import { probe } from '@/debug';
import { diagnose, sceneLog, type Verdict } from '@/scenelog';
import { SceneTrouble } from './SceneTrouble';
import { measureViewport } from '@/viewport';
import { nextFrame } from '@/render/loop';
import { gfx, gfxKey, sceneGfx, subscribeGfx } from '@/render/gfx';
import { awayGameSeconds } from '@/game/sim/tick';
import { useWorld } from '@/world/store';
import { homeRegion } from '@/ui/parts/weather';

/**
 * Как часто сторож спрашивает сцену, идут ли кадры. Две секунды: чаще незачем —
 * остановка меряется `STALL_MS`, — а реже игрок успеет решить, что
 * игра сломалась насовсем.
 */
const WATCH_EVERY = 2000;

/**
 * Сколько после пересборки она считается свежей. Потеря контекста сразу после
 * пересборки означает, что брать его бесполезно: чинить нечем, надо говорить.
 */
const REBUILD_COOLDOWN = 30_000;

/** Рисунок значка листа для сцены: символ из документа в отдельной разметке SVG. */
const SHEET_ART: MarkerArt = {
  svg(name) {
    const sym = document.querySelector(symbolOf(name));
    if (!sym) return null;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${sym.getAttribute('viewBox') ?? '0 0 32 32'}">${sym.innerHTML}</svg>`;
  },
};

export function GameCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TribeScene | null>(null);
  /**
   * Номер сборки диорамы. Меняется — и эффект собирает сцену заново из состояния
   * игры, на новой канве (её заводит сам эффект — см. ниже).
   */
  const [gen, setGen] = useState(0);
  /**
   * Приговор, с которым сцену уже не поднять самой. Пока он null, экрана-заглушки
   * нет: чинящаяся сцена не должна пугать игрока сообщением о поломке.
   */
  const [trouble, setTrouble] = useState<Verdict | null>(null);
  /**
   * Когда пересобирали в последний раз — по нему видно, что пересборка не
   * помогла. До первой пересборки такого времени нет вовсе, и ноль тут не
   * годится: первая же потеря контекста в пределах `REBUILD_COOLDOWN` после запуска сошла бы
   * за «только что пересобирали», и вместо молчаливой починки игрок получил бы
   * экран поломки. Поймано стендом (`npm run revive:report`, случай 2).
   */
  const rebuiltAt = useRef(Number.NEGATIVE_INFINITY);
  /**
   * Номер первой сборки, на которой сцена встала. Стадия загрузки и её снятие бывают раз за
   * партию, и первая сборка — не всегда номер ноль: класс сцены мог не приехать к ней (ниже).
   * Номер, а не флаг: в StrictMode эффект первой сборки заходит дважды, и оба захода — первые.
   */
  const bootGen = useRef<number | null>(null);

  /**
   * Графика сменилась в настройках — сцена пересобирается на новой канве с новым уровнем:
   * сменить уровень на живой сцене нельзя (docs/handbook/scene.md). Это не лечение, поэтому
   * отметки «только что пересобирали» нет — потеря контекста следом лечится как обычно.
   */
  useLayoutEffect(() => {
    let key = gfxKey(gfx(), window.location.search);
    return subscribeGfx(() => {
      const next = gfxKey(gfx(), window.location.search);
      if (next === key) return;
      key = next;
      setGen((n) => n + 1);
    });
  }, []);

  const rebuild = useCallback(() => {
    rebuiltAt.current = performance.now();
    setTrouble(null);
    setGen((n) => n + 1);
  }, []);

  // Именно layout, а не обычный эффект. Дело в уборке: она обязана пройти, пока
  // канва ещё в разметке (подробно — в `TribeScene.dispose`). Утечку на этом
  // поймали через OrbitControls — его `dispose` снимал слушатель не с того узла,
  // и документ навсегда оставался держателем всей сцены; самого OrbitControls в
  // сцене больше нет, а порядок остался.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    /*
     * Сцена у игры одна — город (docs/city.md, «Город — единственный вид»), и её класс едет
     * своим куском: `main.tsx` везёт его до игры. Не приехал (сеть, страница старой сборки
     * после выкладки) — просим ещё раз и собираем, когда придёт; не пришёл и так — экран
     * восстановления: его кнопка зовёт эту же сборку, а с ней и новую просьбу.
     */
    const City = SCENES.game;
    if (!City) {
      let gone = false;
      void import('@/render/city/scene').then(
        () => {
          if (!gone) setGen((n) => n + 1);
        },
        () => {
          if (!gone) setTrouble('gone');
        },
      );
      return () => {
        gone = true;
      };
    }
    if (bootGen.current === null) bootGen.current = gen;
    const first = gen === bootGen.current;
    /*
     * Канву заводит эффект, а не разметка, и это не вкусовщина.
     *
     * `dispose` отдаёт контекст WebGL насильно (`forceContextLoss`) — иначе
     * браузер копил бы их и ронял самый старый молча. Но отданный контекст
     * элемент не отпускает: `getContext` на той же канве возвращает **тот же
     * мёртвый** контекст, и следующая сцена падает в конструкторе на пустой
     * точности шейдера. Проверено на живой странице: `same: true, lost: true`.
     *
     * Значит, правило одно и без исключений: **новая сцена — новый элемент.**
     * В разметке этого не выразить: React переиспользует узел, а эффект в
     * StrictMode заходит дважды (сборка — уборка — сборка), и вторая сборка
     * доставалась мёртвому контексту. Так дев-режим и жил с чёрной диорамой,
     * пока это не всплыло здесь.
     */
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    // Стадия загрузки и её снятие бывают раз за партию: пересборка диораму
    // меняет, а экран загрузки давно ушёл, и звать его обратно незачем.
    if (first) bootStage('scene');
    // Уровень — выбор игрока (пункт «Графика»), адрес сильнее записи.
    const scene = new City(canvas, null, sceneGfx(gfx(), window.location.search));
    sceneRef.current = scene;
    sceneLog.mark(first ? 'scene' : 'rebuild', `сборка №${gen + 1}`);
    // Тап по зданию открывает его панель; тап по пустому месту закрывает открытую.
    // Касание в сцене — единственная дверь, у которой здание подаёт голос (ЗВ-1, `sound/epoch/hallcue.hallHeard`).
    scene.onPick = (id) => useGame.getState().openBuilding(id, 'scene');
    // Замер: сцену надо достать из консоли, в собранном бандле её неоткуда взять.
    // Журнал рядом со сценой: стенд восстановления проверяет не только то, что
    // диорама вернулась, но и то, что она об этом честно написала.
    if (probe()) {
      const w = window as unknown as { __scene?: TribeScene; __scenelog?: typeof sceneLog };
      w.__scene = scene;
      w.__scenelog = sceneLog;
    }
    const g0 = useGame.getState();
    scene.sync(g0.s);
    scene.setSelected(g0.sheet?.kind === 'building' ? g0.sheet.id : null);
    // Пока открыта карта мира, диорама не рисуется — но и не выгружается:
    // sync продолжает идти, поэтому возврат показывает уже актуальный посёлок сразу.
    if (g0.mapOpen) scene.pause();
    // Погода над городом — по региону игрока (docs/city.md, 15): мир называет клетку города не сразу.
    scene.setRegion(homeRegion());
    const unRegion = useWorld.subscribe((w, was) => {
      if (w.info !== was.info) scene.setRegion(homeRegion());
    });
    // Экран загрузки уходит не по «сцена создана», а по первому её кадру:
    // между конструктором и картинкой лежит компиляция шейдеров. Тот же кадр — половина готовности замка, после
    // которой в простое подтягиваются куски по кнопке (`boot/warm`, РТ-2б).
    if (first)
      void afterPaint(() => {
        bootDone();
        castlePainted();
      });
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
     * и только если через `WATCH_EVERY` кадров по-прежнему нет, показывает
     * игроку, что случилось. Без кадра дольше `STALL_MS` — уже остановка,
     * но одна проверка могла попасть на тяжёлый кадр.
     */
    let nudged = false;
    /**
     * Не даёт ли кадров сам браузер.
     *
     * Разница решающая, а по показаниям сцены её не видно: «кадры не идут»
     * одинаково выглядит и у мёртвой цепочки, и у страницы, которую браузер
     * просто не рисует. А не рисует он её не только в фоне: iOS душит кадры на
     * время жеста, Android — под нагрузкой, и `visibilityState` при этом
     * по-прежнему «видима». Объявить в такую минуту поломку значило бы соврать —
     * и показать экран восстановления исправной игре.
     *
     * Поэтому сторож сперва просит кадр сам, напрямую — разовой заявкой двери
     * кадра (`nextFrame`), без потолка и без проверки видимости: спрашивают
     * браузер, а не нас. Не дождался своего — молчит: сцена тут ни при чём.
     * Поймано живой проверкой в браузере, где панель была скрыта, а видимость подменена.
     */
    let awaitingFrame = false;
    const askFrame = (): void => {
      awaitingFrame = true;
      nextFrame(() => {
        awaitingFrame = false;
      });
    };

    const watch = window.setInterval(() => {
      const verdict = diagnose(scene.vitals());
      if (verdict === 'ok' || verdict === 'map' || verdict === 'hidden') {
        nudged = false;
        return;
      }
      // Потерю контекста лечит свой срок и своя пересборка — сторожу тут не место.
      if (verdict === 'lost') return;
      if (awaitingFrame) {
        sceneLog.mark('watch', 'кадров не даёт сам браузер — ждём, сцена ни при чём');
        return;
      }
      askFrame();
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
      // Окно «С возвращением» закрыто («Посмотреть»): город показывает добычу отлучки одной волной (docs/city.md, 14.3).
      // Новая партия (`reset`) тоже гасит окно — у неё время с нуля, и показывать нечего.
      if (prev.offlineSeconds >= 60 && g.offlineSeconds === 0 && g.s.time >= prev.s.time) {
        scene.welcome(awayGameSeconds(0, prev.offlineSeconds * 1000));
      }
      if (g.mapOpen !== prev.mapOpen) {
        if (g.mapOpen) scene.pause();
        else {
          scene.resume();
          scene.resize();
        }
      }
    });
    // Высота приходит из --app-h (дверь окна, `src/viewport.ts`), поэтому слушаем
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
      // и пересчитанный до него холст померил бы старую раскладку. Попытки после
      // возвращения дверь окна делает сама; здесь — замер к этой минуте.
      measureViewport('сцена');
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
      unRegion();
      // Порядок важен: сцена отдаёт контекст и снимает свои слушатели, и канва
      // обязана быть при этом ещё в разметке (подробно — в `TribeScene.dispose`).
      scene.dispose();
      canvas.remove();
      sceneRef.current = null;
    };
  }, [gen, rebuild]);

  // Холст «нажимаемый» для браузера. Браузер отдаёт касание у края пятна пальца ближайшей
  // нажимаемой кнопке, а холст нажимаемым не считает — и узкая полоса над нижней панелью нажимала кнопку
  // панели, а не город (docs/city.md, 12.4). Пустой слушатель `click` делает обёртку кандидатом наравне с
  // кнопками, и касание достаётся тому, на ком лежит палец. Цена — у мелких кнопок над холстом пропадает
  // прощение у края; кнопок меньше 44 над холстом нет (docs/ui_audit.md, 3.6).
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const claim = (): void => {};
    wrap.addEventListener('click', claim);
    return () => wrap.removeEventListener('click', claim);
  }, []);

  // Значки над крышами — малые, рисунком набора: они в первом экране (`ui/icons/alias.FIRST_SCREEN`) и стоят в документе
  // с первого кадра. Ленивый лист приезжает после первого кадра — бляхи перерисовываются ещё раз.
  useLayoutEffect(() => {
    const apply = (): void => {
      setMarkerArt(SHEET_ART);
      sceneRef.current?.restyleMarkers();
    };
    apply();
    if (sheetReady()) return;
    return onSheet(apply);
  }, [gen]);

  return (
    <>
      {/* Внутри обёртки лежит только канва, и кладёт её эффект. React о ней не
          знает, поэтому своих детей ему сюда давать нельзя — экран-заглушка
          стоит рядом, а не внутри. */}
      <div className="canvas-wrap" ref={wrapRef} />
      {trouble && <SceneTrouble verdict={trouble} onRetry={rebuild} />}
    </>
  );
}
