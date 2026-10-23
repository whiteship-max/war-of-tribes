// ОС-1 (docs/siege_v2.md, раздел 23): ложная сдача голодом — воспроизведение на настоящем мире до правки.
//
// Посёлок мерки 8-го уровня живёт шагом игры (`tick`), логово садится лагерем под стенами. Лагерь встал зимой: окно осады
// заморозило зимний расход (×1.4 сезона) на всю осаду, а племя после зимы ест меньше. Мост урезает склад до остатка окна
// (`sim/siege.breadCap`, «вниз и только вниз»), и город падает голодом в минуту прогноза окна — с хлебом, который у
// племени был и который мост снял со склада.
import '@/game/pace.minute';
import { describe, expect, it } from 'vitest';
import { gameDaysOfMs, gameSeconds } from '@/game/pace';
import { foodConsumptionPerDay, seasonOf } from '@/game/derived';
import { tick } from '@/game/sim/tick';
import { HOME_ID } from './local/LocalWorld';
import { starvesAt } from './siege';
import { openSky, townAt, START, type Inside } from '../../scripts/autopilot';

/** Осада логова мощью `power` у посёлка `level`, лагерь встаёт `shift` игровых дней спустя (сезон). Пульс — настоящая минута. */
async function siegeRun(level: number, power: number, shift: number) {
  const g = townAt(level);
  g.time += shift * 60;
  let fallFood: number | null = null;
  let fall = '';
  const sky = openSky(g, { seed: 7, pulse: 30, raids: true, ripe: true }, {
    effect: (e) => {
      if (fallFood === null && /голод|доела|ворота/i.test(e.text)) {
        fallFood = g.resources.food;
        fall = e.text;
      }
    },
  });
  await sky.pulse();
  const w: Inside = sky.world;
  w.save.nextAiAt = sky.now();
  w.scheduleAi(sky.now());
  const m = w.save.marches.find((x: Inside) => !x.own && x.targetId === HOME_ID);
  m.power = power;
  m.units = { warrior: Math.round(power / 3) };
  let cut = 0;
  let sat: { at: number; season: string; eats: number; hunger: number } | null = null;
  for (let i = 0; i < 6000; i++) {
    sky.at(sky.now() + 60_000);
    tick(g, gameSeconds(60));
    const before = g.resources.food;
    const p = await sky.pulse();
    const win = w.save.sieges[HOME_ID];
    if (win && !sat) sat = { at: sky.now(), season: seasonOf(g.time), eats: foodConsumptionPerDay(g), hunger: gameDaysOfMs(starvesAt(win) - sky.now()) };
    if (win && !p.effects.some((e) => e.id.endsWith('-fell'))) cut += Math.max(0, before - g.resources.food);
    if (sat && !win) return { sat, cut, fall, fallFood, endDay: gameDaysOfMs(sky.now() - START) };
  }
  throw new Error('осада не кончилась');
}

describe('ОС-1: причина ложной сдачи (до правки)', () => {
  it('лагерь встал зимой: мост снял со склада хлеб, которого окно не видит, и город пал по прогнозу окна', async () => {
    const r = await siegeRun(8, 3000, 5);
    expect(r.sat.season, 'точка внутри области: лагерь встал зимой').toBe('winter');
    expect(r.fall, 'город пал голодом').toMatch(/доела/);
    expect(r.cut, `мост урезал склад на ${Math.round(r.cut)} хлеба (зимний расход окна ${Math.round(r.sat.eats)}/день на всю осаду, голод через ${r.sat.hunger.toFixed(1)} игр. дн., пал на ${r.endDay} игр. дн.)`).toBeGreaterThan(0);
  }, 120_000);
});
