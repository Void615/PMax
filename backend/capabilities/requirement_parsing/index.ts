import type {
  Capability,
  CapabilityResult,
  RuntimeState,
  RuntimeContext,
} from "../../runtime/index.js";
import type { RequirementConfig } from "../shared/types.js";
import { createLlmStructuredExtract } from "../../tools/llm_structured_extract/skill.js";
import { PARSE_PROMPT } from "./prompts.js";

export function createRequirementParsingCap(
  llm: { complete(prompt: string): Promise<string> }
): Capability {
  const extractTool = createLlmStructuredExtract(llm);

  return {
    id: "requirement_parsing",
    description: "解析用户自然语言需求，提取结构化分析参数（竞品列表、对比维度、产物格式）",
    inputHints: [],
    outputHints: ["config"],
    requires: [],
    tools: [extractTool],

    async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
      const userInput = state.data.userInput ?? "";
      await ctx.emit({ uiHint: "node_progress", eventType: "NODE_PROGRESS", payload: { stage: "parsing" } });

      const tool = this.tools.find(t => t.name === "llm_structured_extract")!;
      const raw = await tool.execute({
        text: userInput,
        instruction: PARSE_PROMPT.replace("{userInput}", userInput),
      }, { traceId: ctx.traceId, runId: ctx.runId });

      const config = raw as unknown as RequirementConfig;
      config.userInput = userInput;

      // 合法性校验
      if (!config.targets || config.targets.length < 2) {
        await ctx.emit({
          uiHint: "workflow_paused",
          eventType: "WORKFLOW_PAUSED",
          payload: { reason: "targets_insufficient", message: "请至少提供 2 个竞品名称" },
        });
      }

      if (!config.dimensions || config.dimensions.length === 0) {
        config.dimensions = ["functionality", "pricing"];
      }

      if (!config.outputFormat || config.outputFormat.length === 0) {
        config.outputFormat = ["comparison_matrix", "swot"];
      }

      if (!config.constraints) {
        config.constraints = {};
      }

      await ctx.emit({
        uiHint: "node_completed",
        eventType: "NODE_COMPLETED",
        payload: {
          summary: `解析完成：${config.targets.length} 个竞品，${config.dimensions.length} 个维度`,
          config,
        },
      });

      return { patch: { config }, artifacts: [] };
    },
  };
}
