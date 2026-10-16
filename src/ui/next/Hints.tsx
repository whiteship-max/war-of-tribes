// Подсказки новичку по ходу игры (docs/rating.md): по одной плашке, когда к ней пора, один раз. Плашка — та же дверь
// подсказки, что у чисел верха (`tip.ts`, `TipLayer`): встаёт у своего элемента, ссылка ведёт дальше. Касаний мимо себя она
// не ловит (`TipContent.free`): город и постройки под ней отвечают, как без неё, а закрывает её касание по ней самой или
// крестик. Что и когда — данные `game/data/hints.ts`; показанные и выключатель — `sim/hints` (поле партии).
//
// Встаёт только в спокойную минуту: обучение прошло, игрок в городе, ни шторки, ни державы, ни окна, ни другой плашки.
// Город занят (`cityBusy`) — вставшая прячется до возвращения, тем же правилом. Первая — не раньше `HINT_FIRST_MS` после
// входа, следующая — не раньше `HINT_GAP_MS` после предыдущей: подсказки не сыплются подряд, а приходят по ходу игры.
import { useEffect } from 'react';
import { useGame } from '@/game/store';
import { tutorialActive } from '@/game/data/tutorial';
import { HINTS, type HintCtx, type HintDef, type HintGo } from '@/game/data/hints';
import { hintSeen, hintsOff, markHint } from '@/game/sim/hints';
import { energyFullIn } from '@/game/sim/minigames';
import { castleCell, castles } from '@/net/roster';
import { useRealm } from '@/ui/realm/open';
import { energyNow, useTrades } from '@/ui/trades';
import { modalUp, rectOf, useTip, type TipContent } from './tip';
import { goTo as goToSource } from '@/ui/kit/nav';
import { WINDOW } from '@/ui/kit/sources';
import type { GameState } from '@/game/types';

/** Первая подсказка — не раньше этого после входа в партию: сперва игрок смотрит на город сам. */
export const HINT_FIRST_MS = 20_000;
/** Между подсказками — не меньше этого. */
export const HINT_GAP_MS = 90_000;
/** Как часто проверять, не пора ли. */
const CHECK_MS = 3_000;

/** Городов других игроков рядом: реестр без своей клетки. */
function othersNear(): number {
  const mine = castleCell();
  return castles().filter((c) => !mine || c.x !== mine.x || c.y !== mine.y).length;
}

/** Первая непоказанная подсказка, которой пора. Чистая — её сверяет тест. */
export function nextHint(s: GameState, ctx: HintCtx): HintDef | null {
  if (hintsOff(s) || tutorialActive(s)) return null;
  return HINTS.find((h) => !hintSeen(s, h.id) && h.due(s, ctx)) ?? null;
}

const gameBusy = (g: { mapOpen: boolean; sheet: unknown }): boolean => g.mapOpen || g.sheet !== null;
const tradesBusy = (t: { open: boolean; playing: unknown }): boolean => t.open || t.playing !== null;

/** Город занят своим — картой, шторкой, державой или промыслами: подсказка новичку не встаёт, а вставшая прячется. */
export const cityBusy = (): boolean => gameBusy(useGame.getState()) || useRealm.getState().open || tradesBusy(useTrades.getState());

/** То же правило подпиской: слой подсказки перерисуется, когда город займут или освободят. */
export function useCityBusy(): boolean {
  const game = useGame(gameBusy);
  const realm = useRealm((r) => r.open);
  const trades = useTrades(tradesBusy);
  return game || realm || trades;
}

/** Плашка подсказки новичку: свободная — касаний мимо себя не ловит (`TipContent.free`). */
export const hintTip = (hint: HintDef): TipContent => ({
  title: hint.title,
  body: hint.body,
  link: { label: hint.link.label, go: goTo(hint.link.go) },
  free: true,
});

/** Куда ведёт ссылка: имя двери из данных — в саму дверь. */
function goTo(go: HintGo): () => void {
  const g = useGame.getState();
  switch (go) {
    case 'townhall':
      return () => g.openTownHall();
    case 'army':
      // Туда же, куда кнопка низа «Дружина» (`next/Nav`): одна кнопка — одно место (Д1).
      return () => goToSource(WINDOW.army);
    case 'map':
      return () => g.openMap();
    case 'trades':
      return () => useTrades.getState().show();
  }
}

export function Hints() {
  useEffect(() => {
    const born = performance.now();
    let last = -Infinity;
    const check = (): void => {
      const now = performance.now();
      if (now - born < HINT_FIRST_MS || now - last < HINT_GAP_MS) return;
      if (cityBusy() || useTip.getState().open || modalUp() || document.querySelector('.tut-bar')) return;
      const g = useGame.getState();
      const hint = nextHint(g.s, { others: othersNear(), energyFull: energyFullIn(g.s, energyNow()) === 0 });
      if (!hint) return;
      const el = document.querySelector(hint.anchor);
      if (!el) return;
      const at = rectOf(el);
      if (at.w < 1 || at.h < 1) return;
      last = now;
      // Показана — значит показана: отметка ложится сразу, а не по закрытию, — закрытую перезапуском второй раз не покажем.
      g.world((st) => markHint(st, hint.id));
      useTip.getState().show(at, hintTip(hint));
    };
    const timer = setInterval(check, CHECK_MS);
    return () => clearInterval(timer);
  }, []);
  return null;
}
