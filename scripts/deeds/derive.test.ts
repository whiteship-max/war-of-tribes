// Таблица наград разового дела (AC-1) сверяется с данными игры: выведенное заново буква в букву равно записанному
// (`src/game/data/deedgain.ts`). Поправил весть, награду задания, ежедневку, груз бойца, лот лавки или привоз и не пересобрал
// таблицу (`npx vite-node scripts/deeds/build.ts`) — красный тест: сервер мерил бы честную партию вчерашними наградами.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEED_MARGIN, DEED_TABLE } from '@/game/data/deedgain';
import { QUESTS } from '@/game/data/quests';
import { EVENTS } from '@/game/data/events';
import { isCrown } from '@/game/crownrules';
import { deriveDeedTable, eventsPerScale, questFlat, renderDeedTable } from './derive';

const FILE = fileURLToPath(new URL('../../src/game/data/deedgain.ts', import.meta.url));

describe('таблица наград разового дела — из данных игры', () => {
  it('записанная таблица — ровно вывод из данных', () => {
    expect(readFileSync(FILE, 'utf8')).toBe(renderDeedTable(deriveDeedTable()));
  }, 60_000);

  it('вывод прогоняет каждый ответ вести и вести державы, запас — ×1.2 над выведенным', () => {
    // Точки внутри правила: ответы правда исполнены, а не пропущены отказом; вести державы — в общем списке вестей.
    expect(eventsPerScale().answers).toBeGreaterThan(3000);
    expect(EVENTS.some((e) => isCrown(e.id))).toBe(true);
    expect(DEED_MARGIN).toBe(1.2);
    // Награда задания — постоянная часть: наибольшая награда по виду с запасом и единицей округления.
    const flat = questFlat();
    const food = Math.max(...QUESTS.map((q) => q.reward.food ?? 0));
    expect(flat.food).toBe(food);
    expect(DEED_TABLE.gain.flat.food).toBe(Math.ceil((food + 1) * DEED_MARGIN));
  }, 60_000);
});
