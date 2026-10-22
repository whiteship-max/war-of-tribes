// Ратуша под советом (РТ-1; прежде — под сеткой «Стройки», UI-7, docs/ui_v2.md, 5.6): что она даёт городу и дверь в «Указы»
// державы. Вкладка «Указы» ратуши была второй копией державы (находка Д3: указ, паёк, налог в двух местах); их правят там, где
// казна, — здесь от них строка-дверь. Едет в куске нового вида: первая загрузка за набор не платит.
//
// Своих чисел нет: скорость стройки — `townHallBuildMult`, мораль и жильё — пассивы постройки (`buildingStat`), уровень,
// с которого жильё начинается, — запись постройки (`since`).
import type { Building } from '@/game/types';
import { useGame } from '@/game/store';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { buildingHousing, buildingStat, townHallBuildMult } from '@/game/derived';
import { dec } from '@/game/num';
import { COUNCIL_STEP, MAX_ADVISOR_LEVEL, candidateCount, councilTier } from '@/game/councilrules';
import { Table, type Col } from '@/ui/kit/Table';
import { Row } from '@/ui/kit/Row';
import { goTo } from '@/ui/kit/nav';
import { WINDOW } from '@/ui/kit/sources';
import './hall.css';

const COLS: readonly Col[] = [
  { key: 'name', title: 'Ратуша даёт городу' },
  { key: 'v', title: 'Сейчас', align: 'right', w: '72px' },
];

/** Строки «что даёт»: скорость стройки всегда, мораль — если есть, жильё — числом или «с ур. N», ступень совета (РТ-1). */
export function hallGives(b: Building, buildMult: number): { key: string; name: string; v: string; body: string }[] {
  const housing = buildingHousing(b);
  const morale = buildingStat(b, 'morale');
  const since = BUILDING_BY_ID[b.type].since?.housing ?? 1;
  const out = [
    { key: 'build', name: 'К скорости стройки', v: `×${dec(buildMult, 2)}`, body: 'Множитель всей стройки города: растёт с уровнем ратуши.' },
  ];
  if (morale > 0) out.push({ key: 'morale', name: 'К морали', v: `+${morale}`, body: 'Прибавка к цели морали, пока ратуша стоит.' });
  out.push({
    key: 'housing',
    name: 'Жилых мест',
    v: housing > 0 ? String(housing) : `с ур. ${since}`,
    body: housing > 0 ? 'Ратуша даёт крыши, как Дома.' : `Жильё в ратуше — с ${since}-го уровня.`,
  });
  // Ступень совета (РТ-1): лучший уровень просителя и сколько их на место — по уровню ратуши (`councilrules`).
  const tier = councilTier(b.level);
  const next = (tier < MAX_ADVISOR_LEVEL ? tier : MAX_ADVISOR_LEVEL - 1) * COUNCIL_STEP + 1;
  out.push({
    key: 'council',
    name: 'Ступень совета',
    v: `${tier} из ${MAX_ADVISOR_LEVEL}`,
    body:
      tier < MAX_ADVISOR_LEVEL
        ? `Просители до ${tier}-го уровня, на место — ${candidateCount(b.level)}. Следующая ступень — с ${next}-го уровня ратуши.`
        : `Просители до ${tier}-го уровня, на место — ${candidateCount(b.level)}. Это высшая ступень.`,
  });
  return out;
}

export function HallGives({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  return (
    <section className="hall-gives">
      <Table
        label="Ратуша даёт городу"
        cols={COLS}
        rows={hallGives(b, townHallBuildMult(s)).map((r) => ({ key: r.key, cells: { name: r.name, v: r.v }, tip: () => ({ title: `${r.name} · ${r.v}`, body: r.body }) }))}
      />
      <Row icon={'bld-town_hall'} label="Указы" sub="Указ, паёк и налог — в державе, рядом с золотом" go={() => goTo(WINDOW.gold)} goLabel="К указам" />
    </section>
  );
}
