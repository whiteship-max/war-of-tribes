// Раздел «Оборона» у частокола и башни — одна часть на два здания.
//
// Решения здесь нет своего: расстановка обороны (сектора, план, приказы, резерв) живёт
// одним экраном (`panels/BattlePanel` без цели), и стена даёт к нему четвёртый вход —
// рядом с тревогой о набеге, письмом о набеге и карточкой своего замка. Здесь только
// то, что стена выводит в поле, заперта ли оборона и дверь к экрану.
//
// Ни одного числа часть не считает сама. Защита — `defense`, ополчение и стрелки —
// `world/bridge` (`militiaMen`, `militiaArchers`), где они встанут — замер переводом
// расстановки (`militiaPlaces`), замок — общая дверь `parts/defenseLock`. Держит это
// тест по исходнику (`Walls.test.ts`).
import type { Building } from '@/game/types';
import { useGame } from '@/game/store';
import { defense } from '@/game/derived';
import { useWorld, worldNow } from '@/world/store';
import { secondsLeft } from '@/world/geo';
import { realLeft } from '@/ui/parts/wait';
import { militiaArchers, militiaMen, militiaPlaces } from '@/world/bridge';
import { SECTOR_NAME, type Sector } from '@/battle';
import { Icon } from '@/ui/icons/Icon';
import { useLockWords } from './defenseLock';

const where = (ids: Sector[]): string => ids.map((id) => SECTOR_NAME[id]).join(', ');

export function Walls({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  const openDefense = useGame((g) => g.openDefense);
  const openSiege = useGame((g) => g.openSiege);
  const siege = useWorld((g) => g.siege);
  const lock = useLockWords();
  const men = militiaMen(s);
  const archers = militiaArchers(s);
  // Где встанет ополчение, решает перевод расстановки — но только когда расстановка
  // есть. Без неё весь строй раскладывает готовое построение по жребию боя, и сектора
  // называть было бы неправдой.
  const places = s.defenseFormation ? militiaPlaces(s) : { foot: [], archers: [] };
  const march = lock.lock.march;

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
          <span className="name">
            Ополчение выйдет в поле
            {places.foot.length > 0 && <em className="sub">пехота встанет: {where(places.foot)}</em>}
          </span>
          <span className="val">{men}</span>
        </div>
        {/* Своя строка башни: сколько из ополчения выйдет стрелками и где встанет. */}
        {b.type === 'tower' && (
          <div className="mod">
            <span className="ico">
              <Icon name="gear-bow" glyph="🏹" />
            </span>
            <span className="name">
              Из них стрелками
              {places.archers.length > 0 && <em className="sub">встанут: {where(places.archers)}</em>}
            </span>
            <span className="val">{archers}</span>
          </div>
        )}
      </div>
      {!s.defenseFormation && (
        <div className="note">Расстановку ещё не открывали: пока её нет, весь строй вместе с ополчением встанет одним из готовых построений, по жребию боя.</div>
      )}

      <div className={`card ${lock.frozen ? 'danger' : ''}`}>
        <div className="ico">{lock.frozen ? '🔒' : march ? '⚠️' : '🛡️'}</div>
        <div className="body">
          <div className="title">
            {march ? march.fromName : 'Набегов в пути нет'}
            {march && <span className="count">{realLeft(secondsLeft(march.arriveAt, worldNow()))}</span>}
          </div>
          <div className="desc">{lock.long}</div>
        </div>
      </div>

      {siege ? (
        <button className="btn wide" onClick={openSiege}>
          ⛺ Окно осады
        </button>
      ) : (
        <button className="btn wide" onClick={openDefense}>
          {lock.frozen ? '🔒' : '🛡️'} Расстановка{lock.short ? ` · ${lock.short}` : ''}
        </button>
      )}
    </>
  );
}
