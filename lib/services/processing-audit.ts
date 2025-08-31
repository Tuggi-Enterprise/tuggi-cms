export interface ProcessingStep {
  step: number;
  name: string;
  status: 'success' | 'failed' | 'fallback' | 'skipped';
  duration_ms: number;
  data_sources?: string[];
  errors?: string[];
  metadata?: Record<string, any>;
}

export interface ProcessingAudit {
  poi_id: string;
  poi_name: string;
  started_at: string;
  completed_at?: string;
  total_duration_ms?: number;
  final_status: 'success' | 'partial_success' | 'failed';
  steps: ProcessingStep[];
  data_quality_score?: number;
  trigger_points_generated: number;
  trigger_points_approved: number;
}

export class ProcessingAuditService {
  private static audits: Map<string, ProcessingAudit> = new Map();

  /**
   * Inicia auditoria para um POI
   */
  static startAudit(poiId: string, poiName: string): void {
    const audit: ProcessingAudit = {
      poi_id: poiId,
      poi_name: poiName,
      started_at: new Date().toISOString(),
      final_status: 'success',
      steps: [],
      trigger_points_generated: 0,
      trigger_points_approved: 0
    };

    this.audits.set(poiId, audit);
    console.log(`🔍 Started audit for POI: ${poiName} (${poiId})`);
  }

  /**
   * Registra um passo do processamento
   */
  static logStep(
    poiId: string,
    stepNumber: number,
    stepName: string,
    status: ProcessingStep['status'],
    duration: number,
    options?: {
      dataSources?: string[];
      errors?: string[];
      metadata?: Record<string, any>;
    }
  ): void {
    const audit = this.audits.get(poiId);
    if (!audit) return;

    const step: ProcessingStep = {
      step: stepNumber,
      name: stepName,
      status,
      duration_ms: duration,
      data_sources: options?.dataSources,
      errors: options?.errors,
      metadata: options?.metadata
    };

    audit.steps.push(step);

    // Atualizar status final se houver falha
    if (status === 'failed') {
      audit.final_status = 'failed';
    } else if (status === 'fallback' && audit.final_status === 'success') {
      audit.final_status = 'partial_success';
    }

    console.log(`📝 Step ${stepNumber} (${stepName}): ${status} (${duration}ms)`);
  }

  /**
   * Finaliza auditoria
   */
  static completeAudit(
    poiId: string,
    options?: {
      dataQualityScore?: number;
      triggerPointsGenerated?: number;
      triggerPointsApproved?: number;
    }
  ): ProcessingAudit | null {
    const audit = this.audits.get(poiId);
    if (!audit) return null;

    audit.completed_at = new Date().toISOString();
    audit.total_duration_ms = new Date(audit.completed_at).getTime() - new Date(audit.started_at).getTime();
    
    if (options?.dataQualityScore) audit.data_quality_score = options.dataQualityScore;
    if (options?.triggerPointsGenerated) audit.trigger_points_generated = options.triggerPointsGenerated;
    if (options?.triggerPointsApproved) audit.trigger_points_approved = options.triggerPointsApproved;

    console.log(`✅ Completed audit for POI: ${audit.poi_name}`);
    console.log(`   - Status: ${audit.final_status}`);
    console.log(`   - Duration: ${audit.total_duration_ms}ms`);
    console.log(`   - Steps: ${audit.steps.length}`);
    console.log(`   - Quality: ${audit.data_quality_score || 'N/A'}%`);
    console.log(`   - TPs: ${audit.trigger_points_generated} generated, ${audit.trigger_points_approved} approved`);

    // Salvar no banco de dados (opcional)
    this.saveAuditToDB(audit);

    return audit;
  }

  /**
   * Obtém auditoria em andamento
   */
  static getAudit(poiId: string): ProcessingAudit | null {
    return this.audits.get(poiId) || null;
  }

  /**
   * Gera relatório de auditoria
   */
  static generateReport(poiId: string): string {
    const audit = this.audits.get(poiId);
    if (!audit) return 'Audit not found';

    let report = `\n📋 PROCESSING AUDIT REPORT\n`;
    report += `POI: ${audit.poi_name} (${audit.poi_id})\n`;
    report += `Started: ${new Date(audit.started_at).toLocaleString()}\n`;
    if (audit.completed_at) {
      report += `Completed: ${new Date(audit.completed_at).toLocaleString()}\n`;
      report += `Duration: ${audit.total_duration_ms}ms\n`;
    }
    report += `Status: ${audit.final_status}\n`;
    if (audit.data_quality_score) {
      report += `Quality Score: ${audit.data_quality_score}%\n`;
    }
    report += `Trigger Points: ${audit.trigger_points_generated} generated, ${audit.trigger_points_approved} approved\n\n`;

    report += `PROCESSING STEPS:\n`;
    audit.steps.forEach(step => {
      report += `${step.step}. ${step.name}: ${step.status} (${step.duration_ms}ms)\n`;
      if (step.data_sources?.length) {
        report += `   Sources: ${step.data_sources.join(', ')}\n`;
      }
      if (step.errors?.length) {
        report += `   Errors: ${step.errors.join('; ')}\n`;
      }
    });

    return report;
  }

  /**
   * Salva auditoria no banco de dados
   */
  private static async saveAuditToDB(audit: ProcessingAudit): Promise<void> {
    try {
      // Implementar salvamento no Supabase se necessário
      console.log(`💾 Audit saved for ${audit.poi_id}`);
    } catch (error) {
      console.error('❌ Error saving audit:', error);
    }
  }

  /**
   * Limpa auditorias antigas
   */
  static cleanup(): void {
    this.audits.clear();
    console.log('🧹 Audit cache cleared');
  }
}
