import type {
  Capability, CapabilityResult, RuntimeState, RuntimeContext,
} from "../../runtime/index.js";
import type { RequirementConfig, ClarificationRound, ClarificationRoundDef, Target } from "../shared/types.js";
import { ROUND_DEFS } from "../shared/types.js";
import { createLlmStructuredExtract } from "../../tools/llm_structured_extract/skill.js";
import {
  SCENE_CLASSIFY_PROMPT, TARGETS_EXTRACT_PROMPT, TARGETS_PARSE_PROMPT,
  DIMENSIONS_PARSE_PROMPT, OUTPUT_FORMAT_PARSE_PROMPT,
  CONSTRAINTS_PARSE_PROMPT, CONFIG_PREVIEW_PROMPT,
} from "./prompts.js";

/** Capability internal intermediate state stored in state.data._rpState */
export interface RpIntermediateState {
  phase: "scene_selection" | "clarification_loop" | "confirming";
  roundIndex: number;
  roundDefs: ClarificationRoundDef[] | null;
  partialConfig: Partial<RequirementConfig>;
  history: ClarificationRound[];
  pendingQuestionType?: string;
  modifyTargetIndex?: number;
  completed: boolean;
}

function initRpState(userInput: string): RpIntermediateState {
  return {
    phase: "scene_selection",
    roundIndex: 0,
    roundDefs: null,
    partialConfig: {
      userInput,
      analysisType: "product_comparison",
      targets: [],
      dimensions: [],
      outputFormat: [],
      constraints: {},
    },
    history: [],
    completed: false,
  };
}

function buildEmitPayload(
  ctx: RuntimeContext,
  overrides: Partial<{ nodeId: string; workflowId: string; runId: string }> = {}
) {
  return {
    nodeId: overrides.nodeId ?? ctx.nodeId,
    workflowId: overrides.workflowId ?? ctx.workflowId,
    runId: overrides.runId ?? ctx.runId,
    traceId: ctx.traceId,
    timestamp: new Date().toISOString(),
  };
}

