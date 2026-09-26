import { describe, expect, it } from 'vitest';
import { adjudicate } from './solver/adjudicate';
import { parseDraft, type Draft } from './draft';

describe('parseDraft · 超大十进制原文传递', () => {
  it('草稿录入 2500000000000000.025 等文本时，裁决按录入十进制值判定超载', () => {
    const draft: Draft = {
      rails: [
        { id: 'r1', name: 'M1', coordinate: '0' },
        { id: 'r2', name: 'M2', coordinate: '0' },
      ],
      blocks: [0, 1, 2, 3].map((i) => ({
        id: `b${i}`,
        name: `配重${i + 1}`,
        mass: '2500000000000000.025',
        options: [
          { railId: 'r1', cost: '1' },
          { railId: 'r2', cost: '1' },
        ],
      })),
      maxLoad: '10000000000000000',
      minTorque: '0',
      maxTorque: '0',
    };

    const parsed = parseDraft(draft);
    expect('errors' in parsed ? parsed.errors : []).toEqual([]);
    if ('errors' in parsed) return;
    // 录入原文必须原样到达求解层，而非经 float64 舍入。
    expect(parsed.scenario.blocks[0].mass).toBe('2500000000000000.025');
    expect(parsed.scenario.limits.maxLoad).toBe('10000000000000000');

    const outcome = adjudicate(parsed.scenario);
    expect(outcome.feasible).toBe(false);
    if (outcome.feasible) return;
    expect(outcome.report.witnessPrefix).toHaveLength(3);
    expect(outcome.report.violations).toHaveLength(2);
    expect(outcome.report.violations.every((v) => v.kinds.length === 1 && v.kinds[0] === 'load')).toBe(true);
  });
});
