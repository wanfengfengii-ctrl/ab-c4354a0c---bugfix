import { describe, expect, it } from 'vitest';
import {
  dAdd,
  dCmp,
  dMul,
  dSub,
  dToNumber,
  dToString,
  decimalFrom,
  tryDecimalFrom,
} from './decimal';

describe('decimal · 解析', () => {
  it('按文本原样保留全部有效数字', () => {
    // 该值在 float64 中会舍入为 2500000000000000，精确十进制必须保留 .025。
    const d = decimalFrom('2500000000000000.025');
    expect(dToString(d)).toBe('2500000000000000.025');
    expect(dToString(decimalFrom('10000000000000000'))).toBe('10000000000000000');
  });

  it('支持符号、小数点与科学计数法', () => {
    expect(dToString(decimalFrom('-0.025'))).toBe('-0.025');
    expect(dToString(decimalFrom('+5.'))).toBe('5');
    expect(dToString(decimalFrom('.5'))).toBe('0.5');
    expect(dToString(decimalFrom('1e3'))).toBe('1000');
    expect(dToString(decimalFrom('2.5e-3'))).toBe('0.0025');
    expect(dToString(decimalFrom(' 12 '))).toBe('12');
  });

  it('数值输入经最短往返十进制表示解析', () => {
    expect(dToString(decimalFrom(0.2500000001))).toBe('0.2500000001');
    expect(dToString(decimalFrom(10000000000000000))).toBe('10000000000000000');
    expect(dToString(decimalFrom(0))).toBe('0');
  });

  it('非法输入抛出异常，tryDecimalFrom 返回 null', () => {
    expect(() => decimalFrom('abc')).toThrow();
    expect(() => decimalFrom('')).toThrow();
    expect(() => decimalFrom(Number.NaN)).toThrow();
    expect(() => decimalFrom(Number.POSITIVE_INFINITY)).toThrow();
    expect(tryDecimalFrom('abc')).toBeNull();
    expect(tryDecimalFrom('0.5')).not.toBeNull();
  });
});

describe('decimal · 运算与比较', () => {
  it('累加无舍入：4 × 2500000000000000.025 = 10000000000000000.1', () => {
    const m = decimalFrom('2500000000000000.025');
    const total = [m, m, m, m].reduce(dAdd, decimalFrom(0));
    expect(dToString(total)).toBe('10000000000000000.1');
    // 真实超出上限 10000000000000000：精确比较必须判定超限。
    expect(dCmp(total, decimalFrom('10000000000000000'))).toBe(1);
    // 前三块仍为安全前缀：7500000000000000.075 ≤ 上限。
    const three = dAdd(dAdd(m, m), m);
    expect(dToString(three)).toBe('7500000000000000.075');
    expect(dCmp(three, decimalFrom('10000000000000000'))).toBeLessThanOrEqual(0);
  });

  it('小数累加保持十进制语义：0.1 + 0.2 = 0.3', () => {
    expect(dToString(dAdd(decimalFrom(0.1), decimalFrom(0.2)))).toBe('0.3');
  });

  it('乘法与减法精确（质量 × 力臂、边界差值）', () => {
    expect(dToString(dMul(decimalFrom('2.5'), decimalFrom('-4')))).toBe('-10');
    expect(dToString(dSub(decimalFrom('10000000000000000'), decimalFrom('7500000000000000.075')))).toBe(
      '2499999999999999.925',
    );
  });

  it('比较：符号、相等与边界恰好触及', () => {
    expect(dCmp(decimalFrom('1'), decimalFrom('1.0'))).toBe(0);
    expect(dCmp(decimalFrom('-2'), decimalFrom('1'))).toBe(-1);
    expect(dCmp(decimalFrom('0.30000000000000004'), decimalFrom('0.3'))).toBe(1);
  });

  it('dToNumber 提供 float64 视图（仅展示与决胜用）', () => {
    expect(dToNumber(decimalFrom('0.1'))).toBeCloseTo(0.1);
    expect(dToNumber(decimalFrom('10000000000000000.1'))).toBe(10000000000000000);
  });
});
