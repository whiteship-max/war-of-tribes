import { useGame } from '@/game/store';
import { DECREES, RATIONS, TAXES } from '@/game/data/policy';
import {
  ERA_META,
  decreeOf,
  eraProgress,
  hasGold,
  rationOf,
  stageProgress,
  taxIncomePerDay,
  taxOf,
} from '@/game/derived';
import { setDecree, setRation, setTax } from '@/game/sim/actions';

/**
 * Внутренности Дома вождя: где племя находится по эпохам и чем вождь правит.
 *
 * Эпоха живёт только здесь: в строке состояния её нет, там стадия поселения.
 * Указ и рацион переключаются в любой момент и действуют, пока выбраны, поэтому
 * последствия написаны прямо на кнопке — выбор делают, уже зная цену.
 */
export function ChiefHouse() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const era = eraProgress(s);
  const stage = stageProgress(s);
  const decree = decreeOf(s);
  const ration = rationOf(s);
  const tax = taxOf(s);
  const meta = ERA_META[era.era];

  return (
    <>
      <h3>Эпоха</h3>
      <div className="mod total">
        <span className="ico">{meta.icon}</span>
        <span className="name">{meta.name}</span>
        <span className="val">
          {era.next ? `→ ${ERA_META[era.next].short}` : 'предел'}
        </span>
      </div>
      {era.next ? (
        <>
          <div className="note">
            Эпоха двигается знаниями, а не числом дворов. Она поднимает потолок уровней
            построек и меняет, из чего их складывают.
          </div>
          {era.need.map((t) => (
            <div className={`mod${t.done ? '' : ' pending'}`} key={t.id}>
              <span className="ico">{t.done ? '✅' : t.icon}</span>
              <span className="name">{t.name}</span>
              <span className="val">{t.done ? 'изучено' : 'нужно изучить'}</span>
            </div>
          ))}
        </>
      ) : (
        <div className="note">Выше некуда: племя дошло до раннего государства.</div>
      )}

      <h3>
        Поселение <span className="muted">{stage.stage.name}</span>
      </h3>
      {stage.next ? (
        <>
          <div className="note">До стадии «{stage.next.name}» не хватает:</div>
          {stage.need.map((r) => (
            <div className={`mod${r.ok ? '' : ' pending'}`} key={r.label}>
              <span className="ico">{r.ok ? '✅' : r.icon}</span>
              <span className="name">{r.label}</span>
              <span className={`val${r.ok ? ' pos' : ''}`}>
                {Math.floor(r.have)} / {r.need}
              </span>
            </div>
          ))}
        </>
      ) : (
        <div className="note">{stage.stage.description}</div>
      )}

      <h3>Указ вождя</h3>
      <div className="choice">
        {DECREES.map((d) => (
          <button
            key={d.id}
            className={`choice-opt${decree.id === d.id ? ' on' : ''}`}
            onClick={() => act((st) => setDecree(st, d.id))}
          >
            <span className="ico">{d.icon}</span>
            <b>{d.name}</b>
            <small>{d.effect}</small>
          </button>
        ))}
      </div>

      <h3>Рацион</h3>
      <div className="choice">
        {RATIONS.map((r) => (
          <button
            key={r.id}
            className={`choice-opt${ration.id === r.id ? ' on' : ''}`}
            onClick={() => act((st) => setRation(st, r.id))}
          >
            <span className="ico">{r.icon}</span>
            <b>{r.name}</b>
            <small>{r.effect}</small>
          </button>
        ))}
      </div>

      {/* Налог и казна появляются вместе с торгом: до него денег в игре нет. */}
      {hasGold(s) && (
        <>
          <h3>
            Казна <span className="muted">+{taxIncomePerDay(s).toFixed(1)} в день</span>
          </h3>
          <div className="mod total">
            <span className="ico">💰</span>
            <span className="name">Золото</span>
            <span className="val pos">{Math.floor(s.gold)}</span>
          </div>
          <div className="note">
            Сбор идёт с людей и зависит от того, насколько вырос посёлок: город даёт с человека
            вшестеро больше лагеря. Платит за это мораль, а низкая мораль режет всю выработку —
            высокий налог выгоден в короткую, а не как уклад.
          </div>

          <h3>Налог</h3>
          <div className="choice">
            {TAXES.map((t) => (
              <button
                key={t.id}
                className={`choice-opt${tax.id === t.id ? ' on' : ''}`}
                onClick={() => act((st) => setTax(st, t.id))}
              >
                <span className="ico">{t.icon}</span>
                <b>{t.name}</b>
                <small>{t.effect}</small>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
