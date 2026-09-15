// Приглашение не показывается, пока ему некуда вести.
//
// Имя бота и мини-аппки — заглушки (`data/social.ts`): ссылка приглашения собиралась на
// временное имя и не вела никуда, а рядом стояло обещание алмазов за друга, которых не
// начисляет никто. Блок спрятан до настоящего бота. Проверка двусторонняя: пока заглушка —
// блока нет; впишут настоящие имена — тест упадёт на первом утверждении, и его правят тем же
// коммитом, что и имена.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOT_IS_PLACEHOLDER } from '@/game/data/social';

const strip = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const social = strip(readFileSync(join(__dirname, 'Social.tsx'), 'utf8'));

describe('приглашение', () => {
  it('имена бота — заглушки, и блок приглашения за ними заперт', () => {
    expect(BOT_IS_PLACEHOLDER).toBe(true);
    const shown = [...social.matchAll(/<Invite \/>/g)].length;
    expect(shown).toBe(1);
    expect(social).toMatch(/\{!BOT_IS_PLACEHOLDER && <Invite \/>\}/);
  });

  it('алмазов за приглашённого друга игра не обещает', () => {
    expect(social).not.toMatch(/дают алмазы|алмаз/i);
  });
});
