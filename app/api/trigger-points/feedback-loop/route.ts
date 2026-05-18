/**
 * POST /api/trigger-points/feedback-loop
 *
 * Roda o feedback loop manual ou via cron: lê `core.trigger_point_health`,
 * marca TPs com back_rate alto como `manual_status='review'`.
 *
 * Body (opcional): { dryRun?: boolean, reviewThreshold?: number, minEvents?: number }
 *
 * Requer auth admin ou key de cron.
 */

import { NextRequest, NextResponse } from 'next/server';
import { FeedbackLoopService } from '@/lib/services/trigger-points-google/services/feedback-loop-service';

export async function POST(req: NextRequest) {
  try {
    // Auth simples por header de cron secret (alternativa: middleware de admin auth)
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const headerSecret = req.headers.get('x-cron-secret');
      if (headerSecret !== cronSecret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const body = await req.json().catch(() => ({}));
    const result = await FeedbackLoopService.run({
      dryRun: body.dryRun === true,
      reviewThreshold: typeof body.reviewThreshold === 'number' ? body.reviewThreshold : undefined,
      minEvents: typeof body.minEvents === 'number' ? body.minEvents : undefined,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('feedback-loop error:', error);
    return NextResponse.json(
      { error: error?.message || 'feedback loop failed' },
      { status: 500 }
    );
  }
}
