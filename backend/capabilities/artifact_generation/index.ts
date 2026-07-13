import type {
  Capability,
  CapabilityResult,
  RuntimeState,
  RuntimeContext,
} from "../../runtime/index.js";
import type { RequirementConfig, AnalysisResult, Artifact, SourceMapEntry } from "../shared/types.js";
import { tableComposer } from "../../tools/table_composer/skill.js";
import { markdownRenderer } from "../../tools/markdown_renderer/skill.js";
import { sourceMapBuilder } from "../../tools/source_map_builder/skill.js";

/**
 * Filter sourceMap to entries relevant to a specific artifact type.
 */
function filterSourceMap(
  fullMap: SourceMapEntry[],
  type: Artifact["type"]
): SourceMapEntry[] {
  switch (type) {
    case "comparison_matrix":
      // Only entries from the comparison matrix (fragments starting with attribute:)
      return fullMap.filter(e => e.conclusionFragment.includes(": ") && !e.conclusionFragment.startsWith("SWOT") && !e.conclusionFragment.startsWith("INSIGHT"));
    case "swot":
      return fullMap.filter(e => e.conclusionFragment.startsWith("SWOT"));
    case "insight_report":
      return fullMap.filter(e => e.conclusionFragment.startsWith("INSIGHT"));
    case "report":
      // Full report includes everything
      return fullMap;
    default:
      return fullMap;
  }
}

