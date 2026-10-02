// Ролик боя в стиле Total War поверх сцены (docs/battle_tw.md) — за переключателем `?battle=tw` (`look.ts`);
// без него «Смотреть бой» играет прежний ролик (`BattleReplay`).
//
// Компонент ничего не решает, как и прежний: заводит проигрыватель на одолженной канве и рисует подпись. Подпись,
// фаза, счёт и музыка — у прежней раскадровки (`frameAt`) на той же секунде боя: время у роликов одно (решение 5),
// и строка журнала одна. Кнопки приходят данными (`TW_CONTROLS`), а не разметкой — правило прежнего ролика.
//
// Камерой правит игрок: ввод — на слое ролика, а не на холсте, где сидит ввод сцены города.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { activeScene } from '@/render/Scene';
import { configureRenderer } from '@/render/lighting';
import { pixelRatio } from '@/render/loop';
import { PHASE_NAME } from '@/battle/log';
import { SKIP, frameAt, type Frame } from '@/battle/replay';
import { castOfRecord } from '@/game/battle/cast';
import { beastWords } from '@/game/battle/beasts';
import { battleMusic, villageMusic } from '@/sound/web';
import type { BattleRecord } from '@/world/types';

/** Кнопки ролика TW: «Пропустить», как у прежнего, и «Общий вид» — вернуть камеру режиссуре. */
const OVERVIEW = { id: 'overview', label: 'Общий вид' } as const;
const TW_CONTROLS = [OVERVIEW, SKIP] as const;

export function TwReplay({ rec, onDone }: { rec: BattleRecord; onDone: () => void }) {
  const us = rec.us;
  const cast = useMemo(() => castOfRecord(rec.result, rec.us, rec.troops, rec.militia, rec.place, rec.beasts), [rec]);
  const [frame, setFrame] = useState<Frame>(() => frameAt(cast, 0));
  const [loaded, setLoaded] = useState<'wait' | 'ok' | 'fail'>('wait');
  const shown = useRef('');
  const done = useRef(onDone);
  done.current = onDone;
  const layer = useRef<HTMLDivElement>(null);
  const release = useRef<() => void>(() => undefined);

  useEffect(() => {
    const scene = activeScene();
    document.body.classList.add('replaying');
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
      own.setPixelRatio(pixelRatio());
      configureRenderer(own);
      renderer = own;
    }
    renderer.info.autoReset = false;
    battleMusic.start();
    villageMusic.duck(true);
    let alive = true;
    let dispose: () => void = () => undefined;
    let onResize: () => void = () => undefined;
    void import('@/render/tw/play')
      .then((m) => {
        if (!alive || !layer.current) return;
        const quality = scene?.quality ?? 'medium';
        const player = m.playTw(
          renderer,
          { result: rec.result, us: rec.us, troops: rec.troops, militia: rec.militia, place: rec.place, beasts: rec.beasts },
          quality,
          layer.current,
          {
            onFrame: (_t, castT) => {
              const f = frameAt(cast, castT);
              battleMusic.set(f.music);
              const key = `${f.act}|${f.caption ?? ''}|${f.phase}|${f.side.attacker.men}|${f.side.defender.men}`;
              if (key === shown.current) return;
              shown.current = key;
              setFrame(f);
            },
            onEnd: () => done.current(),
          },
        );
        player.fit();
        player.start();
        release.current = () => player.cam.release();
        onResize = () => player.fit();
        window.addEventListener('resize', onResize);
        dispose = () => player.dispose();
        setLoaded('ok');
      })
      .catch((e: unknown) => {
        // Причина — в консоль: «не загрузился» без неё не отличить сеть от ошибки в коде ролика.
        console.error('ролик TW:', e);
        if (alive) setLoaded('fail');
      });
    return () => {
      alive = false;
      window.removeEventListener('resize', onResize);
      dispose();
      battleMusic.stop();
      villageMusic.duck(false);
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
  }, [cast, rec]);

  const them = us === 'attacker' ? 'defender' : 'attacker';
  return createPortal(
    <div className="replay replay-tw" ref={layer}>
      <div className="replay-top">
        <span className="replay-phase">{PHASE_NAME[frame.phase]}</span>
        <span className="replay-count">
          {frame.side[us].men} · {frame.side[them].men}
        </span>
      </div>
      {loaded === 'fail' && <div className="replay-caption">Ролик не загрузился — итог боя в отчёте.</div>}
      {loaded !== 'fail' && frame.caption && <div className="replay-caption">{beastWords(frame.caption, rec.beasts, us)}</div>}
      <div className="replay-controls">
        {TW_CONTROLS.map((c) => (
          <button className="btn" key={c.id} onClick={() => (c.id === 'skip' ? done.current() : release.current())}>
            {c.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
