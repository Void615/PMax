import type { EventBus, WorkflowEvent, UiHint } from "../bus/types.js";
import type { ArtifactDraft } from "./types.js";

export interface EmitOptions {
  persist?: boolean;
}

export interface LlmClient {
  complete(prompt: string): Promise<string>;
  plan(state: Record<string, any>, tools: { name: string; description: string }[]): Promise<Record<string, any>>;
  synthesize(state: Record<string, any>, results: any[]): Promise<Record<string, any>>;
}

export interface RuntimeContext {
  traceId: string;
  parentTraceId?: string;
  workflowId: string;
  runId: string;
  nodeId: string;
  iteration: number;
  signal: AbortSignal;

  /** 发射事件到 EventBus */
  emit(event: Partial<WorkflowEvent> & { uiHint: UiHint }, opts?: EmitOptions): Promise<void>;

  /** LLM 客户端 */
  llm: LlmClient;

  /** 显式持久化制品 */
  saveArtifact(draft: ArtifactDraft): Promise<string>;
}
