import { describe, expect, it } from 'vitest';
import { adjudicate } from './adjudicate';
import type { Scenario } from './types';

/** 断言用浮点容差（仅用于展示数值的近似断言，裁决内部比较均为精确十进制）。 */
const EPS = 1e-9;

const rails = (...defs: [string, number | string][]): Scenario['rails'] =>
  defs.map(([name, coordinate], i) => ({ id: `rail-${i}`, name, coordinate }));

const block = (
  name: string,
  mass: number | string,
  options: [number, number][], // [railIndex, cost]
): Scenario['blocks'][number] => ({
  id: `blk-${name}`,
  name,
  mass,
  options: options.map(([railIndex, cost]) => ({ railId: `rail-${railIndex}`, cost })),
});

const limits = (maxLoad: number | string, minTorque: number | string, maxTorque: number | string): Scenario['limits'] => ({
  maxLoad,
  minTorque,
  maxTorque,
});

describe('adjudicate · 可行方案与决胜规则', () => {
  it('基本求解：前缀均满足约束，代价/序号稳定决胜', () => {
    // 两块等质量配重，左右对称；四套可行方案余量与代价全同，按录入序号取字典序最小。
    const outcome = adjudicate({
      rails: rails(['L', -1], ['R', 1]),
      blocks: [block('b1', 4, [[0, 1], [1, 1]]), block('b2', 4, [[0, 1], [1, 1]])],
      limits: limits(100, -5, 5),
    });
    expect(outcome.feasible).toBe(true);
    if (!outcome.feasible) return;
    expect(outcome.plan.steps.map((s) => [s.blockIndex, s.railName])).toEqual([
      [0, 'L'],
      [1, 'R'],
    ]);
    expect(outcome.plan.totalCost).toBeCloseTo(2);
    expect(outcome.plan.minTorqueMargin).toBeCloseTo(1);
    // 每个前缀状态同时满足载荷与力矩限制
    for (const s of outcome.plan.steps) {
      expect(s.cumulativeMass).toBeLessThanOrEqual(100 + EPS);
      expect(s.cumulativeTorque).toBeGreaterThanOrEqual(-5 - EPS);
      expect(s.cumulativeTorque).toBeLessThanOrEqual(5 + EPS);
    }
  });

  it('力矩余量最大优先于总代价最小', () => {
    // 便宜方案（代价 2）余量仅 1；居中方案（代价 20）余量 5，必须选后者。
    const outcome = adjudicate({
      rails: rails(['L', -2], ['M', 0], ['R', 2]),
      blocks: [block('b1', 2, [[1, 10], [2, 1]]), block('b2', 2, [[0, 1], [1, 10]])],
      limits: limits(100, -5, 5),
    });
    expect(outcome.feasible).toBe(true);
    if (!outcome.feasible) return;
    expect(outcome.plan.minTorqueMargin).toBeCloseTo(5);
    expect(outcome.plan.totalCost).toBeCloseTo(20);
    expect(outcome.plan.steps.map((s) => s.railName)).toEqual(['M', 'M']);
  });

  it('余量并列时取总代价最小，再按挂装顺序与位置录入序号决胜', () => {
    // 两条零力臂导轨 M1/M2：余量 5 的方案中，b1@M2 + b2@M1 代价 8 最小。
    const outcome = adjudicate({
      rails: rails(['L', -2], ['M1', 0], ['M2', 0], ['R', 2]),
      blocks: [
        block('b1', 2, [[1, 8], [2, 3], [3, 1]]),
        block('b2', 2, [[1, 5], [2, 6], [0, 1]]),
      ],
      limits: limits(100, -5, 5),
    });
    expect(outcome.feasible).toBe(true);
    if (!outcome.feasible) return;
    expect(outcome.plan.minTorqueMargin).toBeCloseTo(5);
    expect(outcome.plan.totalCost).toBeCloseTo(8);
    expect(outcome.plan.steps.map((s) => [s.blockIndex, s.railName])).toEqual([
      [0, 'M2'],
      [1, 'M1'],
    ]);
  });

  it('联合确定位置与次序：不得先选最终位置再事后排序', () => {
    // b4 挂 L（-6）时最终合力矩可为 0，但任何挂装次序都会在中途越界；
    // 只有 b4 挂 H（-3）且 b3 挂 L 并交错挂装才全程安全，且代价更高（9）。
    const outcome = adjudicate({
      rails: rails(['L', -1], ['H', -0.5], ['R', 1]),
      blocks: [
        block('b1', 2, [[2, 1]]),
        block('b2', 2, [[2, 1]]),
        block('b3', 2, [[2, 1], [0, 1]]),
        block('b4', 6, [[0, 1], [1, 9]]),
      ],
      limits: limits(100, -3, 3),
    });
    expect(outcome.feasible).toBe(true);
    if (!outcome.feasible) return;
    expect(outcome.plan.steps.map((s) => [s.blockIndex, s.railName])).toEqual([
      [0, 'R'],
      [2, 'L'],
      [1, 'R'],
      [3, 'H'],
    ]);
    expect(outcome.plan.totalCost).toBeCloseTo(12);
    expect(outcome.plan.minTorqueMargin).toBeCloseTo(1);
    for (const s of outcome.plan.steps) {
      expect(s.cumulativeTorque).toBeGreaterThanOrEqual(-3 - EPS);
      expect(s.cumulativeTorque).toBeLessThanOrEqual(3 + EPS);
    }
  });

  it('多块场景：每块恰用一次且结果确定（可重复）', () => {
    const scenario: Scenario = {
      rails: rails(['L2', -2], ['L1', -1], ['C', 0], ['R1', 1], ['R2', 2]),
      blocks: [
        block('b1', 20, [[1, 2], [3, 2]]),
        block('b2', 15, [[0, 3], [4, 3], [2, 5]]),
        block('b3', 25, [[1, 4], [4, 4]]),
        block('b4', 10, [[2, 1], [3, 2]]),
        block('b5', 30, [[0, 2], [3, 3], [4, 4]]),
      ],
      limits: limits(150, -100, 100),
    };
    const first = adjudicate(scenario);
    const second = adjudicate(scenario);
    expect(first).toEqual(second);
    expect(first.feasible).toBe(true);
    if (!first.feasible) return;
    expect(first.plan.steps).toHaveLength(5);
    expect(new Set(first.plan.steps.map((s) => s.blockIndex)).size).toBe(5);
    for (const s of first.plan.steps) {
      expect(s.cumulativeMass).toBeLessThanOrEqual(150 + EPS);
      expect(Math.abs(s.cumulativeTorque)).toBeLessThanOrEqual(100 + EPS);
      expect(s.loadMargin).toBeCloseTo(150 - s.cumulativeMass);
    }
  });
});

