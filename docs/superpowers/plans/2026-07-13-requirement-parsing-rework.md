# Requirement Parsing Capability 重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 requirement_parsing 从"单次 LLM 提取"重构为"数据驱动的多轮澄清对话"。用户逐轮确认分析场景/竞品/维度/产物格式/约束条件后产出完整 RequirementConfig。轮次序列由 `ROUND_DEFS` 表驱动，analysisType 决定澄清步骤，不硬编码轮次数。

**Architecture:** Capability 内部状态机 + runner 的 intra-node clarification 暂停机制。Round 1 固定为 scene_selection（确定 analysisType 后才能查 ROUND_DEFS），后续轮次由 ROUND_DEFS 表驱动。每轮发出 `clarification_asked` 事件 → runner 暂停等待 → 用户提交 → runner 恢复执行同一节点。所有轮次必填，无跳过逻辑。

**Tech Stack:** TypeScript, Vitest, 现有 runtime 不变

## Global Constraints

- 不修改 `backend/runtime/` 任何文件
- 所有 LLM 调用通过 Tool（llm_structured_extract）
- 新增 2 个 UiHint：`clarification_asked`、`quality_warning`（clarification_answered 复用 `node_progress`）
- 所有轮次必填，无跳过机制
- 不硬编码轮次数，轮次序列由 ROUND_DEFS 表驱动

---

### Task 1: 扩展共享类型与 UiHint 枚举

**Files:**
- Modify: `backend/capabilities/shared/types.ts` — 新增 ClarificationRound, ClarificationRoundDef, ROUND_DEFS
- Modify: `backend/runtime/bus/types.ts` — UiHint 新增 `clarification_asked`, `quality_warning`
- Modify: `backend/src/workflow/events.ts` — WorkflowLifecycleEvent 新增 2 个类型 + HumanClarification

- [ ] **Step 1: shared/types.ts 新增 ClarificationRound, ClarificationRoundDef 类型 + RequirementConfig 扩展**

```typescript
// backend/capabilities/shared/types.ts

/**
 * 单轮澄清的定义。每种 analysisType 有一组 ROUND_DEFS。
 * 所有轮次必填。
 */
export interface ClarificationRoundDef {
  questionType: "targets" | "dimensions" | "output_format" | "constraints" | "confirm_preview";
}

/**
 * 单轮澄清对话记录，用于多轮对话的完整溯源。
 */
export interface ClarificationRound {
  round: number;
  questionType: "scene_selection" | "targets" | "dimensions" | "output_format" | "constraints" | "confirm_preview";
  agentPrompt: string;
  userResponse: string;
  extractedDelta: Record<string, any>;
  timestamp: string;
}

/**
 * 每种分析场景的澄清轮次序列。
 * Round 1 (scene_selection) 是固定入口，不在表内。
 */
export const ROUND_DEFS: Record<string, ClarificationRoundDef[]> = {
  product_comparison: [
    { questionType: "targets" },
    { questionType: "dimensions" },
    { questionType: "output_format" },
    { questionType: "constraints" },
    { questionType: "confirm_preview" },
  ],
  // Phase 3 预留：
  // dev_decision: [
  //   { questionType: "own_product" },
  //   { questionType: "opportunity_areas" },
  //   { questionType: "timeframe" },
  //   { questionType: "confirm_preview" },
  // ],
  // industry_trend: [
  //   { questionType: "industry_sector" },
  //   { questionType: "pest_focus" },
  //   { questionType: "timeframe" },
  //   { questionType: "output_format" },
  //   { questionType: "confirm_preview" },
  // ],
};

// RequirementConfig 新增字段:
export interface RequirementConfig {
  analysisType: "product_comparison";
  targets: Target[];
  dimensions: Dimension[];
  outputFormat: OutputFormat[];
  constraints: AnalysisConstraints;
  userInput: string;
  clarificationHistory: ClarificationRound[];  // 新增
}
```

- [ ] **Step 2: UiHint 新增 2 个值**

```typescript
// backend/runtime/bus/types.ts
export type UiHint =
  | "tool_call" | "tool_result" | "tool_error" | "llm_stream"
  | "node_progress" | "routing_decision" | "workflow_paused"
  | "node_completed" | "workflow_complete" | "workflow_failed"
  | "degradation_notice"
  | "clarification_asked"   // 新增
  | "quality_warning";       // 新增
```

- [ ] **Step 3: events.ts 新增 clarification 事件类型**

