// Ролик о бое поверх сцены. Компонент ничего не решает: он заводит
// проигрыватель, отдаёт ему канву диорамы и рисует то, что пришло кадром.
//
// Кнопок здесь не написано ни одной — они приходят в `frame.controls`. Причина
// та же, по которой в карточке вида не пишется ни одного множителя: написанное
// руками расходится с правилом ровно тогда, когда правило меняют. «Пропустить»
// обязана быть на каждом кадре, и проверить это можно только тогда, когда она
// живёт в данных, а не в разметке.
//
// Своего контекста WebGL ролик не создаёт: канву и рендерер одалживает диорама.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { activeScene } from '@/render/Scene';
import { ReplayPlayer } from '@/render/battle/player';
import { PHASE_NAME } from '@/battle/log';
import { frameAt, type Frame } from '@/battle/replay';
import { castOfRecord } from '@/game/battle/faces';
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

  useEffect(() => {
    const scene = activeScene();
    if (!scene) {
      done.current();
      return;
    }
    // Пока идёт ролик, интерфейс игры уходит: он рисуется поверх той же канвы,
    // в которую идёт бой, и иначе шторка с отчётом закрывает половину поля.
    // Слой ролика висит на body, а не в `.app`, поэтому его это не касается.
    document.body.classList.add('replaying');
    const renderer = scene.lend(true);
    const player = new ReplayPlayer(renderer, cast, {
      onFrame: (f) => {
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
      player.dispose();
      scene.lend(false);
      scene.renderOnce();
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
          <button className="btn" key={c.id} onClick={() => done.current()}>
            {c.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
