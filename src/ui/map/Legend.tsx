// Легенда карты (UI-7, docs/ui_v2.md, 5.6; П9, Л8): вкладками «Места · Метки · Земля», а не столбцом на два экрана; значки —
// сеткой в два столбца; земля — таблицей «одна цена — одна строка»: холмы и горы ходятся одинаково нарочно (условие
// владельца, `world/data/terrain.ts`), и двух строк с одной ценой в легенде нет.
//
// Легенда говорит только о том, что на карте бывает сегодня. На ней логова и замки живых игроков, и больше ничего:
// союзников и врагов нет (договариваться не с кем), разорённых дворов нет (логово на победе сгорает), владений нет (зоны
// влияния считаются от станов, а станов нет), сожжённых городов нет («сжечь» миру не предлагается), трактов нет (они
// соединяли станы). Механики целы и спят (`grep -rn waitsForPlayers src`); строки о них вернутся вместе с живыми соседями.
// Легенда, обещающая то, чего игрок не встретит, учит его неправде — «Тракт ×0.62» висел в ней, когда трактов в мире не
// было ни одного (`legend.test.ts`).
//
// Числа — из тех же констант, что и расчёт пути: легенда, в которой множитель написан руками, врёт со следующей правки.
// Значки мест и отрядов — значками самой карты (`tw/legend.ts`), кусок ленивый: приезжает, когда легенду открыли.
import { useEffect, useState, type ReactNode } from 'react';
import { RELATION_META, RELATION_ORDER } from '@/world/data/meta';
import { TERRAIN_META, TERRAIN_ORDER } from '@/world/data/terrain';
import type { Terrain } from '@/world/types';
import { COST_BRIDGE, COST_FORD, COST_PASS, COST_RIDGE, COST_RIVER, FALL_MARK } from '@/world/data/tuning';
import type { Fate } from '@/world/types';
import { num } from '@/game/num';
import { Icon } from '@/ui/icons/Icon';
import { Tabs, type TabDef } from '@/ui/kit/SheetPage';
import { Table, type Col } from '@/ui/kit/Table';
import { realSpanText } from '@/ui/parts/wait';
import { PALETTE } from './const';
import { FELL_WORDS, WORKS_STEPS, fellUrl, worksUrl } from './siegemark';
import './legend.css';

export const SHOWN_RELATIONS = RELATION_ORDER.filter((r) => r !== 'ally' && r !== 'enemy');
export const SHOWN_FATES = (Object.keys(FELL_WORDS) as Fate[]).filter((f) => f !== 'burn');

/** Множитель дороги словами: дробь — запятой (docs/ui_audit.md, 4.5). */
const frac = (x: number): string => num(x, 3);

/** Земля строками таблицы: местности одной цены и одного цвета — одной строкой («Холмы, горы ×1,5»), порядком игры. */
export function landRows(): { key: string; names: Terrain[]; color: string; cost: number }[] {
  const out: { key: string; names: Terrain[]; color: string; cost: number }[] = [];
  for (const t of TERRAIN_ORDER) {
    const m = TERRAIN_META[t];
    const same = out.find((r) => r.cost === m.cost && r.color === m.color);
    if (same) same.names.push(t);
    else out.push({ key: t, names: [t], color: m.color, cost: m.cost });
  }
  return out;
}

/** Реки и хребты поверх ландшафта — их множители перебивают местность (`world/geography.ts`). */
export const WATER_ROWS: { key: string; color: string; name: string; cost: number; note: string }[] = [
  { key: 'river', color: PALETTE.river, name: 'Река', cost: COST_RIVER, note: 'вплавь' },
  { key: 'bridge', color: PALETTE.bridge, name: 'Мост', cost: COST_BRIDGE, note: 'мостов мало' },
  { key: 'ford', color: PALETTE.ford, name: 'Брод', cost: COST_FORD, note: 'зато без крюка' },
  { key: 'ridge', color: PALETTE.ridge, name: 'Хребет', cost: COST_RIDGE, note: 'лучше перевалом' },
  { key: 'pass', color: PALETTE.pass, name: 'Перевал', cost: COST_PASS, note: 'проход через хребет' },
];

const LAND_COLS: readonly Col[] = [
  { key: 'name', title: 'Земля' },
  { key: 'cost', title: 'Путь', align: 'right', w: '56px' },
];

type View = 'places' | 'marks' | 'land';
const TABS: readonly TabDef<View>[] = [
  { id: 'places', label: 'Места' },
  { id: 'marks', label: 'Метки' },
  { id: 'land', label: 'Земля' },
];

