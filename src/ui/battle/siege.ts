// Запись осады из донесения → вход ролика осады (docs/gfx.md, ГФ-2). Ролик мира не читает (как ролик боя): что посчитала
// осада, сюда переводят двери мира — те же, что у окна осады, — и только они:
//   проломы после каждой фазы — `siegeroll.breachesOf` по фазам до неё включительно;
//   залп фазы — `volleyIn`; камнемёт к броску — `machines.mangonelAt`;
//   готовность, трата и пожар машин — `machines.machinesAt` (сожжённая — минута пожара в `MachineOrder.spent`);
//   выбитое башней — запись (`SiegeRecord.thinned`: то же число, что мир списал с лагеря; считает его только мир);
//   свет минуты — час племени (`derived.solarPhase` от игрового времени: минута раньше конца — время раньше на столько же).
// Подписи эпизодов с числами — тоже словами мира: строка журнала фазы (`siegeroll.phaseText`), имена машин
// (`MACHINE_NAME`), участь (`FATE_META`), донесение — своим заголовком и текстом (CLAUDE.md, правило 18).
//
// Из сцены осады отсюда берутся только типы и мерка эпизода боя (`show.fightEpisode`, крохотный модуль без сцены): значения
// сцены лежат в её ленивом куске (`render/siege/play.ts`).
import { fightEpisode, type ShowFight, type ShowMachine, type ShowMachineState, type ShowOpening, type ShowPhase, type SiegeShow } from '@/render/siege/show';
import type { Episode } from '@/render/siege/reel';
import { NOON, groundOf } from '@/game/battle/ground';
import { gameSecondsOfMs } from '@/game/pace';
import { dayFraction, seasonOf, solarPhase } from '@/game/derived';
import { asWindow, fellBy, type SiegeEnd, type SiegeRecord } from '@/world/siegerecord';
import { siegeSince } from '@/world/siege';
import { OUT_NAMES, breachesOf, phaseOf, phaseText, repairDoneAt, repairsOf, rowsOf, volleyIn } from '@/world/siegeroll';
import { SIEGE_PHASE } from '@/world/data/siegeroll';
import { MACHINE_NAME, machinesAt, mangonelAt } from '@/world/machines';
import { FATE_META } from '@/world/data/fates';
import type { Report } from '@/world/types';

/** Свет минуты осады: час племени в эту минуту — доля суток рига. Места нет — полдень. */
function solarOf(rec: SiegeRecord, ms: number): number {
  const time = rec.place?.time;
  if (time === undefined) return NOON;
  const t = Math.max(0, time - gameSecondsOfMs(rec.end.at - ms));
  return solarPhase(dayFraction(t), seasonOf(t));
}

/**
 * Фаза, на которую пришлась минута: минута после броска k−1 и до броска k включительно — фаза k. Бросок фазы — её конец
 * (`siegeroll.phaseAt`): ворота, открытые броском пятой фазы, — пятая фаза, а не шестая, как вышло бы у `phaseOf`, который
 * считает фазу, начатую с этой минуты.
 */
const phaseAtMs = (rec: SiegeRecord, ms: number): number => {
  const since = siegeSince(asWindow(rec));
  return Math.max(1, phaseOf(since, ms) - (ms > since && (ms - since) % SIEGE_PHASE === 0 ? 1 : 0));
};

