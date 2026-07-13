import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createRequirementParsingCap } from "../index.js";
import type { RpIntermediateState } from "../index.js";
import { GraphRuntime } from "../../../runtime/index.js";
import type { RuntimeState, RuntimeContext } from "../../../runtime/index.js";

// Mock global fetch for web_search
const originalFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = vi.fn().mockImplementation((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response)
  );
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

function createMockLlm() {
  return {
    async complete(prompt: string): Promise<string> {
      if (prompt.includes("三种场景")) {
        return JSON.stringify({ analysisType: "product_comparison", confidence: 0.9 });
      }
      if (prompt.includes("从用户输入中提取所有")) {
        return JSON.stringify({ mentioned: ["微博", "知乎"], ownProduct: "微博" });
      }
      if (prompt.includes("从用户回答中提取完整的竞品列表")) {
        return JSON.stringify({
          targets: [
            { name: "微博", isOwn: true, category: "social" },
            { name: "知乎", isOwn: false, category: "social" },
          ],
        });
      }
      if (prompt.includes("从用户回答中提取选中的对比维度")) {
        return JSON.stringify({ dimensions: ["functionality", "pricing"] });
      }
      if (prompt.includes("从用户回答中提取选中的产物格式")) {
        return JSON.stringify({ outputFormat: ["comparison_matrix", "swot"] });
      }
      if (prompt.includes("从用户回答中提取分析约束条件")) {
        return JSON.stringify({ constraints: { timeRange: { from: "2025-01-01", to: "2025-12-31" } } });
      }
      return "{}";
    },
  };
}

function makeCtx(emitted: any[]): RuntimeContext {
  return {
    traceId: "t1",
    workflowId: "w1",
    runId: "r1",
    nodeId: "requirement_parsing",
    iteration: 0,
    signal: new AbortController().signal,
    llm: { complete: createMockLlm().complete, plan: async () => ({}), synthesize: async (_: any, r: any[]) => r },
    emit: async (event: any) => { emitted.push(event); },
    saveArtifact: async () => "",
  };
}

