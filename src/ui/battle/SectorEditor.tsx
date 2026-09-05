// Выбор состава сектора. Открывается тапом по клетке схемы и живёт прямо под
// ней: отдельная модалка поверх шторки означала бы третий слой на 375 px.
import { KIND_META, SECTOR_NAME, type Sector } from '@/battle';
import { TROOP_IDS, TROOP_BY_ID } from '@/game/data/troops';
import { KIND_OF, type TroopStack } from '@/game/battle/kinds';

interface Props {
  /** Куда ставим. 'rest' — общий мешок нерасставленных. */
  sector: Sector | 'rest';
  /** Сколько кого стоит здесь сейчас. */
  here: TroopStack;
  /** Сколько кого ещё не разложено — их и можно сюда добавить. */
  free: TroopStack;
  onChange: (troop: (typeof TROOP_IDS)[number], n: number) => void;
  onClose: () => void;
}

/** Заголовок с большой буквы: в журнале сектор пишется строчными, в шапке — нет. */
const SECTOR_TITLE: Record<Sector, string> = Object.fromEntries(
  (Object.keys(SECTOR_NAME) as Sector[]).map((id) => [
    id,
    SECTOR_NAME[id].charAt(0).toUpperCase() + SECTOR_NAME[id].slice(1),
  ]),
) as Record<Sector, string>;

/** Чем этот сектор занят в бою — одна строка, чтобы выбор не был вслепую. */
const ROLE: Record<Sector, string> = {
  A: 'Фланг. Ломается первым, если в нём нет пехоты-якоря.',
  B: 'Центр. Сюда бьёт «прямой натиск» и сюда входит резерв «если центр проигрывает».',
  C: 'Фланг. Ломается первым, если в нём нет пехоты-якоря.',
  D: 'Тыл. Лучники стреляют из-за строя; копья здесь сомкнуты со всех сторон.',
  E: 'Тыл центра. Лучники стреляют из-за строя.',
  F: 'Тыл. Лучники стреляют из-за строя; копья здесь сомкнуты со всех сторон.',
  R: 'Резерв. Входит по условию ниже — и это единственное, чего разведка врага не видит.',
};

export function SectorEditor({ sector, here, free, onChange, onClose }: Props) {
  const rows = TROOP_IDS.filter((t) => (here[t] ?? 0) > 0 || (free[t] ?? 0) > 0);
  return (
    <div className="bf-edit">
      <div className="bf-edit-head">
        <b>{sector === 'rest' ? 'Не расставлены' : SECTOR_TITLE[sector]}</b>
        <button className="mini text" onClick={onClose}>
          готово
        </button>
      </div>
      {sector !== 'rest' && <p className="note">{ROLE[sector]}</p>}
      {rows.length === 0 ? (
        <div className="desc">Свободных бойцов нет — забери их из другого сектора.</div>
      ) : (
        rows.map((t) => {
          const def = TROOP_BY_ID[t];
          const n = here[t] ?? 0;
          const max = n + (free[t] ?? 0);
          return (
            <div className="slot pick" key={t}>
              <span className="ico">{def.icon}</span>
              <span className="who">
                {def.name}
                <br />
                <i className="talent">
                  {KIND_META[KIND_OF[t]].name} · свободно {free[t] ?? 0}
                </i>
              </span>
              <div className="stepper">
                <button disabled={n <= 0} onClick={() => onChange(t, n - 1)}>
                  −
                </button>
                <span className="n">{n}</span>
                <button disabled={n >= max} onClick={() => onChange(t, n + 1)}>
                  +
                </button>
              </div>
              <button className="mini text" disabled={n >= max} onClick={() => onChange(t, max)}>
                все
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
