// Свет огней в шейдере (docs/polish.md, П-9): одна функция на город, ролики и осадки. Двойник на процессоре — `lamps.ts`
// (`lampFall`, `lampFacing`, `lampKnee`); числа здесь и там держит тест (`glow.test.ts`).
import { LAMP_KNEE, MAX_LAMPS } from './lamps';

/** Униформы огней: место и досягаемость, цвет с силой (уже с горением, мерцанием и наплывом), сколько мест занято. */
export const LAMP_UNIFORMS_GLSL = /* glsl */ `
uniform vec4 gLampPos[${MAX_LAMPS}];
uniform vec4 gLampCol[${MAX_LAMPS}];
uniform int gLampN;
`;

/**
 * Свет огней в точке `p` (мир) с нормалью `n` (мир, единичная). Спад — окном по доле досягаемости (`(1 − x²)² / (1 + 9x)`,
 * x = d² / r²): мягкий у огня и ровно ноль у края, без кольца. По нормали — Ламберт с узкой обёрткой: стена, на которой висит
 * факел, светится у факела и быстро гаснет, а не горит кругом; со спины — ноль. Сумма — через мягкий предел.
 */
export const LAMP_GLSL = /* glsl */ `
${LAMP_UNIFORMS_GLSL}
vec3 gLamps(vec3 p, vec3 n) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_LAMPS}; i++) {
    if (i >= gLampN) break;
    vec4 L = gLampPos[i];
    vec3 d = L.xyz - p;
    float d2 = dot(d, d);
    float x = d2 / (L.w * L.w);
    if (x >= 1.0) continue;
    float win = 1.0 - x * x;
    float face = clamp(dot(n, d) * inversesqrt(max(d2, 1e-6)) * 0.8 + 0.2, 0.0, 1.0);
    acc += gLampCol[i].rgb * (win * win / (1.0 + 9.0 * x)) * face;
  }
  float m = max(acc.r, max(acc.g, acc.b));
  return acc / (1.0 + m / ${LAMP_KNEE.toFixed(2)});
}
`;
