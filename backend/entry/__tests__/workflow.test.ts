// backend/entry/__tests__/workflow.test.ts

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createRegistry } from "../workflow.js";
import { createArtifactGenerationCap } from "../../capabilities/artifact_generation/index.js";
import { createRequirementParsingCap } from "../../capabilities/requirement_parsing/index.js";
import { createInformationCollectionCap } from "../../capabilities/information_collection/index.js";
import { createInformationProcessingCap } from "../../capabilities/information_processing/index.js";
import { createAnalysisReasoningCap } from "../../capabilities/analysis_reasoning/index.js";
import { runWorkflow } from "../../src/workflow/runner.js";
import type { RunnerDeps } from "../../src/workflow/runner.js";
import type { WorkflowLifecycleEvent, HumanClarification } from "../../src/workflow/events.js";
import { GraphRuntime, CapabilityRegistry } from "../../runtime/index.js";
import type { EventBus, Capability, RuntimeState } from "../../runtime/index.js";
import type { RuntimeContext } from "../../runtime/index.js";

// mock DDG API（web_search 替换真实实现后需要，避免测试真实网络调用超时）
// Also provides HTML responses for web_scrape since the capability now scrapes search result URLs.
const originalFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = vi.fn().mockImplementation((_url: string | URL | Request, _init?: RequestInit) => {
    const urlStr = typeof _url === "string" ? _url : _url instanceof URL ? _url.href : _url.url;
    // DDG API requests get JSON
    if (urlStr.includes("duckduckgo.com")) {
      return Promise.resolve({
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
      } as Response);
    }
    // All other URLs (web_scrape targets) get fake HTML
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      text: async () => "<html><head><title>测试页面</title></head><body><article><h1>产品功能介绍</h1><p>这是竞品分析测试页面的正文内容，包含丰富的产品功能描述和定价信息。会员价格15元每月，支持去广告、高清视频等高级功能。</p></article></body></html>",
      json: async () => { throw new Error("Not JSON"); },
    } as unknown as Response);
  });
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

// Wraps artifact_generation + captures final state.data for test inspection
let capturedWorkflowData: Record<string, any> = {};

function createStateCapturingArtifactGenerationCap(): Capability {
  const real = createArtifactGenerationCap();
  return {
    ...real,
    id: "artifact_generation",
    description: "Artifact generation + state capture for testing",
    requires: ["analysis_reasoning"],
    outputHints: ["artifacts", "_captured"],
    async execute(state: RuntimeState, ctx: RuntimeContext): Promise<{ patch: Record<string, any>; artifacts: any[] }> {
      // Save the full state BEFORE executing (so we see rawData, structuredData, analysisResults)
      capturedWorkflowData = {
        config: state.data.config,
        rawData: state.data.rawData,
        structuredData: state.data.structuredData,
        analysisResults: state.data.analysisResults,
      };
      // Delegate to real artifact_generation
      const result = await real.execute(state, ctx);
      capturedWorkflowData.artifacts = result.patch.artifacts ?? state.data.artifacts;
      return result;
    },
  };
}