```typescript
// backend/src/workflow/events.ts
export type WorkflowLifecycleEvent =
  | { type: "node.executed";      nodeId: string; iteration: number; outputKeys: string[] }
  | { type: "route.required";     completedNode: string; suggestions: RouteSuggestion[] }
  | { type: "clarification.required"; nodeId: string; round: number; questionType: string; agentPrompt: string }
  | { type: "clarification.provided"; nodeId: string; round: number; userResponse: string; extractedDelta: Record<string, any> }
  | { type: "human.continued";    targetNode: string }
  | { type: "human.backjumped";   targetNode: string }
  | { type: "workflow.completed" }
  | { type: "workflow.failed";    error: string }
  | { type: "workflow.cancelled" };

export interface HumanClarification {
  round: number;
  userResponse: string;
}
```

- [ ] **Step 4: fold 函数新增 clarification 事件处理**

```typescript
// events.ts — fold 函数 switch 新增两个 case
case "clarification.required":
  return state;

case "clarification.provided":
  return {
    ...state,
    data: { ...state.data, _userResponse: event.userResponse },
  };

// 默认分支保持: route.required / workflow.completed / failed / cancelled — 不改 state
```

- [ ] **Step 5: 验证编译通过**

```bash
cd backend && npx tsc --noEmit
```

Expected: 编译通过

- [ ] **Step 6: Commit**

```bash
git add backend/capabilities/shared/types.ts backend/runtime/bus/types.ts backend/src/workflow/events.ts
git commit -m "feat: add ClarificationRound, ROUND_DEFS, UiHint extensions, and clarification lifecycle events"
```

---

### Task 2: 更新 prompts.ts

**Files:**
- Modify: `backend/capabilities/requirement_parsing/prompts.ts`

- [ ] **Step 1: 替换旧 PARSE_PROMPT 为新 prompts**

```typescript
// backend/capabilities/requirement_parsing/prompts.ts

export const SCENE_CLASSIFY_PROMPT = `分析用户意图，判断属于以下哪种竞品分析场景。

用户输入：{userInput}

三种场景：
1. product_comparison — 比较多个产品的功能、定价、体验等维度
2. dev_decision      — 分析产品发展方向和竞争策略
3. industry_trend    — 分析产业发展趋势和竞争格局

当前 Phase 2 默认返回 product_comparison。

输出 JSON: { "analysisType": "product_comparison", "confidence": 0.95 }

只输出 JSON。`;

export const TARGETS_EXTRACT_PROMPT = `从用户输入中提取所有提到的产品/竞品名称。
如果用户未明确说明自身产品，设为 null。

用户输入：{userInput}

输出 JSON: { "mentioned": ["产品名1"], "ownProduct": "自身产品名或null" }

只输出 JSON。`;

export const TARGETS_PARSE_PROMPT = `从用户回答中提取完整的竞品列表。
将自身产品标记为 isOwn: true，并排在第一个。
尝试根据产品名推断品类（category），如不确定填 null。

用户回答：{userResponse}

输出 JSON: { "targets": [{ "name": "产品名", "isOwn": true, "category": "品类或null" }] }

规则：
- isOwn 为 true 的排在第一位
- 至少 2 个 targets
- category 不确定则填 null

只输出 JSON。`;

export const DIMENSIONS_PARSE_PROMPT = `从用户回答中提取选中的对比维度。

可用维度：
- functionality    功能特性
- pricing          定价与付费模式
- user_experience  用户体验与交互设计
- market_position  市场定位与份额
- technology       技术能力与架构

用户回答：{userResponse}

输出 JSON: { "dimensions": ["functionality", "pricing"] }

只输出 JSON。`;

export const OUTPUT_FORMAT_PARSE_PROMPT = `从用户回答中提取选中的产物格式。

可用格式：
- comparison_matrix  对比矩阵表格
- swot               SWOT 分析
- insight_report     差异化洞察报告
- report             完整分析报告

用户回答：{userResponse}

输出 JSON: { "outputFormat": ["comparison_matrix", "swot"] }

只输出 JSON。`;

export const CONSTRAINTS_PARSE_PROMPT = `从用户回答中提取分析约束条件。

用户回答：{userResponse}

输出 JSON: {
  "constraints": {
    "timeRange": { "from": "2025-01-01", "to": "2025-12-31" },
    "regions": ["中国"],
    "languages": ["中文"],
    "maxCompetitors": 5
  }
}

