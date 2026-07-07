import { describe, it, expect } from "vitest";
import { createWorkflow } from "../workflow.js";
import type { EventBus } from "../../runtime/index.js";
import type { WorkflowData } from "../../capabilities/shared/types.js";

// Mock LLM: 返回固定输出，验证数据流
function createMockLlm() {
  return {
    async complete(prompt: string): Promise<string> {
      if (prompt.includes("需求解析器")) {
        return JSON.stringify({
          analysisType: "product_comparison",
          targets: [{ name: "微博" }, { name: "知乎" }],
          dimensions: ["functionality", "pricing"],
          outputFormat: ["comparison_matrix", "swot"],
          constraints: {},
        });
      }
      if (prompt.includes("工作流编排器")) {
        return JSON.stringify({
          phases: [
            { name: "采集", targetNodes: ["information_collection"], rationale: "采集竞品数据" },
            { name: "分析", targetNodes: ["information_processing", "analysis_reasoning"], rationale: "处理分析数据" },
            { name: "生成", targetNodes: ["artifact_generation"], rationale: "生成产物" },
          ],
        });
      }
      if (prompt.includes("搜索计划") || prompt.includes("采集调度器")) {
        return JSON.stringify({
          batches: [{
            queries: [
              { target: "微博", dimension: "functionality", query: "微博 会员 功能" },
              { target: "知乎", dimension: "functionality", query: "知乎 盐选 功能" },
            ],
          }],
        });
      }
      if (prompt.includes("数据提取器")) {
        return JSON.stringify({
          records: [
            { attribute: "去广告", value: "支持", confidence: 0.9 },
            { attribute: "月费价格", value: "15元/月", confidence: 0.85 },
          ],
        });
      }
      if (prompt.includes("竞品分析师")) {
        return JSON.stringify({
          comparisonMatrix: [
            {
              dimension: "functionality",
              attribute: "去广告",
              values: [{ target: "微博", value: "支持", sourceTraceId: "" }, { target: "知乎", value: "支持", sourceTraceId: "" }],
              winner: null,
              analysis: "两者均支持去广告",
            },
          ],
        });
      }
      if (prompt.includes("SWOT 分析")) {
        return JSON.stringify({
          swot: [
            { category: "strengths", point: "内容丰富", evidence: "对比数据显示功能全面", sourceTraceIds: [], target: "微博" },
            { category: "weaknesses", point: "价格较高", evidence: "定价数据", sourceTraceIds: [], target: "微博" },
          ],
        });
      }
      // summary / llm_ranker fallback (invalid JSON → triggers fallbackRank)
      return "微博和知乎在会员功能上各有侧重，微博偏向社交增值，知乎偏向内容获取。";
    },
  };
}

// Mock EventBus: 不抛异常即可
function createMockEventBus(): EventBus {
  return {
    async publish(_event: any): Promise<void> { /* no-op */ },
    async subscribe(_workflowId: string, _handler: (event: any) => void): Promise<void> { /* no-op */ },
    async unsubscribe(_workflowId: string): Promise<void> { /* no-op */ },
  };
}

describe("Phase 2 全链路 E2E", () => {
  it("should complete product comparison workflow end to end", async () => {
    const llm = createMockLlm();
    const eventBus = createMockEventBus();
    const workflow = createWorkflow(llm, eventBus);

    const state = await workflow.run("对比微博和知乎的会员功能差异");

    const data = state.data as WorkflowData;

    // 1. config 已生成
    expect(data.config).toBeDefined();
    expect(data.config!.targets).toHaveLength(2);
    expect(data.config!.dimensions).toContain("functionality");

    // 2. rawData 已采集
    expect(data.rawData).toBeDefined();

    // 3. analysisResults 已生成
    expect(data.analysisResults).toBeDefined();
    expect(data.analysisResults!.comparisonMatrix.length).toBeGreaterThan(0);
    expect(data.analysisResults!.summary).toBeTruthy();

    // 4. artifacts 已生成
    expect(data.artifacts).toBeDefined();
    expect(data.artifacts!.length).toBeGreaterThan(0);
    const artifactTypes = data.artifacts!.map(a => a.type);
    expect(artifactTypes).toContain("comparison_matrix");
    expect(artifactTypes).toContain("summary");
    expect(artifactTypes).toContain("swot");
  });

  it("should handle empty user input gracefully", async () => {
    const llm = createMockLlm();
    const eventBus = createMockEventBus();
    const workflow = createWorkflow(llm, eventBus);

    const state = await workflow.run("");
    const data = state.data as WorkflowData;

    expect(data.config).toBeDefined();
  });

  it("should contain source maps in artifacts", async () => {
    const llm = createMockLlm();
    const eventBus = createMockEventBus();
    const workflow = createWorkflow(llm, eventBus);

    const state = await workflow.run("对比微博和知乎");
    const data = state.data as WorkflowData;

    expect(data.artifacts).toBeDefined();
    for (const artifact of data.artifacts!) {
      expect(artifact.sourceMap).toBeDefined();
      expect(Array.isArray(artifact.sourceMap)).toBe(true);
      expect(artifact.content).toBeTruthy();
    }
  });
});
