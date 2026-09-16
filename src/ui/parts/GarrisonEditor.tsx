// Состав дружины полководца — один компонент на два места: карточка своего замка на
// карте и Статуя Героя в деревне. Состояние у мира одно (`world/store.setGarrison`),
// отказы — его же словами, и своих слов о том, почему состав не поменять, здесь нет:
// в пути, укрылся, дружина в дороге, осада — всё это говорит мир. Потолка у дружины нет:
// войско держит цена (`data/upkeep.ts`), а не Статуя.
// Прецедент показа в двух местах — настройки (`Settings`). Держит это тест по
// исходнику (`GarrisonEditor.test.ts`): `setGarrison` зовёт ровно этот файл.
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { defense } from '@/game/derived';
import { formatLeft, secondsLeft } from '@/world/geo';
import { postureOf, roomOf } from '@/world/muster';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { Icon } from '@/ui/icons/Icon';

/**
 * Что полководец держит при себе. Правится только вплотную к своей деревне: в
 * поле состав войска не меняется, и это правило игры, а не ограничение панели.
 */
export function GarrisonEditor() {
  const s = useGame((g) => g.s);
  const showToast = useGame((g) => g.showToast);
  const marches = useWorld((g) => g.marches);
  const figures = useWorld((g) => g.figures);
  const setGarrison = useWorld((g) => g.setGarrison);
  const general = figures.find((f) => f.id === 'general');
  const held: TroopStack = general?.troops ?? {};
  // Сколько можно держать при себе — всё войско, что не ушло отрядами: дома
  // дружина уже в гарнизоне, и складывать её с ним второй раз нельзя. Тем же
  // правилом отказывает мир (`world/muster.roomOf`).
  const pool = roomOf(s.army, marches);
  const [want, setWant] = useState<TroopStack>(held);
  const [busy, setBusy] = useState(false);

  // Пришёл новый состав из мира — начинаем от него, а не от прошлого выбора.
  const key = TROOP_IDS.map((t) => held[t] ?? 0).join(',');
  useEffect(() => setWant({ ...held }), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!general) return null;
  const rows = TROOP_IDS.filter((t) => (pool[t] ?? 0) + (held[t] ?? 0) > 0);
  const total = troopTotal(want);
  const gathering = general.readyAt > worldNow();
  const posture = postureOf(general);
  // Три состояния дружины, и за разницу между ними игрок платит: собранная и
  // стоящая у своих ворот — часть гарнизона; пока идёт сбор, эти
  // люди не защищают никого; в поле — не защищают тоже (`world/muster`). Игрок
  // обязан видеть обе цены до того, как отдаст приказ: сколько обороны стоит сам
  // сбор и какой она станет, когда дружина соберётся. Считает та же `defense`,
  // что и всегда, — только для выбранной дружины, а не своей арифметикой рядом.
  const def = defense(s);
  // Не в обороне сверх дружины: отряды в пути. Дружина, стоящая дома, в
  // `warriorsAway` не входит; в сборе и в поле — входит вся.
  const marchesOut = Math.max(0, s.warriorsAway - (posture === 'stands' ? 0 : troopTotal(held)));
  // В сборе числятся все, кого он касается, — те же `max(было, станет)` по видам,
  // что кладёт в дружину сам мир (`setGarrison`). Ничего не меняется — сбора нет.
  let onRoad = 0;
  let moved = 0;
  for (const t of TROOP_IDS) {
    onRoad += Math.max(held[t] ?? 0, want[t] ?? 0);
    moved += Math.abs((held[t] ?? 0) - (want[t] ?? 0));
  }
  const during = defense({ ...s, warriorsAway: marchesOut + onRoad });
  const after = defense({ ...s, warriorsAway: marchesOut });
  const apply = async (next: TroopStack | null): Promise<void> => {
    setBusy(true);
    const err = await setGarrison(next);
    setBusy(false);
    showToast(err ?? (troopTotal(next ?? {}) > 0 ? 'Дружина при полководце.' : 'Дружина вернулась в деревню.'));
  };

  return (
    <>
      <h3>
        Дружина при полководце{' '}
        <small>{total}</small>
      </h3>
      {gathering ? (
        <p className="note bad">
          Идёт сбор: ещё {formatLeft(secondsLeft(general.readyAt, worldNow()))}. Пока он идёт, все{' '}
          {troopTotal(held)} не защищают деревню ни как гарнизон, ни как дружина — и в бой не годятся.
        </p>
      ) : posture === 'stands' ? (
        <p className="note">
          Собрана и дома: {troopTotal(held)} — часть гарнизона: у частокола, у амбара, на вылазке и под
          рассеянием, если город падёт.
        </p>
      ) : posture === 'engaged' ? (
        <p className="note bad">Дружина занята: пока полководец в пути или в поле, деревню она не защищает.</p>
      ) : null}
      {rows.length === 0 ? (
        <div className="desc">Бойцов нет ни дома, ни при нём. Найми кого-нибудь в казармах.</div>
      ) : (
        rows.map((t) => {
          // Шаг вверх упирается в тех, кто дома, а не в ошибку после нажатия.
          const all = pool[t] ?? 0;
          const max = all;
          const n = want[t] ?? 0;
          const set = (v: number): void => setWant((w) => ({ ...w, [t]: Math.max(0, Math.min(max, v)) }));
          return (
            <div className="slot pick" key={t}>
              <span className="ico">
                <Icon name={`troop-${t}`} glyph={TROOP_BY_ID[t].icon} />
              </span>
              <span className="who">
                {TROOP_BY_ID[t].name}{' '}
                <i className="talent">
                  всего {all}
                </i>
              </span>
              <div className="stepper">
                <button disabled={n <= 0} onClick={() => set(n - 1)}>
                  −
                </button>
                <span className="n">{n}</span>
                <button disabled={n >= max} onClick={() => set(n + 1)}>
                  +
                </button>
              </div>
              <button className="mini text" disabled={n >= max} onClick={() => set(max)}>
                все
              </button>
            </div>
          );
        })
      )}
      <div className="mod-list">
        {moved > 0 && (
          <div className="mod">
            <span className="ico">⏳</span>
            <span className="name">Пока идёт сбор, оборона</span>
            <span className={`val ${during < def * 0.5 ? 'neg' : ''}`}>
              {Math.round(def)} → {Math.round(during)}
            </span>
          </div>
        )}
        <div className="mod total">
          <span className="ico"><Icon name="ui-home" glyph="🏠" /></span>
          <span className="name">Соберётся и встанет дома — оборона</span>
          <span className="val">{Math.round(after)}</span>
        </div>
      </div>
      <div className="wm-actions">
        <button className="btn wide" disabled={busy || gathering} onClick={() => void apply(want)}>
          🎖️ Отдать полководцу {total}
        </button>
        <button
          className="btn ghost wide"
          disabled={busy || gathering || troopTotal(held) === 0}
          onClick={() => void apply(null)}
        >
          <Icon name="ui-home" glyph="🏠" /> Вернуть всю дружину домой
        </button>
      </div>
      <p className="note">
        Дружина, собранная и стоящая у своих ворот, — часть гарнизона: держит стену и выходит на вылазку. Пока идёт сбор или
        роспуск, эти люди не защищают никого, а уведёшь полководца в поле — дома останутся частокол, башня,
        жители и те, кого он не взял. Увести можно всех: сколько войска держать, решает цена — еда и
        жалованье, — а не Статуя.
      </p>
    </>
  );
}
