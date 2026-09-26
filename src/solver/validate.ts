import { dCmp, decimalFrom, tryDecimalFrom } from './decimal';
import type { NumericInput, Scenario } from './types';

/** 录入约束：配重 4~7 块，每块可挂位置 2~3 个，导轨 2~10 个。 */
export const BLOCK_COUNT_MIN = 4;
export const BLOCK_COUNT_MAX = 7;
export const OPTIONS_PER_BLOCK_MIN = 2;
export const OPTIONS_PER_BLOCK_MAX = 3;
export const RAIL_COUNT_MIN = 2;
export const RAIL_COUNT_MAX = 10;

const ZERO = decimalFrom(0);

/** 录入值转 float64（用于有限性检查与兜底比较）；空文本与非法文本得 NaN。 */
function toNum(v: NumericInput): number {
  if (typeof v === 'number') return v;
  const t = v.trim();
  return t === '' ? NaN : Number(t);
}

/** 录入值与 0 的精确比较：负 → -1，零 → 0，正 → 1；无法精确解析时按 float64 兜底。 */
function signOf(v: NumericInput): number {
  const d = tryDecimalFrom(v);
  if (d) return dCmp(d, ZERO);
  const n = toNum(v);
  if (Number.isNaN(n)) return 0;
  return n < 0 ? -1 : n > 0 ? 1 : 0;
}

/** 两个录入值的精确比较：a<b → -1，a=b → 0，a>b → 1；无法精确解析时按 float64 兜底。 */
function compareInputs(a: NumericInput, b: NumericInput): number {
  const da = tryDecimalFrom(a);
  const db = tryDecimalFrom(b);
  if (da && db) return dCmp(da, db);
  const na = toNum(a);
  const nb = toNum(b);
  return na < nb ? -1 : na > nb ? 1 : 0;
}

/** 校验录入草稿，返回全部错误信息（空数组表示合法）。 */
export function validateScenario(s: Scenario): string[] {
  const errors: string[] = [];

  if (s.rails.length < RAIL_COUNT_MIN || s.rails.length > RAIL_COUNT_MAX) {
    errors.push(`导轨位置数量须为 ${RAIL_COUNT_MIN} 至 ${RAIL_COUNT_MAX} 个（当前 ${s.rails.length} 个）`);
  }
  const railIds = new Set<string>();
  const railNames = new Set<string>();
  s.rails.forEach((r, i) => {
    const name = r.name.trim();
    if (!name) errors.push(`第 ${i + 1} 个导轨位置的名称不能为空`);
    if (name && railNames.has(name)) errors.push(`导轨位置名称重复：「${name}」`);
    railNames.add(name);
    if (railIds.has(r.id)) errors.push(`导轨位置标识重复：${r.id}`);
    railIds.add(r.id);
    if (!Number.isFinite(toNum(r.coordinate))) errors.push(`导轨「${name || r.id}」的力臂坐标须为有限数值`);
  });

  if (s.blocks.length < BLOCK_COUNT_MIN || s.blocks.length > BLOCK_COUNT_MAX) {
    errors.push(`配重块数量须为 ${BLOCK_COUNT_MIN} 至 ${BLOCK_COUNT_MAX} 块（当前 ${s.blocks.length} 块）`);
  }
  s.blocks.forEach((b, i) => {
    const label = b.name.trim() || `第 ${i + 1} 块`;
    if (!b.name.trim()) errors.push(`第 ${i + 1} 块配重的名称不能为空`);
    if (!Number.isFinite(toNum(b.mass)) || signOf(b.mass) <= 0) errors.push(`配重「${label}」的质量须为正数`);
    if (b.options.length < OPTIONS_PER_BLOCK_MIN || b.options.length > OPTIONS_PER_BLOCK_MAX) {
      errors.push(
        `配重「${label}」的可挂入位置须为 ${OPTIONS_PER_BLOCK_MIN} 至 ${OPTIONS_PER_BLOCK_MAX} 个（当前 ${b.options.length} 个）`,
      );
    }
    const seen = new Set<string>();
    b.options.forEach((o, j) => {
      if (!railIds.has(o.railId)) errors.push(`配重「${label}」的第 ${j + 1} 个位置引用了不存在的导轨`);
      if (seen.has(o.railId)) errors.push(`配重「${label}」重复选择了同一导轨位置`);
      seen.add(o.railId);
      if (!Number.isFinite(toNum(o.cost)) || signOf(o.cost) < 0) {
        errors.push(`配重「${label}」第 ${j + 1} 个位置的安装代价须为非负数`);
      }
    });
  });

  if (!Number.isFinite(toNum(s.limits.maxLoad)) || signOf(s.limits.maxLoad) < 0) {
    errors.push('卷扬轴总载荷上限须为非负数');
  }
  if (!Number.isFinite(toNum(s.limits.minTorque)) || !Number.isFinite(toNum(s.limits.maxTorque))) {
    errors.push('左右力矩闭区间的端点须为有限数值');
  } else if (compareInputs(s.limits.minTorque, s.limits.maxTorque) > 0) {
    errors.push('力矩闭区间的下端不得大于上端');
  }

  return errors;
}
