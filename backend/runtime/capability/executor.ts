import type { Capability, CapabilityResult } from "./types.js";
import type { RuntimeContext } from "./context.js";
import type { RuntimeState, ErrorRecord, ExecutionStep } from "../state.js";
import { executeWithRetry, NodeFatalError } from "../retry.js";
import type { RetryPolicyConfig } from "../retry.js";

const DOMException = globalThis.DOMException ?? class extends Error {
  readonly name = "AbortError";
  constructor(message?: string) { super(message ?? "Aborted"); this.name = "AbortError"; }
};

const DEFAULT_RETRY_POLICY: RetryPolicyConfig = {
  maxAttempts: 3,
  timeoutSec: 300,
  backoffBaseSec: 2,
};

export class CapabilityExecutor {
  constructor(
    private readonly registry: { get(id: string): Capability | undefined },
    private readonly retryPolicy?: RetryPolicyConfig
  ) {}

  async execute(
    nodeId: string,
    state: RuntimeState,
    ctx: RuntimeContext
  ): Promise<RuntimeState> {
    const cap = this.registry.get(nodeId);
    if (!cap) {
      const error: ErrorRecord = {
        nodeId,
        traceId: ctx.traceId,
        errorCode: "CAPABILITY_NOT_FOUND",
        errorMessage: `Capability not found: ${nodeId}`,
        timestamp: new Date().toISOString(),
      };
      return {
        data: state.data,
        control: state.control,
        runtime: state.runtime,
        errors: [...state.errors, error],
      };
    }

    const step: ExecutionStep = {
      nodeId,
      iteration: (state.control.executionPath?.filter(s => s.nodeId === nodeId).length ?? 0),
      startedAt: new Date().toISOString(),
    };

    try {
      const result = await executeWithRetry(
        async (s) => {
          if (ctx.signal.aborted) throw new DOMException("Cancelled", "AbortError");
          const r = await cap.execute(s as RuntimeState, ctx);
          return r as unknown as Record<string, any>;
        },
        state as unknown as Record<string, any>,
        nodeId,
        { logNodeError: async () => {} },
        this.retryPolicy ?? DEFAULT_RETRY_POLICY
      );

      const cr = result as unknown as CapabilityResult;
      step.completedAt = new Date().toISOString();

      return {
        data: { ...state.data, ...cr.patch },
        control: {
          currentNode: nodeId,
          executionPath: [...(state.control.executionPath ?? []), step],
        },
        runtime: state.runtime,
        errors: state.errors,
      };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        return state;
      }

      const isFatal = e instanceof NodeFatalError;
      const errorRecord: ErrorRecord = {
        nodeId,
        traceId: ctx.traceId,
        errorCode: isFatal ? (e as NodeFatalError).errorCode : (e instanceof Error ? e.constructor.name : "NODE_ERROR"),
        errorMessage: isFatal ? (e as NodeFatalError).errorMessage : String(e).slice(0, 1000),
        timestamp: new Date().toISOString(),
        details: isFatal ? (e as NodeFatalError).errorDetails : undefined,
      };
      return {
        data: state.data,
        control: state.control,
        runtime: state.runtime,
        errors: [...state.errors, errorRecord],
      };
    }
  }

  /** 无重试的执行变体（用于 Capability 内部工具调用） */
  async executeOnce(nodeId: string, state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
    const cap = this.registry.get(nodeId);
    if (!cap) {
      throw new Error(`Capability not found: ${nodeId}`);
    }
    return cap.execute(state, ctx);
  }
}
