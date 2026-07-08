import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';

@Injectable()
export class EventsService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async persistEvent(workflowId: string, event: any) {
    return this.prisma.event.create({
      data: {
        workflowId,
        eventType: event.eventType,
        nodeId: event.nodeId,
        payload: event.payload,
        timestamp: new Date(event.timestamp),
      },
    });
  }

  async getWorkflowEvents(workflowId: string) {
    return this.prisma.event.findMany({
      where: { workflowId },
      orderBy: { timestamp: 'asc' },
    });
  }

  async publishEvent(workflowId: string, event: any) {
    await this.persistEvent(workflowId, event);

    await this.redis.publish(`sse:${workflowId}`, JSON.stringify(event));

    return event;
  }

  async subscribeToWorkflow(workflowId: string, callback: (event: any) => void) {
    return this.redis.subscribe(`sse:${workflowId}`, (message) => {
      callback(JSON.parse(message));
    });
  }
}
