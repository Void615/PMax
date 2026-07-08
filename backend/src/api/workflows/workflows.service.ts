import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { EventsService } from '../events/events.service';
import { GraphRuntime, CapabilityRegistry } from '../../../runtime/index.js';
import { createRegistry } from '../../../entry/workflow.js';

@Injectable()
export class WorkflowsService {
  private registry: CapabilityRegistry;

  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
  ) {
    this.registry = new CapabilityRegistry();
  }

  async createWorkflow(userId: string, input: string) {
    const workflow = await this.prisma.workflow.create({
      data: {
        userId,
        name: input.substring(0, 50),
        input: { requirement: input },
      },
    });

    // 异步执行工作流
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

  async routeDecision(workflowId: string, nodeId: string) {
    // TODO: 实现路由决策逻辑
    return { workflowId, nodeId, status: 'accepted' };
  }

  private async executeWorkflow(workflowId: string, input: string) {
    try {
      // 更新状态为运行中
      await this.prisma.workflow.update({
        where: { id: workflowId },
        data: { status: 'running' },
      });

      // 创建 EventBus 包装器，桥接到 EventsService
      const eventBus = {
        publish: async (event: any) => {
          await this.eventsService.publishEvent(workflowId, event);
        },
        subscribe: async () => {},
        unsubscribe: async () => {},
      };

      // 创建 LLM 客户端（占位）
      const llmClient = {
        complete: async (prompt: string) => 'LLM response placeholder',
      };

      // 创建 Registry 和 GraphRuntime
      const registry = createRegistry(llmClient);
      const runtime = new GraphRuntime(registry);

      // 执行入口节点
      const state = runtime.initialState({ userInput: input });
      const result = await runtime.executeStep('requirement_parsing', state, {
        traceId: '',
        workflowId,
        runId: state.runtime.runId,
        nodeId: 'requirement_parsing',
        iteration: 0,
        signal: new AbortController().signal,
        llm: {
          complete: llmClient.complete,
          plan: async () => ({ phases: [] }),
          synthesize: async (_state: Record<string, any>, r: any[]) => r,
        },
        emit: async (event: any) => {
          await eventBus.publish(event);
        },
        saveArtifact: async (_draft: any) => '',
      });

      // 保存产物
      await this.prisma.artifact.create({
        data: {
          workflowId,
          type: 'analysis_result',
          content: result.data,
        },
      });

      // 更新状态为完成
      await this.prisma.workflow.update({
        where: { id: workflowId },
        data: { status: 'completed' },
      });
    } catch (error: any) {
      // 更新状态为失败
      await this.prisma.workflow.update({
        where: { id: workflowId },
        data: { status: 'failed' },
      });

      // 发布错误事件
      await this.eventsService.publishEvent(workflowId, {
        eventType: 'workflow_failed',
        nodeId: 'system',
        payload: { error: error.message },
        timestamp: new Date().toISOString(),
      });
    }
  }
}
