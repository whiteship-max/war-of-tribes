import { useEffect, useState } from 'react';
import { useGame, type Curtain } from '@/game/store';
import march from './art/curtain-march.webp';
import camp from './art/curtain-camp.webp';

/**
 * Занавес между посёлком и картой мира.
 *
 * Диорама и карта больше не живут в памяти разом: уходя на карту, посёлок
 * выгружается целиком, возвращаясь — собирается заново. Сборка идёт в главном
 * потоке и рисовать в это время нечем, поэтому переход прикрыт артом.
 *
 * Два арта, а не один: переход, одинаковый в обе стороны, читается сбоем
 * интерфейса, а не дорогой — игрок перестаёт понимать, куда его ведут. В
 * сторону карты идёт дружина у чужой крепости, домой — племя у костра.
 *
 * **В первую загрузку игры арты не входят ни байтом.** В чанке лежит только
 * адрес файла; сам файл браузер качает, когда `<img>` впервые встанет в
 * разметку, то есть при первом переходе, — и дальше берёт из кэша.
 */

const ART: Record<Curtain, { src: string; line: string }> = {
  march: { src: march, line: 'Дружина выходит за ворота' },
  camp: { src: camp, line: 'Племя ждёт у костра' },
};

export function SceneCurtain() {
  const curtain = useGame((g) => g.curtain);
  // Занавес переживает своё снятие: без этого он исчезал бы рывком, вместе с
  // тем самым кадром, ради которого его и вешали.
  const [shown, setShown] = useState<Curtain | null>(curtain);

  useEffect(() => {
    if (curtain) {
      setShown(curtain);
      return;
    }
    const t = setTimeout(() => setShown(null), 260);
    return () => clearTimeout(t);
  }, [curtain]);

  if (!shown) return null;
  const art = ART[shown];
  return (
    <div className={`curtain${curtain ? ' on' : ''}`}>
      {/* Арт стоит во всю ширину и своей высотой. Растягивать его на весь
          вертикальный экран нельзя: 640 px исходника на 844 pt — почти
          четырёхкратное увеличение, то есть каша вместо костра. Пустоту вокруг
          закрывает не размытая копия (она читалась грязным пятном), а тёплое
          свечение из палитры — тем же приёмом, что на экране загрузки. */}
      <div className="curtain-frame">
        <img className="curtain-art" src={art.src} alt="" />
        <div className="curtain-line">{art.line}</div>
      </div>
    </div>
  );
}
