import type { LlmClient } from "../capability/context.js";
import type { RouteCandidate, RouteSuggestion, TaskPlan } from "./types.js";

const RANKING_PROMPT = `当前工作流已完成节点: {completedNodes}
当前数据产出: {stateSummary}
当前阶段: {currentPhase}
推荐执行计划: {planSummary}

可选的下游节点: {candidates}

请按推荐优先级排序，并为每个节点生成一句话理由。
格式: JSON [{ "nodeId": "string", "priority": number, "reason": "string" }]`;

export class LlmRanker {
  constructor(private readonly llm: LlmClient) {}

  async rank(
    candidates: RouteCandidate[],
    stateSummary: string,
    plan: TaskPlan | null
  ): Promise<RouteSuggestion[]> {
    const candidateList = candidates
      .sort((a, b) => b.planWeight - a.planWeight)
      .map(c => c.nodeId)
      .join(", ");

    const completedNodes = candidates
      .filter(c => c.status === "rerun")
      .map(c => c.nodeId)
      .join(", ");

    const currentPhaseName = plan?.phases.find(p =>
      !p.targetNodes.every(n => candidates.some(c => c.nodeId === n && c.status === "rerun"))
    )?.name ?? "未知阶段";

    const planSummary = plan?.phases
      .map(p => `${p.name}: ${p.targetNodes.join(", ")}`)
      .join(" → ") ?? "无计划";

    const prompt = RANKING_PROMPT
      .replace("{completedNodes}", completedNodes || "无")
      .replace("{stateSummary}", stateSummary)
      .replace("{currentPhase}", currentPhaseName)
      .replace("{planSummary}", planSummary)
      .replace("{candidates}", candidateList);

    try {
      const result = await this.llm.complete(prompt);
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) return parsed as RouteSuggestion[];
    } catch { /* fall through to fallback */ }

    return this.fallbackRank(candidates);
  }

  /** 降级排序：按权重降序 */
  private fallbackRank(candidates: RouteCandidate[]): RouteSuggestion[] {
    return [...candidates]
      .sort((a, b) => b.planWeight - a.planWeight)
      .map((c, i) => ({
        nodeId: c.nodeId,
        priority: i + 1,
        reason: c.status === "pending" ? "建议执行" : "可重新执行",
      }));
  }
}
