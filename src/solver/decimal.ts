/**
 * 精确十进制运算：值 = coef × 10^exp（coef 为任意精度整数）。
 *
 * 裁决的安全边界（总载荷上限、力矩闭区间）必须按录入的十进制值精确判定：
 * float64 在整数部分约 2^53 之后连 0.5 都无法表示，例如录入质量
 * 2500000000000000.025 会被舍入为 2500000000000000，4 块累加后恰好等于
 * 上限 10000000000000000，真实的 0.1 超载将被吞没。这里用 bigint 定点
 * 表示保证累加、乘积与比较全程无舍入。
 */

/** 规范化十进制数：coef 不含末尾的 0（0 的 exp 恒为 0）。 */
export interface Decimal {
  coef: bigint;
  exp: number;
}

const DECIMAL_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

function normalize(coef: bigint, exp: number): Decimal {
  if (coef === 0n) return { coef: 0n, exp: 0 };
  while (coef % 10n === 0n) {
    coef /= 10n;
    exp += 1;
  }
  return { coef, exp };
}

/** 解析十进制文本（支持科学计数法）；非法时抛出异常。 */
export function decimalFromString(raw: string): Decimal {
  const text = raw.trim();
  const m = DECIMAL_RE.exec(text);
  if (!m) throw new Error(`无法解析的十进制数值: ${raw}`);
  const negative = text.startsWith('-');
  const body = text.replace(/^[+-]/, '');
  const [mantissa, expPart] = body.split(/[eE]/);
  const dot = mantissa.indexOf('.');
  const digits = dot >= 0 ? mantissa.slice(0, dot) + mantissa.slice(dot + 1) : mantissa;
  let exp = (dot >= 0 ? -(mantissa.length - 1 - dot) : 0) + (expPart ? parseInt(expPart, 10) : 0);
  let coef = BigInt(digits);
  if (negative) coef = -coef;
  return normalize(coef, exp);
}

/**
 * 把录入值解析为精确十进制。
 *
 * 字符串按文本原样解析（保留用户录入的全部有效数字）；数值经其最短
 * 往返十进制表示（String(n)）解析，即“录入该数值时想要的十进制值”。
 * 非有限数值或非法文本抛出异常。
 */
export function decimalFrom(input: number | string): Decimal {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error(`非有限数值: ${input}`);
    return decimalFromString(String(input));
  }
  return decimalFromString(input);
}

/** 非抛出式解析：非法输入返回 null（供录入校验降级使用）。 */
export function tryDecimalFrom(input: number | string): Decimal | null {
  try {
    return decimalFrom(input);
  } catch {
    return null;
  }
}

export function dAdd(a: Decimal, b: Decimal): Decimal {
  if (a.exp === b.exp) return normalize(a.coef + b.coef, a.exp);
  const [lo, hi] = a.exp < b.exp ? [a, b] : [b, a];
  return normalize(lo.coef + hi.coef * 10n ** BigInt(hi.exp - lo.exp), lo.exp);
}

export function dNeg(a: Decimal): Decimal {
  return { coef: -a.coef, exp: a.exp };
}

export function dSub(a: Decimal, b: Decimal): Decimal {
  return dAdd(a, dNeg(b));
}

export function dMul(a: Decimal, b: Decimal): Decimal {
  return normalize(a.coef * b.coef, a.exp + b.exp);
}

/** 比较：a < b 返回 -1，相等返回 0，a > b 返回 1（精确，无容差）。 */
export function dCmp(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const d = dSub(a, b);
  return d.coef < 0n ? -1 : d.coef > 0n ? 1 : 0;
}

/** 转为 float64（仅用于展示与决胜余量，不参与安全边界判定）。 */
export function dToNumber(d: Decimal): number {
  return Number(`${d.coef}e${d.exp}`);
}

/** 转为不使用科学计数法的精确十进制文本。 */
export function dToString(d: Decimal): string {
  const neg = d.coef < 0n;
  const digits = (neg ? -d.coef : d.coef).toString();
  let out: string;
  if (d.exp >= 0) {
    out = digits + '0'.repeat(d.exp);
  } else {
    const point = digits.length + d.exp;
    out = point > 0 ? `${digits.slice(0, point)}.${digits.slice(point)}` : `0.${'0'.repeat(-point)}${digits}`;
  }
  return neg ? `-${out}` : out;
}
