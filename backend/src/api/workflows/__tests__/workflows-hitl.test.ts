import { describe, it, expect } from 'vitest';
import { fold, countIterations, getOutputKeys } from '../../../workflow/events.js';
import type { WorkflowLifecycleEvent } from '../../../workflow/events.js';
import { CapabilityRegistry } from '../../../../runtime/index.js';
import type { RuntimeState } from '../../../../runtime/index.js';

function createMockCapability(id: string, inputHints: string[] = [], outputHints: string[] = []) {
  return {
    id,
    description: `Mock ${id}`,
    inputHints,
    outputHints,
    tools: [],
    requires: [],
    async execute(_state: RuntimeState, _ctx: any) {
      return { patch: { [`${id}_output`]: `data from ${id}` }, artifacts: [] };
    },
  };
}

function setupRegistry() {
  const registry = new CapabilityRegistry();
  registry.register(createMockCapability("requirement_parsing", [], ["config"]));
  registry.register(createMockCapability("information_collection", ["config"], ["rawData"]));
  registry.register(createMockCapability("information_processing", ["rawData", "config"], ["structuredData"]));
  registry.register(createMockCapability("analysis_reasoning", ["structuredData", "rawData"], ["analysisResults"]));
  registry.register(createMockCapability("artifact_generation", ["analysisResults"], []));
  return registry;
}

function initialState(): RuntimeState {
  return {
    data: { userInput: "test input" },
    control: { currentNode: "", executionPath: [] },
    runtime: { workflowId: "wf-1", runId: "r-1", threadId: "r-1" },
    errors: [],
  };
}