describe("requirement_parsing clarification state machine", () => {
  it("Round 1: should emit clarification_asked with scene_selection", async () => {
    const cap = createRequirementParsingCap({ complete: createMockLlm().complete });
    const emitted: any[] = [];
    const runtime = new GraphRuntime({ get: () => cap } as any);
    let state = runtime.initialState({ userInput: "比较微博和知乎" });

    const result = await cap.execute(state, makeCtx(emitted));

    const asked = emitted.find(e => e.uiHint === "clarification_asked");
    expect(asked).toBeDefined();
    expect(asked.payload.round).toBe(1);
    expect(asked.payload.questionType).toBe("scene_selection");
    expect(asked.payload.inputType).toBe("single_select");
    expect(asked.payload.options).toHaveLength(3);

    const rp: RpIntermediateState = result.patch._rpState;
    expect(rp).toBeDefined();
    expect(rp.phase).toBe("clarification_loop");
    expect(rp.roundDefs).toBeDefined();
    expect(rp.roundDefs!.length).toBe(4);
    expect(rp.history).toHaveLength(1);
  });

  it("should complete full 6-round clarification", async () => {
    const cap = createRequirementParsingCap({ complete: createMockLlm().complete });
    const emitted: any[] = [];
    const runtime = new GraphRuntime({ get: () => cap } as any);
    let state = runtime.initialState({ userInput: "比较微博和知乎" });

    // Round 1: scene_selection
    let result = await cap.execute(state, makeCtx(emitted));
    state.data._rpState = result.patch._rpState;

    // Round 2: targets
    state.data._userResponse = "微博和知乎，自身产品是微博";
    result = await cap.execute(state, makeCtx(emitted));
    expect(emitted.some(e => e.uiHint === "clarification_asked" && e.payload.questionType === "targets")).toBe(true);
    state.data._rpState = result.patch._rpState;
    state.data._userResponse = undefined;

    // Round 3: dimensions
    state.data._userResponse = "functionality, pricing";
    result = await cap.execute(state, makeCtx(emitted));
    expect(emitted.some(e => e.uiHint === "clarification_asked" && e.payload.questionType === "dimensions")).toBe(true);
    state.data._rpState = result.patch._rpState;
    state.data._userResponse = undefined;

    // Round 4: output_format
    state.data._userResponse = "comparison_matrix, swot";
    result = await cap.execute(state, makeCtx(emitted));
    expect(emitted.some(e => e.uiHint === "clarification_asked" && e.payload.questionType === "output_format")).toBe(true);
    state.data._rpState = result.patch._rpState;
    state.data._userResponse = undefined;

    // Round 5: constraints
    state.data._userResponse = "时间范围2025年";
    result = await cap.execute(state, makeCtx(emitted));
    const constraintsAsked = emitted.find(e => e.uiHint === "clarification_asked" && e.payload.questionType === "constraints");
    expect(constraintsAsked).toBeDefined();
    expect(constraintsAsked.payload.inputType).toBe("free_text");
    state.data._rpState = result.patch._rpState;
    state.data._userResponse = undefined;

    // All ROUND_DEFS exhausted -> enters confirming
    result = await cap.execute(state, makeCtx(emitted));
    const confirmAsked = emitted.find(e => e.uiHint === "clarification_asked" && e.payload.questionType === "confirm_preview");
    expect(confirmAsked).toBeDefined();
    expect(confirmAsked.payload.inputType).toBe("confirm_actions");
    expect(confirmAsked.payload.current).toBeDefined();
    state.data._rpState = result.patch._rpState;
    state.data._userResponse = undefined;

    // Confirm
    state.data._userResponse = "确认";
    result = await cap.execute(state, makeCtx(emitted));

    const answered = emitted.find(e => e.eventType === "CLARIFICATION_ANSWERED");
    expect(answered).toBeDefined();

    const completed = emitted.find(e => e.uiHint === "node_completed");
    expect(completed).toBeDefined();

    const config = completed.payload.config;
    expect(config.analysisType).toBe("product_comparison");
    expect(config.targets).toHaveLength(2);
    expect(config.targets[0].name).toBe("微博");
    expect(config.dimensions).toContain("functionality");
    expect(config.outputFormat).toContain("comparison_matrix");
    expect(config.clarificationHistory).toHaveLength(6);

    for (const round of config.clarificationHistory) {
      expect(round.agentPrompt).toBeTruthy();
      expect(round.questionType).toBeTruthy();
    }

    expect(config.clarificationHistory[0].extractedDelta.analysisType).toBe("product_comparison");
    expect(result.patch._rpState).toBeNull();
  });

  it("should support backjump from confirm_preview to targets", async () => {
    const cap = createRequirementParsingCap({ complete: createMockLlm().complete });
    const emitted: any[] = [];
    const runtime = new GraphRuntime({ get: () => cap } as any);
    let state = runtime.initialState({ userInput: "比较微博和知乎" });

    // Run through rounds 1-5
    let result = await cap.execute(state, makeCtx(emitted));
    state.data._rpState = result.patch._rpState;

    state.data._userResponse = "微博和知乎，自身产品是微博"; result = await cap.execute(state, makeCtx(emitted));
    state.data._rpState = result.patch._rpState; state.data._userResponse = undefined;

    state.data._userResponse = "functionality, pricing"; result = await cap.execute(state, makeCtx(emitted));
    state.data._rpState = result.patch._rpState; state.data._userResponse = undefined;

    state.data._userResponse = "comparison_matrix, swot"; result = await cap.execute(state, makeCtx(emitted));
    state.data._rpState = result.patch._rpState; state.data._userResponse = undefined;

    state.data._userResponse = "无"; result = await cap.execute(state, makeCtx(emitted));
    state.data._rpState = result.patch._rpState; state.data._userResponse = undefined;

    // Enter confirming
    result = await cap.execute(state, makeCtx(emitted));
    state.data._rpState = result.patch._rpState;

    // User rejects: modify
    state.data._userResponse = "我要修改竞品列表";
    result = await cap.execute(state, makeCtx(emitted));

    const rp: RpIntermediateState = result.patch._rpState;
    expect(rp.phase).toBe("clarification_loop");
    expect(rp.roundIndex).toBe(0);
    expect(rp.history.length).toBeLessThan(5);

    // Next execute should re-ask targets
    result = await cap.execute(state, makeCtx(emitted));
    const reAsked = emitted.findLast(e => e.uiHint === "clarification_asked" && e.payload.questionType === "targets");
    expect(reAsked).toBeDefined();
  });

  it("should handle completed state as idempotent", async () => {
    const cap = createRequirementParsingCap({ complete: createMockLlm().complete });
    const emitted: any[] = [];
    const runtime = new GraphRuntime({ get: () => cap } as any);
    let state = runtime.initialState({ userInput: "比较微博和知乎" });

    const completedState: RpIntermediateState = {
      phase: "confirming",
      roundIndex: 0,
      roundDefs: null,
      partialConfig: {
        analysisType: "product_comparison",
        targets: [{ name: "A" }, { name: "B" }],
        dimensions: ["functionality"],
        outputFormat: ["comparison_matrix"],
        constraints: {},
        userInput: "test",
      },
      history: [],
      completed: true,
    };
    state.data._rpState = completedState;

    const result = await cap.execute(state, makeCtx(emitted));
    const completed = emitted.find(e => e.uiHint === "node_completed");
    expect(completed).toBeDefined();
    expect(result.patch._rpState).toBeNull();
  });
});
