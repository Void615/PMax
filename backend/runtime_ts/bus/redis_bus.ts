import type { EventBus, WorkflowEvent } from "./types.js";

interface RedisClient {
  xadd(key: string, id: string, ...args: string[]): Promise<string>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string): Promise<void>;
  on(event: string, handler: (channel: string, message: string) => void): void;
  unsubscribe(channel: string): Promise<void>;
}

export class RedisEventBus implements EventBus {
  private pendingQueue: WorkflowEvent[] = [];
  private connected = false;
  private handlers = new Map<string, Set<(event: WorkflowEvent) => void>>();
  private readonly maxPending = 10_000;

  constructor(private readonly redis: RedisClient) {}

  async connect(): Promise<void> {
    this.connected = true;
    while (this.pendingQueue.length > 0) {
      const event = this.pendingQueue.shift()!;
      await this.publish(event);
    }
  }

  async publish(event: WorkflowEvent, opts?: { persist?: boolean }): Promise<void> {
    if (!this.connected) {
      if (this.pendingQueue.length < this.maxPending) {
        this.pendingQueue.push(event);
      }
      return;
    }

    const data = JSON.stringify(event);
    try {
      if (opts?.persist !== false) {
        const streamKey = `events:${event.workflowId}:${event.runId}`;
        await this.redis.xadd(streamKey, "*", "event", data);
      }
      const channel = `sse:${event.workflowId}`;
      await this.redis.publish(channel, data);
    } catch (err) {
      this.pendingQueue.push(event);
      console.warn("Redis publish failed, queued in memory", err);
    }
  }

  async subscribe(
    workflowId: string,
    handler: (event: WorkflowEvent) => void
  ): Promise<void> {
    const channel = `sse:${workflowId}`;
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
      await this.redis.subscribe(channel);
      this.redis.on("message", (ch, msg) => {
        const handlers = this.handlers.get(ch);
        if (handlers) {
          try {
            const event = JSON.parse(msg) as WorkflowEvent;
            for (const h of handlers) h(event);
          } catch { /* skip malformed messages */ }
        }
      });
    }
    this.handlers.get(channel)!.add(handler);
  }

  async unsubscribe(workflowId: string): Promise<void> {
    const channel = `sse:${workflowId}`;
    this.handlers.delete(channel);
    await this.redis.unsubscribe(channel);
  }
}
