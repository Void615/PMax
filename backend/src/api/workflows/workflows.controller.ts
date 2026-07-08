import { Controller, Get, Post, Body, Param, Sse } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { EventsService } from '../events/events.service';
import { Observable } from 'rxjs';

@Controller('api/workflows')
export class WorkflowsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly eventsService: EventsService,
  ) {}

  @Post()
  create(@CurrentUser() user: any, @Body() body: { input: string }) {
    return this.workflowsService.createWorkflow(user.id, body.input);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workflowsService.getWorkflow(id);
  }

  @Sse(':id/stream')
  streamEvents(@Param('id') id: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      this.eventsService.subscribeToWorkflow(id, (event) => {
        subscriber.next({ data: event } as MessageEvent);
      });
    });
  }

  @Post(':id/route')
  routeDecision(
    @Param('id') id: string,
    @Body() body: { targetNode: string; action?: "continue" | "backjump" }
  ) {
    return this.workflowsService.routeDecision(id, body.targetNode, body.action ?? "continue");
  }

  @Post(':id/cancel')
  cancelWorkflow(@Param('id') id: string) {
    return this.workflowsService.cancelWorkflow(id);
  }

  @Get(':id/history')
  getHistory(@Param('id') id: string) {
    return this.workflowsService.getWorkflowHistory(id);
  }

  @Get(':id/artifacts')
  getArtifacts(@Param('id') id: string) {
    return this.workflowsService.getWorkflowArtifacts(id);
  }
}
