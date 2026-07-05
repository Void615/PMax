import type { RuntimeState } from "../state.js";
import type { RuntimeContext } from "./context.js";

/**
 * Capability = 业务逻辑 + 事件 + 容错 + 追踪的原子体。
 * 每个 Capability 是完整、自描述、可独立部署的原子单元。
 */
export interface Capability {
  readonly id: string;
  readonly description: string;
  readonly inputHints?: string[];
  readonly outputHints?: string[];
  readonly tools: Tool[];
  readonly requires?: string[];
  execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult>;
}

export interface CapabilityResult {
  patch: Record<string, any>;
  artifacts: ArtifactDraft[];
}

/**
 * Tool = 独立目录组织的原子工具能力（skill 或 MCP）。
 */
export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, any>;

  readonly eventPayloads?: {
    onStart?(params: Record<string, any>): Record<string, any>;
    onComplete?(result: any, durationMs: number): Record<string, any>;
    onError?(error: Error): Record<string, any>;
  };

  execute(params: Record<string, any>, ctx: ToolContext): Promise<any>;
}

export interface ToolContext {
  traceId: string;
  runId: string;
}

/**
 * 制品草稿 —— Capability 产出的持久化数据。
 */
export interface ArtifactDraft {
  artifactType: string;
  title: string;
  content: Record<string, any>;
  createdByNode: string;
  contentText?: string;
}

/**
 * 单次执行的指标快照（可选）。
 */
export interface NodeMetrics {
  durationMs: number;
  tokensInput: number;
  tokensOutput: number;
  modelName: string;
}