export function createArtifactGenerationCap(): Capability {
  return {
    id: "artifact_generation",
    description: "将分析结果格式化为最终可交付产物（对比表格 + SWOT + 洞察报告 + 溯源）",
    inputHints: ["analysisResults", "config", "rawData"],
    outputHints: ["artifacts"],
    requires: ["analysis_reasoning"],
    tools: [tableComposer, markdownRenderer, sourceMapBuilder],

    async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
      const config = state.data.config as RequirementConfig;
      const analysisResults = state.data.analysisResults as AnalysisResult;

      if (!config || !analysisResults) {
        return { patch: {}, artifacts: [] };
      }

      const artifacts: Artifact[] = [];

      // ── Step 1: Build sourceMap via source_map_builder Tool ──
      await ctx.emit({
        uiHint: "tool_call",
        eventType: "TOOL_CALL",
        payload: { toolName: "source_map_builder", params: {} },
      });

      const smResult = await sourceMapBuilder.execute(
        {
          analysisResults,
          rawData: state.data.rawData,
          structuredData: state.data.structuredData,
        },
        { traceId: ctx.traceId, runId: ctx.runId }
      );

      const fullSourceMap: SourceMapEntry[] = (smResult as { sourceMap: SourceMapEntry[] }).sourceMap ?? [];

      await ctx.emit({
        uiHint: "tool_result",
        eventType: "TOOL_RESULT",
        payload: { toolName: "source_map_builder", result: { sourceMapCount: fullSourceMap.length } },
      });

      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: { stage: "rendering", message: `生成 ${config.outputFormat.join("、")}` },
      });

      // ── Step 2: Route by outputFormat ──
      for (const format of config.outputFormat) {
        switch (format) {
          // ── comparison_matrix → table_composer Tool ──
          case "comparison_matrix": {
            const rows = analysisResults.comparisonMatrix.map(c => ({
              attribute: c.attribute,
              values: Object.fromEntries((c.values ?? []).map(v => [v.target, v.value])),
            }));

            const tcTool = this.tools.find(t => t.name === "table_composer")!;

            await ctx.emit({
              uiHint: "tool_call",
              eventType: "TOOL_CALL",
              payload: { toolName: "table_composer", params: { title: "产品对比矩阵" } },
            });

            const result = await tcTool.execute({
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
              sourceMap: filterSourceMap(fullSourceMap, "comparison_matrix"),
            });
            break;
          }

          // ── SWOT → pure string template (no LLM) ──
          case "swot": {
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
                sourceMap: filterSourceMap(fullSourceMap, "swot"),
              });
            }
            break;
          }

          // ── insight_report → pure string template (no LLM) ──
          case "insight_report": {
            const insights = analysisResults.insights ?? [];
            const sections = insights.map(i => {
              const categoryLabel: Record<string, string> = {
                gap: "短板",
                opportunity: "蓝海机会",
                risk: "竞品反超风险",
                advantage: "自身优势",
              };
              return `### ${categoryLabel[i.category] ?? i.category}\n\n**${i.statement}**\n\n${i.evidence}\n\n关联竞品: ${i.relatedTargets.join(", ")}`;
            });

            const content = [
              "## 竞争洞察报告",
              "",
              `综合分析摘要: ${analysisResults.summary}`,
              "",
              ...sections,
            ].join("\n");

            artifacts.push({
              type: "insight_report",
              format: "markdown",
              title: "竞争洞察报告",
              content,
              sourceMap: filterSourceMap(fullSourceMap, "insight_report"),
            });
            break;
          }

          // ── report → markdown_renderer Tool ──
          case "report": {
            // "feature_list" goes through markdown_renderer as well (backwards compat)
            // and "report" is a separate route
          }
          // fall through — feature_list and report both use markdown_renderer
          case "feature_list": {
            const mrTool = this.tools.find(t => t.name === "markdown_renderer")!;

            // Build sections from analysis results
            const sections: { heading: string; body: string }[] = [];

            // 1. Summary section
            sections.push({
              heading: "综合分析摘要",
              body: analysisResults.summary,
            });

            // 2. Comparison matrix section
            if (analysisResults.comparisonMatrix?.length) {
              const matrixBody = analysisResults.comparisonMatrix.map(c =>
                `**${c.attribute}**: ${(c.values ?? []).map(v => `${v.target}=${v.value}`).join(", ")}` +
                (c.analysis ? `\n> ${c.analysis}` : "")
              ).join("\n\n");
              sections.push({ heading: "对比矩阵", body: matrixBody || "无数据" });
            }

            // 3. SWOT section
            if (analysisResults.swot?.length) {
              const targets = config.targets.map(t => t.name);
              const swotBody = targets.map(target => {
                const swotForTarget = analysisResults.swot.filter(s => s.target === target);
                const lines = swotForTarget.map(s => `- **${s.category}**: ${s.point}`);
                return `**${target}**:\n${lines.join("\n") || "无数据"}`;
              }).join("\n\n");
              sections.push({ heading: "SWOT 分析", body: swotBody || "无数据" });
            }

            // 4. Insights section
            if (analysisResults.insights?.length) {
              const insightsBody = analysisResults.insights.map(i =>
                `- **${i.category}**: ${i.statement}\n  > ${i.evidence}`
              ).join("\n\n");
              sections.push({ heading: "竞争洞察", body: insightsBody || "无数据" });
            }

            await ctx.emit({
              uiHint: "tool_call",
              eventType: "TOOL_CALL",
              payload: { toolName: "markdown_renderer", params: { title: "竞品分析综合报告" } },
            });

            const mrResult = await mrTool.execute({
              title: "竞品分析综合报告",
              sections: JSON.stringify(sections),
            }, { traceId: ctx.traceId, runId: ctx.runId });

            await ctx.emit({
              uiHint: "tool_result",
              eventType: "TOOL_RESULT",
              payload: { toolName: "markdown_renderer", result: { format: mrResult.format } },
            });

            const reportType = format === "report" ? "report" as const : "summary" as const;
            artifacts.push({
              type: reportType,
              format: mrResult.format ?? "markdown",
              title: "竞品分析综合报告",
              content: mrResult.content ?? "",
              sourceMap: filterSourceMap(fullSourceMap, reportType),
            });
            break;
          }
        }
      }

      await ctx.emit({
        uiHint: "node_completed",
        eventType: "NODE_COMPLETED",
        payload: { artifactCount: artifacts.length },
      });

      // ── Step 3: Emit WORKFLOW_COMPLETE ──
      await ctx.emit({
        uiHint: "workflow_complete",
        eventType: "WORKFLOW_COMPLETE",
        payload: { artifactCount: artifacts.length, sourceMapCount: fullSourceMap.length },
      });

      return { patch: { artifacts }, artifacts: [] };
    },
  };
}
