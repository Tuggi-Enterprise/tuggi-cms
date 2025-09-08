'use client';

import { useState } from 'react';

export default function TestOSMBuildingsPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const testOSMBuildings = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/test-osm-buildings?lat=-23.5466147&lng=-46.6448513&radius=500');
      const data = await response.json();

      if (data.success) {
        setResult(data);
      } else {
        setError(data.error || 'Unknown error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">🔍 OSM Buildings Structure Test</h1>
      
      <div className="mb-6">
        <button
          onClick={testOSMBuildings}
          disabled={loading}
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
        >
          {loading ? 'Testing...' : 'Test OSM Buildings Query'}
        </button>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          {/* Query Info */}
          <div className="bg-gray-100 p-4 rounded">
            <h2 className="text-xl font-bold mb-2">📝 Query Information</h2>
            <p><strong>Location:</strong> {result.query.lat}, {result.query.lng}</p>
            <p><strong>Radius:</strong> {result.query.radius}m</p>
            <p><strong>Total Elements:</strong> {result.analysis.totalElements}</p>
          </div>

          {/* Element Types */}
          <div className="bg-blue-50 p-4 rounded">
            <h2 className="text-xl font-bold mb-2">📊 Element Types</h2>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(result.analysis.elementTypes).map(([type, count]) => (
                <div key={type} className="bg-white p-2 rounded">
                  <strong>{type}:</strong> {count as number}
                </div>
              ))}
            </div>
          </div>

          {/* Coordinate Extraction Methods */}
          <div className="bg-green-50 p-4 rounded">
            <h2 className="text-xl font-bold mb-2">🎯 Coordinate Extraction Methods</h2>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white p-2 rounded">
                <strong>Direct lat/lon:</strong> {result.analysis.coordinateExtraction.hasLatLon}
              </div>
              <div className="bg-white p-2 rounded">
                <strong>Center:</strong> {result.analysis.coordinateExtraction.hasCenter}
              </div>
              <div className="bg-white p-2 rounded">
                <strong>Nodes:</strong> {result.analysis.coordinateExtraction.hasNodes}
              </div>
              <div className="bg-white p-2 rounded">
                <strong>Geometry:</strong> {result.analysis.coordinateExtraction.hasGeometry}
              </div>
            </div>
          </div>

          {/* Sample Structures */}
          <div className="bg-yellow-50 p-4 rounded">
            <h2 className="text-xl font-bold mb-2">🏗️ Sample Building Structures</h2>
            {result.analysis.sampleStructures.map((building: any) => (
              <div key={building.index} className="bg-white p-3 rounded mb-3">
                <h3 className="font-bold">Building {building.index}</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><strong>Type:</strong> {building.type}</div>
                  <div><strong>ID:</strong> {building.id}</div>
                  <div><strong>Has lat/lon:</strong> {building.hasLat ? '✅' : '❌'}</div>
                  <div><strong>Has center:</strong> {building.hasCenter ? '✅' : '❌'}</div>
                  <div><strong>Has nodes:</strong> {building.hasNodes ? `✅ (${building.nodesCount})` : '❌'}</div>
                  <div><strong>Has geometry:</strong> {building.hasGeometry ? `✅ (${building.geometryCount})` : '❌'}</div>
                </div>
                {building.tags && (
                  <div className="mt-2">
                    <strong>Tags:</strong>
                    <pre className="text-xs bg-gray-100 p-2 rounded mt-1 overflow-auto">
                      {JSON.stringify(building.tags, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Coordinate Tests */}
          <div className="bg-purple-50 p-4 rounded">
            <h2 className="text-xl font-bold mb-2">🧪 Coordinate Extraction Tests</h2>
            {result.coordinateTests.map((test: any) => (
              <div key={test.buildingIndex} className="bg-white p-3 rounded mb-3">
                <h3 className="font-bold">Building {test.buildingIndex} ({test.type})</h3>
                <div className="space-y-2">
                  {Object.entries(test.extractionMethods).map(([method, coords]: [string, any]) => (
                    <div key={method} className="text-sm">
                      <strong>{method}:</strong> {
                        coords ? 
                          `✅ (${coords.lat?.toFixed(6)}, ${coords.lon?.toFixed(6)})` : 
                          '❌'
                      }
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Raw Data */}
          <details className="bg-gray-50 p-4 rounded">
            <summary className="cursor-pointer font-bold">🔍 Raw Data (Click to expand)</summary>
            <pre className="mt-2 text-xs bg-white p-2 rounded overflow-auto max-h-96">
              {JSON.stringify(result.rawData, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