/** Запись осады → что показать: фазы, машины, бои, исход — дверями мира. */
export function showOfSiege(rec: SiegeRecord, report?: Report): SiegeShow {
  const w = asWindow(rec);
  const rows = rowsOf(w);
  const since = siegeSince(w);
  const fixes = repairsOf(w).map((d) => repairDoneAt(since, d.at));
  const phases: ShowPhase[] = rows.map((row, i) => {
    const k = i + 1;
    const prev = i === 0 ? since : rows[i - 1].at;
    return {
      k,
      out: row.out,
      breaches: breachesOf(w, rows.slice(0, k), row.at),
      repaired: fixes.filter((t) => t > prev && t <= row.at).length,
      volley: volleyIn(w, k),
      mangonel: mangonelAt(w, row.at),
      waste: row.waste,
      solar: solarOf(rec, row.at),
    };
  });
  const endK = Math.min(phaseAtMs(rec, rec.end.at), rows.length + 1);
  // Машины в минуту конца: готовность — фаза, к броску которой стояла; сожжённая — фаза пожара; на штурм — пущена.
  const states = machinesAt(w, rec.end.at);
  const machines: ShowMachineState[] = states.map((m) => {
    const ready = Number.isFinite(m.readyAt) && m.readyAt <= rec.end.at ? Math.max(0, phaseAtMs(rec, m.readyAt) - (m.readyAt <= since ? 1 : 0)) : null;
    return {
      id: m.id as ShowMachine,
      ready: ready === null ? null : Math.min(ready, endK),
      spent: m.spent !== undefined && !m.burned,
      burned: m.burned && m.spent !== undefined ? phaseAtMs(rec, m.spent) : null,
      solar: solarOf(rec, Math.min(rec.end.at, Number.isFinite(m.readyAt) ? m.readyAt : rec.end.at)),
    };
  });
  const fights: ShowFight[] = (rec.fights ?? []).map((f) => ({
    k: Math.min(phaseAtMs(rec, f.at), endK),
    site: f.site,
    won: f.won,
    ...(f.machine ? { machine: f.machine } : {}),
    ...(f.ally ? { ally: true } : {}),
    ...(f.report ? { report: f.report } : {}),
    ...(f.at >= rec.end.at ? { end: true } : {}),
    solar: solarOf(rec, f.at),
  }));
  // Бой, которым кончилась осада, — донесение о нём само (штурм, вылазка, удар, разбившие лагерь).
  const endBattle = report?.battle?.site && (rec.end.how === 'storm' || rec.end.how === 'broken') ? report : null;
  if (endBattle && !fights.some((f) => f.end)) {
    fights.push({ k: endK, site: endBattle.battle!.site!, won: endBattle.won, report: endBattle.id, end: true, solar: solarOf(rec, rec.end.at) });
  }
  // Чем лезли на штурм — проёмы записи боя; записи боя нет (донесение о падении после штурма войны) — пущенные на штурм
  // машины (`machines.machinesSpent`: лестницы, таран — ворота, башня) и проломы, иначе лестницы на себе.
  const spentOn: ShowOpening[] = [];
  for (const m of machines) if (m.spent) spentOn.push(m.id === 'ram' ? 'gate' : m.id === 'mangonel' ? 'breach' : (m.id as ShowOpening));
  const openings = endBattle?.battle?.openings?.map((o) => o.id as ShowOpening) ?? (spentOn.length ? [...new Set(spentOn)] : undefined);
  return {
    us: rec.us,
    seed: (rec.startedAt % 2147483647) ^ 0x5eed,
    wall: rec.wall ?? 0,
    tower: rec.tower ?? 0,
    camp: rec.camp,
    garrison: rec.garrison,
    phases,
    machines,
    fire: rec.thinned ?? 0,
    ration: Boolean(rec.ration),
    fights,
    end: {
      how: rec.end.how,
      fate: fellBy(rec.end.how) ? (rec.end.fate ?? rec.fate ?? 'plunder') : null,
      k: endK,
      breaches: breachesOf(w, rows, rec.end.at),
      solar: solarOf(rec, rec.end.at),
      ...(rec.end.how === 'storm' ? { openings: openings ?? ['scaling'] } : {}),
    },
    solar0: solarOf(rec, since),
    ground: groundOf(rec.place, rec.startedAt % 100003),
  };
}

/** Чем кончилась осада — словами для полосы и карточки. */
export const END_WORDS: Record<SiegeEnd, string> = {
  hunger: 'Город доели голодом',
  gates: 'Ворота открыли',
  terms: 'Сдача на условиях',
  storm: 'Город взят штурмом',
  broken: 'Лагерь разбит',
  wasted: 'Лагерь растаял',
  paid: 'Дань отдана, лагерь снят',
  ransom: 'Выкуп взят, лагерь снят',
  left: 'Лагерь ушёл',
};