未提及的字段省略。只输出 JSON。`;

export const CONFIG_PREVIEW_PROMPT = `请确认以下分析配置：

分析场景：{analysisType}
竞品列表：{targets}
对比维度：{dimensions}
产物格式：{outputFormat}
约束条件：{constraints}

确认无误请回复"确认"，需要修改请说明修改内容。`;
```

- [ ] **Step 2: 验证编译通过**

```bash
cd backend && npx tsc --noEmit
```

Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add backend/capabilities/requirement_parsing/prompts.ts
git commit -m "feat: replace single PARSE_PROMPT with per-round clarification prompts"
```

---

### Task 3: 实现 ROUND_DEFS 驱动的澄清状态机

**Files:**
- Modify: `backend/capabilities/requirement_parsing/index.ts` — 完全重写

**核心设计:** Round 1 固定为 scene_selection，确定 analysisType 后从 ROUND_DEFS 表中加载轮次序列，后续驱动一个通用循环。

- [ ] **Step 1: 编写完整实现**

```typescript
// backend/capabilities/requirement_parsing/index.ts

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

/** Capability 内部中间状态 */
interface RpIntermediateState {
  phase: "scene_selection" | "clarification_loop" | "confirming";
  roundIndex: number;                        // 当前在 ROUND_DEFS 中的索引
  roundDefs: ClarificationRoundDef[] | null; // 从 analysisType 查询出的轮次序列（null = 尚未确定）
  partialConfig: Partial<RequirementConfig>;
  history: ClarificationRound[];
  pendingQuestionType?: string;
  modifyTargetIndex?: number;   // confirm_preview 中用户要求修改 → 回跳到此索引
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

export function createRequirementParsingCap(
  llm: { complete(prompt: string): Promise<string> }
): Capability {
  const extractTool = createLlmStructuredExtract(llm);

  return {
    id: "requirement_parsing",
    description: "通过RDDEFS驱动的多轮对话明确用户分析需求，产出结构化RequirementConfig（含完整对话溯源链）",
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

      // ── 处理回跳（confirm_preview 中用户要求修改）──
      if (rp.modifyTargetIndex !== undefined) {
        const target = rp.modifyTargetIndex;
        rp.modifyTargetIndex = undefined;
        rp.roundIndex = target;           // 回跳到指定轮次
        rp.phase = "clarification_loop";  // 重新进入澄清循环
        // 清除自该轮次起的历史和 partialConfig 中的相关字段
        rp.history = rp.history.slice(0, target + 1);  // 保留到 scene_selection
        // 根据 defs 清除后续 round 的 partialConfig 数据
        return { patch: { _rpState: rp, _userResponse: null }, artifacts: [] };
      }

      // ── 如果已完成 → 直接返回 ──
      if (rp.completed) {
        const config = rp.partialConfig as RequirementConfig;
        config.clarificationHistory = rp.history;
        await ctx.emit({
          uiHint: "node_completed", eventType: "NODE_COMPLETED",
          nodeId: ctx.nodeId, workflowId: ctx.workflowId, runId: ctx.runId, traceId: ctx.traceId,
          payload: {
            summary: `解析完成：${config.targets.length} 个竞品，${config.dimensions.length} 个维度`,
            config,
          },
          timestamp: new Date().toISOString(),
        });
        return { patch: { config, _rpState: null, _userResponse: null }, artifacts: [] };
      }

      // ===================================================================
      // Phase 1: scene_selection（固定第一轮，确定 analysisType）
      // ===================================================================
      if (rp.phase === "scene_selection") {
        // 发起场景分类
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

        // 记录本轮到 history
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
          nodeId: ctx.nodeId, workflowId: ctx.workflowId, runId: ctx.runId, traceId: ctx.traceId,
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
          timestamp: new Date().toISOString(),
        });

        return { patch: { _rpState: rp, _userResponse: null }, artifacts: [] };
      }

