import { describe, it, expect } from "vitest";
import { createRegistry } from "../workflow.js";
import { runWorkflow } from "../../src/workflow/runner.js";
import type { RunnerDeps } from "../../src/workflow/runner.js";
import type { WorkflowLifecycleEvent } from "../../src/workflow/events.js";
import { GraphRuntime } from "../../runtime/index.js";
import type { EventBus, RuntimeState } from "../../runtime/index.js";
import type { WorkflowData } from "../../capabilities/shared/types.js";

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
          batches: [{ queries: [
            { target: "微博", dimension: "functionality", query: "微博 会员 功能" },
            { target: "知乎", dimension: "functionality", query: "知乎 盐选 功能" },
          ]}],
        });
      }
      if (prompt.includes("数据提取器")) {
        return JSON.stringify({ records: [{ attribute: "去广告", value: "支持", confidence: 0.9 }] });
      }
      if (prompt.includes("竞品分析师")) {
        return JSON.stringify({
          comparisonMatrix: [{
            dimension: "functionality", attribute: "去广告",
            values: [{ target: "微博", value: "支持", sourceTraceId: "" }, { target: "知乎", value: "支持", sourceTraceId: "" }],
            winner: null, analysis: "两者均支持去广告",
          }],
        });
      }
      if (prompt.includes("SWOT 分析")) {
        return JSON.stringify({ swot: [
          { category: "strengths", point: "内容丰富", evidence: "", sourceTraceIds: [], target: "微博" },
          { category: "weaknesses", point: "价格较高", evidence: "", sourceTraceIds: [], target: "微博" },
        ]});
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

function createMockDeps(): RunnerDeps {
  const events: WorkflowLifecycleEvent[] = [];
  return {
    loadEventStream: async () => events,
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

async function runToCompletion(input: string) {
  const llm = createMockLlm();
  const registry = createRegistry(llm);
  const eventBus = createMockEventBus();
  const deps = createMockDeps();
  const runtime = new GraphRuntime(registry);
  let state = runtime.initialState({ userInput: input } as WorkflowData);

  const collectedEvents: WorkflowLifecycleEvent[] = [];
  const wrappedDeps: RunnerDeps = {
    ...deps,
    appendEvent: async (_wfId, event) => { collectedEvents.push(event); return deps.appendEvent(_wfId, event); },
  };

  const ctx = {
    traceId: "", workflowId: "test-wf", runId: state.runtime.runId, nodeId: "", iteration: 0,
    signal: new AbortController().signal,
    llm: { complete: llm.complete, plan: async () => ({ phases: [] }), synthesize: async (_s: any, r: any[]) => r },
    emit: async (event: any) => {
      await eventBus.publish({ traceId: "", eventType: event.eventType ?? "EVENT", uiHint: event.uiHint, nodeId: "", workflowId: "test-wf", runId: "", payload: event.payload ?? {}, timestamp: new Date().toISOString() } as any);
    },
    saveArtifact: async () => "",
  };

  const gen = runWorkflow("test-wf", input, registry, ctx, eventBus, wrappedDeps);
  for await (const _ of gen) {}

  return collectedEvents;
}

describe("Phase 2 E2E with HITL runner", () => {
  it("produces complete event chain for product comparison", async () => {
    const events = await runToCompletion("对比微博和知乎的会员功能差异");

    const executed = events.filter(e => e.type === "node.executed").map(e => (e as any).nodeId);
    expect(executed).toContain("requirement_parsing");
    expect(executed).toContain("information_collection");
    expect(executed).toContain("analysis_reasoning");
    expect(executed).toContain("artifact_generation");

    const completed = events.find(e => e.type === "workflow.completed");
    expect(completed).toBeDefined();

    const routeEvents = events.filter(e => e.type === "route.required");
    expect(routeEvents.length).toBeGreaterThanOrEqual(2);

    const continuedEvents = events.filter(e => e.type === "human.continued");
    expect(continuedEvents.length).toBe(routeEvents.length);
  });

  it("handles empty input", async () => {
    const events = await runToCompletion("");
    const executed = events.filter(e => e.type === "node.executed").map(e => (e as any).nodeId);
    expect(executed).toContain("requirement_parsing");
  });
});
