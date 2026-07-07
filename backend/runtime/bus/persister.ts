import type { WorkflowEvent } from "./types.js";

interface RedisClient {
  xreadgroup(
    group: string,
    consumer: string,
    keys: string[],
    ids: string[],
    options?: { COUNT?: number; BLOCK?: number }
  ): Promise<Array<[string, Array<[string, string[]]>]> | null>;
  xack(key: string, group: string, ...ids: string[]): Promise<number>;
}

interface DbPersister {
  insertEvents(events: WorkflowEvent[]): Promise<void>;
}

export class EventPersister {
  private running = false;
  private consumerName: string;

  constructor(
    private readonly redis: RedisClient,
    private readonly db: DbPersister,
    private readonly groupName: string = "event-persisters",
    private readonly batchSize: number = 10,
    private readonly blockMs: number = 5000
  ) {
    this.consumerName = `consumer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      try {
        const streams = await this.redis.xreadgroup(
          this.groupName,
          this.consumerName,
          ["events:>"],
          [">"],
          { COUNT: this.batchSize, BLOCK: this.blockMs }
        );

        if (!streams) continue;

        for (const [streamKey, messages] of streams) {
          const events: WorkflowEvent[] = [];
          const ids: string[] = [];

          for (const [id, fields] of messages) {
            const eventIdx = fields.indexOf("event");
            if (eventIdx >= 0) {
              const eventStr = fields[eventIdx + 1];
              if (eventStr) {
                try {
                  events.push(JSON.parse(eventStr));
                  ids.push(id);
                } catch { /* skip malformed events */ }
              }
            }
          }

          if (events.length > 0) {
            await this.db.insertEvents(events);
            for (const id of ids) {
              await this.redis.xack(streamKey, this.groupName, id);
            }
          }
        }
      } catch (err) {
        console.error("EventPersister loop error", err);
        await this.sleep(1000);
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
