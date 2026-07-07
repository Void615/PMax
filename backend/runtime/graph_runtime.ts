/**
 * GraphRuntime v2 —— 单节点动态编译执行器。
 *
 * 每次路由决策后动态编译仅 1 个节点的图并执行。
 * CapabilityExecutor 负责实际的节点调度和错误处理。
 */

import { StateGraph, END } from "./engine/graph.js";
import type { GraphConfig } from "./engine/graph.js";
import type { Checkpointer } from "./engine/checkpointer.js";
import { CapabilityExecutor } from "./capability/executor.js";
import { CapabilityRegistry } from "./capability/registry.js";
import type { RuntimeContext } from "./capability/context.js";
import type { RuntimeState, ExecutionStep } from "./state.js";
import { generateRunId } from "./tracing/trace_id.js";

export class GraphRuntime {
  private readonly executor: CapabilityExecutor;
  private readonly runId: string;

  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly checkpointer?: Checkpointer
  ) {
    this.executor = new CapabilityExecutor(registry);
    this.runId = generateRunId();
  }

  get config(): GraphConfig {
    return {
      configurable: { threadId: this.runId },
    };
  }

  initialState(data: Record<string, any>): RuntimeState {
    return {
      data,
      control: {
        currentNode: "",
        executionPath: [] as ExecutionStep[],
      },
      runtime: {
        workflowId: "",
        runId: this.runId,
        threadId: this.runId,
      },
      errors: [],
    };
  }

  /** 动态编译并执行单个节点 */
  async executeStep(
    nodeId: string,
    state: RuntimeState,
    ctx: RuntimeContext
  ): Promise<RuntimeState> {
    const graph = new StateGraph<RuntimeState>();

    graph.addNode(nodeId, async (s) => {
      return this.executor.execute(nodeId, s, ctx);
    });
    graph.addEdge(nodeId, END);
    graph.setEntryPoint(nodeId);

    const compiled = graph.compile(this.checkpointer);

    return compiled.invoke(state, this.config);
  }

  /** 从 checkpoint 恢复 */
  async recover(): Promise<RuntimeState | null> {
    if (!this.checkpointer) return null;
    const checkpoint = await this.checkpointer.load(this.runId);
    if (!checkpoint) return null;
    return checkpoint.state as RuntimeState;
  }
}