describe('adjudicate · 无可行方案的诊断', () => {
  it('第一步即不可挂：已选前缀为空，逐一列出触发的力矩限制', () => {
    const outcome = adjudicate({
      rails: rails(['L', -1], ['R', 1]),
      blocks: [block('b1', 3, [[0, 1], [1, 1]]), block('b2', 3, [[0, 1], [1, 1]])],
      limits: limits(100, -2, 2),
    });
    expect(outcome.feasible).toBe(false);
    if (outcome.feasible) return;
    expect(outcome.report.witnessPrefix).toHaveLength(0);
    expect(outcome.report.violations).toHaveLength(4);
    const kinds = new Map(outcome.report.violations.map((v) => [`${v.blockIndex}:${v.railName}`, v.kinds]));
    expect(kinds.get('0:L')).toEqual(['torque-low']);
    expect(kinds.get('0:R')).toEqual(['torque-high']);
    expect(kinds.get('1:L')).toEqual(['torque-low']);
    expect(kinds.get('1:R')).toEqual(['torque-high']);
  });

  it('最深前缀止步于载荷限制', () => {
    const outcome = adjudicate({
      rails: rails(['M', 0]),
      blocks: [block('b1', 3, [[0, 1]]), block('b2', 3, [[0, 1]]), block('b3', 3, [[0, 1]])],
      limits: limits(5, -10, 10),
    });
    expect(outcome.feasible).toBe(false);
    if (outcome.feasible) return;
    expect(outcome.report.witnessPrefix).toHaveLength(1);
    expect(outcome.report.witnessPrefix[0].blockIndex).toBe(0);
    expect(outcome.report.violations).toHaveLength(2);
    for (const v of outcome.report.violations) {
      expect(v.kinds).toEqual(['load']);
      expect(v.massAfter).toBeCloseTo(6);
    }
  });

  it('最深前缀按裁决优先级选取，并列选择同时触发载荷与力矩限制', () => {
    // 深度 1 的三个可行前缀余量分别为 2/1/0，须选余量最大的 b1。
    const outcome = adjudicate({
      rails: rails(['R', 1]),
      blocks: [block('b1', 3, [[0, 1]]), block('b2', 4, [[0, 1]]), block('b3', 5, [[0, 1]])],
      limits: limits(6, -5, 5),
    });
    expect(outcome.feasible).toBe(false);
    if (outcome.feasible) return;
    expect(outcome.report.witnessPrefix).toHaveLength(1);
    expect(outcome.report.witnessPrefix[0].blockIndex).toBe(0);
    expect(outcome.report.witnessPrefix[0].cumulativeTorque).toBeCloseTo(3);
    expect(outcome.report.violations).toHaveLength(2);
    for (const v of outcome.report.violations) {
      expect(v.kinds).toEqual(['load', 'torque-high']);
    }
  });

  it('小数载荷恰近上限：总质量 1.0000000004 对上限 1 必须判无可行方案', () => {
    // 两条零力臂导轨、力矩闭区间 [0,0]；4 块 0.2500000001 的配重按录入十进制值
    // 求和为 1.0000000004，真实超限 4e-10，不得被浮点容差吞没。
    const outcome = adjudicate({
      rails: rails(['M1', 0], ['M2', 0]),
      blocks: [
        block('b1', 0.2500000001, [[0, 1], [1, 1]]),
        block('b2', 0.2500000001, [[0, 1], [1, 1]]),
        block('b3', 0.2500000001, [[0, 1], [1, 1]]),
        block('b4', 0.2500000001, [[0, 1], [1, 1]]),
      ],
      limits: limits(1, 0, 0),
    });
    expect(outcome.feasible).toBe(false);
    if (outcome.feasible) return;
    // 前三步仍是安全前缀：已挂质量 0.7500000003 ≤ 1，力矩恒为 0 ∈ [0,0]。
    expect(outcome.report.witnessPrefix).toHaveLength(3);
    expect(outcome.report.witnessPrefix[2].cumulativeMass).toBeCloseTo(0.7500000003, 10);
    for (const s of outcome.report.witnessPrefix) {
      expect(s.cumulativeTorque).toBe(0);
      expect(s.loadMargin).toBeGreaterThanOrEqual(0);
    }
    // 第 4 步：剩余配重的两个导轨选择都应明确报告总载荷超限（且仅超限载荷）。
    expect(outcome.report.violations).toHaveLength(2);
    expect(outcome.report.violations.map((v) => [v.blockIndex, v.railName])).toEqual([
      [3, 'M1'],
      [3, 'M2'],
    ]);
    for (const v of outcome.report.violations) {
      expect(v.kinds).toEqual(['load']);
      expect(v.massAfter).toBeCloseTo(1.0000000004, 10);
      expect(v.torqueAfter).toBe(0);
    }
  });

  it('小数载荷恰达上限：总质量恰好等于上限时仍判可行（边界判定不变）', () => {
    // 4 块 0.25 总质量恰为 1，载荷余量最后一步为 0，力矩恒在 [0,0] 边界上。
    const outcome = adjudicate({
      rails: rails(['M1', 0], ['M2', 0]),
      blocks: [
        block('b1', 0.25, [[0, 1], [1, 2]]),
        block('b2', 0.25, [[0, 1], [1, 2]]),
        block('b3', 0.25, [[0, 1], [1, 2]]),
        block('b4', 0.25, [[0, 1], [1, 2]]),
      ],
      limits: limits(1, 0, 0),
    });
    expect(outcome.feasible).toBe(true);
    if (!outcome.feasible) return;
    expect(outcome.plan.steps.map((s) => [s.blockIndex, s.railName])).toEqual([
      [0, 'M1'],
      [1, 'M1'],
      [2, 'M1'],
      [3, 'M1'],
    ]);
    expect(outcome.plan.totalCost).toBeCloseTo(4);
    expect(outcome.plan.minTorqueMargin).toBeCloseTo(0);
    expect(outcome.plan.finalMass).toBeCloseTo(1);
    expect(outcome.plan.steps[3].loadMargin).toBeCloseTo(0);
  });

  it('超大整数部分十进制载荷：真实超载 0.1 不得被 float64 舍入吞没', () => {
    // 两条零力臂导轨、上限 10000000000000000、力矩 [0,0]；
    // 4 块质量 2500000000000000.025（float64 会舍入为 2500000000000000）。
    // 按录入十进制值总质量为 10000000000000000.1，真实超限 0.1，必须判无可行方案。
    const outcome = adjudicate({
      rails: rails(['M1', 0], ['M2', 0]),
      blocks: [
        block('b1', '2500000000000000.025', [[0, 1], [1, 1]]),
        block('b2', '2500000000000000.025', [[0, 1], [1, 1]]),
        block('b3', '2500000000000000.025', [[0, 1], [1, 1]]),
        block('b4', '2500000000000000.025', [[0, 1], [1, 1]]),
      ],
      limits: limits('10000000000000000', '0', '0'),
    });
    expect(outcome.feasible).toBe(false);
    if (outcome.feasible) return;
    // 前三块构成安全挂装前缀（7500000000000000.075 ≤ 上限，力矩恒为 0）。
    expect(outcome.report.witnessPrefix).toHaveLength(3);
    expect(outcome.report.witnessPrefix.map((s) => s.blockIndex)).toEqual([0, 1, 2]);
    for (const s of outcome.report.witnessPrefix) {
      expect(s.cumulativeTorque).toBe(0);
      expect(s.loadMargin).toBeGreaterThanOrEqual(0);
    }
    // 第 4 块配重的两个导轨选择都应报告总载荷超限（且仅超限载荷）。
    expect(outcome.report.violations).toHaveLength(2);
    expect(outcome.report.violations.map((v) => [v.blockIndex, v.railName])).toEqual([
      [3, 'M1'],
      [3, 'M2'],
    ]);
    for (const v of outcome.report.violations) {
      expect(v.kinds).toEqual(['load']);
      expect(v.torqueAfter).toBe(0);
    }
  });

  it('超大整数部分十进制力矩：质量 × 力臂的微小超出同样按精确十进制判定', () => {
    // 质量 2500000000000000.025、力臂 ±0.001：挂后力矩为 ±2500000000000.000025，
    // 在区间 [0,0] 外；第一步即无任何可行选择，须逐一报告力矩越界。
    const outcome = adjudicate({
      rails: rails(['L', '-0.001'], ['R', '0.001']),
      blocks: [
        block('b1', '2500000000000000.025', [[0, 1], [1, 1]]),
        block('b2', '2500000000000000.025', [[0, 1], [1, 1]]),
        block('b3', '2500000000000000.025', [[0, 1], [1, 1]]),
        block('b4', '2500000000000000.025', [[0, 1], [1, 1]]),
      ],
      limits: limits('10000000000000001', '0', '0'),
    });
    expect(outcome.feasible).toBe(false);
    if (outcome.feasible) return;
    expect(outcome.report.witnessPrefix).toHaveLength(0);
    expect(outcome.report.violations).toHaveLength(8);
    const kinds = new Map(outcome.report.violations.map((v) => [`${v.blockIndex}:${v.railName}`, v.kinds]));
    for (let i = 0; i < 4; i++) {
      expect(kinds.get(`${i}:L`)).toEqual(['torque-low']);
      expect(kinds.get(`${i}:R`)).toEqual(['torque-high']);
    }
  });

  it('超大整数部分载荷恰达上限：按录入十进制值恰好相等时仍判可行（边界不变）', () => {
    // 4 块 2500000000000000（无小数尾差）总质量恰为上限，余量最后一步为 0。
    const outcome = adjudicate({
      rails: rails(['M1', 0], ['M2', 0]),
      blocks: [
        block('b1', '2500000000000000', [[0, 1], [1, 2]]),
        block('b2', '2500000000000000', [[0, 1], [1, 2]]),
        block('b3', '2500000000000000', [[0, 1], [1, 2]]),
        block('b4', '2500000000000000', [[0, 1], [1, 2]]),
      ],
      limits: limits('10000000000000000', '0', '0'),
    });
    expect(outcome.feasible).toBe(true);
    if (!outcome.feasible) return;
    expect(outcome.plan.steps).toHaveLength(4);
    expect(outcome.plan.totalCost).toBeCloseTo(4);
    expect(outcome.plan.steps[3].loadMargin).toBeCloseTo(0);
  });
});

