import { useState } from 'react';
import { dAdd, dCmp, dMul, dSub, dToString, decimalFrom, type Decimal } from '../solver/decimal';
import type { AdjudicationOutcome, Scenario, StepRecord, ViolationKind } from '../solver/types';
import { fmt } from '../format';

const KIND_LABEL: Record<ViolationKind, string> = {
  load: '总载荷超限',
  'torque-low': '力矩低于区间下端',
  'torque-high': '力矩高于区间上端',
};

interface Props {
  scenario: Scenario;
  outcome: AdjudicationOutcome;
}

/**
 * 按录入原文重建的精确十进制视图：float64 在整数部分超过 2^53 后会丢失
 * 小数尾差（例如挂后质量 10000000000000000.1 显示成 10000000000000000），
 * 展示同样使用精确十进制，避免“数字相等却报告超限”的误导。
 */
interface ExactContext {
  maxLoad: Decimal;
  minTorque: Decimal;
  maxTorque: Decimal;
  massOf: (blockIndex: number) => Decimal;
  deltaOf: (blockIndex: number, optionIndex: number) => Decimal;
}

function exactContextOf(scenario: Scenario): ExactContext {
  const railCoord = new Map(scenario.rails.map((r) => [r.id, decimalFrom(r.coordinate)]));
  return {
    maxLoad: decimalFrom(scenario.limits.maxLoad),
    minTorque: decimalFrom(scenario.limits.minTorque),
    maxTorque: decimalFrom(scenario.limits.maxTorque),
    massOf: (bi) => decimalFrom(scenario.blocks[bi].mass),
    deltaOf: (bi, oi) => {
      const opt = scenario.blocks[bi].options[oi];
      return dMul(decimalFrom(scenario.blocks[bi].mass), railCoord.get(opt.railId)!);
    },
  };
}

function exactMargin(torque: Decimal, min: Decimal, max: Decimal): Decimal {
  const low = dSub(torque, min);
  const high = dSub(max, torque);
  return dCmp(low, high) <= 0 ? low : high;
}

interface ExactRow {
  mass: Decimal;
  torque: Decimal;
  loadMargin: Decimal;
  torqueMargin: Decimal;
}

/** 沿挂装步骤逐步累加精确质量与力矩。 */
function exactRows(ctx: ExactContext, steps: StepRecord[]): ExactRow[] {
  let mass = decimalFrom(0);
  let torque = decimalFrom(0);
  return steps.map((s) => {
    mass = dAdd(mass, ctx.massOf(s.blockIndex));
    torque = dAdd(torque, ctx.deltaOf(s.blockIndex, s.optionIndex));
    return {
      mass,
      torque,
      loadMargin: dSub(ctx.maxLoad, mass),
      torqueMargin: exactMargin(torque, ctx.minTorque, ctx.maxTorque),
    };
  });
}

/** 某一步中该配重未采用的位置（含其安装代价）。 */
function unusedOptions(scenario: Scenario, step: StepRecord) {
  const block = scenario.blocks[step.blockIndex];
  return block.options
    .map((o, j) => ({ o, j }))
    .filter(({ j }) => j !== step.optionIndex)
    .map(({ o, j }) => {
      const rail = scenario.rails.find((r) => r.id === o.railId);
      return { key: `${step.blockIndex}-${j}`, text: `${rail?.name ?? o.railId}（代价 ${fmt(o.cost)}）` };
    });
}

