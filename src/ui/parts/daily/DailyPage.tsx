import { useEffect, useRef, useState } from 'react';
import { useGame } from '@/game/store';
import { RESOURCE_META } from '@/game/constants';
import { DAILY_GAME_BY_ID, dayIndex, untilNextDay } from '@/game/data/daily';
import { dailyReward, dailyStatus } from '@/game/sim/daily';
import { finishDaily, startDaily } from '@/game/sim/actions';
import { Social } from '../Social';
import { Archery } from './Archery';
import { Maze } from './Maze';
import { Quiz } from './Quiz';

/**
 * Вторая страница «Заданий»: сперва ежедневная мини-игра, потом социальные
 * подписки, потом приглашение — в этом порядке, потому что игра единственное
 * здесь, что игрок делает, а остальное он читает один раз.
 *
 * Календарный день берётся у настоящих часов ровно здесь, на границе. Внутрь
 * симуляции он уходит числом: `tick` про ежедневку не знает, и от этого она не
 * ломает ни детерминированность, ни офлайн-догон.
 */
export function DailyPage() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const [playing, setPlaying] = useState(false);
  const [result, setResult] = useState<boolean | null>(null);
  const arena = useRef<HTMLDivElement>(null);

  // Доска встаёт под шапку панели, а игроку нужно видеть её целиком и сразу: у
  // лабиринта тридцать секунд, и первые из них не должны уйти на прокрутку.
  //
  // Через два кадра, а не сразу: в момент, когда эффект срабатывает, сама игра
  // ещё не разметилась, и прокрутка «к началу» пустого места ничего не даёт —
  // доска появляется уже под нижним краем экрана. Плавную прокрутку тоже нельзя:
  // пока она едет, игрок уже тапает, а доска под пальцем движется.
  useEffect(() => {
    if (!playing) return;
    const show = (): void => {
      const el = arena.current;
      const box = el?.closest('.sheet-body');
      if (!el || !box) return;
      // Прокручиваем саму шторку на разницу верхних краёв, а не зовём
      // scrollIntoView: он у шторки не срабатывает — она сама едет трансформом,
      // и браузер считает, что элемент уже виден.
      box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    };
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(show);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const now = Date.now();
  const day = dayIndex(now);
  const st = dailyStatus(s, day);
  const def = DAILY_GAME_BY_ID[st.game];
  const reward = dailyReward(s, st.game);

  const begin = (): void => {
    setResult(null);
    if (act((g) => startDaily(g, day))) setPlaying(true);
  };

  // Итог уходит в симуляцию, и она же решает, давать ли награду: кнопке здесь не
  // верят — без начатой попытки итог не принимается, и второй раз за день не
  // выиграть, сколько ни перезагружай страницу.
  //
  // Игра при этом остаётся на экране. Убирать её сразу нельзя: у викторины вместе
  // с ней исчез бы разбор из журнала боя — то единственное, ради чего она вообще
  // учит кольцу контрров, — у лабиринта пропали бы точки короткого пути, а у
  // стрельбы итоговый счёт. Игрок закроет её сам, прочитав.
  const done = (won: boolean): void => {
    act((g) => finishDaily(g, day, won));
    setResult(won);
  };

  return (
    <>
      <h3>
        Задание дня <span className="muted">до нового {hoursLeft(now)}</span>
      </h3>

      {/* Пока игра идёт, карточка с правилами убрана: правила уже прочитаны, а
          доска лабиринта — 308 px, и вместе они не помещаются в свёрнутую
          шторку на 375×812. Игрок оказался бы перед наполовину видимым полем. */}
      {!playing && (
        <div className="card">
          <div className="ico">{def.icon}</div>
          <div className="body">
            <div className="title">{def.name}</div>
            <div className="desc">{def.rules}</div>
            <div className="cost">
              <span style={{ color: 'var(--muted)' }}>Награда:</span>
              {(Object.keys(reward) as (keyof typeof reward)[]).map((r) => (
                <span key={r}>
                  {RESOURCE_META[r].icon} {reward[r]}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {playing ? (
        <div ref={arena}>
          <Game game={st.game} seed={st.seed} onDone={done} />
          {result !== null && (
            <>
              <div className={`mg-result ${result ? 'good' : 'bad'}`}>
                {result
                  ? 'Взято. Награда уже на складе, новое задание — завтра.'
                  : 'Не вышло. Попытка одна в сутки: завтра будет другая игра.'}
              </div>
              <button className="btn ghost wide" onClick={() => setPlaying(false)}>
                Закрыть
              </button>
            </>
          )}
        </div>
      ) : st.won ? (
        <div className="mg-result good">Задание выполнено, награда на складе. Новое — завтра.</div>
      ) : st.played ? (
        <div className="mg-result bad">
          Сегодня не вышло. Попытка одна в сутки — приходи завтра, задание будет другое.
        </div>
      ) : (
        <>
          <button className="btn wide" onClick={begin}>
            Взяться за дело
          </button>
          <div className="note">
            Одна попытка в сутки. Уйдёшь с экрана посреди игры — попытка сгорит. Задание сегодня
            одно у всех племён.
          </div>
        </>
      )}

      <Social />
    </>
  );
}

function Game({
  game,
  seed,
  onDone,
}: {
  game: 'archery' | 'quiz' | 'maze';
  seed: number;
  onDone: (won: boolean) => void;
}) {
  if (game === 'archery') return <Archery seed={seed} onDone={onDone} />;
  if (game === 'maze') return <Maze seed={seed} onDone={onDone} />;
  return <Quiz seed={seed} onDone={onDone} />;
}

/** Сколько осталось до смены задания. Граница суток общая для всех — по UTC. */
function hoursLeft(now: number): string {
  const ms = untilNextDay(now);
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}
