// Вести края словами (docs/feed.md): заголовок, строка и значок записи ленты. Числа — сроки — функцией сроков
// (`game/span.realSpan`, правило 18); имена городов и правителей — как их назвали игроки, поэтому склонять их нельзя:
// город стоит после слова «город», правитель — после слова «правитель», оба в именительном.
import type { FeedItem } from '@/net/feed';
import { realSpan } from '@/game/span';
import { cityOr } from '../../../netlify/lib/contract';

export interface FeedWords {
  title: string;
  line: string;
  icon: { name: string; glyph: string };
}

/** Срок, округлённый до своей единицы: «12 мин», «3 ч», «2 дн.». */
function coarse(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 3600) return realSpan(Math.max(60, Math.floor(sec / 60) * 60));
  if (sec < 48 * 3600) return realSpan(Math.floor(sec / 3600) * 3600);
  return realSpan(Math.floor(sec / 86_400) * 86_400);
}

/** Давно ли: «только что», «12 мин назад», «3 ч назад», «2 дн. назад». */
export const agoText = (ms: number): string => (ms < 60_000 ? 'только что' : `${coarse(ms)} назад`);

/** Другая сторона: «отряд из города Катания, правитель Андрей». */
const party = (item: FeedItem, what: string): string =>
  `${what} из города ${cityOr(item.byCity)}${item.byRuler ? `, правитель ${item.byRuler}` : ''}`;

const DEED: Record<string, { title: string; line: string; icon: FeedWords['icon'] }> = {
  fire: { title: 'Пожар', line: 'Склад поджёг чужой лазутчик.', icon: { name: 'evt-fire', glyph: '🔥' } },
  theft: { title: 'Кража', line: 'Чужой лазутчик унёс запасы со склада.', icon: { name: 'ui-pouch', glyph: '👝' } },
  unrest: { title: 'Смута', line: 'Чужой лазутчик сманил жителей.', icon: { name: 'spy-revolt', glyph: '✊' } },
};

export function feedWords(item: FeedItem): FeedWords {
  const name = cityOr(item.city);
  const city = `город ${name}`;
  const City = `Город ${name}`;
  switch (item.kind) {
    case 'fell': {
      const how =
        item.how === 'hunger'
          ? `Сдался от голода${item.siegeMs ? ` после ${coarse(item.siegeMs)} осады` : ''}.`
          : item.siegeMs
            ? `Взят штурмом после ${coarse(item.siegeMs)} осады.`
            : 'Взят штурмом.';
      return { title: `${City} взят`, line: `${how} Победил ${party(item, 'отряд')}.`, icon: { name: 'ui-banner', glyph: '🚩' } };
    }
    case 'siege':
      return { title: `${City} в осаде`, line: `Под стенами встал ${party(item, 'отряд')}.`, icon: { name: 'stage-camp', glyph: '⛺' } };
    case 'lifted': {
      const how =
        item.how === 'retreat' ? 'Осада снята, враг уходит.' : item.how === 'beaten' ? 'Штурм из лагеря отбит.' : 'Защитники разбили лагерь у стен.';
      return { title: `${City} выстоял`, line: `${how} Осаждал ${party(item, 'отряд')}.`, icon: { name: 'gear-shield', glyph: '🛡️' } };
    }
    case 'repelled':
      return { title: `${City} отбил штурм`, line: `Ушёл ни с чем ${party(item, 'отряд')}.`, icon: { name: 'gear-shield', glyph: '🛡️' } };
    case 'spy': {
      const d = DEED[item.how ?? ''] ?? DEED.fire;
      return { title: `${d.title}, ${city}`, line: `${d.line} Чей, не знают.`, icon: d.icon };
    }
    case 'caught':
      return {
        title: `${item.how === 'dead' ? 'Убит' : 'Схвачен'} лазутчик, ${city}`,
        line: item.byRuler ? `Его послал правитель ${item.byRuler} из города ${cityOr(item.byCity)}.` : `Его послал город ${cityOr(item.byCity)}.`,
        icon: { name: 'fig-spy', glyph: '🕵️' },
      };
    case 'settled':
      return item.mine
        ? { title: `${City} встал на карте`, line: `Правитель ${item.ruler || 'без имени'}.`, icon: { name: 'stage-village', glyph: '🏘️' } }
        : { title: `Новый сосед, ${city}`, line: `Правитель ${item.ruler || 'без имени'}.`, icon: { name: 'stage-village', glyph: '🏘️' } };
    case 'leader':
      return {
        title: 'Новый первый в рейтинге',
        line: `${City}, правитель ${item.ruler || 'без имени'}.`,
        icon: { name: 'ui-crown', glyph: '👑' },
      };
  }
}
