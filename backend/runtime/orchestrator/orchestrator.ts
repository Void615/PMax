import { CapabilityDiscoverer } from "./discover.js";
import { TaskPlanner } from "./planner.js";
import { CandidateEngine } from "./candidate_engine.js";
import { LlmRanker } from "./llm_ranker.js";
import type { CapabilityRegistry } from "../capability/registry.js";
import type { RuntimeContext } from "../capability/context.js";
import type { RuntimeState } from "../state.js";
import type { EventBus } from "../bus/types.js";
import type { TaskPlan, RouteSuggestion, CapabilityProfile } from "./types.js";

export class Orchestrator {
  private readonly discoverer: CapabilityDiscoverer;
  private readonly planner: TaskPlanner;
  private readonly candidateEngine: CandidateEngine;
  private readonly ranker: LlmRanker;
  private profiles: CapabilityProfile[] = [];
  private taskPlan: TaskPlan | null = null;

  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly ctx: RuntimeContext,
    private readonly eventBus: EventBus
  ) {
    this.discoverer = new CapabilityDiscoverer(registry);
    this.planner = new TaskPlanner(ctx.llm);
    this.candidateEngine = new CandidateEngine();
    this.ranker = new LlmRanker(ctx.llm);
  }

  /** 初始化：探测子节点能力 + 生成执行计划 */
  async initialize(requirement: string): Promise<void> {
    this.profiles = this.discoverer.discoverSafe();
    this.taskPlan = await this.planner.plan(requirement, this.profiles);

    if (!this.taskPlan) {
      await this.eventBus.publish({
        traceId: this.ctx.traceId,
        eventType: "DEGRADATION",
        uiHint: "degradation_notice",
        nodeId: "__orchestrator__",
        workflowId: this.ctx.workflowId,
        runId: this.ctx.runId,
        payload: {
          level: "warn",
          source: "orchestrator.planning",
          message: "规划器暂时不可用，已降级为平等候选模式",
          fallback: "flat_candidates",
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** 生成下一轮路由建议 */
  async suggestRoute(
    completedNodeId: string,
    state: RuntimeState,
    stateSummary: string
  ): Promise<RouteSuggestion[]> {
    const candidates = this.candidateEngine.generateSafe(
      state,
      completedNodeId,
      this.registry,
      this.taskPlan
    );

    const suggestions = await this.ranker.rank(candidates, stateSummary, this.taskPlan);

    await this.eventBus.publish({
      traceId: this.ctx.traceId,
      eventType: "ROUTING",
      uiHint: "routing_decision",
      nodeId: completedNodeId,
      workflowId: this.ctx.workflowId,
      runId: this.ctx.runId,
      payload: {
        completedNode: completedNodeId,
        currentPhase: this.taskPlan?.phases.find(p =>
          !p.targetNodes.every(n => state.control.executionPath?.some(s => s.nodeId === n))
        )?.name ?? "未知阶段",
        planProgress: {
          completed: state.control.executionPath?.map(s => s.nodeId) ?? [],
          remaining: this.registry.listIds().filter(
            id => !state.control.executionPath?.some(s => s.nodeId === id)
          ),
        },
        suggestions,
        executedNodes: state.control.executionPath?.map(s => s.nodeId) ?? [],
      },
      timestamp: new Date().toISOString(),
    });

    return suggestions;
  }

  /** 是否有更多候选节点 */
  hasMoreCandidates(state: RuntimeState): boolean {
    const executed = new Set(state.control.executionPath?.map(s => s.nodeId) ?? []);
    const remaining = this.registry.listIds().filter(id => !executed.has(id));
    return remaining.length > 0;
  }
}
