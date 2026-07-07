import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventsService } from '../events.service';

function createMockPrisma() {
  return {
    event: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  } as any;
}

function createMockRedis() {
  return {
    publish: vi.fn(),
    subscribe: vi.fn(),
  } as any;
}

describe('EventsService', () => {
  let service: EventsService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let redis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    redis = createMockRedis();
    service = new EventsService(prisma, redis);
  });

  describe('persistEvent', () => {
    it('should persist an event to the database', async () => {
      const workflowId = 'wf-1';
      const event = {
        eventType: 'node.start',
        nodeId: 'node-1',
        payload: { key: 'value' },
        timestamp: '2024-01-01T00:00:00Z',
      };
      const createdEvent = { id: 'event-1', workflowId, ...event, timestamp: new Date(event.timestamp) };

      prisma.event.create.mockResolvedValue(createdEvent);

      const result = await service.persistEvent(workflowId, event);

      expect(prisma.event.create).toHaveBeenCalledWith({
        data: {
          workflowId,
          eventType: event.eventType,
          nodeId: event.nodeId,
          payload: event.payload,
          timestamp: new Date(event.timestamp),
        },
      });
      expect(result).toEqual(createdEvent);
    });
  });

  describe('getWorkflowEvents', () => {
    it('should return events for a workflow ordered by timestamp', async () => {
      const workflowId = 'wf-1';
      const events = [
        { id: 'event-1', workflowId, eventType: 'node.start', timestamp: new Date('2024-01-01') },
        { id: 'event-2', workflowId, eventType: 'node.end', timestamp: new Date('2024-01-02') },
      ];

      prisma.event.findMany.mockResolvedValue(events);

      const result = await service.getWorkflowEvents(workflowId);

      expect(prisma.event.findMany).toHaveBeenCalledWith({
        where: { workflowId },
        orderBy: { timestamp: 'asc' },
      });
      expect(result).toEqual(events);
    });

    it('should return empty array when no events exist', async () => {
      prisma.event.findMany.mockResolvedValue([]);

      const result = await service.getWorkflowEvents('wf-nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('publishEvent', () => {
    it('should persist event and publish to Redis', async () => {
      const workflowId = 'wf-1';
      const event = {
        eventType: 'node.start',
        nodeId: 'node-1',
        payload: { key: 'value' },
        timestamp: '2024-01-01T00:00:00Z',
      };
      const createdEvent = { id: 'event-1', workflowId, ...event, timestamp: new Date(event.timestamp) };

      prisma.event.create.mockResolvedValue(createdEvent);
      redis.publish.mockResolvedValue(1);

      const result = await service.publishEvent(workflowId, event);

      expect(prisma.event.create).toHaveBeenCalledWith({
        data: {
          workflowId,
          eventType: event.eventType,
          nodeId: event.nodeId,
          payload: event.payload,
          timestamp: new Date(event.timestamp),
        },
      });
      expect(redis.publish).toHaveBeenCalledWith(
        `sse:${workflowId}`,
        JSON.stringify(event),
      );
      expect(result).toEqual(event);
    });
  });

  describe('subscribeToWorkflow', () => {
    it('should subscribe to Redis channel for workflow events', async () => {
      const workflowId = 'wf-1';
      const callback = vi.fn();
      const mockSubscriber = { unsubscribe: vi.fn() };

      redis.subscribe.mockResolvedValue(mockSubscriber);

      const result = await service.subscribeToWorkflow(workflowId, callback);

      expect(redis.subscribe).toHaveBeenCalledWith(
        `sse:${workflowId}`,
        expect.any(Function),
      );
      expect(result).toEqual(mockSubscriber);
    });

    it('should parse JSON message and call callback', async () => {
      const workflowId = 'wf-1';
      let subscribedCallback: (message: string) => void;
      const callback = vi.fn();

      redis.subscribe.mockImplementation(async (_channel: string, cb: (message: string) => void) => {
        subscribedCallback = cb;
        return { unsubscribe: vi.fn() };
      });

      await service.subscribeToWorkflow(workflowId, callback);

      const testEvent = { eventType: 'node.start', nodeId: 'node-1' };
      subscribedCallback!(JSON.stringify(testEvent));

      expect(callback).toHaveBeenCalledWith(testEvent);
    });
  });
});
