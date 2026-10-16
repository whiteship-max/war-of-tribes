// Рейтинг игроков на карте (docs/rating.md): все игроки мира — место, город, очки, мощь, жители, победы и взятые
// города — таблицей, числа столбцами (UI-7, docs/ui_v2.md, 5.6; П11). Своя строка подсвечена; касание строки — разбор
// очков (веса договора) и дверь «На карте»: она закрывает окно и наводит камеру на город (та же лупа, что у письма —
// `useWorld.spotlight`). Карта — потому что рейтинг про соседей по миру, и дверь ведёт на неё же.
//
// Очки считает сервер (`/api/rating`); своих чисел здесь нет, веса в подсказке — из договора (`RATING_WEIGHTS`).
import { useEffect, useState } from 'react';
import { ratingCard } from '@/ui/share/shareCard';
import { ShareSheet } from '@/ui/share/ShareSheet';
import { useWorld } from '@/world/store';
import { fetchRating, RATING_PULL_MS, type RatingRow } from '@/net/rating';
import { RATING_WEIGHTS, cityOr } from '../../../netlify/lib/contract';
import { Icon } from '@/ui/icons/Icon';
import { count } from '@/ui/parts/plural';
import { shortNum } from '@/ui/parts/shortNum';
import { Table, type Col } from '@/ui/kit/Table';
import { breakdown } from '@/ui/kit/breakdown';
import { tipAt, type TipContent } from '@/ui/next/tip';
import { num } from '@/game/num';
import { armsOr } from '@/heraldry/arms';
import { ArmsArt } from '@/ui/parts/Arms';

/** Подсказка «откуда очки» — весами договора. */
export const RATING_TIP = {
  title: 'Очки рейтинга',
  body: `Мощь, плюс ${RATING_WEIGHTS.win} за победу над соседом и ${RATING_WEIGHTS.taken} за взятый город.`,
};

/** Столбцы рейтинга (UI-7, docs/ui_v2.md, 5.6; П11): числа строки — столбцами, а не строкой через точки. */
export const RATING_COLS: readonly Col[] = [
  { key: 'place', title: '#', align: 'right', w: '24px' },
  { key: 'city', title: 'Город' },
  { key: 'points', title: 'Очки', align: 'right', w: '44px' },
  { key: 'power', title: 'Мощь', align: 'right', w: '44px' },
  { key: 'pop', title: 'Жит.', align: 'right', w: '36px' },
  { key: 'won', title: 'Поб.', align: 'right', w: '30px' },
  { key: 'taken', title: 'Взято', align: 'right', w: '36px' },
];

/**
 * Очки строки с разбором — весами договора (`RATING_WEIGHTS`, та же формула, что у сервера, `ratingPoints`): мощь, победы и
 * взятые города складываются в очки; итог — число сервера. Внизу — дверь к городу на карте.
 */
export function pointsTip(r: RatingRow, show: () => void): TipContent {
  return breakdown({
    title: `${r.place}. ${cityOr(r.city)}${r.name ? ` · ${r.name}` : ''}`,
    body: `${count(r.pop, 'житель', 'жителя', 'жителей')}.`,
    total: r.points,
    parts: [
      { label: 'Мощь', value: r.power * RATING_WEIGHTS.power },
      { label: `Победы: ${r.won} × ${RATING_WEIGHTS.win}`, value: r.won * RATING_WEIGHTS.win },
      { label: `Взято городов: ${r.taken} × ${RATING_WEIGHTS.taken}`, value: r.taken * RATING_WEIGHTS.taken },
    ],
    fmt: (n) => num(Math.round(n)),
    sumLabel: 'Очки',
    // Очки — целые (`ratingPoints` округляет): дробь мощи — запись, а не дыра в разборе.
    eps: 0.5,
    link: { label: 'На карте', go: show },
  });
}

export function Rating({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<RatingRow[] | null>(null);
  const [why, setWhy] = useState('');
  const [sharing, setSharing] = useState(false);
  // «Поделиться» своим местом (docs/feed.md, раздел 3): своя строка есть — есть и кнопка.
  const mine = rows?.find((r) => r.mine) ?? null;

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
        {mine && (
          <button className="wm-rbtn" onClick={() => setSharing(true)} aria-label="Поделиться местом">
            <Icon name="ui-share" glyph="📣" />
          </button>
        )}
        <button className="wm-rbtn" onClick={(e) => tipAt(e.currentTarget, RATING_TIP)} aria-label="Откуда очки">
          <Icon name="ui-info" glyph="ℹ️" />
        </button>
        <button className="wm-rbtn" onClick={onClose} aria-label="Закрыть">
          <Icon name="ui-close" glyph="✕" />
        </button>
      </div>
      {why && <div className="nx-stale">{why}</div>}
      {rows === null && !why && <div className="wm-rnone">Считаем…</div>}
      {rows !== null && (
        <Table
          label="Рейтинг"
          cols={RATING_COLS}
          empty="В мире ещё нет городов."
          rows={rows.map((r) => ({
            key: r.id,
            on: Boolean(r.mine),
            tip: () => pointsTip(r, () => show(r)),
            cells: {
              place: r.place,
              // Герб из реестра (П-2): соседей узнают по гербу так же, как на карте; нет — прежняя башня.
              city: (
                <span className="kit-name">
                  <ArmsArt arms={armsOr(r.arms)} size={15} />
                  <b className="one-line">{cityOr(r.city)}</b>
                </span>
              ),
              points: shortNum(r.points),
              power: shortNum(r.power),
              pop: shortNum(r.pop),
              won: r.won,
              taken: r.taken,
            },
          }))}
        />
      )}
      {mine && sharing && <ShareSheet card={ratingCard(mine)} onClose={() => setSharing(false)} />}
    </div>
  );
}
