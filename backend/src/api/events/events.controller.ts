import { Controller, Get, Param, Sse } from '@nestjs/common';
import { EventsService } from './events.service';
import { Observable } from 'rxjs';

@Controller('api/events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get(':workflowId')
  getWorkflowEvents(@Param('workflowId') workflowId: string) {
    return this.eventsService.getWorkflowEvents(workflowId);
  }

  @Sse(':workflowId/stream')
  streamWorkflowEvents(@Param('workflowId') workflowId: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      this.eventsService.subscribeToWorkflow(workflowId, (event) => {
        subscriber.next({ data: event } as MessageEvent);
      });
    });
  }
}
