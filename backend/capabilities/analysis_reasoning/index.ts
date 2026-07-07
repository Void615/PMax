import type {
  Capability,
  CapabilityResult,
  RuntimeState,
  RuntimeContext,
} from "../../runtime/index.js";
import type {
  RequirementConfig,
  RawDataItem,
  StructuredRecord,
  SWOTEntry,
  AnalysisResult,
} from "../shared/types.js";
import { createMatrixBuilder } from "../../tools/matrix_builder/skill.js";
import { createSwotGenerator } from "../../tools/swot_generator/skill.js";
import { SUMMARY_PROMPT } from "./prompts.js";

export function createAnalysisReasoningCap(
  llm: { complete(prompt: string): Promise<string> }
): Capability {
  const matrixTool = createMatrixBuilder(llm);
  const swotTool = createSwotGenerator(llm);

  return {
    id: "analysis_reasoning",
    description: "对采集数据进行多维对比分析和 SWOT 生成",
    inputHints: ["config", "rawData", "structuredData"],
    outputHints: ["analysisResults"],
    requires: ["information_collection"],
    tools: [matrixTool, swotTool],

    async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
      const config = state.data.config as RequirementConfig;
      const rawData = state.data.rawData as Record<string, RawDataItem[]> | undefined;
      const structuredData = state.data.structuredData as Record<string, StructuredRecord[]> | undefined;

      if (!config) return { patch: {}, artifacts: [] };

      // 优先使用 structuredData，降级到 rawData
      const dataForAnalysis = structuredData
        ? JSON.stringify(structuredData)
        : JSON.stringify(rawData ?? {});

      const targets = config.targets.map(t => t.name);

      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: { stage: "comparison", message: "生成对比矩阵..." },
      });

      // Phase 1: 对比矩阵
      const matrixResult = await matrixTool.execute({
        targets,
        data: dataForAnalysis,
      }, { traceId: ctx.traceId, runId: ctx.runId });

      await ctx.emit({
        uiHint: "tool_result",
        eventType: "TOOL_RESULT",
        payload: { toolName: "matrix_builder", result: { rows: matrixResult.comparisonMatrix?.length ?? 0 } },
      });

      // Phase 2: SWOT（每个竞品并行）
      const swotEntries: SWOTEntry[] = [];
      const swotResults = await Promise.allSettled(
        targets.map(async (target: string) => {
          await ctx.emit({
            uiHint: "tool_call",
            eventType: "TOOL_CALL",
            payload: { toolName: "swot_generator", params: { target } },
          });
          const res = await swotTool.execute({ target, data: dataForAnalysis }, { traceId: ctx.traceId, runId: ctx.runId });
          await ctx.emit({
            uiHint: "tool_result",
            eventType: "TOOL_RESULT",
            payload: { toolName: "swot_generator", result: { target, entries: res.swot?.length ?? 0 } },
          });
          return res;
        })
      );

      for (const r of swotResults) {
        if (r.status === "fulfilled" && r.value.swot) {
          swotEntries.push(...r.value.swot.map((s: any) => ({ ...s, target: s.target ?? "unknown" })));
        }
      }

      // Phase 3: LLM 综合归纳
      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: { stage: "summarizing", message: "生成综合分析摘要..." },
      });

      const summaryPrompt = SUMMARY_PROMPT
        .replace("{targets}", targets.join("、"))
        .replace("{matrixSummary}", JSON.stringify(matrixResult.comparisonMatrix?.slice(0, 5) ?? []))
        .replace("{swotSummary}", JSON.stringify(swotEntries.slice(0, 10)));

      const summary = await llm.complete(summaryPrompt);

      const analysisResult: AnalysisResult = {
        comparisonMatrix: matrixResult.comparisonMatrix ?? [],
        swot: swotEntries,
        summary: summary.trim().slice(0, 500),
      };

      await ctx.emit({
        uiHint: "node_completed",
        eventType: "NODE_COMPLETED",
        payload: {
          summary: `生成 ${analysisResult.comparisonMatrix.length} 条对比 + ${analysisResult.swot.length} 条 SWOT`,
        },
      });

      return { patch: { analysisResults: analysisResult }, artifacts: [] };
    },
  };
}
