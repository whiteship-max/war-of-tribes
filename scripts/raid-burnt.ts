// «Сожжённые посёлки» — раздел отчёта `raid-hiring:report` (docs/time.md, раздел 16, пункт 9).
//
// До пачки «зреет по времени» вести при игроке приходили раз в 70–140 игровых секунд, и автопилот
// замеров — он всегда «при игроке» и отвечает первым бесплатным вариантом — разбирал их сотнями за
// прогон. У «Пожара» первый бесплатный вариант отнимает уровень Жилищ, а посёлок мерки уровней не
// строит: крыши выгорали, жители расходились, и столбец «жителей в конце» в лестнице «Найма» мерил
// пожары автопилота, а не поведение найма. Число это жило щупом; раздел делает его командой.
//
// Раздел гоняет те же посёлки мерки с тем же игроком и **прежним ритмом вестей** — подстановкой в
// действие игрока (`Player.also`), игра при этом нынешняя, — и ставит рядом прогоны нынешнего ритма,
// которые «Найм» уже сделал (`Hired.ladder`): второй раз они не гоняются.
import type { GameState } from '@/game/types';
import { buildingOfType, defense, housingCapacity } from '@/game/derived';
import { pickEvent } from '@/game/data/events';
import { raiseEvent } from '@/game/sim/mail';
import { hashId } from '@/world/diplomacy';
import { townAt } from './autopilot';
import { SEEDS, mean, pad, tally } from './raid-common';
import { NAME, live, type Out, type Style } from './raid-live';
import type { Hired } from './raid-hiring';

/** Прежний ритм вестей при игроке, игровых секунд (константы удалены пачкой 3, числа — из истории: `86fa7e9`). */
const OLD_MIN = 70;
const OLD_MAX = 140;
const HOURS = 4;
const LEVELS = [7, 10];
const STYLES_B: Style[] = ['feed', 'meansHigh'];

interface Mail {
  raised: number;
  fires: number;
}

/** Действие игрока, поднимающее вести прежним счётом: раз в 70–140 игровых секунд, вид — кость партии. */
function oldMail(seed: number, m: Mail): (g: GameState) => void {
  let next = -1;
  let k = 0;
  return (g) => {
    if (next < 0) next = g.time + OLD_MIN;
    if (g.time < next) return;
    const e = pickEvent(g);
    if (e && raiseEvent(g, e.id)) {
      m.raised++;
      if (e.id === 'fire') m.fires++;
    }
    k++;
    next = g.time + OLD_MIN + (hashId(`${seed}|old-mail|${k}`) % (OLD_MAX - OLD_MIN + 1));
  };
}

const houses = (g: GameState): number => buildingOfType(g, 'houses')?.level ?? 0;

export async function burntSection(h: Hired): Promise<void> {
  console.log('');
  console.log('=== Сожжённые посёлки: что прежний ритм вестей делал с посёлком мерки ===');
  console.log(`Те же посёлки мерки, тот же игрок и мир, ${HOURS} ч на каждом из ${SEEDS.length} миров, логова дозрели. «прежний» — вести раз в ${OLD_MIN}–${OLD_MAX} игровых секунд`);
  console.log('при игроке (так было до пачки «зреет по времени»), подстановкой в действие игрока; «нынешний» — вести по настоящим часам, прогоны лестницы «Найма»');
  console.log('выше. Автопилот отвечает первым бесплатным вариантом; у «Пожара» он отнимает уровень Жилищ, а посёлок мерки уровней не строит.');
  console.log('«Жилища» и «крыш» — в начале → в конце, среднее по мирам; «жителей» — в конце; «прорвали» и «падений/ч» — как в лестнице.');
  console.log(' поведение                    ур  ритм      вестей  пожаров  Жилища     крыш          жителей  набегов  прорвали  падений/ч  войско в конце');
  for (const level of LEVELS) {
    const ref = defense(townAt(level));
    const start = townAt(level);
    for (const style of STYLES_B) {
      const rows: [string, Out[], Mail | null][] = [];
      const mail: Mail = { raised: 0, fires: 0 };
      const old: Out[] = [];
      for (const seed of SEEDS) old.push(await live({ g: townAt(level), seed, style, hours: HOURS, ripe: true, ref, also: oldMail(seed, mail) }));
      rows.push(['прежний', old, mail]);
      rows.push(['нынешний', h.ladder[`${style}:${level}`] ?? [], null]);
      for (const [name, outs, m] of rows) {
        if (outs.length === 0) continue;
        const t = tally(
          outs.map((o) => o.run),
          HOURS,
        );
        const answered = Math.round(mean(outs.map((o) => o.l.answered)));
        console.log(
          ` ${NAME[style].padEnd(27)} ${pad(level, 2)}  ${name.padEnd(8)}  ${pad(answered, 6)}  ${pad(m ? (m.fires / outs.length).toFixed(1) : '—', 7)}  ${pad(`${houses(start)} → ${mean(outs.map((o) => houses(o.g))).toFixed(1)}`, 9)}  ${pad(`${housingCapacity(start)} → ${Math.round(mean(outs.map((o) => housingCapacity(o.g))))}`, 12)}  ${pad(Math.round(mean(outs.map((o) => o.g.pop))), 7)}  ${pad(t.raids, 7)}  ${pad(t.broke, 8)}  ${pad(t.perHour, 9)}  ${pad(t.armyEnd, 14)}`,
        );
      }
    }
  }
  console.log('«вестей» — отвечено за прогон, среднее по мирам; «пожаров» — поднято «Пожаров» за прогон, среднее по мирам (у нынешнего ритма не считано).');
}
