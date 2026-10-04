// Родословная: правитель, наследник, очки трёх видов и книга дома.
//
// Своего счёта здесь нет ни строки — это то же правило, по которому живёт карточка
// агента. Возраст и срок до покоя считает `sim/dynasty` теми же часами и той же формулой,
// что возраст агента; очки — `sim/points`, единственная дверь; книга — тот же `Lineage`,
// что стоит в Статуе, только другим местом.
//
// Одна строка здесь обязательна, и она про будущее: **при смене правителя меняются
// только навыки, а очки и изученное остаются.** Игрок должен знать это до смерти
// правителя, а не после неё (docs/dynasty.md, раздел 7.1).
import { useGame } from '@/game/store';
import { BRANCH_NAME, POINTS_CAP, REALM_BRANCHES, SKILL_NAME } from '@/game/data/realm';
import { RETIRE_AGE } from '@/game/data/agents';
import { circlesText, levelOfWord } from '@/game/sim/agents';
import { rulerAge, rulerAging, rulerRestAt, rulerYears } from '@/game/sim/dynasty';
import { pointsOf, rulerRate } from '@/game/sim/points';
import { Lineage } from '@/ui/parts/Lineage';
import { count } from '@/ui/parts/plural';
import { realLeft } from '@/ui/parts/wait';

export function RulerTab() {
  const s = useGame((g) => g.s);
  const r = s.realm;
  const years = rulerYears(s);
  const toRest = Math.max(0, RETIRE_AGE - rulerAge(s));

  return (
    <>
      <div className="panel">
        <h3>Правитель</h3>
        <div className="mod total">
          <span className="ico">👑</span>
          <span className="name">{r.ruler.name ?? 'Имени ещё нет'}</span>
          <span className={`val${rulerAging(s) ? ' neg' : ''}`}>
            {count(years, 'год', 'года', 'лет')}
          </span>
        </div>
        <div className="note">
          {toRest > 0
            ? `В ${RETIRE_AGE} лет оставит правление наследнику. Стареет только пока идут часы деревни: ${realLeft(Math.max(0, rulerRestAt(s) - s.time))} игрового времени.`
            : 'Дожил до покоя: правление вот-вот перейдёт наследнику.'}
        </div>

        {REALM_BRANCHES.map((b) => (
          <div className="mod" key={b}>
            <span className="ico">✦</span>
            <span className="name">
              {BRANCH_NAME[b]}
              <em className="sub">навык</em>
            </span>
            <span className="val pos">
              {circlesText(r.ruler.skills[b])} — {levelOfWord(r.ruler.skills[b])}
            </span>
          </div>
        ))}
      </div>

      <div className="panel">
        <h3>Очки</h3>
        <div className="note">
          Каждый кружок навыка даёт одно очко своего вида за игровой день. Копятся они сами, пока идут часы
          деревни, — и не дальше потолка: {POINTS_CAP} очков. Потолок не выбран, а выведен — столько даёт
          самый сильный правитель за сутки отлучки, ровно тот срок, который игра и так догоняет.
        </div>
        {REALM_BRANCHES.map((b) => {
          const have = pointsOf(s, b);
          const rate = rulerRate(s, b);
          const full = have >= POINTS_CAP;
          return (
            <div className="mod" key={b}>
              <span className="ico">◆</span>
              <span className="name">
                {BRANCH_NAME[b]}
                <em className="sub">{rate > 0 ? `+${rate} в игровой день` : 'приток нулевой'}</em>
              </span>
              <span className={`val${full ? ' neg' : ' pos'}`}>
                {Math.floor(have)} из {POINTS_CAP}
                {full ? ' · полно' : ''}
              </span>
            </div>
          );
        })}
        {/* Прежде здесь стояло «Технологии ещё не построены» — неправда с тех пор, как вкладка есть. */}
        <div className="note">Очки тратятся в «Технологиях».</div>
      </div>

      <div className="panel">
        <h3>Наследник</h3>
        <div className="mod total">
          <span className="ico">🌳</span>
          <span className="name">{r.heir.name ?? 'Имени ещё нет'}</span>
          <span className="val">ждёт своего часа</span>
        </div>
        <div className="note">
          Чего от него ждать, видно заранее:{' '}
          {REALM_BRANCHES.map((b) => `${SKILL_NAME[b]} ${r.heir.skills[b]}`).join(', ')}.
        </div>
        <div className="note">
          <b>При смене правителя меняются только навыки; очки и изученное остаются.</b> Держава не
          теряет ни одного накопленного очка и ни одной изученной ступени — меняется лишь то, с какой
          скоростью идут новые.
        </div>
      </div>

      <div className="panel">
        <Lineage id="ruler" />
      </div>
    </>
  );
}
