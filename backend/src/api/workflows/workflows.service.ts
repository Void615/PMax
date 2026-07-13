import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { EventsService } from '../events/events.service';
import { RedisService } from '../../infra/redis/redis.service';
import { createRegistry } from '../../../entry/workflow.js';
import { runWorkflow } from '../../../src/workflow/runner.js';
import type { RunnerDeps } from '../../../src/workflow/runner.js';
import type { WorkflowLifecycleEvent, HumanDecision, HumanClarification } from '../../../src/workflow/events.js';

@Injectable()
export class WorkflowsService {
  private abortControllers = new Map<string, AbortController>();

  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
    private redis: RedisService,
  ) {}

  async createWorkflow(userId: string, input: string) {
    const workflow = await this.prisma.workflow.create({
      data: {
        userId,
        name: input.substring(0, 50),
        input: { requirement: input },
      },
    });

    this.executeWorkflow(workflow.id, input).catch(console.error);

    return workflow;
  }

  async getWorkflow(id: string) {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id },
      include: { events: true, artifacts: true },
    });

    if (!workflow) {
      throw new NotFoundException('工作流不存在');
    }

    return workflow;
  }

  async getWorkflowHistory(id: string) {
    return this.eventsService.getWorkflowEvents(id);
  }

  async getWorkflowArtifacts(id: string) {
    return this.prisma.artifact.findMany({
      where: { workflowId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async routeDecision(workflowId: string, targetNode: string, action: "continue" | "backjump" = "continue") {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
    });
    if (!workflow) {
      throw new NotFoundException('工作流不存在');
    }
    if (workflow.status !== 'paused') {
      throw new ConflictException('工作流未处于暂停状态');
    }

    const eventType = action === "backjump" ? "human.backjumped" : "human.continued";
    await this.eventsService.publishEvent(workflowId, {
      eventType,
      nodeId: targetNode,
      payload: { targetNode, action },
      timestamp: new Date().toISOString(),
    });

    await this.prisma.workflow.update({
      where: { id: workflowId },
      data: { status: "running", pausedAt: null, currentNode: targetNode },
    });

    const decision: HumanDecision = { targetNode, action };
    await this.redis.publish(
      `workflow:${workflowId}:decision`,
      JSON.stringify(decision)
    );

    return { workflowId, targetNode, action, status: "accepted" };
  }

  async cancelWorkflow(workflowId: string) {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
    });
    if (!workflow) {
      throw new NotFoundException('工作流不存在');
    }
    if (workflow.status === 'completed' || workflow.status === 'failed' || workflow.status === 'cancelled') {
      throw new ConflictException('工作流已终止');
    }

    const controller = this.abortControllers.get(workflowId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(workflowId);
    }

    await this.eventsService.publishEvent(workflowId, {
      eventType: "workflow.cancelled",
      nodeId: "system",
      payload: { reason: "user_cancelled" },
      timestamp: new Date().toISOString(),
    });

    await this.prisma.workflow.update({
      where: { id: workflowId },
      data: { status: "cancelled", pausedAt: null },
    });

    return { workflowId, status: "cancelled" };
  }

  private async executeWorkflow(workflowId: string, input: string) {
    const abortController = new AbortController();
    this.abortControllers.set(workflowId, abortController);

    try {
      await this.prisma.workflow.update({
        where: { id: workflowId },
        data: { status: 'running' },
      });

      const registry = createRegistry({
        complete: async (prompt: string) => 'LLM response placeholder',
      });

      const eventBus = {
        publish: async (event: any) => {
          await this.eventsService.publishEvent(workflowId, event);
        },
        subscribe: async () => {},
        unsubscribe: async () => {},
      };

      const deps: RunnerDeps = {
        loadEventStream: async (wfId: string) => {
          const events = await this.eventsService.getWorkflowEvents(wfId);
          return events
            .filter((e: any) => e.payload && typeof e.payload === 'object' && 'type' in e.payload)
            .map((e: any) => e.payload as WorkflowLifecycleEvent);
        },
        appendEvent: async (wfId: string, event: WorkflowLifecycleEvent) => {
          await this.eventsService.publishEvent(wfId, {
            eventType: event.type,
            nodeId: "nodeId" in event ? (event as any).nodeId : (event as any).targetNode ?? "system",
            payload: event,
            timestamp: new Date().toISOString(),
          });
        },
        waitForHumanDecision: (wfId: string) => {
          return new Promise<HumanDecision>((resolve) => {
            const channel = `workflow:${wfId}:decision`;
            this.redis.subscribe(channel, (msg: string) => {
              resolve(JSON.parse(msg));
            });
          });
        },
        waitForHumanClarification: (wfId: string) => {
          return new Promise<HumanClarification>((resolve) => {
            const channel = `workflow:${wfId}:clarification`;
            this.redis.subscribe(channel, (msg: string) => {
              resolve(JSON.parse(msg));
            });
          });
        },
        updateWorkflowStatus: async (wfId: string, data) => {
          await this.prisma.workflow.update({
            where: { id: wfId },
            data,
          });
        },
      };

      const ctx = {
        traceId: "",
        workflowId,
        runId: "",
        nodeId: "",
        iteration: 0,
        signal: abortController.signal,
        llm: {
          complete: async (prompt: string) => 'LLM response placeholder',
          plan: async () => ({ phases: [] }),
          synthesize: async (_state: Record<string, any>, r: any[]) => r,
        },
        emit: async (event: any, _opts?: any) => {
          await eventBus.publish({
            traceId: "",
            eventType: event.eventType ?? "EVENT",
            uiHint: event.uiHint,
            nodeId: "",
            workflowId,
            runId: "",
            payload: event.payload ?? {},
            timestamp: new Date().toISOString(),
          } as any);
        },
        saveArtifact: async (_draft: any) => "",
      };

      const gen = runWorkflow(workflowId, input, registry, ctx, eventBus, deps);

      for await (const _ of gen) {
        if (abortController.signal.aborted) break;
      }

      this.abortControllers.delete(workflowId);
    } catch (error: any) {
      await this.prisma.workflow.update({
        where: { id: workflowId },
        data: { status: 'failed' },
      });
      await this.eventsService.publishEvent(workflowId, {
        eventType: 'workflow.failed',
        nodeId: 'system',
        payload: { type: "workflow.failed", error: error.message },
        timestamp: new Date().toISOString(),
      });
      this.abortControllers.delete(workflowId);
    }
  }
}