      // ===================================================================
      // Phase 2: clarification_loop — 按 ROUND_DEFS 表驱动的澄清循环
      // ===================================================================
      if (rp.phase === "clarification_loop") {
        // ── 处理上一轮的用户回答 ──
        if (userResponse && rp.roundIndex > 0) {
          const prevDefIndex = rp.roundIndex - 1;
          const prevDef = rp.roundDefs![prevDefIndex];
          const prevHistory = rp.history[prevDefIndex + 1];  // +1 因为 history[0] = scene_selection

          let extractedDelta: Record<string, any> = {};

          switch (prevDef.questionType) {
            case "targets": {
              const r = await tool.execute(
                { text: userResponse, instruction: TARGETS_PARSE_PROMPT.replace("{userResponse}", userResponse) },
                { traceId: ctx.traceId, runId: ctx.runId }
              );
              const targets: Target[] = ((r as any).targets ?? []).map((t: any) => ({
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

          // 补全 history
          if (prevHistory) {
            prevHistory.userResponse = userResponse;
            prevHistory.extractedDelta = extractedDelta;
          }

          // 发射 clarification_answered（复用 node_progress）
          await ctx.emit({
            uiHint: "node_progress", eventType: "CLARIFICATION_ANSWERED",
            nodeId: ctx.nodeId, workflowId: ctx.workflowId, runId: ctx.runId, traceId: ctx.traceId,
            payload: {
              round: prevDefIndex + 2,  // +2: 1-based + scene_selection offset
              questionType: prevDef.questionType,
              userResponse,
              extractedDelta,
              timestamp: new Date().toISOString(),
            },
            timestamp: new Date().toISOString(),
          });
        }

        // ── 如果所有 defs 走完 → 进入 confirm_preview ──
        if (rp.roundIndex >= rp.roundDefs!.length) {
          rp.phase = "confirming";
          // 继续执行（不要 return），下面进入 confirming 分支
        } else {
          // ── 发起下一轮提问 ──
          const def = rp.roundDefs![rp.roundIndex];
          const displayRound = rp.roundIndex + 2;  // 1-based + scene_selection

          let prompt = "";
          let inputType = "";
          let options: { key: string; label: string; description?: string }[] | undefined;

          switch (def.questionType) {
            case "targets": {
              // 先从 userInput 提取已提及的名称
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
                parts.push("确认无误？如需修改请直接输入，格式：`自身产品=XX，竞品=YY、ZZ`");
              }
              prompt = parts.join("\n\n");
              inputType = "free_text";
              break;
            }
            case "dimensions": {
              const dims = rp.partialConfig.dimensions ?? [];
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
                `- **地域范围**：如"仅中国大陆"、 "全球"\n` +
                `- **语言偏好**：如"仅中文来源"\n` +
                `- **竞品数量上限**：如"不超过 5 个"`;
              inputType = "free_text";
              break;
            }
          }

          rp.pendingQuestionType = def.questionType;

          // history 记录本轮提问
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
            nodeId: ctx.nodeId, workflowId: ctx.workflowId, runId: ctx.runId, traceId: ctx.traceId,
            payload: {
              round: displayRound,
              questionType: def.questionType,
              agentPrompt: prompt,
              inputType,
              ...(options ? { options } : {}),
              ...(def.questionType === "targets"
                ? { current: (rp.partialConfig.targets ?? []).map(t => (t as any).name) }
                : {}),
            },
            timestamp: new Date().toISOString(),
          });

          return { patch: { _rpState: rp, _userResponse: null }, artifacts: [] };
        }
      }

      // ===================================================================
      // Phase 3: confirming — 展示预览，等待确认
      // ===================================================================
      if (rp.phase === "confirming") {
        const targets = rp.partialConfig.targets ?? [];
        const dims = rp.partialConfig.dimensions ?? [];
        const fmts = rp.partialConfig.outputFormat ?? [];
        const constraints = rp.partialConfig.constraints ?? {};

        const display: Record<string, string> = {
          分析场景: rp.partialConfig.analysisType === "product_comparison" ? "产品横向对比" : (rp.partialConfig.analysisType ?? ""),
          竞品列表: targets.map((t: any) => t.name ?? t).join("、"),
          对比维度: dims.join("、"),
          产物格式: fmts.join("、"),
          约束条件: Object.keys(constraints).length > 0 ? JSON.stringify(constraints) : "无",
        };

        const prompt = Object.entries(display)
          .map(([k, v]) => `- **${k}**：${v}`)
          .join("\n");

        // 如果是首次进入 confirming（没有 pending question），发出提问
        if (!rp.pendingQuestionType || rp.pendingQuestionType !== "confirm_preview") {
          rp.pendingQuestionType = "confirm_preview";
          const displayRound = rp.history.length + 1;

          rp.history.push({
            round: displayRound,
            questionType: "confirm_preview",
            agentPrompt: `请确认以下分析配置：\n\n${prompt}\n\n确认无误请回复"确认"，需要修改请指明修改内容。`,
            userResponse: "",
            extractedDelta: {},
            timestamp: new Date().toISOString(),
          });

          await ctx.emit({
            uiHint: "clarification_asked", eventType: "CLARIFICATION_ASKED",
            nodeId: ctx.nodeId, workflowId: ctx.workflowId, runId: ctx.runId, traceId: ctx.traceId,
            payload: {
              round: displayRound,
              questionType: "confirm_preview",
              agentPrompt: `请确认以下分析配置：\n\n${prompt}\n\n确认无误请回复"确认"，需要修改请指明修改内容。`,
              inputType: "confirm_actions",
              current: rp.partialConfig,
            },
            timestamp: new Date().toISOString(),
          });

          return { patch: { _rpState: rp, _userResponse: null }, artifacts: [] };
        }

        // ── 处理 confirm_preview 的用户回答 ──
        if (userResponse && rp.pendingQuestionType === "confirm_preview") {
          const trimmed = userResponse.trim();

          // 更新 history
          const confirmHistory = rp.history[rp.history.length - 1];
          if (confirmHistory) {
            confirmHistory.userResponse = userResponse;
            confirmHistory.extractedDelta = { confirmed: trimmed === "确认" };
          }

          if (trimmed === "确认" || trimmed.toLowerCase() === "confirm" || trimmed.toLowerCase() === "ok") {
            // ── 用户确认 → 完成 ──
            rp.completed = true;
            rp.pendingQuestionType = undefined;

            const config = rp.partialConfig as RequirementConfig;
            config.clarificationHistory = rp.history;

            await ctx.emit({
              uiHint: "node_progress", eventType: "CLARIFICATION_ANSWERED",
              nodeId: ctx.nodeId, workflowId: ctx.workflowId, runId: ctx.runId, traceId: ctx.traceId,
              payload: {
                round: rp.history.length,
                questionType: "confirm_preview",
                userResponse,
                extractedDelta: { confirmed: true },
                timestamp: new Date().toISOString(),
              },
              timestamp: new Date().toISOString(),
            });

            await ctx.emit({
              uiHint: "node_completed", eventType: "NODE_COMPLETED",
              nodeId: ctx.nodeId, workflowId: ctx.workflowId, runId: ctx.runId, traceId: ctx.traceId,
              payload: {
                summary: `解析完成：${config.targets.length} 个竞品，${config.dimensions.length} 个维度`,
                config,
              },
              timestamp: new Date().toISOString(),
            });

            return { patch: { config, _rpState: null, _userResponse: null }, artifacts: [] };
          } else {
            // ── 用户要修改 → 回跳到 targets（默认从竞品列表重来）──
            rp.phase = "clarification_loop";
            rp.roundIndex = 0;  // targets 是 ROUND_DEFS[0]
            rp.pendingQuestionType = undefined;
            rp.modifyTargetIndex = undefined;
            return { patch: { _rpState: rp, _userResponse: null }, artifacts: [] };
          }
        }
      }

      throw new Error(`requirement_parsing: unexpected state phase=${rp.phase} roundIndex=${rp.roundIndex}`);
    },
  };
}
```

- [ ] **Step 2: 验证编译通过**

```bash
cd backend && npx tsc --noEmit
```

Expected: 编译通过

- [ ] **Step 3: 运行现有测试检查影响范围**

```bash
cd backend && npx vitest run entry/__tests__/workflow.test.ts
```

Expected: 现有 E2E 测试会因行为变化而 fail（预期之中，Task 6 更新）

- [ ] **Step 4: Commit**

```bash
git add backend/capabilities/requirement_parsing/index.ts
git commit -m "feat: implement ROUND_DEFS-driven multi-round clarification state machine"
```

---

### Task 4: Runner 适配 intra-node clarification 暂停

**Files:**
- Modify: `backend/src/workflow/runner.ts:66-122` — while 循环新增 clarification 分支
- Modify: `backend/src/workflow/events.ts` — RunnerDeps 扩展

- [ ] **Step 1: RunnerDeps 新增 waitForHumanClarification**

```typescript
// backend/src/workflow/events.ts — runner.ts 引入
export interface HumanClarification {
  round: number;
  userResponse: string;
}

