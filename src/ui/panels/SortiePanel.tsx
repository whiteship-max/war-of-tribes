// Вылазка: кого выпускаем за ворота.
//
// Состав выбирается — не «всё или ничего». Гарнизон, вышедший весь, оставил бы
// стену пустой, и это была бы не ставка, а ловушка: осада не кончится от одной
// неудачи, а обороняться после неё будет нечем.
//
// Расстановки здесь нет нарочно. Вылазка — это внезапный удар из ворот, и
// шесть секторов с планом и резервом на неё не раскладывают: строй в воротах не
// строят. Пресет выберется по сиду боя — тем же, каким его выбирает быстрая
// атака.
//
// Прогноза исхода нет — как и везде в этой игре. Известно ровно то, что можно
// увидеть со стены: сколько людей в лагере и насколько он укрепился — а значит,
// сколько из выбранных пробьются к рогаткам. Это не исход, а условие боя, и
// считает его та же функция, что и сам бой (`world/works.sortieForecast`).
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useGame } from '@/game/store';
import type { MachineId } from '@/world/data/machines';
import { plural } from '@/ui/parts/plural';
import { useWorld, worldNow } from '@/world/store';
import { awayOf, homeOf, standingTroops } from '@/world/muster';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { kindsOf } from '@/game/battle/price';
import { secondsLeft } from '@/world/geo';
import { realLeft } from '@/ui/parts/wait';
import { REST_WHY, restLine, wearLine } from '@/ui/parts/restWords';
import { hungerLeft } from '@/ui/parts/hunger';
import { gateBusyText, refusedAtGate, sortieForecast } from '@/world/works';
import type { TroopId } from '@/game/types';
import { Icon } from '@/ui/icons/Icon';

/**
 * Ряд шага, как у рабочих в здании: числом, а не карточкой на человека.
 *
 * Разметка здесь ровно та же, что у `Steps` в `BuildingPanel` — `.stepper
 * wide-steps` на всю ширину, — и это не вкусовщина. Своих классов у ряда шага
 * нет: единственный, кто его красит, — эти два правила в стилях, и ряд,
 * названный по-своему, остаётся без стилей вовсе. Так и вышло в первый раз:
 * пять кнопок `.mini` (каждая `display: flex` шириной в палец) встали друг под
 * друга, строка вида выросла до 211 px, а список из пяти видов — до 1108 px в
 * шторке высотой 413.
 */
