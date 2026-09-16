import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ARCHERY_MAX,
  ARCHERY_SHOTS,
  ARCHERY_WIN,
  SCORE_BULL,
  archeryLevel,
  archeryWon,
  markerAt,
  scoreAt,
} from '@/game/daily/archery';
import { haptic } from '@/telegram/webapp';

/**
 * 🏹 Меткий выстрел. По дорожке ходит бегунок, зачётная зона стоит на месте —
 * целятся временем, а не местом: на 375 px палец накрывает мишень целиком.
 *
 * Честность игры держится на одном: очки считаются в самом обработчике тапа по
 * стенным часам, а кадр только рисует. Возьми мы очки из последнего кадра — они
 * поехали бы от частоты кадров и от подвисаний вебвью, а в скрытой вкладке
 * requestAnimationFrame и вовсе стоит.
 */
export function Archery({ seed, onDone }: { seed: number; onDone: (won: boolean) => void }) {
  // useMemo, а не вызов в теле: панель перерисовывается на каждом кадре стора
  // (`TICK_MS`), а новый объект уровня каждый раз перезапускал бы цикл
  // отрисовки — бегунок дёргался бы на ровном месте.
  const lv = useMemo(() => archeryLevel(seed), [seed]);
  const [scores, setScores] = useState<number[]>([]);
  const marker = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const railWidth = useRef(0);
  const start = useRef(performance.now());
  const shot = scores.length;
  const done = shot >= ARCHERY_SHOTS;
  const total = scores.reduce((n, x) => n + x, 0);

  // Ширина дорожки меряется, а не берётся в процентах: у бегунка своя ширина в
  // три пикселя, и translateX(100%) сдвинул бы его на эти три пикселя, а не на
  // дорожку. Мерить в кадре нельзя — это лишний пересчёт разметки шестьдесят раз
  // в секунду, поэтому ширина снимается на монтировании и на повороте экрана.
  useEffect(() => {
    const measure = (): void => {
      railWidth.current = rail.current?.clientWidth ?? 0;
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  useEffect(() => {
    if (done) return;
    let raf = 0;
    const draw = (): void => {
      const el = marker.current;
      if (el) {
        const x = markerAt(lv, performance.now() - start.current);
        el.style.transform = `translateX(${x * railWidth.current}px)`;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [lv, done]);

  // Свернул приложение посреди выстрела — взвод сбрасывается. Иначе появляется
  // лазейка: свернуть, когда бегунок стоит на зелёном, и по возврату ударить
  // наверняка. Уже сделанные выстрелы при этом остаются.
  useEffect(() => {
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') start.current = performance.now();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, []);

  const fire = (e: ReactPointerEvent<HTMLDivElement>): void => {
    // На pointerdown, а не на click: у click в вебвью 50–100 мс задержки и
    // эвристика «а вдруг это прокрутка», а здесь всё решают полсотни миллисекунд.
    e.preventDefault();
    if (done) return;
    const x = markerAt(lv, performance.now() - start.current);
    const got = scoreAt(lv.shots[shot], x);
    haptic(got === SCORE_BULL ? 'success' : got > 0 ? 'light' : 'error');
    const next = [...scores, got];
    setScores(next);
    if (next.length >= ARCHERY_SHOTS) {
      onDone(archeryWon(next.reduce((n, v) => n + v, 0)));
    }
  };

  const zone = done ? lv.shots[ARCHERY_SHOTS - 1] : lv.shots[shot];
  const pct = (v: number): string => `${v * 100}%`;

  return (
    <>
      <div className="mg-head">
        <b>Выстрел {Math.min(shot + 1, ARCHERY_SHOTS)} из {ARCHERY_SHOTS}</b>
        <span className="mg-clock">
          {total} / {ARCHERY_MAX}
        </span>
      </div>

      <div className="mg-shots">
        {Array.from({ length: ARCHERY_SHOTS }, (_, i) => (
          <span
            key={i}
            className={`mg-shot${
              i >= scores.length ? '' : scores[i] === SCORE_BULL ? ' hit' : scores[i] > 0 ? ' ring' : ' miss'
            }`}
          />
        ))}
      </div>

      <div className="mg-track" onPointerDown={fire}>
        <div className="mg-rail" ref={rail}>
          <div
            className="mg-zone"
            style={{ left: pct(zone.center - zone.ring), width: pct(zone.ring * 2) }}
          />
          <div
            className="mg-bull"
            style={{ left: pct(zone.center - zone.bull), width: pct(zone.bull * 2) }}
          />
          <div className="mg-marker" ref={marker} />
        </div>
      </div>

      <div className="note">
        Бей по дорожке, когда бегунок в зелёном. Тёмная полоса — три очка, светлая — одно.
        Нужно {ARCHERY_WIN} из {ARCHERY_MAX}.
      </div>
    </>
  );
}
