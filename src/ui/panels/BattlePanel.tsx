// Оборона поселения: раскладка гарнизона по секторам и заморозка за `DEFENSE_FREEZE` до набега.
//
// Панель была общей у обороны и подготовки удара. У удара раскладки, плана, приказов и резерва с
// условием больше нет (docs/battle_eu4.md, 14.5): кто куда встанет, решает правило развёртывания, и
// «Настроить бой» ушло вместе с «быстрой атакой» — удар один. Оборона держит раскладку до поставки 2,
// теряя план, приказы, условие резерва и пресеты: их ядро больше не читает. Начальная раскладка —
// правило развёртывания; нерасставленные и сектор R идут в резерв стороны.
//
// Прогноза исхода здесь нет. Ни шансов, ни предварительного расчёта.
import { useEffect, useMemo, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { homeArmy } from '@/game/derived';
import { militiaArchers, militiaFoot, militiaMen } from '@/world/bridge';
import { awayOf, homeOf, postureOf, standingTroops } from '@/world/muster';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { secondsLeft } from '@/world/geo';
import { realLeft } from '@/ui/parts/wait';
import {
  cloneFormation,
  deployFormation,
  stashUnplaced,
  unplacedTroops,
  type Formation,
} from '@/game/battle/formation';
import { troopTotal } from '@/game/battle/kinds';
import { setDefenseFormation } from '@/game/battle/actions';
import type { Sector } from '@/battle';
import type { TroopId } from '@/game/types';
import { FormationGrid } from '../battle/FormationGrid';
import { SectorEditor } from '../battle/SectorEditor';
import { Icon } from '@/ui/icons/Icon';
import { useLockWords } from '@/ui/parts/defenseLock';

export function BattlePanel() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const marches = useWorld((g) => g.marches);

  const figures = useWorld((g) => g.figures);
  const general = figures.find((f) => f.id === 'general');
  const away = useMemo(() => awayOf(marches, figures), [marches, figures]);
  // Дома — весь гарнизон, а в нём и дружина, если она собрана и стоит у своих ворот (`world/muster`).
  const home = useMemo(() => homeOf(s.army, away), [s, away]);
  const standing = troopTotal(standingTroops(s.army, away));
  const posture = general ? postureOf(general) : 'none';
  const words = useLockWords();
  const lock = words.lock;

  const [formation, setFormation] = useState<Formation>(() => s.defenseFormation ?? deployFormation(home));
  const [sel, setSel] = useState<Sector | 'rest' | null>(null);

  // Оборона правится «на месте»: у неё нет кнопки «отправить», и настройка,
  // не доехавшая до сохранения, пропала бы при закрытии шторки.
  useEffect(() => {
    if (lock.frozen) return;
    act((g) => setDefenseFormation(g, formation));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formation, lock.frozen]);

  const unplaced = unplacedTroops(home, formation);
  const locked = lock.frozen;

  const place = (t: TroopId, n: number): void => {
    if (locked || sel === null || sel === 'rest') return;
    const f = cloneFormation(formation);
    f.sectors[sel][t] = Math.max(0, n);
    setFormation(f);
  };

  /**
   * Тап по клетке. «Не расставлены» — не сектор, а остаток: открывать над ним
   * степперы бессмысленно (забирать оттуда некуда), поэтому тап по нему просто
   * убирает остаток в резерв — то же, что случится при отправке, но видимо.
   */
  const pick = (id: Sector | 'rest'): void => {
    if (id === 'rest') {
      if (!locked && troopTotal(unplaced) > 0) setFormation(stashUnplaced(formation, unplaced));
      setSel(null);
      return;
    }
    setSel(sel === id ? null : id);
  };

  /** По правилу развёртывания заново: так гарнизон встал бы сам. */
  const redeploy = (): void => {
    setFormation(deployFormation(home));
    setSel(null);
  };

  // ---------- Шапка ----------

  const head = (
    <div className="bhead">
      <div className="ico">🏠</div>
      <div className="body">
        <div className="name">Оборона деревни</div>
        <div className="lvl">
          в обороне {homeArmy(s)}
          {standing > 0 ? ` (дружина ${standing})` : ''} · ополчение {militiaMen(s)}
        </div>
      </div>
    </div>
  );
  // Дружина, которой в обороне нет, — строкой под шапкой: за эту разницу игрок
  // платит, и узнавать о ней из отчёта после боя поздно.
  const druzhinaNote =
    !general
      ? null
      : posture === 'gathering'
        ? `Дружина полководца (${troopTotal(general.troops)}) в сборе: пока он идёт, она не стоит ни в гарнизоне, ни в обороне.`
        : posture === 'engaged'
          ? `Дружина полководца (${troopTotal(general.troops)}) занята — в пути или в поле, — и деревню не защищает.`
          : null;

  return (
    <div className="panel">
      {head}

      {lock.march && (
        <div className={`card ${locked ? 'danger' : ''}`}>
          <div className="ico">{locked ? '🔒' : '⚠️'}</div>
          <div className="body">
            <div className="title">
              {lock.march.fromName}
              <span className="count">{realLeft(secondsLeft(lock.march.arriveAt, worldNow()))}</span>
            </div>
            <div className="desc">
              {words.long}
            </div>
          </div>
        </div>
      )}

      <h3>
        Состав <small>{standing > 0 ? 'гарнизон вместе с дружиной' : 'весь гарнизон'}</small>
      </h3>
      {druzhinaNote && <p className="note bad">{druzhinaNote}</p>}
      {troopTotal(home) === 0 ? (
        <div className="desc">Бойцов дома нет. Найми кого-нибудь в казармах.</div>
      ) : (
        <div className="mod-list">
          {TROOP_IDS.filter((t) => (home[t] ?? 0) > 0).map((t) => (
            <div className="mod" key={t}>
              <span className="ico">
                <Icon name={`troop-${t}`} glyph={TROOP_BY_ID[t].icon} />
              </span>
              <span className="name">{TROOP_BY_ID[t].name}</span>
              <span className="val">{home[t]}</span>
            </div>
          ))}
          <div className="mod total">
            <span className="ico">🪵</span>
            <span className="name">Ополчение (частокол и жители)</span>
            <span className="val">{militiaFoot(s)}</span>
          </div>
          {militiaArchers(s) > 0 && (
            <div className="mod total">
              <span className="ico">🏹</span>
              <span className="name">Стрелки на башне</span>
              <span className="val">{militiaArchers(s)}</span>
            </div>
          )}
        </div>
      )}

      <h3>
        Расстановка{' '}
        <button className="mini text" disabled={locked} onClick={redeploy}>
          разложить заново
        </button>
      </h3>
      <FormationGrid
        formation={formation}
        unplaced={unplaced}
        selected={sel}
        onSelect={pick}
      />
      {sel !== null && !locked && (
        <SectorEditor
          sector={sel}
          here={sel === 'rest' ? unplaced : formation.sectors[sel]}
          free={sel === 'rest' ? {} : unplaced}
          onChange={place}
          onClose={() => setSel(null)}
        />
      )}
      {sel !== null && locked && <p className="note bad">{words.long}</p>}

      <p className="note">
        Так деревня встретит следующий набег. Ополчение — частокол, башня и сами жители — встаёт во фронт
        само, расставлять его не нужно. Кто не встал в сектора — нерасставленные и резерв, — стоит в резерве
        и встаёт в строй, когда там освобождается место.
      </p>
    </div>
  );
}
