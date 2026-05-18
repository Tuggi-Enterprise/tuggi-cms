/**
 * Logger configurável pra trigger-points generation.
 *
 * Por que: o motor emite centenas de log lines por POI (rays, candidates,
 * filtros, dedups). Em batch 10k POIs × 10 workers concurrent, isso vira
 * 100M+ linhas. Em produção, queremos só errors e métricas resumidas.
 *
 * Uso:
 *   import { TPLogger } from '../utils/logger';
 *   TPLogger.info('Generated X TPs');
 *   TPLogger.debug('Candidate detail...');
 *
 * Configuração via env: TP_LOG_LEVEL=silent|error|warn|info|debug
 *  - default `info` em dev, `error` recomendado em prod
 *
 * Migração: incremental. Novos console.* → TPLogger. Não bloqueio até
 * substituir todos os ~500 console.log existentes.
 */

type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

function resolveLevel(): LogLevel {
  const raw = (process.env.TP_LOG_LEVEL || '').toLowerCase().trim();
  if (raw === 'silent' || raw === 'error' || raw === 'warn' || raw === 'info' || raw === 'debug') {
    return raw as LogLevel;
  }
  return 'info'; // default
}

// Resolve uma vez no module load. Pra dev hot-reload pegar mudança, restart.
const ACTIVE_LEVEL = resolveLevel();
const ACTIVE_RANK = LEVEL_RANK[ACTIVE_LEVEL];

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] <= ACTIVE_RANK;
}

export const TPLogger = {
  /**
   * Erros que precisam atenção (sempre logados a menos que silent).
   */
  error(...args: any[]): void {
    if (shouldLog('error')) console.error(...args);
  },

  /**
   * Avisos sobre situações inesperadas mas não-bloqueantes.
   */
  warn(...args: any[]): void {
    if (shouldLog('warn')) console.warn(...args);
  },

  /**
   * Marcos importantes do pipeline (POI iniciado, X candidatos gerados,
   * fan colapsou, etc). Nível default em dev.
   */
  info(...args: any[]): void {
    if (shouldLog('info')) console.log(...args);
  },

  /**
   * Detalhes verbose (ray-cast por direção, candidato individual, etc).
   * Em prod (TP_LOG_LEVEL=error), nunca aparece.
   */
  debug(...args: any[]): void {
    if (shouldLog('debug')) console.log(...args);
  },

  /**
   * Nível ativo (pra introspecção/testes).
   */
  getLevel(): LogLevel {
    return ACTIVE_LEVEL;
  },
};
