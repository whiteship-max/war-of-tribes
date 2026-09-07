// Ролик о бое поверх сцены. Компонент ничего не решает: он заводит
// проигрыватель, отдаёт ему канву диорамы и рисует то, что пришло кадром.
//
// Кнопок здесь не написано ни одной — они приходят в `frame.controls`. Причина
// та же, по которой в карточке вида не пишется ни одного множителя: написанное
// руками расходится с правилом ровно тогда, когда правило меняют. «Пропустить»
// обязана быть на каждом кадре, и проверить это можно только тогда, когда она
// живёт в данных, а не в разметке.
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
import { ReplayPlayer } from '@/render/battle/player';
import { PHASE_NAME } from '@/battle/log';
import { frameAt, type Frame } from '@/battle/replay';
import { castOfRecord } from '@/game/battle/faces';
import { battleMusic, villageMusic } from '@/sound/web';
import { setSoundOn, soundOn } from '@/sound/settings';
import type { BattleRecord } from '@/world/types';

export function BattleReplay({ rec, onDone }: { rec: BattleRecord; onDone: () => void }) {
  const us = rec.us;
  const cast = useMemo(() => castOfRecord(rec.result, rec.us, rec.troops, rec.militia, rec.place), [rec]);
  // Первый кадр есть до запуска: управление обязано быть на экране сразу,
  // а не появляться, когда рендерер отдаст первый onFrame.
  const [frame, setFrame] = useState<Frame>(() => frameAt(cast, 0));
  // Кадр приходит шестьдесят раз в секунду, а перерисовывать надпись надо
  // только когда она изменилась: иначе React работает больше, чем three.
  const shown = useRef('');
  const done = useRef(onDone);
  done.current = onDone;
  // Звук — настройка устройства, а не партии: она живёт своим ключом и сюда
  // приходит только для того, чтобы нарисовать переключатель нажатым.
  const [sound, setSound] = useState(soundOn);

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
      // Та же вилка плотности, что у диорамы: третий пиксель не виден, а филлрейт вдвое.
      own.setPixelRatio(Math.min(2, Math.max(1, window.devicePixelRatio || 1)));
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
      {frame.caption && <div className="replay-caption">{frame.caption}</div>}
      <div className="replay-controls">
        {frame.controls.map((c) => (
          <button
            className={`btn${c.goes === 'sound' && !sound ? ' ghost' : ''}`}
            key={c.id}
            aria-pressed={c.goes === 'sound' ? sound : undefined}
            onClick={() => {
              if (c.goes !== 'sound') {
                done.current();
                return;
              }
              // Нажатие переключателя — тоже жест, и другого может не быть:
              // игрок мог открыть ролик с выключенным звуком.
              const next = !sound;
              setSoundOn(next);
              setSound(next);
              battleMusic.toggle(next);
              // Переключатель один на всю музыку: игрок выключает звук, а не
              // боевую дорожку. Деревня при этом остаётся заглушенной роликом
              // и вернётся сама, когда он кончится.
              villageMusic.toggle(next);
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