/** Ячейка сетки: значок (картинка, вымпел или цвет), имя и пояснение строкой 11 px. */
function Cell({ art, name, note }: { art: ReactNode; name: string; note?: string }) {
  return (
    <div className="wm-leg-cell">
      <span className="wm-leg-art">{art}</span>
      <span className="wm-leg-text">
        <b>{name}</b>
        {note && <em>{note}</em>}
      </span>
    </div>
  );
}

const swatch = (color: string): ReactNode => <i className="wm-leg-swatch" style={{ background: color }} />;

export function Legend({ stale, onClose }: { stale: string | null; onClose: () => void }) {
  const [view, setView] = useState<View>('places');
  const [kit, setKit] = useState<typeof import('./tw/legend') | null>(null);
  useEffect(() => {
    let live = true;
    void import('./tw/legend').then((m) => live && setKit(m));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="wm-legend">
      {stale && <div className="nx-stale">{stale}</div>}
      <Tabs tabs={TABS} value={view} onChange={setView} />

      {view === 'places' && (
        <>
          <h3>Кто на карте</h3>
          <div className="wm-leg-grid">
            {SHOWN_RELATIONS.map((r) => (
              // Форма несёт смысл, цвет её подтверждает: цветной квадратик на цветовую слепоту не рассчитан вовсе.
              <Cell key={r} art={<Icon name={`rel-${r}`} glyph="▪" className="wm-leg-flag" />} name={RELATION_META[r].name} />
            ))}
          </div>
          {kit && (
            <>
              <h3>Города и логова</h3>
              <div className="wm-leg-grid">
                {kit.PLACE_ROWS.map((row) => (
                  <Cell key={row.name} art={<img src={kit.legendUrl(row)} alt="" />} name={row.name} note={row.note} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {view === 'marks' && (
        <>
          {kit && (
            <>
              <h3>Отряды и метки</h3>
              <div className="wm-leg-grid">
                {kit.HOST_ROWS.map((row) => (
                  <Cell key={row.name} art={<img src={kit.legendUrl(row)} alt="" />} name={row.name} note={row.note} />
                ))}
              </div>
            </>
          )}
          {/* Осада и взятые города — теми же картинками, что на полотне (`siegemark.ts`). */}
          <h3>Осада и взятые города</h3>
          <div className="wm-leg-grid">
            <Cell art={<img src={worksUrl(WORKS_STEPS, 0)} alt="" />} name="Рогатки со стороны города" note="ближний ряд, против вылазки" />
            <Cell art={<img src={worksUrl(0, WORKS_STEPS)} alt="" />} name="Рогатки с тыла" note="против удара из поля; редкий ряд ещё строят" />
            {SHOWN_FATES.map((fate) => (
              <Cell key={fate} art={<img className="wm-leg-fell" src={fellUrl(fate)} alt="" />} name={`Город взят, ${FELL_WORDS[fate]}`} note={`знак сойдёт через ${realSpanText(FALL_MARK / 1000)}`} />
            ))}
          </div>
          <h3>Туман войны</h3>
          <div className="wm-leg-grid">
            <Cell art={swatch('#120e0b')} name="Не разведано" note="сюда никто не заходил" />
            <Cell art={swatch('#3a332b')} name="Вне обзора" note="землю знаем, сейчас не видно" />
            <Cell art={swatch('#6b7a44')} name="В обзоре" note="видно своими глазами" />
          </div>
        </>
      )}

      {view === 'land' && (
        <>
          <h3>Цена пути: во сколько раз медленнее равнины</h3>
          <Table
            label="Земля"
            cols={LAND_COLS}
            rows={[
              ...landRows().map((r) => ({
                key: r.key,
                cells: {
                  name: (
                    <span className="kit-name">
                      {swatch(r.color)}
                      <span className="one-line">{r.names.map((t) => TERRAIN_META[t].name).join(', ')}</span>
                    </span>
                  ),
                  cost: `×${frac(r.cost)}`,
                },
              })),
              ...WATER_ROWS.map((r) => ({
                key: r.key,
                cells: {
                  name: (
                    <span className="kit-name">
                      {swatch(r.color)}
                      <span className="one-line">
                        {r.name} <small className="muted">{r.note}</small>
                      </span>
                    </span>
                  ),
                  cost: `×${frac(r.cost)}`,
                },
              })),
            ]}
          />
        </>
      )}

      <button className="btn ghost wide" onClick={onClose}>
        Понятно
      </button>
    </div>
  );
}
