// Раздел «Оборона» у частокола и башни — одна часть на два здания.
//
// Решения здесь нет своего, и расставлять тоже нечего: строй у частокола раскладывает правило боя, как любой бой
// (поставка 2 боя, docs/battle_eu4.md, 14.27). Решение о набеге — донесение о набеге в почте (перехват на карте и
// раскладка дружины), и стена даёт к нему вход рядом со строкой набега в тревогах. Здесь только то, что стена выводит в
// поле, кто идёт и когда придёт — окно ответа длится до прихода, — и дверь к донесению.
//
// Ни одного числа часть не считает сама. Защита — `defense`, ополчение и стрелки — `world/bridge` (`militiaMen`,
// `militiaArchers`), окно набега — общая дверь `parts/raidWords`. Держит это тест по исходнику (`Walls.test.ts`).
import type { Building } from '@/game/types';
import { useGame } from '@/game/store';
import { defense } from '@/game/derived';
import { useWorld } from '@/world/store';
import { militiaArchers, militiaMen } from '@/world/bridge';
import { Icon } from '@/ui/icons/Icon';
import { openRaid } from '@/ui/realm/open';
import { useRaidWords } from './raidWords';
import { dec } from '@/game/num';

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
            <Icon name="gear-shield" />
          </span>
          <span className="name">Оборона города</span>
          <span className="val">{dec(defense(s), 0)}</span>
        </div>
        <div className="mod">
          <span className="ico">
            <Icon name="bld-palisade" />
          </span>
          <span className="name">Ополчение</span>
          <span className="val">{men}</span>
        </div>
        {/* Своя строка башни: сколько из ополчения выйдет стрелками. */}
        {b.type === 'tower' && (
          <div className="mod">
            <span className="ico">
              <Icon name="gear-bow" />
            </span>
            <span className="name">Из них стрелки</span>
            <span className="val">{archers}</span>
          </div>
        )}
      </div>
      <div className="note">Ополчение встаёт в строй с гарнизоном, стрелки башни — во второй линии.</div>

      <div className="card">
        <div className="ico"><Icon name={march ? 'ui-warning' : 'gear-shield'} /></div>
        <div className="body">
          <div className="title">
            {march ? march.fromName : 'Набегов в пути нет'}
            {raid && <span className="count">{raid.left}</span>}
          </div>
          {raid && <div className="desc">{raid.long}</div>}
        </div>
      </div>

      {siege ? (
        <button className="btn wide" onClick={openSiege}>
          <Icon name="letter-siege" /> Осада
        </button>
      ) : (
        march && (
          <button className="btn wide" onClick={() => openRaid(march.id)}>
            <Icon name="letter-raid" /> Весть о набеге
          </button>
        )
      )}
    </>
  );
}
