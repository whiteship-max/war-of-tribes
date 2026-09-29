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

/**
 * Удар с тыла без гарнизона — одной дружиной; строка стоит рядом с кнопкой, пока галочка гарнизона снята и есть что
 * отметить (`StrikePlan.garrisonable` — лагерь под своим городом).
 */
export const REAR_ALONE = 'С тыла бьёт одна дружина. Отметьте «Подключить гарнизон» — удар с двух сторон одним боем.';

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
    showToast(err ?? (plan?.seconds ? 'Полководец пошёл бить лагерь.' : 'Дружина ударила по лагерю. Отчёт в походах.'));
    if (!err) onDone?.();
  };

  return (
    <>
      <button className={`am-row${plan?.can ? '' : ' off'}`} disabled={busy || !plan?.can} onClick={() => void go()}>
        <span className="ico">⛺</span>
        <span className="body">
          <b>Полководцу — ударить с тыла</b>
          <i>
            {!plan
              ? 'Считаем проход…'
              : !plan.can
                ? plan.reason
                : `${plan.seconds > 0 ? `Дойдёт через ${waitLeft(plan.seconds)}. ` : ''}С тыла пробьются ${plan.rear.passed} из ${plan.rear.went} бойцов строя${
                    plan.front ? `, со стороны города — ${plan.front.passed} из ${plan.front.went}` : ''
                  }${plan.seconds > 0 ? ' — если до прихода проход не займут' : ''}. Разобьёшь — осада снята.`}
          </i>
          {plan?.can && plan.garrisonable && !garrison && (
            // Без прогноза исхода — его в игре нет нигде (CLAUDE.md, «Подготовка боя и отчёт»): только кто бьёт и чем ещё
            // можно ударить (слово владельца, docs/battle_eu4.md, 14.35).
            <i>{REAR_ALONE}</i>
          )}
          {plan?.can && (
            // Условно и только так: шанс поражения не показывается нигде.
            <i className="am-risk">Если дружину перебьют до последнего, полководец погибнет с шансом {perilText(plan.rout)}.</i>
          )}
        </span>
      </button>
      {plan?.garrisonable && (
        <label className="am-plain">
          <input type="checkbox" checked={garrison} onChange={(e) => setGarrison(e.target.checked)} /> Подключить
          гарнизон: выйдет весь и полезет со стороны города, дружина — с тыла, бой один. Дерутся только
          пробившиеся, остальные постоят у рогаток и вернутся за стену.
        </label>
      )}
    </>
  );
}