function createMockLlm() {
  return {
    async complete(prompt: string): Promise<string> {
      // ── Requirement parsing: multi-round prompts ──
      if (prompt.includes("三种场景")) {
        return JSON.stringify({ analysisType: "product_comparison", confidence: 0.9 });
      }
      if (prompt.includes("从用户输入中提取所有")) {
        return JSON.stringify({ mentioned: ["微博", "知乎"], ownProduct: "微博" });
      }
      if (prompt.includes("从用户回答中提取完整的竞品列表")) {
        return JSON.stringify({ targets: [{ name: "微博", isOwn: true }, { name: "知乎", isOwn: false }] });
      }
      if (prompt.includes("从用户回答中提取选中的对比维度")) {
        return JSON.stringify({ dimensions: ["functionality", "pricing"] });
      }
      if (prompt.includes("从用户回答中提取选中的产物格式")) {
        return JSON.stringify({ outputFormat: ["comparison_matrix", "swot"] });
      }
      if (prompt.includes("从用户回答中提取分析约束条件")) {
        return JSON.stringify({ constraints: {} });
      }
      // ── Orchestration ──
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
      if (prompt.includes("官方网站或应用商店URL")) {
        return JSON.stringify({ url: "https://weibo.com", sourceType: "official" });
      }
      if (prompt.includes("对比维度统计")) {
        return JSON.stringify({ suggestions: [] });
      }
      // ── Information processing: tools ──
      if (prompt.includes("价格归一化工具")) {
        return JSON.stringify({
          records: [
            { attribute: "月费价格", value: "15元/月", rawValue: "15元/月", confidence: 0.85 },
            { attribute: "年费价格", value: "120元/年", rawValue: "120元/年", confidence: 0.8 },
          ],
        });
      }
      if (prompt.includes("功能点提取工具")) {
        return JSON.stringify({
          records: [
            { attribute: "去广告", value: "支持", rawValue: "支持", confidence: 0.9 },
            { attribute: "高清视频", value: "支持", rawValue: "支持", confidence: 0.85 },
          ],
        });
      }
      if (prompt.includes("实体解析工具")) {
        return JSON.stringify({ merged: [] });
      }
      if (prompt.includes("冲突检测工具")) {
        return JSON.stringify({ records: [], conflicts: [] });
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
      // ── insight_extractor ──
      if (prompt.includes("竞争洞察专家")) {
        return JSON.stringify({
          insights: [
            { category: "advantage", statement: "微博社交属性强", evidence: "微博有5亿月活，知乎8000万", relatedTargets: ["知乎"], sourceTraceIds: [] },
            { category: "gap", statement: "会员权益单一", evidence: "微博会员仅15元/月，知乎盐选25元/月含更多内容", relatedTargets: ["知乎"], sourceTraceIds: [] },
          ],
        });
      }
      // ── comparison_summarizer ──
      if (prompt.includes("竞品分析总结专家")) {
        return "微博和知乎在会员功能上各有侧重。微博主打社交，知乎主打知识付费。";
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
  let clarificationRound = 0;
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
    waitForHumanClarification: async (): Promise<HumanClarification> => {
      clarificationRound++;
      const responses: Record<number, string> = {
        1: "product_comparison",
        2: "微博和知乎，自身产品是微博",
        3: "functionality, pricing",
        4: "comparison_matrix, swot",
        5: "无",
        6: "确认",
      };
      return { round: clarificationRound, userResponse: responses[clarificationRound] ?? "确认" };
    },
    updateWorkflowStatus: async () => {},
  };
}

describe("Phase 2 全链路 E2E (with HITL runner)", () => {
  it("should complete product comparison workflow end to end", async () => {
    const llm = createMockLlm();
    // Use capture wrapper instead of createRegistry so we can inspect the full
    // state.data after the runWorkflow pipeline completes (with HITL loop).
    const registry = new CapabilityRegistry();
    registry.register(createRequirementParsingCap(llm));
    registry.register(createInformationCollectionCap(llm));
    registry.register(createInformationProcessingCap(llm));
    registry.register(createAnalysisReasoningCap(llm));
    registry.register(createStateCapturingArtifactGenerationCap());
    const eventBus = createMockEventBus();
    const deps = createAutoContinueDeps();
    const runtime = new GraphRuntime(registry);
    let state = runtime.initialState({ userInput: "对比微博和知乎的会员功能差异" });

    const collectedEvents: WorkflowLifecycleEvent[] = [];
    let testClarificationRound = 0;
    const wrappedDeps: RunnerDeps = {
      ...deps,
      appendEvent: async (_wfId, event) => {
        collectedEvents.push(event);
        return deps.appendEvent(_wfId, event);
      },
      waitForHumanClarification: async (): Promise<HumanClarification> => {
        testClarificationRound++;
        const responses: Record<number, string> = {
          1: "product_comparison",
          2: "微博和知乎，自身产品是微博",
          3: "functionality, pricing",
          4: "comparison_matrix, swot",
          5: "无",
          6: "确认",
        };
        return { round: testClarificationRound, userResponse: responses[testClarificationRound] ?? "确认" };
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

    // Verify clarification lifecycle: all rounds had required+provided pairs
    const clarificationRequired = collectedEvents.filter(e => e.type === "clarification.required");
    expect(clarificationRequired.length).toBeGreaterThanOrEqual(5);
    // Round 1 should be scene_selection
    const round1 = clarificationRequired.find(
      e => (e as any).round === 1 || (e as any).questionType === "scene_selection",
    );
    expect(round1).toBeDefined();

    const clarificationProvided = collectedEvents.filter(e => e.type === "clarification.provided");
    expect(clarificationProvided.length).toBe(clarificationRequired.length);

    // ═══ Deep data contract verification — captured by state_capture Capability ═══
    const captured = capturedWorkflowData;
    expect(captured.config).toBeDefined();
    expect(captured.config.targets).toHaveLength(2);
    expect(captured.config.dimensions).toContain("functionality");
    expect(captured.config.outputFormat).toContain("comparison_matrix");
    expect(captured.config.clarificationHistory.length).toBeGreaterThanOrEqual(5);

    // rawData verification
    expect(captured.rawData).toBeDefined();
    const rawKeys = Object.keys(captured.rawData);
    expect(rawKeys.length).toBeGreaterThanOrEqual(1);
    for (const dim of rawKeys) {
      for (const item of captured.rawData[dim]) {
        expect(item).toHaveProperty("target");
        expect(item).toHaveProperty("dimension");
        expect(item).toHaveProperty("content");
        expect(item).toHaveProperty("sourceUrl");
        expect(item).toHaveProperty("credibility");
      }
    }

    // structuredData verification
    expect(captured.structuredData).toBeDefined();
    for (const dim of Object.keys(captured.structuredData ?? {})) {
      for (const rec of (captured.structuredData as any)[dim]) {
        expect(rec).toHaveProperty("target");
        expect(rec).toHaveProperty("attribute");
        expect(rec).toHaveProperty("value");
        expect(rec).toHaveProperty("confidence");
        expect(rec).toHaveProperty("status");
      }
    }

    // analysisResults verification
    expect(captured.analysisResults).toBeDefined();
    expect(captured.analysisResults.comparisonMatrix).toBeDefined();
    expect(captured.analysisResults.swot).toBeDefined();
    expect(captured.analysisResults.insights).toBeDefined();
    expect(typeof captured.analysisResults.summary).toBe("string");
    expect(captured.analysisResults.summary.length).toBeGreaterThan(0);

    // artifacts verification
    expect(captured.artifacts).toBeDefined();
    expect(captured.artifacts.length).toBeGreaterThanOrEqual(2);
    const types = captured.artifacts.map((a: any) => a.type);
    expect(types).toContain("comparison_matrix");
    expect(types).toContain("swot");
  });

  it("should handle empty user input gracefully", async () => {
    const llm = createMockLlm();
    const registry = createRegistry(llm);
    const eventBus = createMockEventBus();
    const deps = createAutoContinueDeps();
    const runtime = new GraphRuntime(registry);
    let state = runtime.initialState({ userInput: "" });

    const collectedEvents: WorkflowLifecycleEvent[] = [];
    let testClarificationRound2 = 0;
    const wrappedDeps: RunnerDeps = {
      ...deps,
      appendEvent: async (_wfId, event) => { collectedEvents.push(event); return deps.appendEvent(_wfId, event); },
      waitForHumanClarification: async (): Promise<HumanClarification> => {
        testClarificationRound2++;
        const responses: Record<number, string> = {
          1: "product_comparison",
          2: "微博和知乎，自身产品是微博",
          3: "functionality, pricing",
          4: "comparison_matrix, swot",
          5: "无",
          6: "确认",
        };
        return { round: testClarificationRound2, userResponse: responses[testClarificationRound2] ?? "确认" };
      },
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
