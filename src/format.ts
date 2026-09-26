/** 录入值（数值或十进制文本）转 float64，仅供展示。 */
export function toNum(x: number | string): number {
  return typeof x === 'string' ? Number(x) : x;
}

/** 数值展示：保留至多 3 位小数并去掉多余的 0。 */
export function fmt(x: number | string): string {
  const n = toNum(x);
  if (!Number.isFinite(n)) return '—';
  const v = Math.round(n * 1000) / 1000;
  return Object.is(v, -0) ? '0' : String(v);
}
