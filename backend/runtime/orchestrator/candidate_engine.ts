import type { CapabilityRegistry } from "../capability/registry.js";
import type { RuntimeState } from "../state.js";
import type { RouteCandidate, TaskPlan } from "./types.js";

export class CandidateEngine {
  generate(
    state: RuntimeState,
    completedNodeId: string,
    registry: CapabilityRegistry,
    plan: TaskPlan | null
  ): RouteCandidate[] {
    const executedNodes = state.control.executionPath?.map(s => s.nodeId) ?? [];
    const allNodes = registry.listIds();
    const currentPhase = plan ? this.determineCurrentPhase(plan, executedNodes) : null;

    let candidates = allNodes
      .filter(id => id !== completedNodeId)
      .map(id => ({
        nodeId: id,
        status: (executedNodes.includes(id) ? "rerun" : "pending") as "pending" | "rerun",
        executable: true,
        planWeight: currentPhase?.targetNodes.includes(id) ? 1.0 : 0.5,
      }));

    candidates = this.filterByCapability(candidates, registry);
    return candidates;
  }

  /** 降级：返回全量候选 */
  generateSafe(
    state: RuntimeState,
    completedNodeId: string,
    registry: CapabilityRegistry,
    plan: TaskPlan | null
  ): RouteCandidate[] {
    try {
      return this.generate(state, completedNodeId, registry, plan);
    } catch {
      return registry.listIds()
        .filter(id => id !== completedNodeId)
        .map(id => ({
          nodeId: id,
          status: "pending" as const,
          executable: true,
          planWeight: 0.5,
        }));
    }
  }

  private determineCurrentPhase(
    plan: TaskPlan,
    executedNodes: string[]
  ): TaskPlan["phases"][number] | null {
    for (const phase of plan.phases) {
      const allDone = phase.targetNodes.every(n => executedNodes.includes(n));
      if (!allDone) return phase;
    }
    return plan.phases[plan.phases.length - 1] ?? null;
  }

  private filterByCapability(
    candidates: RouteCandidate[],
    registry: CapabilityRegistry
  ): RouteCandidate[] {
    return candidates.filter(c => {
      const cap = registry.get(c.nodeId);
      return cap != null;
    });
  }
}
