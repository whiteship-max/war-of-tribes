// Родословная: правитель, наследник, очки трёх видов и книга дома.
//
// Своего счёта здесь нет ни строки — это то же правило, по которому живёт карточка
// агента. Возраст и срок до покоя считает `sim/dynasty` теми же часами и той же формулой,
// что возраст агента; очки — `sim/points`, единственная дверь; книга — тот же `Lineage`,
// что стоит в карточке полководца, только другим местом. Вещи — только здесь (ДР-7): `sim/dynasty.wear`.
//
// Одна строка здесь обязательна, и она про будущее: **при смене правителя меняются
// только навыки, а очки и изученное остаются.** Игрок должен знать это до смерти
// правителя, а не после неё (docs/dynasty.md, раздел 7.1).
import { useGame } from '@/game/store';
import { BRANCH_NAME, POINTS_CAP, REALM_BRANCHES, SKILL_NAME } from '@/game/data/realm';
import { RETIRE_AGE } from '@/game/data/agents';
import { circlesText } from '@/game/sim/agents';
import { gearOf, rulerAge, rulerAging, rulerYears, wear } from '@/game/sim/dynasty';
import { itemIn } from '@/game/data/items';
import { ownedItems } from '@/net/owned';
import { branchRate, pointsOf } from '@/game/sim/points';
import { Lineage } from '@/ui/parts/Lineage';
import { count } from '@/ui/parts/plural';
import { Icon } from '@/ui/icons/Icon';
import { BRANCH_ICON } from './branches';

export function RulerTab() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const showToast = useGame((g) => g.showToast);
  const r = s.realm;
  const owned = ownedItems();
  const gear = gearOf(s);
  // Сундук — владение (`net/owned.ts`) без надетого: снятое ложится туда.
  const chest = owned.filter((x) => !gear.includes(x)).length;
  const years = rulerYears(s);
  const toRest = Math.max(0, RETIRE_AGE - rulerAge(s));

  return (
    <>
      <div className="panel">
        <h3>Правитель</h3>
        <div className="mod total">
          <span className="ico"><Icon name="ui-crown" /></span>
          <span className="name">{r.ruler.name ?? 'Без имени'}</span>
          <span className={`val${rulerAging(s) ? ' neg' : ''}`}>
            {count(years, 'год', 'года', 'лет')}
          </span>
        </div>
        <div className="note">
          {toRest > 0
            ? `В ${RETIRE_AGE} лет оставит правление наследнику.`
            : 'Правление вот-вот перейдёт наследнику.'}
        </div>

        {REALM_BRANCHES.map((b) => (
          <div className="mod" key={b}>
            <span className="ico">
              <Icon name={BRANCH_ICON[b]} />
            </span>
            <span className="name">
              {BRANCH_NAME[b]}
              <em className="sub">навык</em>
            </span>
            <span className="val pos">{circlesText(r.ruler.skills[b])}</span>
          </div>
        ))}
      </div>

      {/* Вещи — только на правителе (ДР-7, docs/city_v3.md, «Решения ДР-7»): места у престола, наследник садится в тех же. */}
      <div className="panel">
        <h3>Вещи</h3>
        <div className="totem-row">
          {gear.map((slot, i) => {
            const st = itemIn(slot, owned);
            const label =
              st.kind === 'empty' ? 'пусто' : st.kind === 'unknown' ? 'неизвестная вещь' : st.kind === 'unowned' ? `${st.def.name}, не действует` : st.def.name;
            return (
              <button
                key={i}
                onClick={() => {
                  // Снять — в сундук; надеть — из сундука.
                  if (st.kind !== 'empty') return act((g) => wear(g, i, null, owned));
                  showToast(chest === 0 ? 'Сундук пуст: надеть нечего.' : 'Выбери, что надеть.');
                }}
              >
                <span className="ico">
                  <Icon name="attn-slot" />
                </span>
                <span style={{ color: 'var(--muted)' }}>{label}</span>
              </button>
            );
          })}
        </div>
        <div className="note">Вещи надевают только на правителя: агенты служат без них. Снятое ложится в сундук — {chest === 0 ? 'сейчас он пуст' : count(chest, 'вещь', 'вещи', 'вещей')}.</div>
      </div>

      <div className="panel">
        <h3>Очки</h3>
        <div className="note">Навык правителя и советник совета каждый день приносят очки своего вида, до {POINTS_CAP}.</div>
        {REALM_BRANCHES.map((b) => {
          const have = pointsOf(s, b);
          // Ставка вида — правитель и советник совета Ратуши под потолком лучшего правителя (РТ-1, `branchRate`).
          const rate = branchRate(s, b);
          const full = have >= POINTS_CAP;
          return (
            <div className="mod" key={b}>
              <span className="ico">
                <Icon name={BRANCH_ICON[b]} />
              </span>
              <span className="name">
                {BRANCH_NAME[b]}
                <em className="sub">{rate > 0 ? `+${rate} в день` : 'приток нулевой'}</em>
              </span>
              <span className={`val${full ? ' neg' : ' pos'}`}>
                {Math.floor(have)} из {POINTS_CAP}
                {full ? ' · полно' : ''}
              </span>
            </div>
          );
        })}
        {/* Прежде здесь стояло «Технологии ещё не построены» — неправда с тех пор, как вкладка есть. */}
        <div className="note">Очки тратятся на технологии.</div>
      </div>

      <div className="panel">
        <h3>Наследник</h3>
        <div className="mod total">
          <span className="ico"><Icon name="faith-pagan" /></span>
          <span className="name">{r.heir.name ?? 'Без имени'}</span>
          <span className="val">ждёт своего часа</span>
        </div>
        <div className="note">
          Навыки:{' '}
          {REALM_BRANCHES.map((b) => `${SKILL_NAME[b]} ${r.heir.skills[b]}`).join(', ')}.
        </div>
        <div className="note">При смене правителя меняются только навыки. Очки и изученное остаются.</div>
      </div>

      <div className="panel">
        <Lineage id="ruler" />
      </div>
    </>
  );
}
