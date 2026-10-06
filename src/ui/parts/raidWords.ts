// Окно ответа на набег словами — одна дверь на все входы к нему: строку набега в тревогах, донесение о набеге в почте и
// раздел «Оборона» у частокола и башни.
//
// Окно — до самого прихода отряда (решение владельца 06.10.2026, docs/NOTIFY.md, 12.11): дома перевод дружины
// мгновенный, и слов о сборе («сбор ещё …», «полный сбор не успеет») больше нет нигде. Секунды до прихода —
// `world/store.raidWindow`, слова — здесь, и входы их не повторяют: ни один не зовёт `raidWindow` сам и не пишет своих
// слов об окне. Держит это тест по исходнику (`raidWords.test.ts`). Прежде на этом месте стоял замок обороны
// (`parts/defenseLock`, поставка 2 боя его сняла — docs/battle_eu4.md, 14.27), и урок у него тот же: входы со своими
// словами разойдутся ровно так, как расходились часы голода, пока их округлял каждый.
import { useEffect, useState } from 'react';
import { realLeft } from '@/ui/parts/wait';
import { marchesOnHome, raidWindow, useWorld, worldNow, type RaidWindow } from '@/world/store';

export interface RaidWords {
  /** Ответ мира как есть: какой отряд и сколько до его прихода — столько и длится окно ответа. */
  win: RaidWindow;
  /** Срок до прихода — у входа, у стены и в донесении. */
  left: string;
  /** Строка целиком: у стены. */
  long: string;
}

/** Слова об окне по ответу `raidWindow`. Чистая функция: её сверяет тест на границе окна. */
export function raidWords(win: RaidWindow): RaidWords {
  return { win, left: realLeft(win.seconds), long: 'У стен их встретит гарнизон.' };
}

/**
 * Окна отрядов, идущих на деревню, ближайший первым, — словами в эту секунду. Чужой поход мимо нас (логово на логово)
 * и выручка на наш лагерь сюда не попадают: их строка звала бы к обороне деревни, на которую никто не идёт
 * (`store.marchesOnHome`; выручку показывает «Идут на нас» — `store.marchesOnUs`).
 * Пока кто-то идёт, отсчёт обязан идти сам: замерший счётчик читается как сломанный экран, а не как «время есть».
 */
export function useRaidWords(): RaidWords[] {
  const marches = useWorld((g) => g.marches);
  const homeId = useWorld((g) => g.info?.homeId);
  const [, retick] = useState(0);
  const now = worldNow();
  const words = marchesOnHome(marches, homeId).map((m) => raidWords(raidWindow(m, now)));
  const moving = words.length > 0;
  useEffect(() => {
    if (!moving) return;
    const t = setInterval(() => retick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [moving]);
  return words;
}
