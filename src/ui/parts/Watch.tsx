import { useGame } from '@/game/store';
import { SURVEY_MAX, SURVEY_STEPS } from '@/game/data/survey';
import { cancelSurvey, startSurvey, surveyInfo } from '@/game/sim/actions';
import { surveySeconds } from '@/game/sim/survey';
import { Bar } from '@/ui/kit/Bar';
import { Table, type Col, type TableRow } from '@/ui/kit/Table';
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
 * в таблице с причиной: игрок обязан видеть, чего ему не хватает.
 *
 * Ход разведки — одной таблицей уровней (UI-8, Д11 и П7, docs/ui_v2.md, 5.7): прежде он стоял трижды — строкой «Округа
 * разведана на» в «Что даёт городу», заголовком «ур. N из 10» с карточкой разъездов и десятью карточками уровней. Теперь
 * в таблице видно, что пройдено, что идёт и что заперто; под ней — дело: разведать следующий уровень или отозвать разъезды.
 */
export function Watch() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const info = surveyInfo(s);

  return (
    <>
      <h3>Разведка округи</h3>
      <div className="note">Разведанная земля остаётся на карте навсегда. Что на ней происходит, видит лазутчик.</div>
      <Table label="Уровни разведки" cols={SURVEY_COLS} rows={surveyRows(info, SURVEY_STEPS)} />

      {info.running ? (
        <>
          <Bar
            value={Math.floor(info.progress * 100)}
            max={100}
            label={`Разъезды: ур. ${info.running.n}`}
            text={`~${waitShort(info.left)}`}
          />
          <button className="btn ghost wide" onClick={() => act((st) => cancelSurvey(st))}>
            Отозвать разъезды
          </button>
        </>
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
            Разведать ур. {info.next.n}
          </button>
          <div className="hint">{info.blocked ?? info.next.effect}</div>
        </div>
      ) : (
        <div className="note">Вся округа разведана — {SURVEY_MAX} из {SURVEY_MAX}.</div>
      )}
    </>
  );
}

const SURVEY_COLS: readonly Col[] = [
  { key: 'n', title: 'Ур.', w: '40px' },
  { key: 'r', title: 'Округа', align: 'right', w: '96px' },
  { key: 'state', title: 'Ход' },
];

type Info = ReturnType<typeof surveyInfo>;

/**
 * Строки таблицы уровней: каждая ступень — номер, радиус и где она: «пройдено» (касание — что дала), «идёт» со сроком,
 * срок следующей или «нужен Дозор ур. N». Чистая — её сверяет тест (`ui8.test.ts`).
 */
export function surveyRows(info: Info, steps: typeof SURVEY_STEPS): TableRow[] {
  return steps.map((step) => {
    const done = step.n <= info.done;
    const now = info.running?.n === step.n;
    const locked = step.n > info.level;
    const state = done ? '✅ пройдено' : now ? `🐎 идёт, ~${waitShort(info.left)}` : locked ? `🔒 Дозор ур. ${step.n}` : `⏱ ${waitShort(surveySeconds(step, info.learning))}`;
    return {
      key: String(step.n),
      cells: { n: step.n, r: count(step.radius, 'клетка', 'клетки', 'клеток'), state },
      tip: () => ({ title: `Разведка, ур. ${step.n}`, body: step.effect }),
      dim: locked && !done,
    };
  });
}
