import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../entry/workflow.js', () => ({
  createWorkflow: vi.fn(() => ({
    run: vi.fn().mockResolvedValue({ data: { test: 'result' } }),
  })),
}));

import { NotFoundException } from '@nestjs/common';
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
  } as any;
}

function createMockEventsService() {
  return {
    publishEvent: vi.fn(),
    getWorkflowEvents: vi.fn(),
    subscribeToWorkflow: vi.fn(),
  } as any;
}

describe('WorkflowsService', () => {
  let service: WorkflowsService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let eventsService: ReturnType<typeof createMockEventsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    eventsService = createMockEventsService();
    service = new WorkflowsService(prisma, eventsService);
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
    it('should return accepted status for route decision', async () => {
      const result = await service.routeDecision('wf-1', 'node-1');

      expect(result).toEqual({
        workflowId: 'wf-1',
        nodeId: 'node-1',
        status: 'accepted',
      });
    });

    it('should handle different workflow and node ids', async () => {
      const result = await service.routeDecision('wf-abc', 'requirement_parsing');

      expect(result).toEqual({
        workflowId: 'wf-abc',
        nodeId: 'requirement_parsing',
        status: 'accepted',
      });
    });
  });
});