function Steps({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  const set = (n: number): void => onChange(Math.max(0, Math.min(max, n)));
  return (
    <div className="stepper wide-steps">
      <button disabled={value <= 0} onClick={() => set(value - 10)} aria-label="Убрать 10">
        −10
      </button>
      <button disabled={value <= 0} onClick={() => set(value - 1)} aria-label="Убрать">
        −1
      </button>
      <span className="n">{value}</span>
      <button disabled={value >= max} onClick={() => set(value + 1)} aria-label="Добавить">
        +1
      </button>
      <button disabled={value >= max} onClick={() => set(value + 10)} aria-label="Добавить 10">
        +10
      </button>
    </div>
  );
}

/**
 * `machine` — вылазка на машину лагеря (docs/siege_v2.md, раздел 5): бой с её охраной у стены, перед рогатками; победа сжигает
 * машину. Без него — вылазка на лагерь через рогатки.
 */
export function SortiePanel({ machine }: { machine?: MachineId } = {}) {
  const s = useGame((g) => g.s);
  const showToast = useGame((g) => g.showToast);
  const openReport = useGame((g) => g.openReport);
  const closeSheet = useGame((g) => g.closeSheet);
  const siege = useWorld((g) => g.siege);
  const marches = useWorld((g) => g.marches);
  const figures = useWorld((g) => g.figures);
  const sortie = useWorld((g) => g.sortie);
  const burnMachine = useWorld((g) => g.burnMachine);

  const away = useMemo(() => awayOf(marches, figures), [marches, figures]);
  // Выходят из гарнизона — а в нём и дружина, если полководец в городе: дома она
  // часть гарнизона и за ворота выходит этой же вылазкой (`world/muster`).
  const home = useMemo(() => homeOf(s.army, away), [s, away]);
  const standing = useMemo(() => troopTotal(standingTroops(s.army, away)), [s, away]);
  const [picked, setPicked] = useState<TroopStack>({});
  const [busy, setBusy] = useState(false);
  const [, retick] = useState(0);

  // Рогатки растут, пока игрок выбирает состав: число прохода обязано идти вместе
  // с часами, а не застыть на минуте, в которую открыли панель.
  useEffect(() => {
    if (!siege) return;
    const t = setInterval(() => retick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [siege]);

  const men = troopTotal(picked);
  const stay = troopTotal(home) - men;

  if (!siege) {
    return (
      <div className="panel">
        <div className="bhead">
          <div className="ico">⚔️</div>
          <div className="body">
            <div className="name">Вылазки не нужно</div>
            <div className="lvl">под стенами никого</div>
          </div>
        </div>
        <p className="note">Осада снята.</p>
      </div>
    );
  }

  const now = worldNow();
  const fc = sortieForecast(siege, kindsOf(picked), now);
  const pass = fc.now.pass;
  // Проход — поток: занят прошедшими раньше — пропустит меньше, а то и никого.
  // Отказ виден до нажатия и гасит кнопку; мир откажет теми же словами.
  // На машину — мимо рогаток: прохода у этого боя нет (`fights.machineFight`).
  const target = machine ? siege.answers?.burn.find((m) => m.machine === machine) : undefined;
  const refused = !machine && men > 0 && refusedAtGate(fc.now);

  const go = async (): Promise<void> => {
    setBusy(true);
    const res = machine ? await burnMachine(machine, picked) : await sortie(picked);
    setBusy(false);
    if (res.error) {
      showToast(res.error);
      return;
    }
    if (res.reportId) openReport(res.reportId);
    else closeSheet();
  };

  return (
    <div className="panel">
      <div className="bhead">
        <div className="ico">
          <Icon name="letter-siege" glyph="⛺" />
        </div>
        <div className="body">
          <div className="name">{target ? `Вылазка: ${target.name.toLowerCase()}` : 'Вылазка'}</div>
          <div className="lvl">
            «{siege.byName}» у ворот · до голода {hungerLeft(siege.starvesAt, now)}
          </div>
        </div>
      </div>

      {/*
        Единственное, что игрок знает о бое заранее, — и знать это он обязан:
        лагерь укрепляется, и время работает против города. Спрятать это в отчёт
        значило бы, что решение «выйти сейчас или собраться» принимается вслепую,
        а непонятный проигрыш читается как несправедливый.
      */}
      {machine && (
        <div className="card danger">
          <div className="ico">🔥</div>
          <div className="body">
            <div className="title">{target ? `${target.name}: ${target.ready ? 'готова' : 'строится'}` : 'Машины у лагеря нет'}</div>
            <div className="desc">
              {target
                ? `Охрана — ${target.guard} ${plural(target.guard, 'боец', 'бойца', 'бойцов')} лагеря. Машина стоит у стены, перед рогатками: проход отряду не нужен. Победа сожжёт её вместе с лесом.`
                : 'Её уже сожгли или пустили на штурм.'}
            </div>
          </div>
        </div>
      )}
      {!machine && (
      <div className={`card${fc.now.works > 0 ? ' danger' : ''}`}>
        <div className="ico">⛺</div>
        <div className="body">
          <div className="title">
            {fc.now.works <= 0 ? 'Рогаток нет' : fc.now.works < 1 ? 'Рогатки растут' : 'Рогатки дозрели'}
          </div>
          <div className="desc">
            {fc.now.works <= 0
              ? `Лагерь только встал. К бою пройдут все.`
              : `Со стороны города рогатки готовы на ${Math.floor(fc.now.works * 100)}%. К бою пробьются не больше ${pass}.`}
            {fc.now.works > 0 &&
              fc.now.free < 1 &&
              ` Проход занят, сейчас пройдут ${fc.now.room}. Освободится через ${realLeft(secondsLeft(fc.clearAt, now))}, тогда пройдут не больше ${fc.clearPass}.`}
            {fc.now.works < 1 &&
              ` Дозреют через ${realLeft(secondsLeft(fc.ripeAt, now))}, тогда пройдут не больше ${fc.ripePass}.`}
            {men > 0 &&
              (fc.now.passed < fc.now.went
                ? ` К бою пробьются ${fc.now.passed} из ${fc.now.went}.`
                : ` Отряд пройдёт весь.`)}
          </div>
        </div>
      </div>
      )}

      <h3>
        Кто выходит <small>{men} из {troopTotal(home)}</small>
      </h3>
      {troopTotal(home) === 0 ? (
        <div className="desc">
          В гарнизоне никого. Найми бойцов в казармах.
        </div>
      ) : (
        <div className="mod-list">
          {/*
            Вид и ряд шага — две строки, а не одна. Ряд шага занимает всю
            ширину нарочно (см. `Steps`): пять кнопок в палец шириной — это
            220 px, а на 375 px рядом с именем вида их не поставить.
          */}
          {TROOP_IDS.filter((t) => (home[t] ?? 0) > 0).map((t) => (
            <Fragment key={t}>
              <div className="mod">
                <span className="ico">
                  <Icon name={`troop-${t}`} glyph={TROOP_BY_ID[t].icon} />
                </span>
                <span className="name">{TROOP_BY_ID[t].name}</span>
                <span className={(picked[t] ?? 0) > 0 ? 'val pos' : 'val'}>
                  {picked[t] ?? 0} из {home[t] ?? 0}
                </span>
              </div>
              <Steps
                value={picked[t] ?? 0}
                max={home[t] ?? 0}
                onChange={(n) => setPicked({ ...picked, [t as TroopId]: n })}
              />
            </Fragment>
          ))}
          <div className="mod total">
            <span className="ico">🏠</span>
            <span className="name">Останется за стеной</span>
            <span className={stay > 0 ? 'val' : 'val neg'}>{stay}</span>
          </div>
        </div>
      )}
      {standing > 0 && (
        <p className="note">Отряд полководца стоит дома и выходит со всеми.</p>
      )}

      <div className="cost">
        <button className="mini text" onClick={() => setPicked({ ...home })}>
          Вывести всех
        </button>
        <button className="mini text" onClick={() => setPicked({})}>
          Никого
        </button>
      </div>

      {/* Мораль между боями (14.31): кто и с чем выйдет за ворота и против кого — до нажатия. */}
      {siege.garrisonRest && (
        <p className="note warn">
          {restLine(siege.garrisonRest, 'Гарнизон дрался', now)} {REST_WHY}
        </p>
      )}
      {siege.campRest && <p className="note">{restLine(siege.campRest, 'Лагерь дрался', now)}</p>}
      {/* Износ осады и дела лагеря (укрепления — кость вылазки) — то, что идёт в этот бой, до нажатия (siege_audit, 5 и 11). */}
      {siege.wear !== undefined && <p className="note warn">{wearLine(siege.wear)}</p>}
      {siege.craftNote && <p className="note warn">{siege.craftNote}</p>}
      {refused && <p className="note bad">{gateBusyText(fc.now.waitMs)}</p>}
      <button className="btn wide" disabled={busy || men === 0 || refused} onClick={() => void go()}>
        Выйти{men > 0 ? ` · ${men}` : ''}
      </button>

      <p className="note">
        {machine
          ? 'Победа сжигает машину, лагерь стоит. Потери несут обе стороны, а срок голода считается заново по оставшимся.'
          : 'Победа снимает осаду. После поражения потери несёт и лагерь, а срок голода считается заново по оставшимся.'}
      </p>
    </div>
  );
}
