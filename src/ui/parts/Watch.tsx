import { useGame } from '@/game/store';
import { SURVEY_MAX, SURVEY_STEPS } from '@/game/data/survey';
import { cancelSurvey, startSurvey, surveyInfo } from '@/game/sim/actions';
import { Cost } from './Cost';

/**
 * Дозор: изучение округи. Десять ступеней, каждая раскрывает вокруг деревни
 * радиус терра инкогнита и оставляет его открытым навсегда.
 *
 * Правило, которое обязано быть видно словами, а не догадкой: **изученная земля
 * не даёт живого обзора**. Она показывает, что там лежит, но не что там
 * происходит, — за живыми данными идут лазутчик и деревенский круг.
 *
 * Уровень Дозора — потолок ступени, и недоступная ступень не прячется, а стоит
 * в списке с причиной: игрок обязан видеть, чего ему не хватает.
 */
export function Watch() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const info = surveyInfo(s);

  return (
    <>
      <h3>
        Изучение округи <span className="muted">ступеней: {info.done} из {SURVEY_MAX}</span>
      </h3>
      <div className="note">
        Разъезды описывают землю за кругом деревни и оставляют её на грамоте навсегда.
        Наблюдения это не даёт: изученная округа показывает, что там лежит, а не что там
        происходит — за этим лазутчик.
      </div>

      <div className="mod total">
        <span className="ico">🗺️</span>
        <span className="name">Открыто вокруг деревни</span>
        <span className="val pos">{info.radius > 0 ? `${info.radius} клеток` : 'только свой круг'}</span>
      </div>

      {info.running ? (
        <div className="card">
          <div className="ico">🐎</div>
          <div className="body">
            <div className="title">
              Ступень {info.running.n}: {info.running.radius} клеток
              <span className="count">~{Math.ceil(info.left)} с</span>
            </div>
            <div className="desc">
              Разъезды в поле. Дозор занят: следующую ступень не начать, пока не вернутся.
            </div>
            <div className="progress">
              <div style={{ width: `${Math.floor(info.progress * 100)}%` }} />
            </div>
          </div>
          <button
            className="btn ghost"
            onClick={() => act((st) => cancelSurvey(st))}
            aria-label="Отозвать разъезды"
          >
            ✕
          </button>
        </div>
      ) : info.next ? (
        <div className="upgrade">
          <Cost cost={info.next.cost} work={info.next.seconds} eta={info.next.seconds} />
          <button
            className="btn wide"
            data-tut="survey-start"
            disabled={info.blocked !== null}
            onClick={() => act((st) => startSurvey(st))}
          >
            Изучить ступень {info.next.n} — {info.next.radius} клеток
          </button>
          <div className="hint">{info.blocked ?? info.next.effect}</div>
        </div>
      ) : (
        <div className="note">Округа изучена вся — дальше только своими глазами.</div>
      )}

      <h3>Ступени</h3>
      {SURVEY_STEPS.map((step) => {
        const done = step.n <= info.done;
        const now = info.running?.n === step.n;
        const locked = step.n > info.level;
        return (
          <div className={`card as-row${done ? ' done' : ''}`} key={step.n}>
            <div className="ico">{done ? '✅' : now ? '🐎' : locked ? '🔒' : '·'}</div>
            <div className="body">
              <div className="title">
                Ступень {step.n}
                <span className="count">{step.radius} клеток</span>
              </div>
              <div className="desc">
                {done
                  ? step.effect
                  : locked
                    ? `Нужен Дозор ${step.n} уровня — сейчас ${info.level}.`
                    : `${step.seconds} с разъездов.`}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
