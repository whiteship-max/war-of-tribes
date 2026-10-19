// Удар полководца по лагерю: одна часть на окно осады своего города и на меню
// полководца у чужого лагеря. Кто пробьётся с тыла и — если позвать гарнизон — со
// стороны города, считает мир той же функцией, что и бой (`LocalWorld.strikePlan`),
// а кнопка гаснет ровно тогда, когда гаснет план, и говорит почему.
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld } from '@/world/store';
import { waitLeft } from '@/ui/parts/wait';
import { perilText } from '@/world/peril';
import type { SettlementId, StrikePlan } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';

/**
 * Удар с тыла без гарнизона — одной дружиной; строка стоит рядом с кнопкой, пока галочка гарнизона снята и есть что
 * отметить (`StrikePlan.garrisonable` — лагерь под своим городом).
 */
export const REAR_ALONE = 'С тыла бьёт один отряд. С гарнизоном удар пойдёт с двух сторон.';

export function CampStrike({ target, onDone }: { target: SettlementId; onDone?: () => void }) {
  const showToast = useGame((g) => g.showToast);
  const strikePlan = useWorld((g) => g.strikePlan);
  const strikeCamp = useWorld((g) => g.strikeCamp);
  // План живёт пульсом: проход освобождается, рогатки растут, полководец идёт.
  const now = useWorld((g) => g.now);
  const [garrison, setGarrison] = useState(false);
  const [plan, setPlan] = useState<StrikePlan | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void strikePlan(target, garrison).then((p) => {
      if (live) setPlan(p);
    });
    return () => {
      live = false;
    };
  }, [target, garrison, now, strikePlan]);

  const go = async (): Promise<void> => {
    setBusy(true);
    const err = await strikeCamp(target, garrison);
    setBusy(false);
    showToast(err ?? (plan?.seconds ? 'Отряд вышел к лагерю.' : 'Отряд ударил по лагерю. Донесение в походах.'));
    if (!err) onDone?.();
  };

  return (
    <>
      <button className={`am-row${plan?.can ? '' : ' off'}`} disabled={busy || !plan?.can} onClick={() => void go()}>
        <span className="ico"><Icon name="stage-camp" /></span>
        <span className="body">
          <b>Ударить с тыла</b>
          <i>
            {!plan
              ? 'Считаем проход…'
              : !plan.can
                ? plan.reason
                : `${plan.seconds > 0 ? `В пути ${waitLeft(plan.seconds)}. ` : ''}С тыла пробьются ${plan.rear.passed} из ${plan.rear.went}${
                    plan.front ? `, от города ${plan.front.passed} из ${plan.front.went}` : ''
                  }. Разобьёшь лагерь, осада снята.${plan.energy ? ` Энергия полководца — ${plan.energy.price}.` : ''}`}
          </i>
          {plan?.can && plan.garrisonable && !garrison && (
            // Без прогноза исхода — его в игре нет нигде (docs/handbook/battle.md, «Подготовка боя и отчёт»): только кто бьёт и чем ещё
            // можно ударить (слово владельца, docs/battle_eu4.md, 14.35).
            <i>{REAR_ALONE}</i>
          )}
          {plan?.can && (
            // Условно и только так: шанс поражения не показывается нигде.
            <i className="am-risk">Риск гибели полководца {perilText(plan.rout)}, если отряд перебьют.</i>
          )}
        </span>
      </button>
      {plan?.garrisonable && (
        <label className="am-plain">
          <input type="checkbox" checked={garrison} onChange={(e) => setGarrison(e.target.checked)} /> Подключить
          гарнизон. Выйдет весь и ударит от города, кто не пробьётся, вернётся за стену.
        </label>
      )}
    </>
  );
}
