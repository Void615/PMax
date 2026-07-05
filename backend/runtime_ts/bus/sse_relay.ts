import type { EventBus, WorkflowEvent } from "./types.js";

export interface SseConnection {
  write(data: string): void;
  end(): void;
  on(event: "close", handler: () => void): void;
}

export class SSERelay {
  private connections = new Map<string, Set<SseConnection>>();

  constructor(private readonly eventBus: EventBus) {}

  async registerConnection(workflowId: string, conn: SseConnection): Promise<void> {
    if (!this.connections.has(workflowId)) {
      this.connections.set(workflowId, new Set());
      await this.eventBus.subscribe(workflowId, (event: WorkflowEvent) => {
        this.broadcast(workflowId, event);
      });
    }

    this.connections.get(workflowId)!.add(conn);

    conn.write(`data: ${JSON.stringify({ uiHint: "connected", workflowId })}\n\n`);

    conn.on("close", () => {
      const set = this.connections.get(workflowId);
      if (set) {
        set.delete(conn);
        if (set.size === 0) {
          this.connections.delete(workflowId);
          this.eventBus.unsubscribe(workflowId).catch(() => {});
        }
      }
    });
  }

  private broadcast(workflowId: string, event: WorkflowEvent): void {
    const set = this.connections.get(workflowId);
    if (!set) return;
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const conn of set) {
      try {
        conn.write(data);
      } catch {
        set.delete(conn);
      }
    }
  }
}
