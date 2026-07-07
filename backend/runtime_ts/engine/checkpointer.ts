/**
 * 检查点持久化接口。
 * 由调用方提供具体实现（Postgres / Redis / 内存等）。
 */

export interface Checkpoint<T = any> {
  /** 快照时的状态 */
  state: T;
  /** 下一个待执行节点 id */
  nextNode: string;
}

export interface Checkpointer<T = any> {
  save(threadId: string, checkpoint: Checkpoint<T>): Promise<void>;
  load(threadId: string): Promise<Checkpoint<T> | null>;
}
