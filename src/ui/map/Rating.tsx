// Рейтинг игроков на карте (docs/rating.md): все игроки мира — место, город, очки, мощь, жители, победы и взятые
// города. Своя строка подсвечена; касание строки закрывает окно и наводит камеру на город (та же лупа, что у письма —
// `useWorld.spotlight`). Карта — потому что рейтинг про соседей по миру, и касание ведёт на неё же.
//
// Очки считает сервер (`/api/rating`); своих чисел здесь нет, веса в подсказке — из договора (`RATING_WEIGHTS`).
import { useEffect, useState } from 'react';
import { useWorld } from '@/world/store';
import { fetchRating, RATING_PULL_MS, type RatingRow } from '@/net/rating';
import { RATING_WEIGHTS, cityOr } from '../../../netlify/lib/contract';
import { Icon } from '@/ui/icons/Icon';
import { count } from '@/ui/parts/plural';
import { tipAt } from '@/ui/next/tip';
import { num } from '@/game/num';

/** Подсказка «откуда очки» — весами договора. */
export const RATING_TIP = {
  title: 'Очки рейтинга',
  body: `Мощь, плюс ${RATING_WEIGHTS.win} за победу в бою с игроком и ${RATING_WEIGHTS.taken} за взятый город. Считает сервер.`,
};

/** Вторая строка: из чего очки. */
export function rowFacts(r: RatingRow): string {
  return [`мощь ${num(r.power)}`, count(r.pop, 'житель', 'жителя', 'жителей'), count(r.won, 'победа', 'победы', 'побед'), count(r.taken, 'город взят', 'города взято', 'городов взято')].join(' · ');
}

export function Rating({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<RatingRow[] | null>(null);
  const [why, setWhy] = useState('');

  useEffect(() => {
    let live = true;
    const pull = async (): Promise<void> => {
      const got = await fetchRating();
      if (!live) return;
      if (got.ok) {
        setRows(got.rows);
        setWhy('');
      } else setWhy(got.why);
    };
    void pull();
    const timer = setInterval(() => void pull(), RATING_PULL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const show = (r: RatingRow): void => {
    onClose();
    useWorld.setState({ spotlight: { x: r.x, y: r.y } });
  };

  return (
    <div className="wm-rating" role="dialog" aria-label="Рейтинг">
      <div className="wm-rhead">
        <b>Рейтинг</b>
        <button className="wm-rbtn" onClick={(e) => tipAt(e.currentTarget, RATING_TIP)} aria-label="Откуда очки">
          <Icon name="ui-info" glyph="ℹ️" />
        </button>
        <button className="wm-rbtn" onClick={onClose} aria-label="Закрыть">
          <Icon name="ui-close" glyph="✕" />
        </button>
      </div>
      {why && <div className="nx-stale">{why}</div>}
      {rows === null && !why && <div className="wm-rnone">Считаем…</div>}
      {rows !== null && rows.length === 0 && <div className="wm-rnone">В мире пока нет городов.</div>}
      {rows?.map((r) => (
        <button key={r.id} className={`wm-rrow${r.mine ? ' mine' : ''}`} onClick={() => show(r)}>
          <span className="wm-rplace">{r.place}</span>
          <span className="wm-rwho">
            <span className="one-line">
              <b>{cityOr(r.city)}</b>
              {r.name && <i> · {r.name}</i>}
            </span>
            <small>{rowFacts(r)}</small>
          </span>
          <span className="wm-rpts">{num(r.points)}</span>
        </button>
      ))}
    </div>
  );
}
