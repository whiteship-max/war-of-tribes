// Технологии: три ветви правителя, ступени, цена в очках и то, что ступень открывает.
//
// **Ни одного своего числа и ни одной своей подписи.** Уровень, цена, хватает ли очков и
// сколько ждать — из `sim/tech.studyInfo`; что даст ступень — оттуда же, замером двух
// уровней одними и теми же дверьми (`techGains`), а не строкой, написанной рядом. Это то
// же правило, по которому живёт кнопка улучшения: подпись, написанная руками, расходится
// с правилом ровно тогда, когда правило поправят.
//
// Цена показана той же формой, какой в игре говорят «нужно столько, а есть столько»
// (`ui/parts/Cost.tsx`, класс `.cost`): не хватает — ячейка краснеет, и по этой же нехватке
// гаснет кнопка. Самим `Cost` очки не показать — он про ресурсы склада и казну, а очки не
// ресурс; форма поэтому взята его, буква в букву, чтобы игрок читал её тем же взглядом.
import { useGame } from '@/game/store';
import { BRANCH_BUILT, BRANCH_NAME, POINTS_CAP, REALM_BRANCHES, levelPrice, levelsOf } from '@/game/data/realm';
import { pointsOf, rulerRate } from '@/game/sim/points';
import { levelName, study, studyInfo, techGains, techLevel } from '@/game/sim/tech';
import { waitLeft } from '@/ui/parts/wait';
import type { RealmBranch } from '@/game/types';

export function TechTab() {
  return (
    <>
      <div className="panel">
        <h3>Технологии</h3>
        <div className="note">
          Три ветви, по одной на навык правителя: каждая тратит очки своего вида. Первый уровень
          бесплатен — это то, с чем держава начинается; дальше уровень покупается и что-то
          открывает. Изученное не отнимается ни сменой правителя, ни чем-либо ещё.
        </div>
      </div>
      {REALM_BRANCHES.map((b) => (
        <Branch key={b} branch={b} />
      ))}
    </>
  );
}

function Branch({ branch }: { branch: RealmBranch }) {
  const s = useGame((g) => g.s);
  const have = pointsOf(s, branch);
  const rate = rulerRate(s, branch);
  const level = techLevel(s, branch);
  const last = levelsOf(branch);

  return (
    <div className="panel">
      <h3>{BRANCH_NAME[branch]} ветвь</h3>
      <div className="mod total">
        <span className="ico">◆</span>
        <span className="name">
          Очки
          <em className="sub">{rate > 0 ? `+${rate} в игровой день` : 'приток нулевой'}</em>
        </span>
        <span className={`val${have >= POINTS_CAP ? ' neg' : ' pos'}`}>
          {Math.floor(have)} из {POINTS_CAP}
        </span>
      </div>

      {!BRANCH_BUILT[branch] ? (
        <>
          <div className="note">Ещё не построена.</div>
          <div className="note">
            Ветвь без гейта была бы ценником без товара: пока она ничего не открывает, её и не
            продают. Очки этого вида копятся и никуда не денутся.
          </div>
        </>
      ) : (
        <>
          {Array.from({ length: last }, (_, i) => i + 1).map((l) => (
            <Level key={l} branch={branch} level={l} at={level} />
          ))}
          <div className="note">
            Что уровень открывает, здесь не подписано, а измерено: игра спрашивает у гейта, чем
            держава на этом уровне отличается от державы уровнем ниже, — и печатает разницу.
          </div>
        </>
      )}
    </div>
  );
}

function Level({ branch, level, at }: { branch: RealmBranch; level: number; at: number }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const info = studyInfo(s, branch);
  const done = level <= at;
  const next = level === at + 1;
  const price = levelPrice(branch, level);
  // Что открыл (или откроет) этот уровень — разница дверей между ним и уровнем ниже.
  const gains = techGains(branch, level - 1);

  return (
    <>
      <div className={`mod${done ? '' : next ? ' warn' : ' off'}`}>
        <span className="ico">{done ? '✓' : next ? '◆' : '🔒'}</span>
        <span className="name">
          {level} · {levelName(branch, level)}
          {gains.length > 0 && <em className="sub">{gains.join(' · ')}</em>}
        </span>
        <span className={`val${done ? ' pos' : ''}`}>{done ? 'изучено' : `${price} очков`}</span>
      </div>

      {next && (
        <>
          <div className="cost">
            <span className={info.have >= info.price ? '' : 'no'} title="Очки правителя">
              ◆ {info.price}
              <i className="have">из {Math.floor(info.have)}</i>
            </span>
          </div>
          <button
            className="btn wide"
            data-tut={`tech-${branch}`}
            disabled={info.blocked !== null}
            onClick={() => act((g) => study(g, branch))}
          >
            Изучить
          </button>
          {info.blocked && (
            <div className="hint">
              {info.blocked}
              {info.wait > 0 && ` Накопится через ${waitLeft(info.wait)}.`}
            </div>
          )}
        </>
      )}
    </>
  );
}
