// Промысел: оболочка вокруг сцены — общий образец (docs/minigames.md, раздел 4). Начало — карточка цели, время, «до N»
// и цена; игра — отсчёт, счёт, подпись прицела; итог — что легло на склад и сколько энергии осталось.
//
// КАНВУ ЗАВОДИТ ЭФФЕКТ, А НЕ РАЗМЕТКА, и первой в обёртке (`prepend`) — по тем же причинам, что у предыстории
// (`prologue/Prologue.tsx`): отданный контекст WebGL элемент не отпускает, а холст, положенный последним, закрыл бы
// надстройку. Города под этим экраном нет вовсе: `App` не рисует `GameCanvas`, пока идёт промысел.
//
// В ПАРТИЮ ИДЁТ ОДИН ВЫЗОВ — `sim/minigames.harvest` в конце игры: трата энергии и добыча вместе. Ушёл посреди
// игры — ни того, ни другого. Числа на карточках — той же дверью (`minigameHaul`, `energyShown`), а не своей
// арифметикой (правило 18).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './minigames.css';
import { probe } from '@/debug';
import { useGame } from '@/game/store';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { seasonOf } from '@/game/derived';
import { ENERGY_MAX, MINIGAME_BY_ID, MINIGAME_COST, type MinigameId } from '@/game/data/minigames';
import { canPlay, energyReadyIn, harvest, minigameHaul, minigameSeed, type Harvest, type Haul } from '@/game/sim/minigames';
import { Icon } from '@/ui/icons/Icon';
import { realSpanText } from '@/ui/parts/wait';
import { energyNow } from '@/ui/trades';
import { BerriesPlay } from './berriesPlay';
import { HerdPlay } from './herdPlay';
import { GAME_SECONDS, LATE_SECONDS, shareOf, type Tally } from './rules';
import { Stage, type StageView } from './stage';

/** Сколько «Уйти» ждёт второго касания: столько же, сколько «Точно?» окна постройки (`next/Confirm`). */
const LEAVE_MS = 3000;

/** Что считает игра — подписью счёта и итога. */
const TALLY_WORDS: Record<MinigameId, { short: (t: Tally) => string; done: (t: Tally) => string }> = {
  berries: { short: (t) => `Ягод ${t.got}`, done: (t) => `Собрано ${t.got} из ${t.total}` },
  herd: { short: (t) => `Охапок ${t.got} из ${t.total}`, done: (t) => `Отдано охапок: ${t.got} из ${t.total}` },
};