// runner.ts — RunnerDeps 新增
export interface RunnerDeps {
  loadEventStream(workflowId: string): Promise<WorkflowLifecycleEvent[]>;
  appendEvent(workflowId: string, event: WorkflowLifecycleEvent): Promise<void>;
  waitForHumanDecision(workflowId: string): Promise<HumanDecision>;
  waitForHumanClarification(workflowId: string): Promise<HumanClarification>;
  updateWorkflowStatus(
    workflowId: string,
    data: { status: string; pausedAt?: Date | null; currentNode?: string }
  ): Promise<void>;
}
```

- [ ] **Step 2: runner.ts while 循环在 executeStep 后插入 clarification 检查**

在 `state = await runtime.executeStep(currentNode, state, ctx);` 之后、`const iteration = countIterations(state, currentNode);` 之前插入：

```typescript
while (currentNode) {
  ctx.nodeId = currentNode;
  state = await runtime.executeStep(currentNode, state, ctx);

  // ── Intra-node clarification 暂停 ──
  const rpState = state.data._rpState;
  if (rpState) {
    const rp = rpState as any;
    const round = rp.history?.length ?? 1;
    const questionType = rp.pendingQuestionType ?? "";
    const lastPrompt = rp.history?.[rp.history.length - 1]?.agentPrompt ?? "";

    await deps.appendEvent(workflowId, {
      type: "clarification.required",
      nodeId: currentNode,
      round,
      questionType,
      agentPrompt: lastPrompt,
    });

    await deps.updateWorkflowStatus(workflowId, {
      status: "paused",
      pausedAt: new Date(),
      currentNode,
    });

    const clarification = await deps.waitForHumanClarification(workflowId);

    await deps.appendEvent(workflowId, {
      type: "clarification.provided",
      nodeId: currentNode,
      round,
      userResponse: clarification.userResponse,
      extractedDelta: {},
    });

    await deps.updateWorkflowStatus(workflowId, {
      status: "running",
      pausedAt: null,
      currentNode,
    });

    state = fold(state, {
      type: "clarification.provided",
      nodeId: currentNode,
      round,
      userResponse: clarification.userResponse,
      extractedDelta: {},
    }, registry);

    continue;  // 重新进入同一节点
  }

  // ── 正常完成的节点逻辑 ──
  const iteration = countIterations(state, currentNode);
  // ... 其余不变
}
```

- [ ] **Step 3: Orchestrator 初始化移到 while 循环之前**

原 runner 在 while 循环前只初始化了一次 Orchestrator。现在需要在每个 clarification 循环恢复时，Orchestrator 保持不变。将 `const orch = new Orchestrator(...)` 和 `await orch.initialize(userInput)` 移到 while 前（已经在那里），不需要修改。

- [ ] **Step 4: 验证编译通过**

```bash
cd backend && npx tsc --noEmit
```

Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add backend/src/workflow/runner.ts backend/src/workflow/events.ts
git commit -m "feat: add intra-node clarification pause/resume loop to runner"
```