export function createRequirementParsingCap(
  llm: { complete(prompt: string): Promise<string> }
): Capability {
  const extractTool = createLlmStructuredExtract(llm);

  return {
    id: "requirement_parsing",
    description: "通过ROUND_DEFS驱动的多轮对话明确用户分析需求，产出结构化RequirementConfig",
    inputHints: [],
    outputHints: ["config"],
    requires: [],
    tools: [extractTool],

    async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
      const userInput = state.data.userInput ?? "";
      let rp: RpIntermediateState = (state.data._rpState as RpIntermediateState | undefined)
        ?? initRpState(userInput);

      const userResponse = state.data._userResponse as string | undefined;
      const tool = this.tools.find(t => t.name === "llm_structured_extract")!;
      const base = buildEmitPayload(ctx);

      // ── Handle backjump from confirm_preview ──
      if (rp.modifyTargetIndex !== undefined) {
        const target = rp.modifyTargetIndex;
        rp.modifyTargetIndex = undefined;
        rp.roundIndex = target;
        rp.phase = "clarification_loop";
        return { patch: { _rpState: rp, _userResponse: null }, artifacts: [] };
      }

      // ── If completed → emit node_completed ──
      if (rp.completed) {
        const config = rp.partialConfig as RequirementConfig;
        config.clarificationHistory = rp.history;
        await ctx.emit({
          uiHint: "node_completed", eventType: "NODE_COMPLETED",
          ...base,
          payload: {
            summary: `解析完成：${config.targets.length} 个竞品，${config.dimensions.length} 个维度`,
            config,
          },
        });
        return { patch: { config, _rpState: null, _userResponse: null }, artifacts: [] };
      }

      // ═══════════════════════════════════════════════════════════
      // Phase 1: scene_selection (Round 1 always)
      // ═══════════════════════════════════════════════════════════
      if (rp.phase === "scene_selection") {
        const result = await tool.execute(
          { text: userInput, instruction: SCENE_CLASSIFY_PROMPT.replace("{userInput}", userInput) },
          { traceId: ctx.traceId, runId: ctx.runId }
        );
        const { analysisType = "product_comparison", confidence = 1 } = result as any;

        const displayName: Record<string, string> = {
          product_comparison: "产品横向对比",
          dev_decision: "产品发展决策",
          industry_trend: "产业趋势分析",
        };

        const prompt = confidence < 0.7
          ? `您想做哪种分析？\n\n` +
            `1. **产品横向对比** — 多产品功能/定价/体验维度的横向对比，产出对比矩阵 + SWOT\n` +
            `2. **产品发展决策** — 分析差异化机会和竞争策略\n` +
            `3. **产业趋势分析** — PEST分析、产业链结构、市场规模\n\n` +
            `当前推断：${displayName[analysisType] ?? analysisType}（置信度 ${(confidence*100).toFixed(0)}%）`
          : `推断您想做 **${displayName[analysisType] ?? analysisType}** 分析。确认吗？`;

        rp.pendingQuestionType = "scene_selection";
        rp.partialConfig.analysisType = analysisType as any;

        rp.history.push({
          round: 1,
          questionType: "scene_selection",
          agentPrompt: prompt,
          userResponse: "",
          extractedDelta: { analysisType },
          timestamp: new Date().toISOString(),
        });

        await ctx.emit({
          uiHint: "clarification_asked", eventType: "CLARIFICATION_ASKED",
          ...base,
          payload: {
            round: 1,
            questionType: "scene_selection",
            agentPrompt: prompt,
            inputType: "single_select",
            options: [
              { key: "product_comparison", label: "产品横向对比", description: "多产品功能/定价/体验维度对比" },
              { key: "dev_decision", label: "产品发展决策", description: "差异化机会和竞争策略" },
              { key: "industry_trend", label: "产业趋势分析", description: "PEST、产业链、市场规模" },
            ],
          },
        });

        rp.roundDefs = ROUND_DEFS[analysisType] ?? ROUND_DEFS.product_comparison;
        rp.phase = "clarification_loop";

        return { patch: { _rpState: rp, _userResponse: null }, artifacts: [] };
      }

      // ═══════════════════════════════════════════════════════════
      // Phase 2: clarification_loop — ROUND_DEFS driven
      // ═══════════════════════════════════════════════════════════
      if (rp.phase === "clarification_loop") {
        // Process previous round's user response
        if (userResponse != null && userResponse !== undefined && rp.roundIndex > 0) {
          const prevDefIndex = rp.roundIndex - 1;
          const prevDef = rp.roundDefs![prevDefIndex];
          const historyIndex = prevDefIndex + 1; // +1 because history[0] = scene_selection
          const prevHistory = rp.history[historyIndex];

          let extractedDelta: Record<string, any> = {};

          switch (prevDef.questionType) {
            case "targets": {
              const r = await tool.execute(
                { text: userResponse, instruction: TARGETS_PARSE_PROMPT.replace("{userResponse}", userResponse) },
                { traceId: ctx.traceId, runId: ctx.runId }
              );
              const rawTargets = (r as any).targets ?? [];
              const targets: Target[] = rawTargets.map((t: any) => ({
                name: t.name,
                url: t.url,
                category: t.category ?? null,
              } as Target));
              if (targets.length >= 2) {
                rp.partialConfig.targets = targets;
              }
              extractedDelta = { targets, count: targets.length };
              break;
            }
            case "dimensions": {
              const r = await tool.execute(
                { text: userResponse, instruction: DIMENSIONS_PARSE_PROMPT.replace("{userResponse}", userResponse) },
                { traceId: ctx.traceId, runId: ctx.runId }
              );
              const dimensions = (r as any).dimensions ?? [];
              if (dimensions.length >= 1) {
                rp.partialConfig.dimensions = dimensions;
              }
              extractedDelta = { dimensions, count: dimensions.length };
              break;
            }
            case "output_format": {
              const r = await tool.execute(
                { text: userResponse, instruction: OUTPUT_FORMAT_PARSE_PROMPT.replace("{userResponse}", userResponse) },
                { traceId: ctx.traceId, runId: ctx.runId }
              );
              const outputFormat = (r as any).outputFormat ?? [];
              if (outputFormat.length >= 1) {
                rp.partialConfig.outputFormat = outputFormat;
              }
              extractedDelta = { outputFormat, count: outputFormat.length };
              break;
            }
            case "constraints": {
              if (userResponse.trim() === "") {
                rp.partialConfig.constraints = {};
                extractedDelta = { constraints: {} };
              } else {
                const r = await tool.execute(
                  { text: userResponse, instruction: CONSTRAINTS_PARSE_PROMPT.replace("{userResponse}", userResponse) },
                  { traceId: ctx.traceId, runId: ctx.runId }
                );
                const constraints = (r as any).constraints ?? {};
                rp.partialConfig.constraints = constraints;
                extractedDelta = { constraints };
              }
              break;
            }
          }

          if (prevHistory) {
            prevHistory.userResponse = userResponse;
            prevHistory.extractedDelta = extractedDelta;
          }

          const displayRound = historyIndex + 1;
          await ctx.emit({
            uiHint: "node_progress", eventType: "CLARIFICATION_ANSWERED",
            ...base,
            payload: {
              round: displayRound,
              questionType: prevDef.questionType,
              userResponse,
              extractedDelta,
              timestamp: new Date().toISOString(),
            },
          });
        }

        // All defs exhausted → move to confirming
        if (rp.roundIndex >= rp.roundDefs!.length) {
          rp.phase = "confirming";
          // fall through to confirming phase (no return)
        } else {
          // Ask next question
          const def = rp.roundDefs![rp.roundIndex];
          const displayRound = rp.roundIndex + 2; // 1-based + scene_selection offset

          let prompt = "";
          let inputType = "";
          let options: { key: string; label: string; description?: string }[] | undefined;

          switch (def.questionType) {
            case "targets": {
              const initial = await tool.execute(
                { text: userInput, instruction: TARGETS_EXTRACT_PROMPT.replace("{userInput}", userInput) },
                { traceId: ctx.traceId, runId: ctx.runId }
              );
              const mentioned = (initial as any).mentioned ?? [];
              const ownProduct = (initial as any).ownProduct ?? null;

              const parts: string[] = [];
              if (mentioned.length > 0) {
                parts.push(`您提到了：**${mentioned.join("、")}**`);
              }
              if (!ownProduct) {
                parts.push("**您的自身产品是哪一个？**（自身产品将被用作分析的参照系）");
              }
              if (mentioned.length < 2 || !ownProduct) {
                parts.push("请补充完整信息（至少 2 个产品，标记哪个是自身产品）。");
              } else {
                parts.push("确认无误？如需修改请直接输入。");
              }
              prompt = parts.join("\n\n");
              inputType = "free_text";
              break;
            }
            case "dimensions": {
              prompt = `请选择对比维度（可多选）：\n\n` +
                `- **functionality** — 功能特性\n` +
                `- **pricing** — 定价与付费模式\n` +
                `- **user_experience** — 用户体验与交互\n` +
                `- **market_position** — 市场地位与份额\n` +
                `- **technology** — 技术能力与架构`;
              inputType = "multi_select";
              options = [
                { key: "functionality", label: "功能特性", description: "产品功能、特色、能力对比" },
                { key: "pricing", label: "定价与付费", description: "价格方案、免费版限制、计费周期" },
                { key: "user_experience", label: "用户体验", description: "交互设计、易用性、界面评价" },
                { key: "market_position", label: "市场地位", description: "市场份额、用户规模、品牌影响力" },
                { key: "technology", label: "技术能力", description: "技术架构、API开放性、性能" },
              ];
              break;
            }
            case "output_format": {
              prompt = `请选择期望的产物格式（可多选）：\n\n` +
                `- **comparison_matrix** — 属性级对比表格，含差异高亮\n` +
                `- **swot** — 各竞品的优势/劣势/机会/威胁分析\n` +
                `- **insight_report** — 以您的产品为参照系的差距/优势/机会/风险洞察\n` +
                `- **report** — 完整分析报告（含以上全部 + 数据来源附录）`;
              inputType = "multi_select";
              options = [
                { key: "comparison_matrix", label: "对比矩阵表格", description: "竞品×属性的横向对比" },
                { key: "swot", label: "SWOT 分析", description: "各竞品的优势/劣势/机会/威胁" },
                { key: "insight_report", label: "差异化洞察", description: "差距/蓝海/风险分析" },
                { key: "report", label: "完整报告", description: "含以上全部 + 数据来源附录" },
              ];
              break;
            }
            case "constraints": {
              prompt = `请指定分析约束条件（可输入"无"表示无需约束）：\n\n` +
                `- **时间范围**：如"最近一年"、"2025年至今"\n` +
                `- **地域范围**：如"仅中国大陆"、"全球"\n` +
                `- **语言偏好**：如"仅中文来源"\n` +
                `- **竞品数量上限**：如"不超过 5 个"`;
              inputType = "free_text";
              break;
            }
          }

          rp.pendingQuestionType = def.questionType;
          rp.history.push({
            round: displayRound,
            questionType: def.questionType,
            agentPrompt: prompt,
            userResponse: "",
            extractedDelta: {},
            timestamp: new Date().toISOString(),
          });
          rp.roundIndex++;

          await ctx.emit({
            uiHint: "clarification_asked", eventType: "CLARIFICATION_ASKED",
            ...base,
            payload: {
              round: displayRound,
              questionType: def.questionType,
              agentPrompt: prompt,
              inputType,
              ...(options ? { options } : {}),
            },
          });

          return { patch: { _rpState: rp, _userResponse: null }, artifacts: [] };
        }
      }

      // ═══════════════════════════════════════════════════════════
      // Phase 3: confirming — preview and wait for confirmation
      // ═══════════════════════════════════════════════════════════
      if (rp.phase === "confirming") {
        const targets = rp.partialConfig.targets ?? [];
        const dims = rp.partialConfig.dimensions ?? [];
        const fmts = rp.partialConfig.outputFormat ?? [];
        const constraints = rp.partialConfig.constraints ?? {};

        // First time entering confirming → emit clarification_asked
        if (!rp.pendingQuestionType || rp.pendingQuestionType !== "confirm_preview") {
          rp.pendingQuestionType = "confirm_preview";
          const displayRound = rp.history.length + 1;

          const agentPrompt = CONFIG_PREVIEW_PROMPT
            .replace("{analysisType}", rp.partialConfig.analysisType === "product_comparison" ? "产品横向对比" : (rp.partialConfig.analysisType ?? ""))
            .replace("{targets}", targets.map((t: any) => t.name ?? t).join("、"))
            .replace("{dimensions}", dims.join("、"))
            .replace("{outputFormat}", fmts.join("、"))
            .replace("{constraints}", Object.keys(constraints).length > 0 ? JSON.stringify(constraints) : "无");

          rp.history.push({
            round: displayRound,
            questionType: "confirm_preview",
            agentPrompt,
            userResponse: "",
            extractedDelta: {},
            timestamp: new Date().toISOString(),
          });

          await ctx.emit({
            uiHint: "clarification_asked", eventType: "CLARIFICATION_ASKED",
            ...base,
            payload: {
              round: displayRound,
              questionType: "confirm_preview",
              agentPrompt,
              inputType: "confirm_actions",
              current: rp.partialConfig,
            },
          });

          return { patch: { _rpState: rp, _userResponse: null }, artifacts: [] };
        }

        // Process confirm_preview response
        if (userResponse != null && userResponse !== undefined) {
          const trimmed = userResponse.trim();
          const confirmHistory = rp.history[rp.history.length - 1];
          if (confirmHistory) {
            confirmHistory.userResponse = userResponse;
            confirmHistory.extractedDelta = { confirmed: trimmed === "确认" };
          }

          if (trimmed === "确认" || trimmed.toLowerCase() === "confirm" || trimmed.toLowerCase() === "ok") {
            rp.completed = true;
            rp.pendingQuestionType = undefined;

            // Emit CLARIFICATION_ANSWERED for confirm
            await ctx.emit({
              uiHint: "node_progress", eventType: "CLARIFICATION_ANSWERED",
              ...base,
              payload: {
                round: rp.history.length,
                questionType: "confirm_preview",
                userResponse,
                extractedDelta: { confirmed: true },
                timestamp: new Date().toISOString(),
              },
            });

            const config = rp.partialConfig as RequirementConfig;
            config.clarificationHistory = rp.history;

            await ctx.emit({
              uiHint: "node_completed", eventType: "NODE_COMPLETED",
              ...base,
              payload: {
                summary: `解析完成：${config.targets.length} 个竞品，${config.dimensions.length} 个维度`,
                config,
              },
            });

            return { patch: { config, _rpState: null, _userResponse: null }, artifacts: [] };
          } else {
            // User wants to modify → back to targets (ROUND_DEFS index 0)
            rp.history = rp.history.slice(0, 1); // keep only scene_selection
            rp.phase = "clarification_loop";
            rp.roundIndex = 0;
            rp.pendingQuestionType = undefined;
            rp.modifyTargetIndex = undefined;
            return { patch: { _rpState: rp, _userResponse: null }, artifacts: [] };
          }
        }
      }

      throw new Error(
        `requirement_parsing: unexpected state phase=${rp.phase} roundIndex=${rp.roundIndex}`
      );
    },
  };
}
