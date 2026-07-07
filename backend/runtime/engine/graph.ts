/**
 * 轻量级 StateGraph 引擎 —— 单节点编译执行（v2 精简版）。
 *
 * 提供：
 *   - StateGraph      图构建器（addNode / addEdge / setEntryPoint）
 *   - CompiledGraph   编译后的可执行图
 *   - END             终止常量
 *   - Checkpointer    检查点持久化接口
 *
 * 废弃能力（v2 移除）：
 *   - addConditionalEdges / Router       由 Orchestrator 替代
 *   - interrupt() / GraphInterrupt       由每节点后暂停替代
 *   - Command / resume                   不再需要恢复
 *   - AsyncLocalStorage                  不再需要中断上下文
 */

import type { Checkpointer } from "./checkpointer.js";

// ── 常量 ────────────────────────────────────────────────────────────────

/** 图终止标记。 */
export const END = "__END__";

// ── 图配置 ──────────────────────────────────────────────────────────────

/** 调用配置。 */
export interface GraphConfig {
  configurable: {
    threadId: string;
  };
  metadata?: Record<string, any>;
}

// ── 节点处理器类型 ──────────────────────────────────────────────────────

export type NodeHandler<T> = (state: T) => Promise<T>;

// ── StateGraph 构建器 ───────────────────────────────────────────────────

/**
 * 声明式图构建器。
 *
 * 用法：
 *   const graph = new StateGraph<MyState>();
 *   graph.addNode("a", handlerA);
 *   graph.addEdge("a", END);
 *   graph.setEntryPoint("a");
 *   const compiled = graph.compile(checkpointer);
 *   const result = await compiled.invoke(initialState, config);
 */
export class StateGraph<T> {
  private nodes = new Map<string, NodeHandler<T>>();
  private edges = new Map<string, string>();
  private entryPointValue?: string;

  addNode(id: string, handler: NodeHandler<T>): this {
    this.nodes.set(id, handler);
    return this;
  }

  addEdge(from: string, to: string): this {
    this.edges.set(from, to);
    return this;
  }

  setEntryPoint(nodeId: string): this {
    this.entryPointValue = nodeId;
    return this;
  }

  compile(checkpointer?: Checkpointer): CompiledGraph<T> {
    if (!this.entryPointValue) {
      throw new Error("Entry point not set");
    }
    return new CompiledGraph<T>(
      new Map(this.nodes),
      new Map(this.edges),
      this.entryPointValue,
      checkpointer
    );
  }
}

// ── CompiledGraph 执行器 ────────────────────────────────────────────────

/**
 * 编译后的可执行图。
 */
export class CompiledGraph<T> {
  constructor(
    private nodes: Map<string, NodeHandler<T>>,
    private edges: Map<string, string>,
    private entryPoint: string,
    private checkpointer?: Checkpointer
  ) {}

  async invoke(input: T, config: GraphConfig): Promise<T> {
    let state = input;
    let currentNode = this.entryPoint;

    while (currentNode !== END) {
      const handler = this.nodes.get(currentNode);
      if (!handler) {
        throw new Error(`Unknown node: ${currentNode}`);
      }

      // 执行前保存检查点
      if (this.checkpointer) {
        await this.checkpointer.save(config.configurable.threadId, {
          state,
          nextNode: currentNode,
        });
      }

      state = await handler(state);

      // 确定下一个节点
      const directEdge = this.edges.get(currentNode);
      currentNode = directEdge ?? END;
    }

    return state;
  }
}