/** Подпись эпизода: что случилось — словами мира. Числа — только из записи и её дверей. */
export function captionOf(rec: SiegeRecord, ep: Episode, report?: Report): string {
  const w = asWindow(rec);
  const rows = rowsOf(w);
  const row = rows[ep.k - 1];
  switch (ep.kind) {
    case 'pitch':
      return rec.wall
        ? `Лагерь встал под стенами: частокол ${rec.wall}-го уровня, в гарнизоне ${rec.garrison}, в лагере ${rec.camp}.`
        : `Лагерь встал у частокола логова: в лагере ${rec.camp}.`;
    case 'fire':
      return `Башня бьёт по лагерю: к концу осады выбила ${Math.round((rec.thinned ?? 0) * 100)} % лагеря.`;
    case 'machines':
      return `Готовы: ${(ep.machines ?? []).map((id) => MACHINE_NAME[id].toLowerCase()).join(', ')}.`;
    case 'repair':
      return row ? `Пролом заделывают к броску ${ep.k}-й фазы.` : 'Пролом заделывают.';
    case 'breach':
    case 'volley':
    case 'plague':
    case 'short':
      return row ? phaseText(row, ep.k) : OUT_NAMES.calm;
    case 'sortie':
    case 'relief':
    case 'assault':
      return fightWords(ep);
    case 'fate': {
      const f = rec.end.fate ?? rec.fate ?? 'plunder';
      return `${FATE_META[f].title}.`;
    }
    default:
      return report && ep.kind === rec.end.how ? `${report.title}. ${report.text}` : `${END_WORDS[ep.kind as SiegeEnd]}.`;
  }
}

function fightWords(ep: Episode): string {
  const f = ep.fight;
  if (!f) return '';
  if (f.machine) return `Вылазка на машину «${MACHINE_NAME[f.machine].toLowerCase()}»: ${f.won ? 'сожгли' : 'отбита'}.`;
  if (fightEpisode(f.site) === 'assault') return f.won ? 'Штурм: город взят.' : 'Штурм отбит, осада идёт дальше.';
  if (f.site === 'joint') return f.won ? 'Клещи: гарнизон из ворот и дружина с поля — лагерь разбит.' : 'Клещи: лагерь устоял.';
  if (f.site === 'camp') return f.ally ? `Союзник пришёл на выручку: ${f.won ? 'лагерь разбит' : 'отбит'}.` : `Удар по лагерю с поля: ${f.won ? 'лагерь разбит' : 'лагерь устоял'}.`;
  return f.won ? 'Вылазка: лагерь разбит.' : 'Вылазка отбита.';
}

/** Короткие ролики донесения: пролом каждой фазы, бои, развязка — чем заголовок кнопки. */
export interface SiegeClip {
  kind: Episode['kind'];
  k: number;
  label: string;
}

/** Какие короткие ролики есть у этой осады (те же эпизоды, что выберет режиссура: пролом, бой, развязка). */
export function clipsOfSiege(rec: SiegeRecord): SiegeClip[] {
  const show = showOfSiege(rec);
  const out: SiegeClip[] = [];
  let before = 0;
  for (const p of show.phases) {
    const opened = p.out === 'breach' && p.breaches > before - p.repaired;
    if (opened && show.wall > 0) out.push({ kind: 'breach', k: p.k, label: `Пролом · ${p.k}-я фаза` });
    before = p.breaches;
  }
  for (const f of show.fights.filter((x) => !x.end)) {
    const kind = fightEpisode(f.site);
    out.push({ kind, k: f.k, label: `${kind === 'assault' ? 'Штурм' : kind === 'relief' ? 'Удар по лагерю' : 'Вылазка'} · ${f.k}-я фаза` });
  }
  out.push({ kind: rec.end.how, k: show.end.k, label: END_WORDS[rec.end.how] });
  return out.sort((a, b) => a.k - b.k);
}
