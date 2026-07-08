import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../entry/workflow.js', () => ({
  createRegistry: vi.fn(() => ({
    get: vi.fn(() => ({ outputHints: [] })),
    register: vi.fn(),
  })),
}));

import { NotFoundException, ConflictException } from '@nestjs/common';
import { WorkflowsService } from '../workflows.service';

function createMockPrisma() {
  return {
    workflow: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    artifact: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    event: {
      findMany: vi.fn(),
    },
  } as any;
}

function createMockEventsService() {
  return {
    publishEvent: vi.fn(),
    getWorkflowEvents: vi.fn(),
    subscribeToWorkflow: vi.fn(),
  } as any;
}

function createMockRedisService() {
  return {
    publish: vi.fn(),
    subscribe: vi.fn(),
  } as any;
}

describe('WorkflowsService', () => {
  let service: WorkflowsService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let eventsService: ReturnType<typeof createMockEventsService>;
  let redis: ReturnType<typeof createMockRedisService>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    eventsService = createMockEventsService();
    redis = createMockRedisService();
    // Mock getWorkflowEvents for executeWorkflow
    eventsService.getWorkflowEvents.mockResolvedValue([]);
    service = new WorkflowsService(prisma, eventsService, redis);
  });

  describe('createWorkflow', () => {
    it('should create a workflow and return it', async () => {
      const userId = 'user-1';
      const input = '对比微博和知乎的会员功能';
      const createdWorkflow = {
        id: 'wf-1',
        userId,
        name: input.substring(0, 50),
        input: { requirement: input },
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prisma.workflow.create.mockResolvedValue(createdWorkflow);
      prisma.workflow.update.mockResolvedValue({});

      const result = await service.createWorkflow(userId, input);

      expect(prisma.workflow.create).toHaveBeenCalledWith({
        data: {
          userId,
          name: input.substring(0, 50),
          input: { requirement: input },
        },
      });
      expect(result).toEqual(createdWorkflow);
    });

    it('should truncate long input to 50 chars for workflow name', async () => {
      const longInput = 'a'.repeat(100);
      const createdWorkflow = {
        id: 'wf-1',
        userId: 'user-1',
        name: 'a'.repeat(50),
        input: { requirement: longInput },
      };

      prisma.workflow.create.mockResolvedValue(createdWorkflow);

      await service.createWorkflow('user-1', longInput);

      expect(prisma.workflow.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          name: longInput.substring(0, 50),
          input: { requirement: longInput },
        },
      });
    });
  });

  describe('getWorkflow', () => {
    it('should return a workflow with events and artifacts', async () => {
      const workflow = {
        id: 'wf-1',
        userId: 'user-1',
        name: 'Test Workflow',
        status: 'completed',
        events: [{ id: 'e-1', eventType: 'node.start' }],
        artifacts: [{ id: 'a-1', type: 'analysis_result' }],
      };

      prisma.workflow.findUnique.mockResolvedValue(workflow);

      const result = await service.getWorkflow('wf-1');

      expect(prisma.workflow.findUnique).toHaveBeenCalledWith({
        where: { id: 'wf-1' },
        include: { events: true, artifacts: true },
      });
      expect(result).toEqual(workflow);
    });

    it('should throw NotFoundException when workflow not found', async () => {
      prisma.workflow.findUnique.mockResolvedValue(null);

      await expect(service.getWorkflow('nonexistent')).rejects.toThrow(NotFoundException);
      await expect(service.getWorkflow('nonexistent')).rejects.toThrow('工作流不存在');
    });
  });

  describe('getWorkflowHistory', () => {
    it('should return events from events service', async () => {
      const events = [
        { id: 'e-1', eventType: 'node.start', nodeId: 'requirement_parsing' },
        { id: 'e-2', eventType: 'node.end', nodeId: 'requirement_parsing' },
      ];

      eventsService.getWorkflowEvents.mockResolvedValue(events);

      const result = await service.getWorkflowHistory('wf-1');

      expect(eventsService.getWorkflowEvents).toHaveBeenCalledWith('wf-1');
      expect(result).toEqual(events);
    });

    it('should return empty array when no history', async () => {
      eventsService.getWorkflowEvents.mockResolvedValue([]);

      const result = await service.getWorkflowHistory('wf-nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('getWorkflowArtifacts', () => {
    it('should return artifacts ordered by createdAt desc', async () => {
      const artifacts = [
        { id: 'a-2', workflowId: 'wf-1', type: 'summary', createdAt: new Date('2024-01-02') },
        { id: 'a-1', workflowId: 'wf-1', type: 'analysis_result', createdAt: new Date('2024-01-01') },
      ];

      prisma.artifact.findMany.mockResolvedValue(artifacts);

      const result = await service.getWorkflowArtifacts('wf-1');

      expect(prisma.artifact.findMany).toHaveBeenCalledWith({
        where: { workflowId: 'wf-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(artifacts);
    });

    it('should return empty array when no artifacts', async () => {
      prisma.artifact.findMany.mockResolvedValue([]);

      const result = await service.getWorkflowArtifacts('wf-empty');

      expect(result).toEqual([]);
    });
  });

  describe('routeDecision', () => {
    it('should accept a continue decision and publish to redis', async () => {
      const workflow = { id: 'wf-1', status: 'paused' };
      prisma.workflow.findUnique.mockResolvedValue(workflow);
      prisma.workflow.update.mockResolvedValue({});
      eventsService.publishEvent.mockResolvedValue({});
      redis.publish.mockResolvedValue(undefined);

      const result = await service.routeDecision('wf-1', 'node-1', 'continue');

      expect(result).toEqual({
        workflowId: 'wf-1',
        targetNode: 'node-1',
        action: 'continue',
        status: 'accepted',
      });
      expect(redis.publish).toHaveBeenCalledWith(
        'workflow:wf-1:decision',
        JSON.stringify({ targetNode: 'node-1', action: 'continue' }),
      );
    });

    it('should accept a backjump decision', async () => {
      const workflow = { id: 'wf-abc', status: 'paused' };
      prisma.workflow.findUnique.mockResolvedValue(workflow);
      prisma.workflow.update.mockResolvedValue({});
      eventsService.publishEvent.mockResolvedValue({});
      redis.publish.mockResolvedValue(undefined);

      const result = await service.routeDecision('wf-abc', 'requirement_parsing', 'backjump');

      expect(result).toEqual({
        workflowId: 'wf-abc',
        targetNode: 'requirement_parsing',
        action: 'backjump',
        status: 'accepted',
      });
    });

    it('should throw NotFoundException when workflow not found', async () => {
      prisma.workflow.findUnique.mockResolvedValue(null);

      await expect(service.routeDecision('nonexistent', 'node-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when workflow is not paused', async () => {
      const workflow = { id: 'wf-1', status: 'running' };
      prisma.workflow.findUnique.mockResolvedValue(workflow);

      await expect(service.routeDecision('wf-1', 'node-1')).rejects.toThrow(ConflictException);
      await expect(service.routeDecision('wf-1', 'node-1')).rejects.toThrow('工作流未处于暂停状态');
    });
  });

  describe('cancelWorkflow', () => {
    it('should cancel a paused workflow', async () => {
      const workflow = { id: 'wf-1', status: 'paused' };
      prisma.workflow.findUnique.mockResolvedValue(workflow);
      prisma.workflow.update.mockResolvedValue({});
      eventsService.publishEvent.mockResolvedValue({});

      const result = await service.cancelWorkflow('wf-1');

      expect(result).toEqual({ workflowId: 'wf-1', status: 'cancelled' });
    });

    it('should throw ConflictException when workflow already terminated', async () => {
      const workflow = { id: 'wf-1', status: 'completed' };
      prisma.workflow.findUnique.mockResolvedValue(workflow);

      await expect(service.cancelWorkflow('wf-1')).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when workflow not found', async () => {
      prisma.workflow.findUnique.mockResolvedValue(null);

      await expect(service.cancelWorkflow('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