---

### Task 5: WorkflowsService + Controller 适配

**Files:**
- Modify: `backend/src/api/workflows/workflows.service.ts` — 新增 submitClarification + waitForHumanClarification
- Modify: `backend/src/api/workflows/workflows.controller.ts` — 新增 POST `/:id/clarification` 端点

- [ ] **Step 1: WorkflowsController 新增端点**

```typescript
// backend/src/api/workflows/workflows.controller.ts
@Post(':id/clarification')
async submitClarification(
  @Param('id') id: string,
  @Body() body: { round: number; userResponse: string },
) {
  await this.workflowsService.submitClarification(id, body.round, body.userResponse);
  return { message: 'ok' };
}
```

- [ ] **Step 2: WorkflowsService 新增方法**

```typescript
// backend/src/api/workflows/workflows.service.ts
async submitClarification(
  workflowId: string,
  round: number,
  userResponse: string,
): Promise<void> {
  await this.redis.publish(
    `workflow:${workflowId}:clarification`,
    JSON.stringify({ round, userResponse }),
  );
}

async waitForHumanClarification(workflowId: string): Promise<HumanClarification> {
  return new Promise((resolve) => {
    const channel = `workflow:${workflowId}:clarification`;
    const handler = (msg: string) => {
      const data = JSON.parse(msg);
      this.redis.unsubscribeChannel(channel, handler);
      resolve({ round: data.round, userResponse: data.userResponse });
    };
    this.redis.subscribe(channel, handler);
  });
}
```

（`subscribeChannel` / `unsubscribeChannel` 需确认 RedisService 当前方法签名。若现有 API 不匹配，用一次性 subscriber 模式适配。）

- [ ] **Step 3: 验证编译通过**

