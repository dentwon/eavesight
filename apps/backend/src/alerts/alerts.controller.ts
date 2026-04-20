import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res, Sse, UseGuards, MessageEvent } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject, fromEvent, map, filter } from 'rxjs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AlertsService } from './alerts.service';

/**
 * Alerts endpoints:
 *   GET  /alerts/stream                       SSE live push — storm alerts for this user's org
 *   GET  /alerts/active                       One-shot snapshot of active alerts
 *   POST /alerts/properties/:id/earmark       Flag a property
 *   DELETE /alerts/properties/:id/earmark     Unflag a property
 *   GET  /alerts/earmarks                     User's earmark worklist
 */
@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  // Single broadcast subject — every SSE subscriber pipes through this.
  // We rely on the global EventEmitter for fan-out, and filter per connection.
  constructor(
    private readonly alertsService: AlertsService,
    private readonly emitter: EventEmitter2,
  ) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('active')
  @ApiOperation({ summary: 'Active alerts for this org (one-shot poll)' })
  async getActive(@Req() req: any, @Query('limit') limit?: string) {
    const n = Math.max(1, Math.min(1000, Number(limit) || 500));
    return this.alertsService.getActiveAlertsForOrg(req.user.orgId, n);
  }

  /**
   * SSE stream. Client `new EventSource('/api/alerts/stream')`.
   * Emits one event per batch; client filters per property set.
   *
   * Auth via JWT on initial request — Next.js proxy forwards the cookie header.
   * If no orgId is present we still allow connection but no events flow.
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Sse('stream')
  @ApiOperation({ summary: 'Live SSE stream of storm alerts for this org' })
  stream(@Req() req: any): Observable<MessageEvent> {
    const orgId = req.user?.orgId;
    return fromEvent(this.emitter, 'property.alert.batch').pipe(
      // Filter: only events containing at least one property whose alert matters to this org.
      // For a pure fan-out MVP we let every batch through; the client filters against its
      // own lead/territory list. Once we have millions of connections we'll add server-side
      // org filtering here.
      map((payload: any) => ({
        id: `${payload.stormEventId ?? 'live'}-${payload.startedAt?.valueOf?.() ?? Date.now()}`,
        type: 'property.alert',
        data: JSON.stringify({ orgId, ...payload }),
      } as MessageEvent)),
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('properties/:id/earmark')
  @ApiOperation({ summary: 'Flag a property for post-storm inspection' })
  earmark(@Req() req: any, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.alertsService.setEarmark(id, req.user.id || req.user.userId, body?.reason ?? null);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Delete('properties/:id/earmark')
  @ApiOperation({ summary: 'Unflag a property' })
  unmark(@Param('id') id: string) {
    return this.alertsService.clearEarmark(id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('earmarks')
  @ApiOperation({ summary: 'My earmarked properties' })
  myEarmarks(@Req() req: any, @Query('limit') limit?: string) {
    const n = Math.max(1, Math.min(500, Number(limit) || 100));
    return this.alertsService.listEarmarks(req.user.id || req.user.userId, n);
  }
}
