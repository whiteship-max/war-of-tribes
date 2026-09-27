import { useEffect, useState } from 'react';
import type { BuildingTypeId, GameState } from '@/game/types';
import { useGame } from '@/game/store';
import { currentStep, stepText, type TutorialStep } from '@/game/data/tutorial';
import { activeScene } from '@/render/Scene';
import { FrameLoop } from '@/render/loop';

/** Запас вокруг цели, чтобы «дырка» не резала её по краю. */
const PAD = 6;

interface Spot {
  x: number;
  y: number;
  w: number;
  h: number;
  round: boolean;
}

/**
 * Подводит цель к середине шторки. Скроллим ровно её собственный контейнер, а не
 * `scrollIntoView`: тот тянет за собой и корень приложения, а оттуда верхний HUD
 * уезжает за край экрана (см. сброс прокрутки в App).
 */
function scrollIntoSheet(el: Element): void {
  const box = el.closest('.sheet-body');
  if (!(box instanceof HTMLElement)) return;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const delta = r.top + r.height / 2 - (b.top + b.height / 2);
  if (Math.abs(delta) > 4) box.scrollTop += delta;
}

function domSpot(sel: string): Spot | null {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2, round: false };
}

function buildingSpot(s: GameState, type: BuildingTypeId): Spot | null {
  const b = s.buildings.find((x) => x.type === type);
  if (!b) return null;
  const p = activeScene()?.screenSpot(b.id);
  if (!p) return null;
  return { x: p.x - p.r, y: p.y - p.r, w: p.r * 2, h: p.r * 2, round: true };
}

function spotOf(step: TutorialStep, s: GameState): Spot | null {
  switch (step.target.kind) {
    case 'dom':
      return domSpot(step.target.sel);
    case 'building':
      return buildingSpot(s, step.target.type);
    default:
      return null;
  }
}

/**
 * Проводка первых шагов: строка сверху и «дырка» в затемнении на цели.
 * Слой ничего не перехватывает — мир живёт, шаг закрывается настоящим действием
 * в настоящем интерфейсе. Исключение — шаги-строки: их закрывают тапом в любом месте,
 * и тогда экран накрывает ловушка тапа.
 */
export function TutorialOverlay() {
  const s = useGame((g) => g.s);
  const skip = useGame((g) => g.skipTutorial);
  const tap = useGame((g) => g.tapTutorial);
  const closeSheet = useGame((g) => g.closeSheet);
  const [spot, setSpot] = useState<Spot | null>(null);
  const step = currentStep(s);

  // Цель в сцене: шторка закрывает нижние две трети экрана, из-под неё здания не видно.
  useEffect(() => {
    if (step?.target.kind === 'building') closeSheet();
  }, [step, closeSheet]);

  // Позиция цели считается каждый кадр: камера вращается, шторка едет, список скроллится.
  useEffect(() => {
    // Прошлая цель снимается сразу: лучше кадр без затемнения, чем кадр с дыркой не там.
    setSpot(null);
    if (!step) return;
    let key = '';
    let nextScroll = 0;
    const frame = (): void => {
      const next = spotOf(step, useGame.getState().s);
      // Цель в списке может оказаться ниже сгиба. Пробуем не один раз: шторка ещё
      // едет вверх, и на первом кадре её список толком не размечен.
      if (next && step.target.kind === 'dom' && (next.y < 0 || next.y + next.h > window.innerHeight)) {
        const now = performance.now();
        if (now >= nextScroll) {
          nextScroll = now + 250;
          const el = document.querySelector(step.target.sel);
          if (el) scrollIntoSheet(el);
        }
      }
      const k = next ? `${Math.round(next.x)}:${Math.round(next.y)}:${Math.round(next.w)}:${Math.round(next.h)}` : '';
      if (k === key) return;
      key = k;
      setSpot(next);
    };
    // Первая позиция — сразу, дальше — кадрами через дверь кадра (`render/loop.ts`).
    frame();
    const loop = FrameLoop.run(frame);
    return () => loop.stop();
  }, [step]);

  if (!step) return null;
  // Шаг с условием ждёт настоящего действия, поэтому экран не перехватываем.
  const waiting = step.done !== undefined;
  // Строка уходит вниз, если цель в верхней половине экрана: подсказка не должна её накрыть.
  const atBottom = spot !== null && spot.y < window.innerHeight * 0.45;

  return (
    <>
      {!waiting && <div className="tut-catch" onClick={tap} />}
      {spot && (
        <div
          className={`tut-hole${spot.round ? ' round' : ''}`}
          style={{ left: spot.x, top: spot.y, width: spot.w, height: spot.h }}
        />
      )}
      <div className={`tut-bar ${atBottom ? 'at-bottom' : 'at-top'}`}>
        <span className="txt">{stepText(step, s)}</span>
        <button className="skip" onClick={skip}>
          Пропустить
        </button>
      </div>
    </>
  );
}
