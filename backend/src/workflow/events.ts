// backend/src/workflow/events.ts

import type { CapabilityRegistry } from "../../runtime/index.js";
import type { RuntimeState, ExecutionStep } from "../../runtime/index.js";
import type { RouteSuggestion } from "../../runtime/index.js";

export type WorkflowLifecycleEvent =
  | { type: "node.executed";      nodeId: string; iteration: number; outputKeys: string[] }
  | { type: "route.required";     completedNode: string; suggestions: RouteSuggestion[] }
  | { type: "human.continued";    targetNode: string }
  | { type: "human.backjumped";   targetNode: string }
  | { type: "workflow.completed" }
  | { type: "workflow.failed";    error: string }
  | { type: "workflow.cancelled" };

export interface HumanDecision {
  targetNode: string;
  action: "continue" | "backjump";
}

/**
 * fold — 纯函数投影。
 * 输入当前状态 + 一个事件 + Registry，返回新状态。
 */
export function fold(
  state: RuntimeState,
  event: WorkflowLifecycleEvent,
  registry: CapabilityRegistry
): RuntimeState {
  switch (event.type) {

    case "node.executed": {
      const step: ExecutionStep = {
        nodeId: event.nodeId,
        iteration: event.iteration,
        startedAt: "",
        completedAt: new Date().toISOString(),
      };
      return {
        ...state,
        control: {
          ...state.control,
          currentNode: event.nodeId,
          executionPath: [...state.control.executionPath, step],
        },
      };
    }

    case "human.backjumped": {
      const idx = state.control.executionPath.findIndex(
        s => s.nodeId === event.targetNode
      );
      if (idx === -1) return state;

      const downstream = state.control.executionPath.slice(idx + 1);
      const staleKeys = new Set<string>();
      for (const s of downstream) {
        const cap = registry.get(s.nodeId);
        (cap?.outputHints ?? []).forEach(k => staleKeys.add(k));
      }

      const newData = { ...state.data };
      for (const k of staleKeys) {
        delete newData[k];
      }

      return {
        ...state,
        data: newData,
        control: {
          ...state.control,
          currentNode: event.targetNode,
          executionPath: state.control.executionPath.slice(0, idx + 1),
        },
      };
    }

    case "human.continued":
      return {
        ...state,
        control: { ...state.control, currentNode: event.targetNode },
      };

    // route.required / workflow.completed / failed / cancelled — never change state.data
    default:
      return state;
  }
}

/**
 * Count how many times a nodeId appears in executionPath (its current iteration).
 */
export function countIterations(state: RuntimeState, nodeId: string): number {
  return state.control.executionPath.filter(s => s.nodeId === nodeId).length;
}

/**
 * Get a Capability's outputHints from the registry.
 */
export function getOutputKeys(nodeId: string, registry: CapabilityRegistry): string[] {
  const cap = registry.get(nodeId);
  return cap?.outputHints ?? [];
}
