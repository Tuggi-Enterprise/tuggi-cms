/**
 * Feedback Loop Service (issue 2.5)
 *
 * Lê a view `core.trigger_point_health` e marca como `manual_status='review'`
 * os TPs com back_rate acima do threshold. Pensado para rodar como job semanal.
 *
 * Premissa: o app loga eventos em `core.trigger_point_events`. TPs com muito
 * `DIRECTION_BACK` provavelmente estão mal posicionados (bearing errado,
 * mão errada de via one-way, etc.) — sinalizar para revisão humana.
 */

import { getSupabaseService } from '@/lib/core/supabase-client';

export interface FeedbackLoopOptions {
  /** back_rate acima do qual o TP é marcado para review (default 0.4) */
  reviewThreshold?: number;
  /** Mínimo de eventos agregados para considerar o TP (default 10) */
  minEvents?: number;
  /** dry-run: não escreve, apenas reporta */
  dryRun?: boolean;
}

export interface FeedbackLoopResult {
  totalEvaluated: number;
  flaggedForReview: number;
  flaggedIds: string[];
  details: Array<{
    trigger_point_id: string;
    attraction_id: string;
    back_rate: number;
    direction_back_count: number;
    triggers_fired: number;
  }>;
}

export class FeedbackLoopService {
  static async run(options: FeedbackLoopOptions = {}): Promise<FeedbackLoopResult> {
    const reviewThreshold = options.reviewThreshold ?? 0.4;
    const minEvents = options.minEvents ?? 10;
    const dryRun = options.dryRun ?? false;

    const supabase = getSupabaseService();

    // 1. Buscar todos os TPs com saúde calculada
    const { data: healthRows, error } = await supabase
      .schema('core')
      .from('trigger_point_health')
      .select('trigger_point_id, attraction_id, back_rate, direction_back_count, triggers_fired')
      .not('back_rate', 'is', null);

    if (error) {
      console.error('❌ FeedbackLoop: error fetching trigger_point_health:', error);
      throw error;
    }

    const rows = (healthRows || []) as Array<{
      trigger_point_id: string;
      attraction_id: string;
      back_rate: number;
      direction_back_count: number;
      triggers_fired: number;
    }>;

    // 2. Filtrar candidatos: back_rate acima do threshold E sample size mínimo
    const flagged = rows.filter(r => {
      const totalEvents = r.direction_back_count + r.triggers_fired;
      return totalEvents >= minEvents && r.back_rate > reviewThreshold;
    });

    console.log(
      `🔁 FeedbackLoop: ${rows.length} TPs avaliados, ${flagged.length} flagados ` +
      `(back_rate > ${reviewThreshold}, min ${minEvents} eventos)`
    );

    // 3. Atualizar manual_status='review' nos flagados
    if (!dryRun && flagged.length > 0) {
      const ids = flagged.map(f => f.trigger_point_id);
      const { error: updErr } = await supabase
        .schema('core')
        .from('attraction_trigger_points')
        .update({
          manual_status: 'review',
          validation_notes: `Auto-flagged by feedback loop: back_rate > ${reviewThreshold}`,
        })
        .in('id', ids);

      if (updErr) {
        console.error('❌ FeedbackLoop: error updating manual_status:', updErr);
        throw updErr;
      }
      console.log(`✅ FeedbackLoop: marked ${ids.length} TP(s) as review`);
    } else if (dryRun) {
      console.log(`🧪 FeedbackLoop (dry-run): would flag ${flagged.length} TP(s)`);
    }

    return {
      totalEvaluated: rows.length,
      flaggedForReview: flagged.length,
      flaggedIds: flagged.map(f => f.trigger_point_id),
      details: flagged,
    };
  }
}
