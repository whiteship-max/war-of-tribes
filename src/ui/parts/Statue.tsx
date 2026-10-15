import { useGame } from '@/game/store';
import { payGraceDays } from '@/game/derived';
import { seated } from '@/game/sim/agents';
import { MusterLink } from './Muster';
import { AgentCard } from './AgentCard';
import { Lineage } from './Lineage';
import { waitDays } from './wait';

/**
 * Статуя Героя — дом военачальников. Морали она не даёт нарочно — их в посёлке уже
 * четыре источника; она даёт племени имя. Здесь сколько терпит войско, которому не
 * заплатили или которое нечем кормить, кто полководец сейчас — та же карточка, что в
 * «Походах», с уровнем, чертами и вещами, — и кто водил дружину до него. Прогноза
 * «насколько он усилит бой» нет, как и везде. Людей из ниоткуда герой в бой не приводит
 * (поставка 1 боя, docs/battle_eu4.md, 14.19.6): его вклад — отметки полководца по уровню.
 *
 * Потолка дружины у Статуи больше нет: войско держит цена (`data/upkeep.ts`). Главное
 * число здания теперь — терпение, верность полководцу: сколько игровых дней у вождя,
 * чтобы заплатить или накормить, прежде чем люди начнут уходить.
 */
export function Statue() {
  const s = useGame((g) => g.s);
  const here = seated(s, 'general');

  return (
    <>
      <h3>Полководец</h3>
      <div className="mod total">
        <span className="ico">⚔️</span>
        <span className="name">
          Дружина терпит
          <em className="sub">без жалованья и еды</em>
        </span>
        <span className="val pos">{waitDays(payGraceDays(s))}</span>
      </div>
      {/* Герой и полководец на карте — один человек. Сколько он уводит и чего стоит
          сам, решает Статуя; уровень, отметки и черты — его, и карточка у него одна:
          та же, что в «Походах», без кнопки возврата и без строк Статуи. */}
      {here ? (
        <AgentCard id="general" embedded />
      ) : (
        <div className="note">Полководца нет, и дружина не выходит из города. Найми его ниже.</div>
      )}

      {/* Кто с полководцем — передача в «Дружине», одна на всю игру (docs/retinue.md, docs/ui_v2.md, 5.3): здесь строка-вход. */}
      {here && <MusterLink />}

      <Lineage id="general" />
    </>
  );
}
