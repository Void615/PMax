import type { WorkflowEvent } from "../bus/types.js";

export interface TraceNode {
  event: WorkflowEvent;
  children: TraceNode[];
}

export interface TraceStore {
  saveTree(runId: string, tree: TraceNode): Promise<void>;
}

export class TraceCollector {
  constructor(private readonly store: TraceStore) {}

  /** 将扁平事件列表重组为树形链路 */
  buildTree(events: WorkflowEvent[]): TraceNode[] {
    const roots: TraceNode[] = [];
    const map = new Map<string, TraceNode>();

    for (const event of events) {
      const node: TraceNode = { event, children: [] };
      map.set(event.traceId, node);
    }

    for (const event of events) {
      const node = map.get(event.traceId);
      if (!node) continue;

      if (event.parentTraceId && map.has(event.parentTraceId)) {
        map.get(event.parentTraceId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async collect(runId: string, events: WorkflowEvent[]): Promise<void> {
    const tree = this.buildTree(events);
    const root = tree.length > 0 ? tree[0] : null;
    if (root) {
      await this.store.saveTree(runId, root);
    }
  }
}
