import { dAdd, dCmp, dMul, dSub, dToNumber, decimalFrom, type Decimal } from './decimal';
import type {
  AdjudicationOutcome,
  Limits,
  Plan,
  Scenario,
  StepRecord,
  Violation,
  ViolationKind,
} from './types';

/**
 * 安全边界（总载荷 / 力矩闭区间）判定与力矩余量决胜均使用精确十进制比较：
 * 按录入的十进制值累加与相乘（bigint 定点，无舍入），恰好触及边界的
 * 方案仍判可行，而任何真实超限——包括整数部分超过 2^53 后 float64
 * 无法表示的小数超出量（例如总载荷 10000000000000000.1 对上限
 * 10000000000000000）——都必须判不可行。同理，力矩余量的并列只在
 * 精确十进制值确实相等时成立：9999999999999999.975 与 10000000000000000
 * 在 float64 中同为 1e16，但前者的安全余量严格更小，不得判为并列。
 */

interface FlatOption {
  optionIndex: number;
  railId: string;
  railName: string;
  coordinate: number;
  /** 该选项的力矩增量（质量 × 力臂），精确十进制。 */
  torqueDelta: Decimal;
  cost: number;
  /** 安装代价按全场景公共定点折算的大整数，用于精确决胜比较。 */
  costScaled: bigint;
}

interface FlatBlock {
  index: number;
  name: string;
  mass: number;
  massDec: Decimal;
  options: FlatOption[];
}

/** 某前缀的力矩余量 = 力矩到闭区间两端的最短距离（精确十进制）。 */
function torqueMarginOf(torque: Decimal, min: Decimal, max: Decimal): Decimal {
  const low = dSub(torque, min);
  const high = dSub(max, torque);
  return dCmp(low, high) <= 0 ? low : high;
}

/** 按 (块录入序号, 位置录入序号) 沿挂装次序逐位比较，保证稳定决胜。 */
function lexCompareSteps(a: StepRecord[], b: StepRecord[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i].blockIndex !== b[i].blockIndex) return a[i].blockIndex - b[i].blockIndex;
    if (a[i].optionIndex !== b[i].optionIndex) return a[i].optionIndex - b[i].optionIndex;
  }
  return a.length - b.length;
}

/**
 * 候选方案：除公开展示用的 Plan 外，携带精确十进制的最小力矩余量与
 * 公共定点折算的总代价，使三级决胜全程无浮点舍入参与。
 */
interface Candidate {
  plan: Plan;
  /** 精确最小力矩余量；null 表示空前缀（尚无任何前缀力矩，视为 +∞）。 */
  margin: Decimal | null;
  /** 总安装代价（按全场景公共定点折算的大整数）。 */
  cost: bigint;
}

/** 余量比较：null（+∞）大于任何有限余量；其余按精确十进制比较。 */
function cmpMargin(a: Decimal | null, b: Decimal | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return dCmp(a, b);
}

/**
 * 裁决优先级（依次）：
 * 1. 力矩余量（所有前缀中的最小值）最大者优先——按精确十进制比较，
 *    只有确实相等才算并列，安全余量严格更高者必须优先于代价更低者；
 * 2. 总安装代价最小者优先（按精确十进制比较，无浮点噪声）；
 * 3. 按挂装顺序的 (块录入序号, 位置录入序号) 序列字典序最小者优先。
 */
function isBetter(a: Candidate, b: Candidate | null): boolean {
  if (b === null) return true;
  const mc = cmpMargin(a.margin, b.margin);
  if (mc !== 0) return mc > 0;
  if (a.cost !== b.cost) return a.cost < b.cost;
  return lexCompareSteps(a.plan.steps, b.plan.steps) < 0;
}

/** 卷扬轴限制的精确十进制视图。 */
interface LimitDec {
  maxLoad: Decimal;
  minTorque: Decimal;
  maxTorque: Decimal;
}

function limitDecOf(limits: Limits): LimitDec {
  return {
    maxLoad: decimalFrom(limits.maxLoad),
    minTorque: decimalFrom(limits.minTorque),
    maxTorque: decimalFrom(limits.maxTorque),
  };
}

/**
 * 裁决：联合确定每块配重恰用一次的挂入位置与完整挂装次序。
 *
 * 搜索按挂装顺序逐步进行，每一个前缀状态都同时校验总载荷与力矩闭区间，
 * 因此绝不出现“先定最终位置再事后排序”的情况；力矩余量沿前缀单调不增、
 * 总代价单调不减（代价非负），据此对当前最优解做分支限界。
 */
