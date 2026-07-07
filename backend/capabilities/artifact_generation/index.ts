import type {
  Capability,
  CapabilityResult,
  RuntimeState,
  RuntimeContext,
} from "../../runtime/index.js";
import type { RequirementConfig, AnalysisResult, Artifact } from "../shared/types.js";
import { tableComposer } from "../../tools/table_composer/skill.js";
import { buildSourceMap } from "./source_map.js";

export function createArtifactGenerationCap(): Capability {
  return {
    id: "artifact_generation",
    description: "将分析结果格式化为最终可交付产物（对比表格 + SWOT + 溯源）",
    inputHints: ["analysisResults", "config", "rawData"],
    outputHints: ["artifacts"],
    requires: ["analysis_reasoning"],
    tools: [tableComposer],

    async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
      const config = state.data.config as RequirementConfig;
      const analysisResults = state.data.analysisResults as AnalysisResult;

      if (!config || !analysisResults) {
        return { patch: {}, artifacts: [] };
      }

      const artifacts: Artifact[] = [];
      const sourceMap = buildSourceMap(analysisResults, state.data.rawData);

      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: { stage: "rendering", message: `生成 ${config.outputFormat.join("、")}` },
      });

      // 1. 对比矩阵表格
      if (config.outputFormat.includes("comparison_matrix")) {
        const rows = analysisResults.comparisonMatrix.map(c => ({
          attribute: c.attribute,
          values: Object.fromEntries((c.values ?? []).map(v => [v.target, v.value])),
        }));

        const tool = this.tools.find(t => t.name === "table_composer")!;

        await ctx.emit({
          uiHint: "tool_call",
          eventType: "TOOL_CALL",
          payload: { toolName: "table_composer", params: { title: "产品对比矩阵" } },
        });

        const result = await tool.execute({
          title: "产品对比矩阵",
          targets: config.targets.map(t => t.name),
          rows: JSON.stringify(rows),
        }, { traceId: ctx.traceId, runId: ctx.runId });

        await ctx.emit({
          uiHint: "tool_result",
          eventType: "TOOL_RESULT",
          payload: { toolName: "table_composer", result: { format: result.format } },
        });

        artifacts.push({
          type: "comparison_matrix",
          format: result.format ?? "markdown",
          title: "产品对比矩阵",
          content: result.content ?? "",
          sourceMap,
        });
      }

      // 2. SWOT（每个竞品）
      if (config.outputFormat.includes("swot")) {
        const targets = config.targets.map(t => t.name);
        for (const target of targets) {
          const swotForTarget = (analysisResults.swot ?? []).filter(s => s.target === target);
          const content = [
            `## ${target} SWOT 分析`,
            "",
            "### 优势 (Strengths)",
            ...swotForTarget.filter(s => s.category === "strengths").map(s => `- ${s.point}`),
            "",
            "### 劣势 (Weaknesses)",
            ...swotForTarget.filter(s => s.category === "weaknesses").map(s => `- ${s.point}`),
            "",
            "### 机会 (Opportunities)",
            ...swotForTarget.filter(s => s.category === "opportunities").map(s => `- ${s.point}`),
            "",
            "### 威胁 (Threats)",
            ...swotForTarget.filter(s => s.category === "threats").map(s => `- ${s.point}`),
          ].join("\n");

          artifacts.push({
            type: "swot",
            format: "markdown",
            title: `${target} SWOT 分析`,
            content,
            sourceMap,
          });
        }
      }

      // 3. 综合分析摘要
      artifacts.push({
        type: "summary",
        format: "markdown",
        title: "综合分析摘要",
        content: `## 综合分析摘要\n\n${analysisResults.summary}`,
        sourceMap,
      });

      await ctx.emit({
        uiHint: "node_completed",
        eventType: "NODE_COMPLETED",
        payload: { artifactCount: artifacts.length },
      });

      // 4. 发送 workflow_complete
      await ctx.emit({
        uiHint: "workflow_complete",
        eventType: "WORKFLOW_COMPLETE",
        payload: { artifactCount: artifacts.length, sourceMapCount: sourceMap.length },
      });

      return { patch: { artifacts }, artifacts: [] };
    },
  };
}
