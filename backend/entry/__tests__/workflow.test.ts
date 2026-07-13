// backend/entry/__tests__/workflow.test.ts

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createRegistry } from "../workflow.js";
import { runWorkflow } from "../../src/workflow/runner.js";
import type { RunnerDeps } from "../../src/workflow/runner.js";
import type { WorkflowLifecycleEvent, HumanClarification } from "../../src/workflow/events.js";
import { GraphRuntime } from "../../runtime/index.js";
import type { EventBus } from "../../runtime/index.js";
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
    const registry = createRegistry(llm);
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

  // This test validates data shapes / contracts by driving Capability.execute directly.
  // It does NOT exercise the HITL clarification loop — see the runWorkflow tests above
  // for full user-flow coverage.
  it("should verify data contract through direct Capability execution", async () => {
    const llm = createMockLlm();
    const registry = createRegistry(llm);
    const runtime = new GraphRuntime(registry);

    // Initial state
    let state = runtime.initialState({ userInput: "对比微博和知乎的会员功能差异" });

    const emitted: any[] = [];
    function makeCtx(nodeId: string): RuntimeContext {
      return {
        traceId: `trace-${nodeId}`,
        workflowId: "test-wf-deep",
        runId: state.runtime.runId,
        nodeId,
        iteration: 0,
        signal: new AbortController().signal,
        llm: {
          complete: llm.complete,
          plan: async () => ({ phases: [] }),
          synthesize: async (_s: any, r: any[]) => r,
        },
        emit: async (event: any) => { emitted.push(event); },
        saveArtifact: async () => "",
      };
    }

    // ═══ Step 1: Requirement Parsing ═══
    // Round 1: scene_selection
    let result = await registry.get("requirement_parsing")!.execute(state, makeCtx("requirement_parsing"));
    state.data._rpState = result.patch._rpState;

    // Rounds 2-5: targets, dimensions, output_format, constraints
    const answers = [
      "微博和知乎，自身产品是微博",       // round 2: targets
      "functionality, pricing",           // round 3: dimensions
      "comparison_matrix, swot",          // round 4: output_format
      "无",                               // round 5: constraints
    ];
    for (const ans of answers) {
      state.data._userResponse = ans;
      result = await registry.get("requirement_parsing")!.execute(state, makeCtx("requirement_parsing"));
      state.data._rpState = result.patch._rpState;
      state.data._userResponse = undefined;
    }

    // Round 6: confirm_preview — first call emits clarification_asked
    result = await registry.get("requirement_parsing")!.execute(state, makeCtx("requirement_parsing"));
    state.data._rpState = result.patch._rpState;

    // Round 6 confirm response
    state.data._userResponse = "确认";
    result = await registry.get("requirement_parsing")!.execute(state, makeCtx("requirement_parsing"));
    // Merge final patch (config + _rpState: null)
    state.data._rpState = result.patch._rpState;
    state.data.config = result.patch.config;
    state.data._userResponse = undefined;

    // After confirmation, rpState should be null and config should exist
    expect(state.data._rpState).toBeNull();
    const config = state.data.config as any;
    expect(config).toBeDefined();
    expect(config.analysisType).toBe("product_comparison");
    expect(config.targets).toHaveLength(2);
    expect(config.targets[0].name).toBe("微博");
    expect(config.dimensions).toContain("functionality");
    expect(config.dimensions).toContain("pricing");
    expect(config.outputFormat).toContain("comparison_matrix");
    expect(config.outputFormat).toContain("swot");
    expect(config.clarificationHistory).toBeDefined();
    expect(config.clarificationHistory.length).toBe(6);

    // Verify each clarification round has agentPrompt and extractedDelta
    const sceneRound = config.clarificationHistory[0];
    expect(sceneRound.questionType).toBe("scene_selection");
    expect(sceneRound.agentPrompt).toBeTruthy();
    expect(sceneRound.extractedDelta.analysisType).toBe("product_comparison");

    // ═══ Step 2: Information Collection ═══
    result = await registry.get("information_collection")!.execute(state, makeCtx("information_collection"));
    // Merge patch
    state = { ...state, data: { ...state.data, ...result.patch } };

    const rawData = state.data.rawData as Record<string, any[]>;
    expect(rawData).toBeDefined();
    expect(Object.keys(rawData).length).toBeGreaterThanOrEqual(1);
    // Check each item has the correct shape
    for (const dim of Object.keys(rawData)) {
      for (const item of rawData[dim]) {
        expect(item).toHaveProperty("target");
        expect(item).toHaveProperty("dimension");
        expect(item).toHaveProperty("content");
        expect(item).toHaveProperty("sourceUrl");
        expect(item).toHaveProperty("retrievedAt");
        expect(item).toHaveProperty("credibility");
      }
    }

    // ═══ Step 3: Information Processing ═══
    result = await registry.get("information_processing")!.execute(state, makeCtx("information_processing"));
    state = { ...state, data: { ...state.data, ...result.patch } };

    const structuredData = state.data.structuredData as Record<string, any[]>;
    expect(structuredData).toBeDefined();
    // Each record should have the StructuredRecord shape
    for (const dim of Object.keys(structuredData)) {
      for (const rec of structuredData[dim]) {
        expect(rec).toHaveProperty("target");
        expect(rec).toHaveProperty("dimension");
        expect(rec).toHaveProperty("attribute");
        expect(rec).toHaveProperty("value");
        expect(rec).toHaveProperty("confidence");
        expect(rec).toHaveProperty("status");
        expect(["clean", "conflicting", "inferred"]).toContain(rec.status);
      }
    }

    // ═══ Step 4: Analysis Reasoning ═══
    result = await registry.get("analysis_reasoning")!.execute(state, makeCtx("analysis_reasoning"));
    state = { ...state, data: { ...state.data, ...result.patch } };

    const analysisResults = state.data.analysisResults as any;
    expect(analysisResults).toBeDefined();
    expect(analysisResults.comparisonMatrix).toBeDefined();
    expect(Array.isArray(analysisResults.comparisonMatrix)).toBe(true);
    expect(analysisResults.swot).toBeDefined();
    expect(Array.isArray(analysisResults.swot)).toBe(true);
    expect(analysisResults.insights).toBeDefined();
    expect(Array.isArray(analysisResults.insights)).toBe(true);
    expect(analysisResults.summary).toBeDefined();
    expect(typeof analysisResults.summary).toBe("string");
    expect(analysisResults.summary.length).toBeGreaterThan(0);
    // SWOT entries should have all required fields
    for (const entry of analysisResults.swot) {
      expect(entry).toHaveProperty("category");
      expect(entry).toHaveProperty("target");
      expect(entry).toHaveProperty("point");
      expect(entry).toHaveProperty("evidence");
      expect(["strengths", "weaknesses", "opportunities", "threats"]).toContain(entry.category);
    }
    // Insights should have all required fields
    for (const insight of analysisResults.insights) {
      expect(insight).toHaveProperty("category");
      expect(insight).toHaveProperty("statement");
      expect(insight).toHaveProperty("evidence");
      expect(["gap", "opportunity", "risk", "advantage"]).toContain(insight.category);
    }

    // ═══ Step 5: Artifact Generation ═══
    result = await registry.get("artifact_generation")!.execute(state, makeCtx("artifact_generation"));
    state = { ...state, data: { ...state.data, ...result.patch } };

    const artifacts = state.data.artifacts as any[];
    expect(artifacts).toBeDefined();
    expect(artifacts.length).toBeGreaterThanOrEqual(2); // at least comparison_matrix + swot
    // Each artifact should have type, format, title, content, sourceMap
    const artifactTypes = artifacts.map((a: any) => a.type);
    expect(artifactTypes).toContain("comparison_matrix");
    expect(artifactTypes).toContain("swot");
    for (const art of artifacts) {
      expect(art).toHaveProperty("type");
      expect(art).toHaveProperty("format");
      expect(art).toHaveProperty("title");
      expect(art).toHaveProperty("content");
      expect(art).toHaveProperty("sourceMap");
      expect(typeof art.title).toBe("string");
      expect(art.title.length).toBeGreaterThan(0);
      expect(typeof art.content).toBe("string");
    }
    // SWOT artifacts should contain SWOT structure
    const swotArtifact = artifacts.find((a: any) => a.type === "swot");
    expect(swotArtifact).toBeDefined();
    expect(swotArtifact.content).toContain("SWOT 分析");

    // Emitted events should include WORKFLOW_COMPLETE
    const completeEvent = emitted.find(e => e.uiHint === "workflow_complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent.payload).toHaveProperty("artifactCount");
    expect(completeEvent.payload).toHaveProperty("sourceMapCount");

    // ═══ Full flow verification ═══
    // Verify the data chain is intact: config → rawData → structuredData → analysisResults → artifacts
    expect(config.targets[0].name).toBe("微博");
    expect(Object.keys(rawData).length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(structuredData).length).toBeGreaterThanOrEqual(0);
    expect(analysisResults.summary.length).toBeGreaterThan(0);
    expect(artifacts.length).toBeGreaterThanOrEqual(2);
  });
});
