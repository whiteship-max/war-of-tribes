// Ответы осаждённого — блок окна осады (docs/siege_v2.md, раздел 5; набросок окна — 9.2). Каждое дело с ценой и пользой:
// починка пролома — цена со склада формой `Cost` и минута, когда пролом закроется; паёк — на сколько дольше хватит хлеба и чем
// платит город; вылазка на машину — кто её охраняет; сдача — какая участь вместо объявленной; выручка союзника — кто идёт и
// когда ударит. Своей арифметики у блока нет: числа — из мира (`SiegeView.answers`) и из тех же функций игры
// (`derived.rationMorale`, `SIEGE_RATION`, `SIEGE_RATION_CUT`), которыми их считает племя.
import { useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld } from '@/world/store';
import { SIEGE_RATION, SIEGE_RATION_CUT } from '@/game/constants';
import { rationMorale } from '@/game/derived';
import { FATE_META } from '@/world/data/fates';
import { secondsLeft } from '@/world/geo';
import { cleanDefend, type DefendOrders } from '@/world/siegeroll';
import type { SiegeView } from '@/world/types';
import { Cost } from '@/ui/parts/Cost';
import { BREACH_MAX } from '@/world/data/siegeroll';
import { Btn } from '@/ui/kit/Btn';
import { Toggle } from '@/ui/kit/Toggle';
import { hungerLeft } from '@/ui/parts/hunger';
import { realLeft } from '@/ui/parts/wait';
import { plural } from '@/ui/parts/plural';

/** Паёк словами: доля еды, мораль и надзор — теми же числами, что племя (`derived`). */
export function rationWords(): string {
  return `Еда ×${SIEGE_RATION}, мораль −${Math.round(rationMorale())}, надзор за невольниками −${Math.round(SIEGE_RATION_CUT * 100)}%.`;
}

export function SiegeAnswers({ siege, now }: { siege: SiegeView; now: number }) {
  const showToast = useGame((g) => g.showToast);
  const openSortie = useGame((g) => g.openSortie);
  const defend = useWorld((g) => g.defend);
  const [busy, setBusy] = useState(false);
  const a = siege.answers;
  if (!a) return null;

  const run = async (fn: () => Promise<string | null>): Promise<void> => {
    setBusy(true);
    const err = await fn();
    setBusy(false);
    if (err) showToast(err);
  };
  const orders: DefendOrders = a.defend ?? {};
  const setOrders = (next: DefendOrders): Promise<void> => run(() => defend({ act: 'orders', defend: cleanDefend(next) ?? {} }));
  const breaches = siege.phases?.breaches ?? 0;

  return (
    <>
      <h3>Ответы осаждённого</h3>

      <div className="card">
        <div className="ico">🧱</div>
        <div className="body">
          <div className="title">Заделать пролом</div>
          <div className="desc">
            {a.repair.doneAt !== null
              ? `Пролом заделывают: к концу фазы, через ${realLeft(secondsLeft(a.repair.doneAt, now))}, стена будет цела.`
              : breaches > 0
                ? `К концу фазы проломов станет ${breaches - 1} из ${BREACH_MAX}: меньше пролома — меньше кости осаждающим и фронта без стены.`
                : 'Проломов нет.'}
          </div>
          <Cost cost={a.repair.cost} />
        </div>
      </div>
      <Btn wide why={a.repair.doneAt === null && breaches > 0 ? a.repair.reason : null} onClick={() => void run(() => defend({ act: 'repair' }))}>
        Заделать пролом
      </Btn>

      <div className="card">
        <div className="ico">🥣</div>
        <div className="body">
          <div className="title">{a.ration.on ? 'Паёк урезан' : 'Урезать паёк'}</div>
          <div className="desc">
            {a.ration.on
              ? `${rationWords()} Вернуть паёк — хлеба хватит на ${hungerLeft(a.ration.starvesAt, now)}.`
              : `${rationWords()} Хлеба хватит на ${hungerLeft(a.ration.starvesAt, now)} вместо ${hungerLeft(siege.starvesAt, now)}.`}
          </div>
        </div>
      </div>
      <Btn wide onClick={() => void run(() => defend({ act: 'ration', on: !a.ration.on }))}>
        {a.ration.on ? 'Вернуть паёк' : 'Урезать паёк'}
      </Btn>

      {a.burn.length > 0 && (
        <>
          <p className="note">Машина стоит у стены, перед рогатками. Вылазка на неё бьётся с охраной — стороной лагеря у города, а не со всем лагерем.</p>
          {a.burn.map((m) => (
            <Btn key={m.machine} wide onClick={() => openSortie(m.machine)} sub={`охрана ${m.guard} ${plural(m.guard, 'боец', 'бойца', 'бойцов')}`}>
              Вылазка: {m.name.toLowerCase()}
            </Btn>
          ))}
        </>
      )}

      {a.reliefs.map((r) => (
        <p className="note" key={`${r.from}-${r.at}`}>
          Союзник «{r.from}» идёт на выручку: {r.men} {plural(r.men, 'боец', 'бойца', 'бойцов')}, ударит по лагерю с тыла через{' '}
          {realLeft(secondsLeft(r.at, now))}.
        </p>
      ))}

      {/* Наказы на отлучку — переключателями 44, а не родными флажками с подписью 12 px (К5, UI-7). */}
      <h3>Наказы на отлучку</h3>
      <Toggle
        label="Заделывать пролом"
        sub="Пока хватает дерева и камня; срабатывает в минуту фазы"
        on={Boolean(orders.repair)}
        disabled={busy}
        onChange={(on) => void setOrders({ ...orders, repair: on })}
      />
      <Toggle
        label="Урезать паёк"
        sub="Когда хлеба меньше половины"
        on={Boolean(orders.ration)}
        disabled={busy}
        onChange={(on) => void setOrders({ ...orders, ration: on })}
      />

      <h3>Сдача</h3>
      <p className="note">
        Откроешь ворота сам — участь «{FATE_META[a.surrender].name.toLowerCase()}» вместо «{FATE_META[siege.fate].name.toLowerCase()}», гарнизон
        уйдёт живым.
      </p>
      {/* Необратимое — двумя касаниями одной кнопки (`kit/twotap`): прежде здесь была своя пара «Открыть ворота · Держаться». */}
      <Btn wide confirm onClick={() => void run(() => defend({ act: 'surrender' }))}>
        Сдать город
      </Btn>
    </>
  );
}
