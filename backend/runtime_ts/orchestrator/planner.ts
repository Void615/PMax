import type { LlmClient } from "../capability/context.js";
import type { CapabilityProfile, TaskPlan } from "./types.js";

const PLANNING_PROMPT = `你是一个工作流编排器。你需要将以下总需求分解为一系列子任务，每个子任务对应一个目标子节点。

总需求: {requirement}

可用的子节点及其能力：
{profiles}

请输出一个执行计划，包含：
1. 大致阶段划分（如：采集 → 分析 → 汇总 → 审查）
2. 每个阶段推荐执行的节点及理由
3. 节点间的数据依赖关系

格式: JSON
{
  "phases": [{ "name": "阶段名", "targetNodes": ["nodeId"], "rationale": "理由" }],
  "dependencies": { "nodeId": ["依赖的nodeId"] }
}`;

export class TaskPlanner {
  constructor(private readonly llm: LlmClient) {}

  async plan(requirement: string, profiles: CapabilityProfile[]): Promise<TaskPlan | null> {
    const profilesText = profiles.map(p =>
      `- **${p.id}**: ${p.description}\n` +
      `  输入依赖: ${p.inputHints.join(", ") || "无"}\n` +
      `  产出物: ${p.outputHints.join(", ") || "无"}\n` +
      `  工具: ${p.toolDescriptions.map(t => `${t.name}(${t.desc})`).join(", ")}`
    ).join("\n\n");

    const prompt = PLANNING_PROMPT
      .replace("{requirement}", requirement)
      .replace("{profiles}", profilesText);

    try {
      const result = await this.llm.complete(prompt);
      return JSON.parse(result) as TaskPlan;
    } catch {
      return null;  // 降级：返回 null，Orchestrator 使用 flat 候选
    }
  }
}
