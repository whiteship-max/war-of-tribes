// Чужие отряды бродяг на карте (ПН-4у, docs/gdd/path_of_sword.md, 3.5.4 и «Решения ПН-4у») — у лорда и у бродяги, своим куском:
// карта открывает его только за `ROAM_ON` (`WorldMap`) и вешает на крючок видимости (`roamhook.setSightHook`). Обнаруженный сервером
// отряд — живьём (знамя, лагерь, колонна, люди); не обнаруженный — его нет вовсе; потерянный из обзора — следом с давностью
// (`world/bandsight`). Касание отряда или следа — строкой: кто, сколько, когда видели.
import { useEffect } from 'react';
import { useGame } from '@/game/store';
import { serverNow } from '@/net/clock';
import { useBandSight, type BandMark } from '@/world/bandsight';
import { setSightHook } from '../roamhook';
import { agoText } from '../feedWords';
import { bandAt, paintBands } from './paint';

const CAMP_WORDS: Record<NonNullable<BandMark['camp']>, string> = { open: 'открытым лагерем', hidden: 'скрытым лагерем', ruin: 'лагерем в руинах' };

/** Чужой отряд словами — для касания. */
export function bandWords(m: BandMark, now: number): string {
  const who = `Отряд героя ${m.name || 'без имени'} · ${m.men} чел.`;
  if (!m.visible) return `След: ${who} — видели ${agoText(now - m.seenAt)}.`;
  return `${who} — ${m.camp ? `стоит ${CAMP_WORDS[m.camp]}` : m.heading ? 'идёт колонной' : 'стоит в поле'}, виден сейчас.`;
}

export default function BandsLayer() {
  const showToast = useGame((g) => g.showToast);
  useEffect(() => {
    setSightHook({
      paint: (ctx, cam, vp, dpr) => paintBands(ctx, cam, vp, dpr, serverNow(), useBandSight.getState().marks),
      tap: (c) => {
        const m = bandAt(useBandSight.getState().marks, c);
        if (!m) return false;
        showToast(bandWords(m, serverNow()));
        return true;
      },
    });
    return () => setSightHook(null);
  }, [showToast]);
  return null;
}
