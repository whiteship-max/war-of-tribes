import { useGame } from '@/game/store';
import { SURVEY_MAX, SURVEY_STEPS } from '@/game/data/survey';
import { cancelSurvey, startSurvey, surveyInfo } from '@/game/sim/actions';
import { surveySeconds } from '@/game/sim/survey';
import { Icon } from '@/ui/icons/Icon';
import { Cost } from './Cost';
import { count } from './plural';
import { waitShort } from './wait';

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
        Разведка округи <span className="muted">ур. {info.done} из {SURVEY_MAX}</span>
      </h3>
      {/* Сколько клеток уже разведано, стоит строкой «Округа разведана на» в общих данных здания выше (`BuildingPanel.GenericData`). */}
      <div className="note">Разведанная земля остаётся на карте навсегда. Что на ней происходит, видит лазутчик.</div>

      {info.running ? (
        <div className="card">
          <div className="ico">🐎</div>
          <div className="body">
            <div className="title">
              Ур. {info.running.n} · {count(info.running.radius, 'клетка', 'клетки', 'клеток')}
              <span className="count">~{waitShort(info.left)}</span>
            </div>
            <div className="desc">Разъезды в поле</div>
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
          <Cost
            cost={info.next.cost}
            work={surveySeconds(info.next, info.learning)}
            eta={surveySeconds(info.next, info.learning)}
          />
          <button
            className="btn wide"
            data-tut="survey-start"
            disabled={info.blocked !== null}
            onClick={() => act((st) => startSurvey(st))}
          >
            Разведать
          </button>
          <div className="hint">{info.blocked ?? info.next.effect}</div>
        </div>
      ) : (
        <div className="note">Вся округа разведана</div>
      )}

      <h3>Уровни разведки</h3>
      {SURVEY_STEPS.map((step) => {
        const done = step.n <= info.done;
        const now = info.running?.n === step.n;
        const locked = step.n > info.level;
        return (
          <div className={`card as-row${done ? ' done' : ''}`} key={step.n}>
            <div className="ico">{done ? '✅' : now ? '🐎' : locked ? '🔒' : '·'}</div>
            <div className="body">
              <div className="title">
                Ур. {step.n}
                <span className="count">{count(step.radius, 'клетка', 'клетки', 'клеток')}</span>
              </div>
              <div className="desc">
                {done ? (
                  step.effect
                ) : locked ? (
                  `Нужен Дозор ур. ${step.n}`
                ) : (
                  <>
                    <Icon name="ui-time" glyph="⏱" /> {waitShort(surveySeconds(step, info.learning))}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
