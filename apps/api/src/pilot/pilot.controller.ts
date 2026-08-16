import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../identity/auth.guard';
import { AuthenticatedRequest } from '../identity/auth.types';
import { PilotService } from './pilot.service';

@Controller('api/v1/pilots')
@UseGuards(AuthGuard)
export class PilotController {
  constructor(private readonly pilots: PilotService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) { return this.pilots.list(request.auth!.userId); }

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.pilots.create(request.auth!.userId, body);
  }

  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.pilots.get(request.auth!.userId, id);
  }

  @Get(':id/readiness')
  readiness(@Req() request: AuthenticatedRequest, @Param('id') id: string) { return this.pilots.readinessView(request.auth!.userId, id); }

  @Get(':id/participants')
  participants(@Req() request: AuthenticatedRequest, @Param('id') id: string) { return this.pilots.participants(request.auth!.userId, id); }

  @Post(':id/participants/:userId')
  addParticipant(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Param('userId') userId: string) { return this.pilots.addParticipant(request.auth!.userId, id, userId); }

  @Post(':id/participants/:userId/remove')
  removeParticipant(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Param('userId') userId: string) { return this.pilots.removeParticipant(request.auth!.userId, id, userId); }

  @Patch(':id')
  update(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.pilots.update(request.auth!.userId, id, body);
  }

  @Get(':id/health')
  health(@Req() request: AuthenticatedRequest, @Param('id') id: string) { return this.pilots.health(request.auth!.userId, id); }

  @Get(':id/issues')
  issues(@Req() request: AuthenticatedRequest, @Param('id') id: string) { return this.pilots.issues(request.auth!.userId, id); }

  @Post(':id/ready')
  ready(@Req() request: AuthenticatedRequest, @Param('id') id: string) { return this.pilots.transition(request.auth!.userId, id, 'READY'); }

  @Post(':id/activate')
  activate(@Req() request: AuthenticatedRequest, @Param('id') id: string) { return this.pilots.transition(request.auth!.userId, id, 'ACTIVE'); }

  @Post(':id/complete')
  complete(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.pilots.transition(request.auth!.userId, id, 'COMPLETED', body);
  }
}
