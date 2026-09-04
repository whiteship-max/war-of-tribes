// Схема боя на телефоне. Перетаскивания здесь нет нарочно: на 390 px внутри
// шторки оно дерётся со скроллом и промахивается мимо сектора. Тап по сектору
// открывает выбор — какие войска и сколько туда поставить.
import { FRONT, REAR, type Sector } from '@/battle';
import { TROOP_IDS, TROOP_BY_ID } from '@/game/data/troops';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import type { Formation } from '@/game/battle/formation';

/** Короткие подписи: на треть экрана «левый фланг» не влезает. */
const SHORT: Record<Sector, string> = {
  A: 'Лев. фланг',
  B: 'Центр',
  C: 'Прав. фланг',
  D: 'Лев. тыл',
  E: 'Тыл центра',
  F: 'Прав. тыл',
  R: 'Резерв',
};

/** Состав клетки значками: «🔱6 🏹2». Пусто — прочерк. */
export function StackLine({ troops }: { troops: TroopStack }) {
  const parts = TROOP_IDS.filter((t) => (troops[t] ?? 0) > 0);
  if (parts.length === 0) return <i className="bf-empty">пусто</i>;
  return (
    <span className="bf-stack">
      {parts.map((t) => (
        <em key={t}>
          {TROOP_BY_ID[t].icon}
          {troops[t]}
        </em>
      ))}
    </span>
  );
}

interface Props {
  formation: Formation;
  /** Нерасставленные — их видно отдельно, чтобы половина армии не пропала по недосмотру. */
  unplaced: TroopStack;
  selected: Sector | 'rest' | null;
  onSelect: (id: Sector | 'rest') => void;
}

function Cell({
  id,
  troops,
  selected,
  onSelect,
  wide,
}: {
  id: Sector | 'rest';
  troops: TroopStack;
  selected: boolean;
  onSelect: (id: Sector | 'rest') => void;
  wide?: boolean;
}) {
  const n = troopTotal(troops);
  return (
    <button
      className={`bf-cell${selected ? ' on' : ''}${wide ? ' wide' : ''}${n === 0 ? ' empty' : ''}`}
      data-tut={`sector-${id}`}
      onClick={() => onSelect(id)}
    >
      <span className="bf-name">
        {id === 'rest' ? 'Не расставлены' : SHORT[id as Sector]}
        <b>{n}</b>
      </span>
      <StackLine troops={troops} />
    </button>
  );
}

export function FormationGrid({ formation, unplaced, selected, onSelect }: Props) {
  const rest = troopTotal(unplaced);
  return (
    <div className="bf">
      <div className="bf-foe">↑ противник</div>
      <div className="bf-row">
        {FRONT.map((id) => (
          <Cell key={id} id={id} troops={formation.sectors[id]} selected={selected === id} onSelect={onSelect} />
        ))}
      </div>
      <div className="bf-row">
        {REAR.map((id) => (
          <Cell key={id} id={id} troops={formation.sectors[id]} selected={selected === id} onSelect={onSelect} />
        ))}
      </div>
      <Cell id="R" troops={formation.sectors.R} selected={selected === 'R'} onSelect={onSelect} wide />
      {rest > 0 && (
        <>
          <Cell id="rest" troops={unplaced} selected={selected === 'rest'} onSelect={onSelect} wide />
          <p className="note bad">
            {rest} {rest === 1 ? 'боец не расставлен' : 'бойцов не расставлено'}. Тапни по ним, чтобы убрать
            в резерв, — иначе они уйдут туда сами при отправке.
          </p>
        </>
      )}
      <p className="note">
        Полосы слева направо — со стороны своего строя. Копья держат линию только во фронте; тыл прикрывает
        лучников.
      </p>
    </div>
  );
}