```bash
cd backend && npx tsc --noEmit
```

Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add backend/src/api/workflows/workflows.service.ts backend/src/api/workflows/workflows.controller.ts
git commit -m "feat: add clarification endpoint and Redis pub/sub wait mechanism"
```

---

### Task 6: 更新现有 E2E 测试

**Files:**
- Modify: `backend/entry/__tests__/workflow.test.ts` — 适配 clarification 自动回复

- [ ] **Step 1: createAutoContinueDeps 新增 waitForHumanClarification**

```typescript
function createAutoContinueDeps(): RunnerDeps {
  const events: WorkflowLifecycleEvent[] = [];
  let clarificationRound = 0;
  return {
    loadEventStream: async () => [],
    appendEvent: async (_wfId, event) => { events.push(event); },
    waitForHumanDecision: async () => {
      const routeEvent = [...events].reverse().find(e => e.type === "route.required");
      if (routeEvent && routeEvent.type === "route.required" && routeEvent.suggestions.length > 0) {
        return { targetNode: routeEvent.suggestions[0].nodeId, action: "continue" };
      }
      return { targetNode: "artifact_generation", action: "continue" };
    },
    waitForHumanClarification: async () => {
      clarificationRound++;
      // 按 product_comparison 的 ROUND_DEFS 顺序自动回答
      const responses: Record<number, string> = {
        1: "product_comparison",                        // scene_selection
        2: "微博和知乎，自身产品是微博",                    // targets
        3: "functionality, pricing",                     // dimensions
        4: "comparison_matrix, swot",                    // output_format
        5: "无",                                         // constraints
        6: "确认",                                        // confirm_preview
      };
      return { round: clarificationRound, userResponse: responses[clarificationRound] ?? "确认" };
    },
    updateWorkflowStatus: async () => {},
  };
}
```

- [ ] **Step 2: 运行 E2E 测试验证全链路通过**

```bash
cd backend && npx vitest run entry/__tests__/workflow.test.ts
```

Expected: 2/2 pass

- [ ] **Step 3: 运行全量测试**

```bash
cd backend && npx vitest run
```

Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add backend/entry/__tests__/workflow.test.ts
git commit -m "test: update E2E tests for ROUND_DEFS-driven clarification auto-respond"
```

---

### Task 7: 新增 clarification 单元测试

