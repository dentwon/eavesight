import { Body, Controller, Delete, Get, Param, Post, Query, Req, Sse, UseGuards, MessageEvent } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Observable, fromEvent, mergeMap, EMPTY, of } from 'rxjs';
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
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AlertsController {
  constructor(
    private readonly alertsService: AlertsService,
    private readonly emitter: EventEmitter2,
  ) {}

  @Get('active')
  @ApiOperation({ summary: 'Active alerts for this org (one-shot poll)' })
  async getActive(@Req() req: any, @Query('limit') limit?: string) {
    const n = Math.max(1, Math.min(1000, Number(limit) || 500));
    return this.alertsService.getActiveAlertsForOrg(req.user.orgId, n);
  }

  /**
   * SSE stream. Server-side filters every batch through alertsService —
   * a connection only sees property events that match a lead or territory
   * for this user's org. Clients NEVER see other tenants' alerts.
   */
  @Sse('stream')
  @ApiOperation({ summary: 'Live SSE stream of storm alerts for this org' })
  stream(@Req() req: any): Observable<MessageEvent> {
    const orgId: string | null = req.user?.orgId ?? null;
    return fromEvent(this.emitter, 'property.alert.batch').pipe(
      mergeMap(async (payload: any) => {
        if (!orgId) return null;
        const filtered = await this.alertsService.filterBatchForOrg(orgId, payload?.properties || []);
        if (!filtered.length) return null;
        return {
          id: `${payload.stormEventId ?? 'live'}-${payload.startedAt?.valueOf?.() ?? Date.now()}`,
          type: 'property.alert',
          data: JSON.stringify({
            orgId,
            alertType: payload.alertType,
            alertSource: payload.alertSource,
            severity: payload.severity,
            startedAt: payload.startedAt,
            expiresAt: payload.expiresAt,
            stormEventId: payload.stormEventId,
            properties: filtered,
          }),
        } as MessageEvent;
      }),
      mergeMap((ev) => (ev ? of(ev) : EMPTY)),
    );
  }

  @Post('properties/:id/earmark')
  @ApiOperation({ summary: 'Flag a property for post-storm inspection' })
  earmark(@Req() req: any, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.alertsService.setEarmark(
      id,
      req.user.id || req.user.userId,
      req.user.orgId,
      body?.reason ?? null,
    );
  }

  @Delete('properties/:id/earmark')
  @ApiOperation({ summary: 'Unflag a property — only the same org may unflag' })
  unmark(@Req() req: any, @Param('id') id: string) {
    return this.alertsService.clearEarmark(id, req.user.id || req.user.userId, req.user.orgId);
  }

  @Get('earmarks')
  @ApiOperation({ summary: 'My earmarked properties' })
  myEarmarks(@Req() req: any, @Query('limit') limit?: string) {
    const n = Math.max(1, Math.min(500, Number(limit) || 100));
    return this.alertsService.listEarmarks(req.user.id || req.user.userId, n);
  }
}