/** Секунды отсчёта: «0:47». */
const clock = (left: number): string => `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

function HaulRow({ haul }: { haul: Haul }) {
  return (
    <>
      {RESOURCE_IDS.filter((r) => haul[r]).map((r) => (
        <span key={r} className="mg-res" aria-label={RESOURCE_META[r].name}>
          <Icon name={`res-${r}`} glyph={RESOURCE_META[r].icon} />
          {haul[r]}
        </span>
      ))}
    </>
  );
}

export function Minigame({ game, onExit }: { game: MinigameId; onExit: () => void }) {
  const def = MINIGAME_BY_ID[game];
  const wrapRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  // Зерно и «до N» — на входе: раскладка не меняется посреди игры, что бы ни случилось с партией.
  const [seed] = useState(() => minigameSeed(useGame.getState().s, game));
  const [top] = useState(() => minigameHaul(useGame.getState().s, game, 1));
  const [view, setView] = useState<StageView | null>(null);
  const [result, setResult] = useState<Harvest | string | null>(null);
  const [hint, setHint] = useState(true);
  const [leave, setLeave] = useState(false);
  const s = useGame((g) => g.s);
  const now = energyNow();
  const ready = canPlay(s, now);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'mg-canvas';
    wrap.prepend(canvas);
    const play = game === 'berries' ? new BerriesPlay(seed) : new HerdPlay(seed);
    const stage = new Stage(canvas, play, GAME_SECONDS[game], seasonOf(useGame.getState().s.time));
    stageRef.current = stage;
    stage.onView = setView;
    stage.stickEl = stickRef.current;
    stage.meterEl = meterRef.current;
    // Время вышло — итог: трата и добыча одним вызовом двери.
    stage.onEnd = (tally) => {
      let out: Harvest | string = 'Энергии не хватает';
      const g = useGame.getState();
      const ok = g.act((st) => {
        const r = harvest(st, game, energyNow(), shareOf(tally));
        if (typeof r === 'string') return r;
        out = r;
        return null;
      });
      if (ok) g.save();
      setResult(out);
    };
    setView(stage.snapshot());
    if (probe()) (window as unknown as { __mini?: Stage }).__mini = stage;
    const drop = (): void => setHint(false);
    canvas.addEventListener('pointerdown', drop, { once: true });
    const onResize = (): void => stage.resize();
    const ro = new ResizeObserver(onResize);
    ro.observe(wrap);
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', drop);
      stage.onView = null;
      stage.onEnd = null;
      stage.stickEl = null;
      stage.meterEl = null;
      stage.dispose();
      canvas.remove();
      stageRef.current = null;
    };
  }, [game, seed]);

  // «Уйти» ждёт второго касания три секунды.
  useEffect(() => {
    if (!leave) return;
    const t = setTimeout(() => setLeave(false), LEAVE_MS);
    return () => clearTimeout(t);
  }, [leave]);

  const phase = view?.phase ?? 'brief';
  const words = TALLY_WORDS[game];
  const meter = probe() || new URLSearchParams(window.location.search).has('fps');

  return (
    <div className="mg" ref={wrapRef}>
      <div className="mg-stick" ref={stickRef} aria-hidden="true">
        <i />
      </div>
      {meter && <div className="mg-meter" ref={meterRef} />}

      {phase === 'play' && view && (
        <>
          <div className="mg-top">
            <span className={`mg-chip mg-clock${view.left <= LATE_SECONDS ? ' late' : ''}`}>{clock(view.left)}</span>
            <span className="mg-chip">
              <Icon name={`mini-${game}`} glyph={def.glyph} />
              {words.short(view.tally)}
            </span>
            <span className="mg-grow" />
            <button
              className={`mg-leave${leave ? ' armed' : ''}`}
              onClick={() => {
                if (!leave) return setLeave(true);
                onExit();
              }}
            >
              {leave ? 'Точно?' : 'Уйти'}
            </button>
          </div>
          {view.note && <div className="mg-note">{view.note}</div>}
          <div className="mg-bottom">
            {view.verb ? <span className="mg-chip mg-verb">Нажми — {view.verb.toLowerCase()}</span> : hint && <span className="mg-hint">Слева шаг, справа взгляд</span>}
          </div>
        </>
      )}

      {phase === 'brief' && (
        <div className="mg-card" role="dialog" aria-label={def.name}>
          <div className="mg-head">
            <span className="mg-ico">
              <Icon name={`mini-${game}`} glyph={def.glyph} />
            </span>
            <b>{def.name}</b>
          </div>
          <p>{def.goal}</p>
          <div className="mg-facts">
            <span className="mg-res" aria-label="Время">
              <Icon name="ui-time" glyph="⏳" />
              {realSpanText(GAME_SECONDS[game])}
            </span>
            <span className="mg-res mg-muted">до</span>
            <HaulRow haul={top} />
            <span className="mg-res mg-muted" aria-label="Энергия">
              <Icon name="ui-energy" glyph="✋" />
              {MINIGAME_COST}
            </span>
          </div>
          {!ready && <small className="mg-why">Энергии хватит через {realSpanText(Math.ceil(energyReadyIn(s, now) / 1000))}</small>}
          <div className="mg-actions">
            <button className="mg-back" onClick={onExit}>
              Назад
            </button>
            <button className="mg-go" disabled={!ready} onClick={() => stageRef.current?.begin()}>
              Начать
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && view && (
        <div className="mg-card" role="dialog" aria-label="Итог">
          <div className="mg-head">
            <span className="mg-ico">
              <Icon name={`mini-${game}`} glyph={def.glyph} />
            </span>
            <b>{words.done(view.tally)}</b>
          </div>
          {result && typeof result !== 'string' && (
            <>
              <div className="mg-facts">
                <span className="mg-res mg-muted">На склад</span>
                {Object.keys(result.stored).length > 0 ? <HaulRow haul={result.stored} /> : <span className="mg-res">ничего</span>}
              </div>
              {RESOURCE_IDS.some((r) => (result.stored[r] ?? 0) < (result.got[r] ?? 0)) && <small className="mg-why">Склад полон: легло не всё</small>}
              <small className="mg-muted">
                Энергия {result.energy} из {ENERGY_MAX}
              </small>
            </>
          )}
          {typeof result === 'string' && <small className="mg-why">{result}: добыча не засчитана</small>}
          <div className="mg-actions">
            <button className="mg-go" onClick={onExit}>
              В город
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
