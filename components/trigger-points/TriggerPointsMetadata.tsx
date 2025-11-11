'use client'

interface Boundary {
  coordinates: Array<{lat: number, lng: number}>
  classification?: {
    group?: string
    strategy?: string
    reasoning?: string
  }
}

interface Metadata {
  boundarySource?: string
  boundaryConfidence?: number
  streetCount?: number
  searchRadius?: number
  optimalPointsFound?: number
  streetValidatedCandidates?: number
  validatedPoints?: number
  finalPoints?: number
  elevationAnalysis?: {
    poiElevation?: number
    baseElevation?: number
    elevationDiff?: number
    isHighVisibility?: boolean
  } | null
  fallbackUsed?: boolean
}

interface TriggerPointsMetadataProps {
  metadata: Metadata | null
  boundary: Boundary | null
}

export function TriggerPointsMetadata({
  metadata,
  boundary
}: TriggerPointsMetadataProps) {
  if (!metadata) return null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
        Análise de Raio de Busca
      </h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Raio de Busca */}
        <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
          <h3 className="font-semibold text-purple-800 dark:text-purple-200 mb-2">
            Raio Calculado
          </h3>
          <div className="text-2xl font-bold text-purple-600">
            {metadata.searchRadius ? `${metadata.searchRadius}m` : 'N/A'}
          </div>
          <div className="text-sm text-purple-700 dark:text-purple-300 mt-1">
            {metadata.searchRadius && metadata.searchRadius > 2000 ? 'Landmark de Alta Elevação' : 
             metadata.searchRadius && metadata.searchRadius > 1000 ? 'POI Elevado' : 
             'POI Padrão'}
          </div>
        </div>

        {/* Informações do Boundary */}
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-2">
            Boundary
          </h3>
          <div className="text-lg font-bold text-blue-600">
            {metadata.boundarySource || 'N/A'}
          </div>
          {metadata.boundaryConfidence !== undefined && (
            <div className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              Confiança: {(metadata.boundaryConfidence * 100).toFixed(1)}%
            </div>
          )}
          {metadata.streetCount !== undefined && (
            <div className="text-sm text-blue-700 dark:text-blue-300">
              {metadata.streetCount} ruas encontradas
            </div>
          )}
          {/* Classificação do POI */}
          {boundary?.classification?.group && (
            <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-700">
              <div className="text-xs font-semibold text-blue-600 uppercase">
                {boundary.classification.group === 'high' && '🏔️ HIGH'}
                {boundary.classification.group === 'medium' && '🏗️ MEDIUM'}
                {boundary.classification.group === 'canyon' && '🏙️ CANYON'}
                {boundary.classification.group === 'flat' && '🏞️ FLAT'}
              </div>
              {boundary.classification.strategy && (
                <div className="text-xs text-blue-600 mt-1">
                  Estratégia: {boundary.classification.strategy}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Análise de Elevação */}
      {metadata.elevationAnalysis && (
        <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
          <h3 className="font-semibold text-green-800 dark:text-green-200 mb-3">
            Análise de Elevação
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-lg font-bold text-green-600">
                {metadata.elevationAnalysis.poiElevation != null 
                  ? `${metadata.elevationAnalysis.poiElevation.toFixed(0)}m`
                  : 'N/A'}
              </div>
              <div className="text-sm text-green-700 dark:text-green-300">POI</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-green-600">
                {metadata.elevationAnalysis.baseElevation != null
                  ? `${metadata.elevationAnalysis.baseElevation.toFixed(0)}m`
                  : 'N/A'}
              </div>
              <div className="text-sm text-green-700 dark:text-green-300">Base Regional</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-green-600">
                {metadata.elevationAnalysis.elevationDiff != null
                  ? `+${metadata.elevationAnalysis.elevationDiff.toFixed(0)}m`
                  : 'N/A'}
              </div>
              <div className="text-sm text-green-700 dark:text-green-300">Diferença</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${metadata.elevationAnalysis.isHighVisibility ? 'text-orange-600' : 'text-green-600'}`}>
                {metadata.elevationAnalysis.isHighVisibility ? 'ALTA' : 'Normal'}
              </div>
              <div className="text-sm text-green-700 dark:text-green-300">Visibilidade</div>
            </div>
          </div>
        </div>
      )}

      {/* Processamento de Pontos */}
      {(metadata.optimalPointsFound !== undefined || metadata.streetValidatedCandidates !== undefined) && (
        <div className="mt-4 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
          <h3 className="font-semibold text-indigo-800 dark:text-indigo-200 mb-3">
            Processamento de Pontos
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {metadata.optimalPointsFound !== undefined && (
              <div className="text-center">
                <div className="text-lg font-bold text-indigo-600">
                  {metadata.optimalPointsFound}
                </div>
                <div className="text-sm text-indigo-700 dark:text-indigo-300">Ótimos Encontrados</div>
              </div>
            )}
            {metadata.streetValidatedCandidates !== undefined && (
              <div className="text-center">
                <div className="text-lg font-bold text-indigo-600">
                  {metadata.streetValidatedCandidates}
                </div>
                <div className="text-sm text-indigo-700 dark:text-indigo-300">Validados em Ruas</div>
              </div>
            )}
            {metadata.validatedPoints !== undefined && (
              <div className="text-center">
                <div className="text-lg font-bold text-indigo-600">
                  {metadata.validatedPoints}
                </div>
                <div className="text-sm text-indigo-700 dark:text-indigo-300">Validados</div>
              </div>
            )}
            {metadata.finalPoints !== undefined && (
              <div className="text-center">
                <div className="text-lg font-bold text-indigo-600">
                  {metadata.finalPoints}
                </div>
                <div className="text-sm text-indigo-700 dark:text-indigo-300">Finais</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