describe("fold", () => {
  const registry = setupRegistry();

  describe("node.executed", () => {
    it("appends execution step and updates currentNode", () => {
      const state = initialState();
      const event: WorkflowLifecycleEvent = {
        type: "node.executed", nodeId: "requirement_parsing", iteration: 0, outputKeys: ["config"],
      };
      const result = fold(state, event, registry);
      expect(result.control.currentNode).toBe("requirement_parsing");
      expect(result.control.executionPath).toHaveLength(1);
      expect(result.control.executionPath[0].nodeId).toBe("requirement_parsing");
      expect(result.control.executionPath[0].iteration).toBe(0);
    });
  });

  describe("human.continued", () => {
    it("updates currentNode without modifying data", () => {
      const state: RuntimeState = {
        ...initialState(),
        control: {
          currentNode: "information_collection",
          executionPath: [
            { nodeId: "requirement_parsing", iteration: 0, startedAt: "", completedAt: "t1" },
            { nodeId: "information_collection", iteration: 0, startedAt: "", completedAt: "t2" },
          ],
        },
        data: { config: { targets: [] }, rawData: { items: [] } },
      };
      const event: WorkflowLifecycleEvent = { type: "human.continued", targetNode: "information_processing" };
      const result = fold(state, event, registry);
      expect(result.control.currentNode).toBe("information_processing");
      expect(result.control.executionPath).toHaveLength(2);
      expect(result.data.config).toBeDefined();
      expect(result.data.rawData).toBeDefined();
    });
  });

  describe("human.backjumped", () => {
    it("truncates executionPath and clears downstream data", () => {
      const state: RuntimeState = {
        ...initialState(),
        control: {
          currentNode: "analysis_reasoning",
          executionPath: [
            { nodeId: "requirement_parsing", iteration: 0, startedAt: "", completedAt: "t1" },
            { nodeId: "information_collection", iteration: 0, startedAt: "", completedAt: "t2" },
            { nodeId: "information_processing", iteration: 0, startedAt: "", completedAt: "t3" },
            { nodeId: "analysis_reasoning", iteration: 0, startedAt: "", completedAt: "t4" },
          ],
        },
        data: {
          config: { targets: ["A", "B"] },
          rawData: { items: ["old"] },
          structuredData: { records: ["old"] },
          analysisResults: { summary: "old" },
        },
      };
      const event: WorkflowLifecycleEvent = { type: "human.backjumped", targetNode: "information_collection" };
      const result = fold(state, event, registry);
      expect(result.control.executionPath).toHaveLength(2);
      expect(result.control.executionPath[1].nodeId).toBe("information_collection");
      expect(result.control.currentNode).toBe("information_collection");
      // rawData belongs to information_collection (the target) — it is kept, not cleared
      expect(result.data.config).toBeDefined();
      expect(result.data.rawData).toBeDefined();
      expect(result.data.structuredData).toBeUndefined();
      expect(result.data.analysisResults).toBeUndefined();
    });

    it("returns state unchanged for non-existent target", () => {
      const state: RuntimeState = {
        ...initialState(),
        control: {
          currentNode: "analysis_reasoning",
          executionPath: [{ nodeId: "requirement_parsing", iteration: 0, startedAt: "", completedAt: "t1" }],
        },
        data: { config: { targets: ["A"] } },
      };
      const event: WorkflowLifecycleEvent = { type: "human.backjumped", targetNode: "nonexistent" };
      const result = fold(state, event, registry);
      expect(result.control.executionPath).toHaveLength(1);
      expect(result.data.config).toBeDefined();
    });

    it("clears only self when backjump to last node", () => {
      const state: RuntimeState = {
        ...initialState(),
        control: {
          currentNode: "analysis_reasoning",
          executionPath: [
            { nodeId: "requirement_parsing", iteration: 0, startedAt: "", completedAt: "t1" },
            { nodeId: "information_collection", iteration: 0, startedAt: "", completedAt: "t2" },
            { nodeId: "information_processing", iteration: 0, startedAt: "", completedAt: "t3" },
            { nodeId: "analysis_reasoning", iteration: 0, startedAt: "", completedAt: "t4" },
          ],
        },
        data: { config: { targets: ["A"] }, rawData: { items: ["d"] }, structuredData: { records: ["s"] }, analysisResults: { summary: "a" } },
      };
      const event: WorkflowLifecycleEvent = { type: "human.backjumped", targetNode: "analysis_reasoning" };
      const result = fold(state, event, registry);
      expect(result.control.executionPath).toHaveLength(4);
      // backjumping to the last node: downstream is empty, nothing is cleared
      expect(result.data.config).toBeDefined();
      expect(result.data.rawData).toBeDefined();
      expect(result.data.structuredData).toBeDefined();
      expect(result.data.analysisResults).toBeDefined();
    });
  });

  describe("pass-through events", () => {
    it("does not modify state for route.required", () => {
      const state = initialState();
      const event: WorkflowLifecycleEvent = {
        type: "route.required", completedNode: "rp", suggestions: [{ nodeId: "ic", priority: 1, reason: "next" }],
      };
      expect(fold(state, event, registry)).toEqual(state);
    });

    it("does not modify state for workflow.completed", () => {
      const state = initialState();
      expect(fold(state, { type: "workflow.completed" }, registry)).toEqual(state);
    });
  });
});

describe("countIterations", () => {
  it("counts iterations from executionPath", () => {
    const state: RuntimeState = {
      ...initialState(),
      control: {
        currentNode: "ic",
        executionPath: [
          { nodeId: "rp", iteration: 0, startedAt: "", completedAt: "t1" },
          { nodeId: "ic", iteration: 0, startedAt: "", completedAt: "t2" },
          { nodeId: "ic", iteration: 1, startedAt: "", completedAt: "t3" },
        ],
      },
    };
    expect(countIterations(state, "ic")).toBe(2);
    expect(countIterations(state, "rp")).toBe(1);
    expect(countIterations(state, "nonexistent")).toBe(0);
  });
});

describe("getOutputKeys", () => {
  it("returns outputHints from registry", () => {
    expect(getOutputKeys("information_collection", setupRegistry())).toEqual(["rawData"]);
  });

  it("returns empty array for unknown capability", () => {
    expect(getOutputKeys("nonexistent", setupRegistry())).toEqual([]);
  });
});
