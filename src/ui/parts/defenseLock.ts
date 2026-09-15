// Заморозка обороны словами — одна дверь на все входы к расстановке: строка набега в
// тревогах, письмо о набеге, карточка своего замка на карте, раздел «Оборона» у частокола
// и башни — и сам экран расстановки.
//
// Заперта ли оборона и до какой минуты, решает одна функция — `world/store.defenseLock`,
// по той же отметке мир защёлкивает расстановку у себя (`LocalWorld.lockDefense`). Здесь
// от её ответа до слов один шаг, и входы его не повторяют: ни один из них не зовёт
// `defenseLock` сам и не пишет своих слов о замке. Держит это тест по исходнику
// (`defenseLock.test.ts`): четыре входа, показывающие заморозку по-своему, разойдутся
// ровно так, как расходились часы голода, пока их округлял каждый.
import { useEffect, useState } from 'react';
import { DEFENSE_FREEZE } from '@/world/data/tuning';
import { formatLeft } from '@/world/geo';
import { defenseLock, useWorld, worldNow, type DefenseLock } from '@/world/store';

/** «5 мин» — за сколько до удара запирается расстановка. */
const FREEZE = `${Math.round(DEFENSE_FREEZE / 60_000)} мин`;

export interface LockWords {
  /** Ответ мира как есть: какой отряд, сколько до прихода и до замка. */
  lock: DefenseLock;
  frozen: boolean;
  /** Короткая строка у входа. null — чужих отрядов в пути нет, и сказать нечего. */
  short: string | null;
  /** Строка целиком: у стены и под шапкой расстановки. */
  long: string;
}

/** Слова о замке по ответу `defenseLock`. Чистая функция: её сверяет тест на границе замка. */
export function lockWords(lock: DefenseLock): LockWords {
  if (!lock.march) {
    return {
      lock,
      frozen: false,
      short: null,
      long: `Чужих отрядов в пути нет — расстановку можно менять когда угодно. Запирается она за ${FREEZE} до удара.`,
    };
  }
  if (lock.frozen) {
    return {
      lock,
      frozen: true,
      short: 'оборона заперта',
      long: `Оборона заперта: меньше ${FREEZE} до удара, строй уже не переставить.`,
    };
  }
  return {
    lock,
    frozen: false,
    // Срок не отрывается от слов переносом: узкая строка тревоги рвала «ещё / 0:58».
    short: `менять ещё\u00a0${formatLeft(lock.freezeIn)}`,
    long: `Чужая армия в пути. Менять оборону можно ещё ${formatLeft(lock.freezeIn)} — до отметки «минус ${FREEZE}».`,
  };
}

/**
 * Замок обороны в эту секунду, словами. Пока кто-то идёт на деревню, отсчёт обязан
 * идти сам: замерший счётчик читается как сломанный экран, а не как «время есть».
 */
export function useLockWords(): LockWords {
  const marches = useWorld((g) => g.marches);
  const [, retick] = useState(0);
  const words = lockWords(defenseLock(marches, worldNow()));
  const moving = words.lock.march !== null;
  useEffect(() => {
    if (!moving) return;
    const t = setInterval(() => retick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [moving]);
  return words;
}
