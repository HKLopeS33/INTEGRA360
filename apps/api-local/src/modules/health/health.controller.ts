import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  show() {
    return {
      status: 'ok',
      service: 'api-local',
      timestamp: new Date().toISOString()
    };
  }
}
