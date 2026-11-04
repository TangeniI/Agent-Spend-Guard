import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ServiceTokenGuard } from '../auth/service-token.guard.js';
import { RunsService } from './runs.service.js';

@Controller('runs')
@UseGuards(ServiceTokenGuard)
export class RunsController {
  constructor(@Inject(RunsService) private readonly runs: RunsService) {}

  @Post()
  @HttpCode(202)
  start(@Body() body: { mandateId?: unknown; task?: unknown } | undefined) {
    return this.runs.start(body);
  }

  @Get()
  list(@Query('mandateId') mandateId: string | undefined) {
    return this.runs.list(mandateId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.runs.get(id);
  }
}
