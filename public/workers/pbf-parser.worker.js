/**
 * PBF Parser Web Worker
 * 
 * Handles PBF parsing in background thread
 * Uses server-side conversion for now
 */

self.onmessage = function(e) {
  const { file } = e.data

  try {
    console.log('🔄 [PBF-WORKER] Starting PBF parsing:', { name: file.name, size: file.size })

    // For now, we'll use server-side conversion
    // This maintains compatibility while we implement native PBF parsing
    convertPBFViaServer(file)
      .then(geojson => {
        const features = geojson.features || []
        const totalFeatures = features.length
        const chunkSize = 1000
        let processed = 0

        console.log('✅ [PBF-WORKER] PBF converted to GeoJSON:', { totalFeatures })

        // Process features in chunks
        for (let i = 0; i < features.length; i += chunkSize) {
          const chunk = features.slice(i, i + chunkSize)
          processed += chunk.length

          // Send progress update
          self.postMessage({
            type: 'progress',
            data: {
              progress: (processed / totalFeatures) * 100,
              processed,
              total: totalFeatures
            }
          })

          // Send chunk
          self.postMessage({
            type: 'chunk',
            data: {
              features: chunk,
              index: Math.floor(i / chunkSize)
            }
          })

          // Allow other tasks to run
          setTimeout(() => {}, 0)
        }

        // Send completion
        self.postMessage({
          type: 'complete',
          data: {
            features,
            totalFeatures
          }
        })

      })
      .catch(error => {
        console.error('❌ [PBF-WORKER] PBF conversion failed:', error)
        self.postMessage({
          type: 'error',
          data: {
            error: error.message || 'PBF conversion failed'
          }
        })
      })

  } catch (error) {
    console.error('❌ [PBF-WORKER] PBF parsing error:', error)
    self.postMessage({
      type: 'error',
      data: {
        error: error.message || 'PBF parsing failed'
      }
    })
  }
}

/**
 * Convert PBF to GeoJSON via server
 */
async function convertPBFViaServer(file) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch('/api/osm-importer/convert-pbf', {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    throw new Error(`Server conversion failed: ${response.statusText}`)
  }

  const result = await response.json()

  if (!result.success) {
    throw new Error(result.error || 'Server conversion failed')
  }

  return result.geojson
}
