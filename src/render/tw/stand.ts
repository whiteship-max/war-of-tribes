// Стенд ролика боя в стиле Total War: `?replay=tw&…` (docs/battle_tw.md, раздел 9). Бой считает прежний стенд
// (`battle-stand.standBattle`) — тем же путём, что игра; здесь он только показывается.
import { standBattle } from '../battle-stand';
import { qualityOf } from '../quality';
import { twPlanOfRecord } from './record';

export function mountTwStand(p: URLSearchParams): void {
  const root = document.getElementById('root') ?? document.body;
  root.innerHTML = '';
  const battle = standBattle(p);
  const quality = qualityOf(p.get('quality')) ?? 'medium';
  const plan = twPlanOfRecord(battle.result, battle.us, battle.troops, quality, undefined, battle.place, battle.beastSide);
  const pre = document.createElement('pre');
  pre.style.cssText = 'font:12px/1.4 ui-monospace,monospace;padding:10px;white-space:pre-wrap';
  pre.textContent =
    `бой ${battle.men} против ${battle.foe} · k ${plan.k} · фигур ${plan.sideFigures.attacker}/${plan.sideFigures.defender} · ` +
    `ролик ${plan.seconds.toFixed(1)} с\n` +
    plan.units.map((u) => `${u.side} ${u.sector} ${u.face} ${u.men}→${u.finalMen} · ${u.figures} фиг. ${u.files}×${u.ranks}`).join('\n');
  root.appendChild(pre);
  document.body.dataset.replay = JSON.stringify({ k: plan.k, figures: plan.sideFigures, seconds: plan.seconds });
}
