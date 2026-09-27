// Раздел «Оборона» у частокола и башни — одна часть на два здания.
//
// Решения здесь нет своего, и расставлять тоже нечего: строй у частокола раскладывает правило боя, как любой бой
// (поставка 2 боя, docs/battle_eu4.md, 14.27). Решение о набеге — донесение о набеге в почте (перехват на карте и сбор
// дружины), и стена даёт к нему вход рядом со строкой набега в тревогах. Здесь только то, что стена выводит в поле, кто
// идёт и сколько ещё успевает полный сбор — и дверь к донесению.
//
// Ни одного числа часть не считает сама. Защита — `defense`, ополчение и стрелки — `world/bridge` (`militiaMen`,
// `militiaArchers`), окно набега — общая дверь `parts/raidWords`. Держит это тест по исходнику (`Walls.test.ts`).
import type { Building } from '@/game/types';
import { useGame } from '@/game/store';
import { defense } from '@/game/derived';
import { useWorld } from '@/world/store';
import { realLeft } from '@/ui/parts/wait';
import { militiaArchers, militiaMen } from '@/world/bridge';
import { Icon } from '@/ui/icons/Icon';
import { openRaid } from '@/ui/realm/open';
import { useRaidWords } from './raidWords';

export function Walls({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  const openSiege = useGame((g) => g.openSiege);
  const siege = useWorld((g) => g.siege);
  const raid = useRaidWords()[0] ?? null;
  const men = militiaMen(s);
  const archers = militiaArchers(s);
  const march = raid?.win.march ?? null;

  return (
    <>
      <h3>Оборона</h3>
      <div className="mod-list">
        <div className="mod total">
          <span className="ico">
            <Icon name="gear-shield" glyph="🛡️" />
          </span>
          <span className="name">Защита посёлка</span>
          <span className="val">{defense(s).toFixed(0)}</span>
        </div>
        <div className="mod">
          <span className="ico">
            <Icon name="bld-palisade" glyph="🧱" />
          </span>
          <span className="name">Ополчение выйдет в поле</span>
          <span className="val">{men}</span>
        </div>
        {/* Своя строка башни: сколько из ополчения выйдет стрелками. */}
        {b.type === 'tower' && (
          <div className="mod">
            <span className="ico">
              <Icon name="gear-bow" glyph="🏹" />
            </span>
            <span className="name">Из них стрелками</span>
            <span className="val">{archers}</span>
          </div>
        )}
      </div>
      <div className="note">
        Строй у частокола раскладывает правило боя, как любой бой: ополчение встаёт пехотой вместе с теми, кто дома,
        стрелки башни — лучниками во второй линии, а кому не хватило места в строю, ждёт в резерве.
      </div>

      <div className={`card ${raid?.win.late ? 'danger' : ''}`}>
        <div className="ico">{march ? '⚠️' : '🛡️'}</div>
        <div className="body">
          <div className="title">
            {march ? march.fromName : 'Набегов в пути нет'}
            {raid && <span className="count">{realLeft(raid.win.seconds)}</span>}
          </div>
          {raid && <div className="desc">{raid.long}</div>}
        </div>
      </div>

      {siege ? (
        <button className="btn wide" onClick={openSiege}>
          ⛺ Окно осады
        </button>
      ) : (
        march && (
          <button className="btn wide" onClick={() => openRaid(march.id)}>
            🔥 Донесение о набеге{raid?.short ? ` · ${raid.short}` : ''}
          </button>
        )
      )}
    </>
  );
}