function StepTable({
  scenario,
  steps,
  rows,
  active,
}: {
  scenario: Scenario;
  steps: StepRecord[];
  rows: ExactRow[];
  active?: number;
}) {
  return (
    <table className="steps">
      <thead>
        <tr>
          <th>步</th>
          <th>配重</th>
          <th>采用位置</th>
          <th>未采用位置</th>
          <th>已挂质量</th>
          <th>载荷余量</th>
          <th>力矩</th>
          <th>力矩余量</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s, i) => (
          <tr key={i} className={active === i ? 'active' : undefined}>
            <td>{i + 1}</td>
            <td>{s.blockName}</td>
            <td>
              {s.railName}（力臂 {fmt(s.coordinate)}，代价 {fmt(s.cost)}）
            </td>
            <td>
              {unusedOptions(scenario, s).map((u) => (
                <span key={u.key} className="tag dim">
                  {u.text}
                </span>
              ))}
            </td>
            <td>{dToString(rows[i].mass)}</td>
            <td>{dToString(rows[i].loadMargin)}</td>
            <td>{dToString(rows[i].torque)}</td>
            <td>{dToString(rows[i].torqueMargin)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FeasibleView({ scenario, outcome }: { scenario: Scenario; outcome: Extract<AdjudicationOutcome, { feasible: true }> }) {
  const { plan } = outcome;
  const [idx, setIdx] = useState(0);
  const step = plan.steps[idx];
  const block = scenario.blocks[step.blockIndex];
  const ctx = exactContextOf(scenario);
  const rows = exactRows(ctx, plan.steps);
  const row = rows[idx];
  const minMargin = rows.reduce((acc, r) => (dCmp(r.torqueMargin, acc) < 0 ? r.torqueMargin : acc), rows[0].torqueMargin);
  return (
    <section className="result ok">
      <h2>✓ 裁决通过：存在安全挂装顺序（共 {plan.steps.length} 步）</h2>
      <div className="summary">
        <div>
          <span className="k">总安装代价</span>
          <span className="v">{fmt(plan.totalCost)}</span>
        </div>
        <div>
          <span className="k">最小力矩余量</span>
          <span className="v">{dToString(minMargin)}</span>
        </div>
        <div>
          <span className="k">最终已挂质量</span>
          <span className="v">
            {dToString(rows[rows.length - 1].mass)}（余量 {dToString(rows[rows.length - 1].loadMargin)}）
          </span>
        </div>
        <div>
          <span className="k">最终力矩</span>
          <span className="v">
            {dToString(rows[rows.length - 1].torque)} ∈ [{dToString(ctx.minTorque)}, {dToString(ctx.maxTorque)}]
          </span>
        </div>
      </div>

      <div className="stepper">
        <button type="button" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>
          ◀ 上一步
        </button>
        <strong>
          第 {idx + 1} / {plan.steps.length} 步
        </strong>
        <button
          type="button"
          onClick={() => setIdx((i) => Math.min(plan.steps.length - 1, i + 1))}
          disabled={idx === plan.steps.length - 1}
        >
          下一步 ▶
        </button>
      </div>

      <div className="card">
        <h3>
          第 {idx + 1} 步：挂「{step.blockName}」（质量 {dToString(ctx.massOf(step.blockIndex))}）
        </h3>
        <ul>
          <li>
            采用位置：<strong>{step.railName}</strong>（力臂 {fmt(step.coordinate)}，安装代价 {fmt(step.cost)}）
          </li>
          <li>
            未采用位置：
            {unusedOptions(scenario, step).map((u) => (
              <span key={u.key} className="tag dim">
                {u.text}
              </span>
            ))}
            {block.options.length <= 1 && '（无）'}
          </li>
          <li>
            本步后已挂质量 <strong>{dToString(row.mass)}</strong>（载荷余量 {dToString(row.loadMargin)}），合力矩{' '}
            <strong>{dToString(row.torque)}</strong>（力矩余量 {dToString(row.torqueMargin)}）
          </li>
        </ul>
      </div>

      <h3>完整挂装次序</h3>
      <StepTable scenario={scenario} steps={plan.steps} rows={rows} active={idx} />
    </section>
  );
}

function InfeasibleView({ scenario, outcome }: { scenario: Scenario; outcome: Extract<AdjudicationOutcome, { feasible: false }> }) {
  const { report } = outcome;
  const d = report.witnessPrefix.length;
  const total = scenario.blocks.length;
  const ctx = exactContextOf(scenario);
  const witnessRows = exactRows(ctx, report.witnessPrefix);
  const base = witnessRows.length > 0 ? witnessRows[witnessRows.length - 1] : null;
  const baseMass = base ? base.mass : decimalFrom(0);
  const baseTorque = base ? base.torque : decimalFrom(0);
  return (
    <section className="result bad">
      <h2>⚠ 无可行方案</h2>
      <p className="lead">
        最早无法继续挂装的位置为第 <strong>{d + 1}</strong> 步（共需 {total} 步）：
        {d === 0
          ? '第一步挂装即没有任何满足载荷与力矩限制的选择。'
          : `以下最深的可行已选前缀（长度 ${d}）满足全部限制，但从该状态出发，所有剩余挂装选择均会触发限制。`}
      </p>

      {d > 0 && (
        <>
          <h3>已选前缀（{d} 步，均满足载荷与力矩限制）</h3>
          <StepTable scenario={scenario} steps={report.witnessPrefix} rows={witnessRows} />
        </>
      )}

      <h3>第 {d + 1} 步各候选选择触发的限制</h3>
      {report.violations.length === 0 ? (
        <p>（无候选选择）</p>
      ) : (
        <table className="steps">
          <thead>
            <tr>
              <th>候选配重</th>
              <th>候选位置</th>
              <th>挂后质量</th>
              <th>挂后力矩</th>
              <th>触发的限制</th>
            </tr>
          </thead>
          <tbody>
            {report.violations.map((v, i) => {
              const massAfter = dAdd(baseMass, ctx.massOf(v.blockIndex));
              const torqueAfter = dAdd(baseTorque, ctx.deltaOf(v.blockIndex, v.optionIndex));
              return (
                <tr key={i}>
                  <td>{v.blockName}</td>
                  <td>{v.railName}</td>
                  <td>
                    {dToString(massAfter)}（上限 {dToString(ctx.maxLoad)}）
                  </td>
                  <td>
                    {dToString(torqueAfter)}（区间 [{dToString(ctx.minTorque)}, {dToString(ctx.maxTorque)}]）
                  </td>
                  <td>
                    {v.kinds.map((k) => (
                      <span key={k} className="tag warn">
                        {KIND_LABEL[k]}
                      </span>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function ResultView({ scenario, outcome }: Props) {
  return outcome.feasible ? (
    <FeasibleView scenario={scenario} outcome={outcome} />
  ) : (
    <InfeasibleView scenario={scenario} outcome={outcome} />
  );
}
