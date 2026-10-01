// Ролик о бое поверх сцены. Компонент ничего не решает: он заводит
// проигрыватель, отдаёт ему канву диорамы и рисует то, что пришло кадром.
//
// Кнопок здесь не написано ни одной — они приходят в `frame.controls`. Причина
// та же, по которой в карточке вида не пишется ни одного множителя: написанное
// руками расходится с правилом ровно тогда, когда правило меняют. «Пропустить»
// обязана быть на каждом кадре, и проверить это можно только тогда, когда она
// живёт в данных, а не в разметке.
//
// Переключателя звука здесь больше нет: музыка правится в настройках, в профиле,
// и рычаг на неё один на всю игру. Ролик её только просит начать — жестом
// служит нажатие «Смотреть бой» (`ReportPanel`), другого перед роликом нет.
//
// Контекст WebGL в игре всегда один. Стоит диорама — ролик одалживает её канву
// и рендерер. Открыт мир — диорамы нет вовсе (её выгружают, см. docs/loading.md),
// и тогда ролик заводит свой контекст: он в этот момент единственный. Второго
// одновременно не бывает ни при каком порядке действий, и это условие раздела 12
// документа о бое остаётся в силе.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { activeScene } from '@/render/Scene';
import { configureRenderer } from '@/render/lighting';
import { pixelRatio } from '@/render/loop';
import { ReplayPlayer } from '@/render/battle/player';
import { PHASE_NAME } from '@/battle/log';
import { frameAt, type Frame } from '@/battle/replay';
import { castOfRecord } from '@/game/battle/cast';
import { beastWords } from '@/game/battle/beasts';
import { gfx, sceneGfx } from '@/render/gfx';
import { battleMusic, villageMusic } from '@/sound/web';
import type { BattleRecord } from '@/world/types';

export function BattleReplay({ rec, onDone }: { rec: BattleRecord; onDone: () => void }) {
  const us = rec.us;
  // Стая у ворот (`rec.beasts`) получает метку зверя: ролик одевает её волками, а не всадниками рода ядра.
  const cast = useMemo(() => castOfRecord(rec.result, rec.us, rec.troops, rec.militia, rec.place, rec.beasts), [rec]);
  // Первый кадр есть до запуска: управление обязано быть на экране сразу,
  // а не появляться, когда рендерер отдаст первый onFrame.
  const [frame, setFrame] = useState<Frame>(() => frameAt(cast, 0));
  // Кадр приходит шестьдесят раз в секунду, а перерисовывать надпись надо
  // только когда она изменилась: иначе React работает больше, чем three.
  const shown = useRef('');
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const scene = activeScene();
    // Пока идёт ролик, интерфейс игры уходит: он рисуется поверх той же канвы,
    // в которую идёт бой, и иначе шторка с отчётом закрывает половину поля.
    // Слой ролика висит на body, а не в `.app`, поэтому его это не касается.
    document.body.classList.add('replaying');

    // Своя канва — только когда одолжить не у кого: отчёт о бое открывают с
    // карты, а там диорамы нет. Класс тот же, `canvas-wrap`: правило «на время
    // ролика от игры остаётся одна канва» не должно знать, чья она.
    let own: THREE.WebGLRenderer | null = null;
    let ownWrap: HTMLDivElement | null = null;
    let renderer: THREE.WebGLRenderer;
    if (scene) {
      renderer = scene.lend(true);
    } else {
      ownWrap = document.createElement('div');
      ownWrap.className = 'canvas-wrap';
      const canvas = document.createElement('canvas');
      ownWrap.appendChild(canvas);
      (document.querySelector('.app') ?? document.body).appendChild(ownWrap);
      own = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      // Та же вилка плотности, что у диорамы: третий пиксель не виден, а филлрейт растёт квадратом плотности.
      own.setPixelRatio(pixelRatio());
      configureRenderer(own);
      renderer = own;
    }
    // Жест уже был — им открыли ролик, — поэтому музыке можно начинать. Сама
    // она ни контекста, ни загрузок без жеста не заводит.
    battleMusic.start();
    // Деревня глушится, а не останавливается: круг идёт дальше под роликом, и
    // возврат после боя не стоит ни одной загрузки.
    villageMusic.duck(true);
    const player = new ReplayPlayer(renderer, cast, {
      // Вид сцены — тот же, что у посёлка (адрес сильнее выбора в настройках): у `next` свет и луг окружения.
      look: sceneGfx(gfx(), window.location.search).look,
      onFrame: (f) => {
        // Слой музыки идёт из кадра, как и всё остальное: звук ничего не решает.
        battleMusic.set(f.music);
        const key = `${f.act}|${f.caption ?? ''}|${f.phase}`;
        if (key === shown.current) return;
        shown.current = key;
        setFrame(f);
      },
      onEnd: () => done.current(),
    });
    player.fit();
    player.start();
    const onResize = (): void => player.fit();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      battleMusic.stop();
      villageMusic.duck(false);
      player.dispose();
      if (scene) {
        scene.lend(false);
        scene.renderOnce();
      }
      if (own) {
        own.dispose();
        try {
          own.forceContextLoss();
        } catch {
          /* старый драйвер не отдаёт контекст — заберёт сборщик */
        }
      }
      ownWrap?.remove();
      document.body.classList.remove('replaying');
    };
  }, [cast]);

  // Слой висит на body: шторка сдвинута трансформом, а внутри трансформа
  // position: fixed считается от неё, а не от экрана.
  return createPortal(
    <div className="replay">
      <div className="replay-top">
        <span className="replay-phase">{PHASE_NAME[frame.phase]}</span>
        <span className="replay-count">
          {frame.side[us].men} · {frame.side[us === 'attacker' ? 'defender' : 'attacker'].men}
        </span>
      </div>
      {/* Подпись — строка журнала ядра; о стае она говорит словами о волках, как отчёт (`game/battle/beasts`). */}
      {frame.caption && <div className="replay-caption">{beastWords(frame.caption, rec.beasts, us)}</div>}
      <div className="replay-controls">
        {frame.controls.map((c) => (
          <button className="btn" key={c.id} onClick={() => done.current()}>
            {c.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