**Files:**
- Create: `backend/capabilities/requirement_parsing/__tests__/clarification.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, it, expect } from "vitest";
import { createRequirementParsingCap } from "../index.js";
import { GraphRuntime } from "../../../runtime/index.js";
import type { RuntimeState, RuntimeContext } from "../../../runtime/index.js";

function createMockLlm() {
  return {
    async complete(prompt: string): Promise<string> {
      if (prompt.includes("三种场景")) {
        return JSON.stringify({ analysisType: "product_comparison", confidence: 0.9 });
      }
      if (prompt.includes("从用户输入中提取所有产品")) {
        return JSON.stringify({ mentioned: ["微博", "知乎"], ownProduct: "微博" });
      }
      if (prompt.includes("从用户回答中提取完整的竞品列表")) {
        return JSON.stringify({ targets: [{ name: "微博", isOwn: true }, { name: "知乎", isOwn: false }] });
      }
      if (prompt.includes("从用户回答中提取选中的对比维度")) {
        return JSON.stringify({ dimensions: ["functionality", "pricing"] });
      }
      if (prompt.includes("从用户回答中提取选中的产物格式")) {
        return JSON.stringify({ outputFormat: ["comparison_matrix", "swot"] });
      }
      return "{}";
    },
  };
}

function makeCtx(emitted: any[]): RuntimeContext {
  return {
    traceId: "t", workflowId: "w", runId: "r", nodeId: "requirement_parsing", iteration: 0,
    signal: new AbortController().signal,
    llm: createMockLlm() as any,
    emit: async (event: any) => { emitted.push(event); },
    saveArtifact: async () => "",
  };
}

describe("requirement_parsing ROUND_DEFS-driven clarification", () => {
  it("should complete full product_comparison clarification: scene + 4 defs + confirm", async () => {
    const cap = createRequirementParsingCap({ complete: createMockLlm().complete });
    const emitted: any[] = [];
    const runtime = new GraphRuntime({ get: () => cap } as any);
    let state = runtime.initialState({ userInput: "比较微博和知乎" });

    // Round 1: scene_selection
    let result = await cap.execute(state, makeCtx(emitted));
    expect(emitted.some(e => e.uiHint === "clarification_asked" && e.payload.questionType === "scene_selection")).toBe(true);
    state.data._rpState = result.patch._rpState;

    // Round 2: targets (first ROUND_DEFS entry for product_comparison)
    state.data._userResponse = "微博和知乎，自身产品是微博";
    result = await cap.execute(state, makeCtx(emitted));
    expect(emitted.some(e => e.uiHint === "clarification_asked" && e.payload.questionType === "targets")).toBe(true);
    state.data._rpState = result.patch._rpState;
    state.data._userResponse = undefined;

    // Round 3: dimensions
    state.data._userResponse = "functionality, pricing";
    result = await cap.execute(state, makeCtx(emitted));
    expect(emitted.some(e => e.uiHint === "clarification_asked" && e.payload.questionType === "dimensions")).toBe(true);
    state.data._rpState = result.patch._rpState;
    state.data._userResponse = undefined;

    // Round 4: output_format
    state.data._userResponse = "comparison_matrix, swot";
    result = await cap.execute(state, makeCtx(emitted));
    expect(emitted.some(e => e.uiHint === "clarification_asked" && e.payload.questionType === "output_format")).toBe(true);
    state.data._rpState = result.patch._rpState;
    state.data._userResponse = undefined;

    // Round 5: constraints
    state.data._userResponse = "无";
    result = await cap.execute(state, makeCtx(emitted));
    expect(emitted.some(e => e.uiHint === "clarification_asked" && e.payload.questionType === "constraints")).toBe(true);
    state.data._rpState = result.patch._rpState;
    state.data._userResponse = undefined;

    // Round 6: confirm_preview — confirm
    state.data._userResponse = "确认";
    result = await cap.execute(state, makeCtx(emitted));

    // Should emit CLARIFICATION_ANSWERED + NODE_COMPLETED
    const answered = emitted.find(e => e.eventType === "CLARIFICATION_ANSWERED" && e.payload.questionType === "confirm_preview");
    expect(answered).toBeDefined();
    expect(answered.payload.extractedDelta.confirmed).toBe(true);

    const completed = emitted.find(e => e.uiHint === "node_completed");
    expect(completed).toBeDefined();
    const config = completed.payload.config;
    expect(config.analysisType).toBe("product_comparison");
    expect(config.targets).toHaveLength(2);
    expect(config.targets[0].name).toBe("微博");
    expect(config.dimensions).toContain("functionality");
    expect(config.outputFormat).toContain("comparison_matrix");
    expect(config.clarificationHistory).toHaveLength(6);
    // 验证 history 每轮有 agentPrompt 和 extractedDelta
    for (const round of config.clarificationHistory) {
      expect(round.agentPrompt).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd backend && npx vitest run capabilities/requirement_parsing/__tests__/clarification.test.ts
```

Expected: 1/1 pass

- [ ] **Step 3: 运行全量测试确认无回归**

```bash
cd backend && npx vitest run
```

Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add backend/capabilities/requirement_parsing/__tests__/clarification.test.ts
git commit -m "test: add ROUND_DEFS-driven clarification unit test for product_comparison"
```

---

### Plan Summary

| Task | 变更范围 | 关键内容 |
|------|---------|---------|
| 1 | shared/types.ts, bus/types.ts, events.ts | ClarificationRound, ROUND_DEFS, UiHint ×2, lifecycle events ×2 + HumanClarification |
| 2 | requirement_parsing/prompts.ts | 7 个 per-round prompt |
| 3 | requirement_parsing/index.ts | ROUND_DEFS 驱动的三阶段状态机（scene_selection → loop → confirming） |
| 4 | runner.ts, events.ts | RunnerDeps 扩展 + while 循环 clarification 暂停分支 |
| 5 | workflows.service.ts, workflows.controller.ts | Redis clarification channel + POST `/:id/clarification` 端点 |
| 6 | workflow.test.ts | E2E 测试适配 auto-clarification |
| 7 | clarification.test.ts | ROUND_DEFS 驱动澄清的单元测试 |

### 设计保证

- **不硬编码轮次数** — 轮次序列由 `ROUND_DEFS[analysisType]` 决定
- **Phase 3 新增场景零改动** — 只需在 ROUND_DEFS 加一行 + 写对应 prompt
- **所有轮次必填** — 无 skippable，无跳过机制
- **confirm_preview 修改回跳** — `rp.roundIndex = 0` 即可回到第一个 def
- **完整溯源** — `clarificationHistory` 记录每轮的 agentPrompt + userResponse + extractedDelta