describe('adjudicate · 超大十进制力矩余量的精确决胜', () => {
  it('安全余量严格更高者优先于代价更低者（尾差不得被 float64 吞没）', () => {
    // S 力臂 10000000000000000（代价 10）：力矩恰为区间中点，余量 10000000000000000；
    // C 力臂 10000000000000000.025（代价 0）：余量 9999999999999999.975，严格更小，
    // 但二者在 float64 中均舍入为 1e16。安全余量严格更高的 S 必须胜出，总代价 10。
    const outcome = adjudicate({
      rails: rails(['S', '10000000000000000'], ['C', '10000000000000000.025'], ['Z1', 0], ['Z2', 0]),
      blocks: [
        block('b0', 1, [[0, 10], [1, 0]]),
        block('b1', 1, [[2, 0], [3, 0]]),
        block('b2', 1, [[2, 0], [3, 0]]),
        block('b3', 1, [[2, 0], [3, 0]]),
      ],
      limits: limits(10, '0', '20000000000000000'),
    });
    expect(outcome.feasible).toBe(true);
    if (!outcome.feasible) return;
    // 完整选项与挂装次序：b0 挂 S，其余配重的零力臂选择完全并列，按录入序号稳定取 Z1。
    expect(outcome.plan.steps.map((s) => [s.blockIndex, s.railName])).toEqual([
      [0, 'S'],
      [1, 'Z1'],
      [2, 'Z1'],
      [3, 'Z1'],
    ]);
    expect(outcome.plan.totalCost).toBeCloseTo(10);
    expect(outcome.plan.minTorqueMargin).toBe(10000000000000000);
    expect(outcome.plan.finalTorque).toBe(10000000000000000);
    expect(outcome.plan.finalMass).toBeCloseTo(4);
  });

  it('超大十进制力矩余量确实相等时，总代价才参与决胜', () => {
    // S 力臂 10000000000000000.025（代价 5）与 C 力臂 9999999999999999.975（代价 3）
    // 对区间 [0, 20000000000000000] 的余量都精确等于 9999999999999999.975，
    // 此时才由总代价决胜：C（总代价 3）胜出。
    const outcome = adjudicate({
      rails: rails(['S', '10000000000000000.025'], ['C', '9999999999999999.975'], ['Z1', 0], ['Z2', 0]),
      blocks: [
        block('b0', 1, [[0, 5], [1, 3]]),
        block('b1', 1, [[2, 0], [3, 0]]),
        block('b2', 1, [[2, 0], [3, 0]]),
        block('b3', 1, [[2, 0], [3, 0]]),
      ],
      limits: limits(10, '0', '20000000000000000'),
    });
    expect(outcome.feasible).toBe(true);
    if (!outcome.feasible) return;
    expect(outcome.plan.steps.map((s) => [s.blockIndex, s.railName])).toEqual([
      [0, 'C'],
      [1, 'Z1'],
      [2, 'Z1'],
      [3, 'Z1'],
    ]);
    expect(outcome.plan.totalCost).toBeCloseTo(3);
  });

  it('力矩恰好触及闭区间端点仍判可行（闭区间边界不变）', () => {
    // 首步力矩恰为端点 -2（余量 0，闭区间下可行），次步回到 0。
    const outcome = adjudicate({
      rails: rails(['L', -2], ['R', 2]),
      blocks: [block('b1', 1, [[0, 1], [1, 1]]), block('b2', 1, [[0, 1], [1, 1]])],
      limits: limits(10, -2, 2),
    });
    expect(outcome.feasible).toBe(true);
    if (!outcome.feasible) return;
    expect(outcome.plan.minTorqueMargin).toBeCloseTo(0);
    expect(outcome.plan.steps.map((s) => [s.blockIndex, s.railName])).toEqual([
      [0, 'L'],
      [1, 'R'],
    ]);
    expect(outcome.plan.steps[0].cumulativeTorque).toBe(-2);
  });
});
