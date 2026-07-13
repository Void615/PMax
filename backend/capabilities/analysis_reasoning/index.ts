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
  FeatureComparison,
  Insight,
  AnalysisResult,
} from "../shared/types.js";
import { createMatrixBuilder } from "../../tools/matrix_builder/skill.js";
import { createSwotGenerator } from "../../tools/swot_generator/skill.js";
import { createInsightExtractor } from "../../tools/insight_extractor/skill.js";
import { createComparisonSummarizer } from "../../tools/comparison_summarizer/skill.js";

export function createAnalysisReasoningCap(
  llm: { complete(prompt: string): Promise<string> }
): Capability {
  const matrixTool = createMatrixBuilder(llm);
  const swotTool = createSwotGenerator(llm);
  const insightTool = createInsightExtractor(llm);
  const summarizerTool = createComparisonSummarizer(llm);

  return {
    id: "analysis_reasoning",
    description: "对采集数据进行多维对比分析和 SWOT 生成",
    inputHints: ["config", "rawData", "structuredData"],
    outputHints: ["analysisResults"],
    requires: ["information_collection"],
    tools: [matrixTool, swotTool, insightTool, summarizerTool],

    async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
      const config = state.data.config as RequirementConfig;
      const rawData = state.data.rawData as Record<string, RawDataItem[]> | undefined;
      const structuredData = state.data.structuredData as Record<string, StructuredRecord[]> | undefined;

      if (!config) return { patch: {}, artifacts: [] };

      const targets = config.targets.map(t => t.name);

      // ── Step 0: Data quality pre-check ──
      const allRecords: StructuredRecord[] = structuredData
        ? Object.values(structuredData).flat()
        : [];

      // Imbalance detection: count records per target, warn if max/min > 2x
      const imbalanceWarnings: string[] = [];
      if (allRecords.length > 0) {
        const targetCounts = new Map<string, number>();
        for (const rec of allRecords) {
          targetCounts.set(rec.target, (targetCounts.get(rec.target) ?? 0) + 1);
        }
        const counts = Array.from(targetCounts.values());
        if (counts.length >= 2) {
          const maxCount = Math.max(...counts);
          const minCount = Math.min(...counts);
          if (minCount > 0 && maxCount / minCount > 2) {
            const maxTargets = Array.from(targetCounts.entries())
              .filter(([, c]) => c === maxCount)
              .map(([t]) => t);
            const minTargets = Array.from(targetCounts.entries())
              .filter(([, c]) => c === minCount)
              .map(([t]) => t);
            imbalanceWarnings.push(
              `数据不平衡: ${maxTargets.join(", ")} 有 ${maxCount} 条记录, ` +
              `${minTargets.join(", ")} 仅 ${minCount} 条记录 (比例 ${(maxCount / minCount).toFixed(1)}:1)`
            );
          }
        }
      }

      // Conflict summary: count conflicting status records
      const conflictCount = allRecords.filter(r => r.status === "conflicting").length;
      const totalRecords = allRecords.length;
      let confidencePenalty = 0;
      if (totalRecords > 0 && conflictCount / totalRecords > 0.2) {
        confidencePenalty = 0.3;
        imbalanceWarnings.push(
          `高冲突率: ${conflictCount}/${totalRecords} 条记录存在冲突 (${((conflictCount / totalRecords) * 100).toFixed(0)}%)`
        );
      }

      // Data downgrade: check coverage via structuredData
      const useRawFallback = !structuredData || allRecords.length === 0;
      const dataForAnalysis = useRawFallback
        ? JSON.stringify(rawData ?? {})
        : JSON.stringify(structuredData);

      // Coverage context: summarise what dimensions are covered
      const coverageContext = allRecords.length > 0
        ? (() => {
            const dims = new Set(allRecords.map(r => r.dimension));
            return `可用维度: ${Array.from(dims).join(", ")}。总记录数: ${totalRecords}。`;
          })()
        : undefined;

      // ── Step 1: matrix_builder (Tool) ──
      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: { stage: "comparison", message: "生成对比矩阵..." },
      });

      const matrixResult = await matrixTool.execute({
        targets,
        data: dataForAnalysis,
        dimensions: config.dimensions,
        coverageContext,
        imbalanceWarnings: imbalanceWarnings.length > 0 ? imbalanceWarnings : undefined,
        confidencePenalty: confidencePenalty > 0 ? confidencePenalty : undefined,
      }, { traceId: ctx.traceId, runId: ctx.runId });

      await ctx.emit({
        uiHint: "tool_result",
        eventType: "TOOL_RESULT",
        payload: { toolName: "matrix_builder", result: { rows: matrixResult.comparisonMatrix?.length ?? 0 } },
      });

      // ── Step 2: swot_generator (parallel per target) ──
      const swotEntries: SWOTEntry[] = [];
      const swotResults = await Promise.allSettled(
        targets.map(async (target: string) => {
          await ctx.emit({
            uiHint: "tool_call",
            eventType: "TOOL_CALL",
            payload: { toolName: "swot_generator", params: { target } },
          });

          // Build comparison context for this target
          const targetRecords = allRecords.filter(r => r.target === target);
          const targetRecordCount = targetRecords.length;
          const allTargets = new Set(allRecords.map(r => r.target));
          const otherTargets = Array.from(allTargets).filter(t => t !== target);
          const comparisonContext = otherTargets.length > 0
            ? `竞品 ${target} 有 ${targetRecordCount} 条结构化记录。` +
              `对比其他竞品: ${otherTargets.join(", ")}。`
            : undefined;

          const res = await swotTool.execute({
            target,
            data: dataForAnalysis,
            comparisonContext,
            confidencePenalty: confidencePenalty > 0 ? confidencePenalty : undefined,
          }, { traceId: ctx.traceId, runId: ctx.runId });

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

      // ── Step 3: insight_extractor (new Tool) ──
      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: { stage: "insights", message: "提取差异化洞察..." },
      });

      // Determine own product: first target with isOwn=true, or first target
      const ownProduct = config.targets.find(t => (t as any).isOwn)?.name ?? targets[0];

      const insightResult = await insightTool.execute({
        comparisonMatrix: matrixResult.comparisonMatrix ?? [],
        swot: swotEntries,
        ownProduct,
        imbalanceWarnings: imbalanceWarnings.length > 0 ? imbalanceWarnings : undefined,
        confidencePenalty: confidencePenalty > 0 ? confidencePenalty : undefined,
      }, { traceId: ctx.traceId, runId: ctx.runId });

      await ctx.emit({
        uiHint: "tool_result",
        eventType: "TOOL_RESULT",
        payload: { toolName: "insight_extractor", result: { insightCount: (insightResult as any).insights?.length ?? 0 } },
      });

      const insights: Insight[] = (insightResult as any).insights ?? [];

      // ── Step 4: comparison_summarizer (new Tool) ──
      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: { stage: "summarizing", message: "生成综合分析摘要..." },
      });

      const summarizerResult = await summarizerTool.execute({
        targets,
        matrixSummary: JSON.stringify(matrixResult.comparisonMatrix ?? []),
        swotSummary: JSON.stringify(swotEntries),
        insights: JSON.stringify(insights),
        imbalanceWarnings: imbalanceWarnings.length > 0 ? imbalanceWarnings : undefined,
      }, { traceId: ctx.traceId, runId: ctx.runId });

      const summary = (summarizerResult as any).summary ?? "";

      // ── Step 5: Assemble AnalysisResult ──
      const conclusionCount = (matrixResult.comparisonMatrix?.length ?? 0) +
        swotEntries.length + insights.length;

      const analysisResult: AnalysisResult = {
        comparisonMatrix: (matrixResult.comparisonMatrix ?? []) as FeatureComparison[],
        swot: swotEntries,
        summary: summary.slice(0, 500),
        insights,
        analysisReport: {
          conclusionCount,
          overallConfidence: confidencePenalty > 0.3 ? "low" : confidencePenalty > 0 ? "medium" : "high",
          imbalanceWarnings: imbalanceWarnings.length > 0 ? imbalanceWarnings : undefined,
        },
      };

      await ctx.emit({
        uiHint: "node_completed",
        eventType: "NODE_COMPLETED",
        payload: {
          summary: `生成 ${analysisResult.comparisonMatrix.length} 条对比 + ${analysisResult.swot.length} 条 SWOT + ${analysisResult.insights.length} 条洞察`,
        },
      });

      return { patch: { analysisResults: analysisResult }, artifacts: [] };
    },
  };
}
