/**
 * GeoJSON Parser Web Worker
 * 
 * Handles large GeoJSON parsing in background thread
 */

self.onmessage = function(e) {
  const { file } = e.data

  try {
    // Parse file in chunks
    const reader = new FileReader()
    
    reader.onload = function(event) {
      try {
        const text = event.target.result
        const geojson = JSON.parse(text)

        if (geojson.type !== 'FeatureCollection') {
          throw new Error('Invalid GeoJSON: must be FeatureCollection')
        }

        const features = geojson.features
        const chunkSize = 1000
        let processed = 0

        // Process features in chunks
        for (let i = 0; i < features.length; i += chunkSize) {
          const chunk = features.slice(i, i + chunkSize)
          processed += chunk.length

          // Send progress update
          self.postMessage({
            type: 'progress',
            data: {
              progress: (processed / features.length) * 100,
              processed,
              total: features.length
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
            totalFeatures: features.length
          }
        })

      } catch (error) {
        self.postMessage({
          type: 'error',
          data: {
            error: error.message
          }
        })
      }
    }

    reader.onerror = function() {
      self.postMessage({
        type: 'error',
        data: {
          error: 'Failed to read file'
        }
      })
    }

    reader.readAsText(file)

  } catch (error) {
    self.postMessage({
      type: 'error',
      data: {
        error: error.message
      }
    })
  }
}