export function adjudicate(scenario: Scenario): AdjudicationOutcome {
  const railById = new Map(scenario.rails.map((r) => [r.id, r]));

  // 所有安装代价统一折算到最小指数（最小小数位数）的公共定点，供精确决胜。
  const costScaleExp = Math.min(
    0,
    ...scenario.blocks.flatMap((b) => b.options.map((o) => decimalFrom(o.cost).exp)),
  );
  const scaleCost = (d: Decimal): bigint => d.coef * 10n ** BigInt(d.exp - costScaleExp);

  const blocks: FlatBlock[] = scenario.blocks.map((b, i) => {
    const massDec = decimalFrom(b.mass);
    return {
      index: i,
      name: b.name,
      mass: dToNumber(massDec),
      massDec,
      options: b.options.map((o, j) => {
        const rail = railById.get(o.railId);
        if (!rail) throw new Error(`未知导轨位置: ${o.railId}`);
        const coordinateDec = decimalFrom(rail.coordinate);
        const costDec = decimalFrom(o.cost);
        return {
          optionIndex: j,
          railId: rail.id,
          railName: rail.name,
          coordinate: dToNumber(coordinateDec),
          torqueDelta: dMul(massDec, coordinateDec),
          cost: dToNumber(costDec),
          costScaled: scaleCost(costDec),
        };
      }),
    };
  });
  const n = blocks.length;
  const lim = limitDecOf(scenario.limits);

  const used = new Array<boolean>(n).fill(false);
  const steps: StepRecord[] = [];
  let best: Candidate | null = null;
  /** 每个深度上按裁决优先级最优的可行前缀（用于无可行方案时的诊断）。 */
  const bestPartial: (Candidate | null)[] = new Array(n + 1).fill(null);

  const snapshot = (totalCost: number, minTorqueMargin: number): Plan => ({
    steps: steps.map((s) => ({ ...s })),
    totalCost,
    minTorqueMargin,
    finalMass: steps.length > 0 ? steps[steps.length - 1].cumulativeMass : 0,
    finalTorque: steps.length > 0 ? steps[steps.length - 1].cumulativeTorque : 0,
  });

  const dfs = (depth: number, mass: Decimal, torque: Decimal, cost: bigint, costNum: number, minMargin: Decimal | null): void => {
    const current: Candidate = {
      plan: snapshot(costNum, minMargin === null ? Number.POSITIVE_INFINITY : dToNumber(minMargin)),
      margin: minMargin,
      cost,
    };
    if (isBetter(current, bestPartial[depth])) {
      bestPartial[depth] = current;
    }
    if (depth === n) {
      if (isBetter(current, best)) {
        best = current;
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const block = blocks[i];
      for (const opt of block.options) {
        const massAfter = dAdd(mass, block.massDec);
        if (dCmp(massAfter, lim.maxLoad) > 0) continue;
        const torqueAfter = dAdd(torque, opt.torqueDelta);
        if (dCmp(torqueAfter, lim.minTorque) < 0 || dCmp(torqueAfter, lim.maxTorque) > 0) {
          continue;
        }
        const margin = torqueMarginOf(torqueAfter, lim.minTorque, lim.maxTorque);
        const nextMinMargin = minMargin !== null && dCmp(minMargin, margin) <= 0 ? minMargin : margin;
        const nextCost = cost + opt.costScaled;
        const nextCostNum = costNum + opt.cost;
        if (best && best.margin !== null) {
          const mc = dCmp(nextMinMargin, best.margin);
          // 力矩余量已严格劣于最优解，剪枝。
          if (mc < 0) continue;
          // 余量至多并列且代价已严格更差，剪枝。
          if (mc === 0 && nextCost > best.cost) continue;
        }
        used[i] = true;
        steps.push({
          blockIndex: i,
          blockName: block.name,
          optionIndex: opt.optionIndex,
          railId: opt.railId,
          railName: opt.railName,
          coordinate: opt.coordinate,
          mass: block.mass,
          cost: opt.cost,
          cumulativeMass: dToNumber(massAfter),
          cumulativeTorque: dToNumber(torqueAfter),
          loadMargin: dToNumber(dSub(lim.maxLoad, massAfter)),
          torqueMargin: dToNumber(margin),
        });
        dfs(depth + 1, massAfter, torqueAfter, nextCost, nextCostNum, nextMinMargin);
        steps.pop();
        used[i] = false;
      }
    }
  };

  dfs(0, decimalFrom(0), decimalFrom(0), 0n, 0, null);

  // best 在 dfs 闭包内赋值；TS 不会跨闭包调用还原局部变量的窄化，按声明类型取回。
  const finalBest = best as Candidate | null;
  if (finalBest) return { feasible: true, plan: finalBest.plan };

  // 无可行方案：定位最深的可行已选前缀（其下一步即最早无法继续挂装的位置）。
  let depth = n - 1;
  while (depth >= 0 && bestPartial[depth] === null) depth--;
  const witness = depth >= 0 ? bestPartial[depth] : null;
  const witnessSteps = witness ? witness.plan.steps : [];
  const usedBlocks = new Set(witnessSteps.map((s) => s.blockIndex));
  // 由见证前缀的每步增量恢复精确十进制状态，保证超限判定同样按录入十进制值进行。
  const baseMass = witnessSteps.reduce<Decimal>((acc, s) => dAdd(acc, blocks[s.blockIndex].massDec), decimalFrom(0));
  const baseTorque = witnessSteps.reduce<Decimal>(
    (acc, s) => dAdd(acc, blocks[s.blockIndex].options[s.optionIndex].torqueDelta),
    decimalFrom(0),
  );

  const violations: Violation[] = [];
  for (const block of blocks) {
    if (usedBlocks.has(block.index)) continue;
    for (const opt of block.options) {
      const massAfter = dAdd(baseMass, block.massDec);
      const torqueAfter = dAdd(baseTorque, opt.torqueDelta);
      const kinds: ViolationKind[] = [];
      if (dCmp(massAfter, lim.maxLoad) > 0) kinds.push('load');
      if (dCmp(torqueAfter, lim.minTorque) < 0) kinds.push('torque-low');
      if (dCmp(torqueAfter, lim.maxTorque) > 0) kinds.push('torque-high');
      if (kinds.length > 0) {
        violations.push({
          blockIndex: block.index,
          blockName: block.name,
          optionIndex: opt.optionIndex,
          railId: opt.railId,
          railName: opt.railName,
          massAfter: dToNumber(massAfter),
          torqueAfter: dToNumber(torqueAfter),
          kinds,
        });
      }
    }
  }
  return { feasible: false, report: { witnessPrefix: witnessSteps, violations } };
}
