// backend/entry/__tests__/workflow.test.ts

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createRegistry } from "../workflow.js";
import { runWorkflow } from "../../src/workflow/runner.js";
import type { RunnerDeps } from "../../src/workflow/runner.js";
import type { WorkflowLifecycleEvent } from "../../src/workflow/events.js";
import { GraphRuntime } from "../../runtime/index.js";
import type { EventBus } from "../../runtime/index.js";

// mock DDG API（web_search 替换真实实现后需要，避免测试真实网络调用超时）
const originalFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = vi.fn().mockImplementation((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        AbstractText: "测试摘要内容",
        AbstractURL: "https://example.com",
        Heading: "测试标题",
        RelatedTopics: [
          { Text: "相关话题1 - 描述文本", FirstURL: "https://example.com/1" },
          { Text: "相关话题2 - 描述文本", FirstURL: "https://example.com/2" },
        ],
      }),
    } as Response)
  );
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

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
      return "微博和知乎在会员功能上各有侧重。";
    },
  };
}

function createMockEventBus(): EventBus {
  return {
    async publish(_event: any): Promise<void> {},
    async subscribe(_workflowId: string, _handler: (event: any) => void): Promise<void> {},
    async unsubscribe(_workflowId: string): Promise<void> {},
  };
}

function createAutoContinueDeps(): RunnerDeps {
  const events: WorkflowLifecycleEvent[] = [];
  return {
    loadEventStream: async () => [],
    appendEvent: async (_wfId, event) => { events.push(event); },
    waitForHumanDecision: async () => {
      const routeEvent = [...events].reverse().find(e => e.type === "route.required");
      if (routeEvent && routeEvent.type === "route.required" && routeEvent.suggestions.length > 0) {
        return { targetNode: routeEvent.suggestions[0].nodeId, action: "continue" };
      }
      return { targetNode: "artifact_generation", action: "continue" };
    },
    updateWorkflowStatus: async () => {},
  };
}

describe("Phase 2 全链路 E2E (with HITL runner)", () => {
  it("should complete product comparison workflow end to end", async () => {
    const llm = createMockLlm();
    const registry = createRegistry(llm);
    const eventBus = createMockEventBus();
    const deps = createAutoContinueDeps();
    const runtime = new GraphRuntime(registry);
    let state = runtime.initialState({ userInput: "对比微博和知乎的会员功能差异" });

    const collectedEvents: WorkflowLifecycleEvent[] = [];
    const wrappedDeps: RunnerDeps = {
      ...deps,
      appendEvent: async (_wfId, event) => {
        collectedEvents.push(event);
        return deps.appendEvent(_wfId, event);
      },
    };

    const ctx = {
      traceId: "",
      workflowId: "test-wf-1",
      runId: state.runtime.runId,
      nodeId: "",
      iteration: 0,
      signal: new AbortController().signal,
      llm: { complete: llm.complete, plan: async () => ({ phases: [] }), synthesize: async (_s: any, r: any[]) => r },
      emit: async (event: any) => {
        await eventBus.publish({
          traceId: "", eventType: event.eventType ?? "EVENT", uiHint: event.uiHint,
          nodeId: "", workflowId: "test-wf-1", runId: "", payload: event.payload ?? {},
          timestamp: new Date().toISOString(),
        } as any);
      },
      saveArtifact: async () => "",
    };

    const gen = runWorkflow("test-wf-1", "对比微博和知乎的会员功能差异", registry, ctx, eventBus, wrappedDeps);
    for await (const _ of gen) {}

    const executedNodes = collectedEvents
      .filter(e => e.type === "node.executed")
      .map(e => (e as { type: "node.executed"; nodeId: string }).nodeId);
    expect(executedNodes).toContain("requirement_parsing");
    expect(executedNodes).toContain("information_collection");
    expect(executedNodes).toContain("analysis_reasoning");
    expect(executedNodes).toContain("artifact_generation");

    const completed = collectedEvents.find(e => e.type === "workflow.completed");
    expect(completed).toBeDefined();

    const routeEvents = collectedEvents.filter(e => e.type === "route.required");
    expect(routeEvents.length).toBeGreaterThanOrEqual(2);

    const continuedEvents = collectedEvents.filter(e => e.type === "human.continued");
    expect(continuedEvents.length).toBe(routeEvents.length);
  });

  it("should handle empty user input gracefully", async () => {
    const llm = createMockLlm();
    const registry = createRegistry(llm);
    const eventBus = createMockEventBus();
    const deps = createAutoContinueDeps();
    const runtime = new GraphRuntime(registry);
    let state = runtime.initialState({ userInput: "" });

    const collectedEvents: WorkflowLifecycleEvent[] = [];
    const wrappedDeps: RunnerDeps = {
      ...deps,
      appendEvent: async (_wfId, event) => { collectedEvents.push(event); return deps.appendEvent(_wfId, event); },
    };

    const ctx = {
      traceId: "", workflowId: "test-wf-2", runId: state.runtime.runId, nodeId: "", iteration: 0,
      signal: new AbortController().signal,
      llm: { complete: llm.complete, plan: async () => ({ phases: [] }), synthesize: async (_s: any, r: any[]) => r },
      emit: async (event: any) => {
        await eventBus.publish({
          traceId: "", eventType: event.eventType ?? "EVENT", uiHint: event.uiHint,
          nodeId: "", workflowId: "test-wf-2", runId: "", payload: event.payload ?? {},
          timestamp: new Date().toISOString(),
        } as any);
      },
      saveArtifact: async () => "",
    };

    const gen = runWorkflow("test-wf-2", "", registry, ctx, eventBus, wrappedDeps);
    for await (const _ of gen) {}

    const executed = collectedEvents.filter(e => e.type === "node.executed").map(e => (e as any).nodeId);
    expect(executed).toContain("requirement_parsing");
  });
});
