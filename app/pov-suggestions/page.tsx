'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, MapPin, Navigation, Eye, Clock } from 'lucide-react'

interface POVSuggestion {
  id: string
  lat: number
  lng: number
  distance_m: number
  bearing_deg: number
  access_type: 'walk' | 'car' | 'both'
  vantage_type?: string
  confidence_score: number
  reasoning: string
  estimated_visibility: 'poor' | 'fair' | 'good' | 'excellent'
  pattern_based: boolean
  source?: string
  gemini_reasoning?: string
}

export default function POVSuggestionsTestPage() {
  const [formData, setFormData] = useState({
    poi_id: 'test-poi-1',
    poi_name: 'Cristo Redentor',
    poi_lat: -22.9519,
    poi_lng: -43.2105,
    poi_types: 'tourist_attraction,monument',
    limit: 10,
    min_confidence: 70,
    use_gemini: true
  })

  const [suggestions, setSuggestions] = useState<POVSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [apiType, setApiType] = useState<'basic' | 'enhanced'>('enhanced')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuggestions([])

    try {
      const endpoint = apiType === 'enhanced' ? '/api/pov-suggestions/enhanced' : '/api/pov-suggestions'
      
      const payload = {
        ...formData,
        poi_types: formData.poi_types.split(',').map(t => t.trim()).filter(Boolean),
        poi_lat: Number(formData.poi_lat),
        poi_lng: Number(formData.poi_lng),
        limit: Number(formData.limit),
        min_confidence: Number(formData.min_confidence)
      }

      console.log('🚀 Sending request:', payload)

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to generate suggestions')
      }

      // Handle different response formats
      const suggestionsData = result.suggestions || result.data?.suggestions || []
      setSuggestions(suggestionsData)
      console.log('✅ Received suggestions:', suggestionsData)

    } catch (err) {
      console.error('❌ Error:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const getVisibilityColor = (visibility: string) => {
    switch (visibility) {
      case 'excellent': return 'bg-green-100 text-green-800'
      case 'good': return 'bg-blue-100 text-blue-800'
      case 'fair': return 'bg-yellow-100 text-yellow-800'
      case 'poor': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getAccessTypeColor = (accessType: string) => {
    switch (accessType) {
      case 'walk': return 'bg-green-100 text-green-800'
      case 'car': return 'bg-blue-100 text-blue-800'
      case 'both': return 'bg-purple-100 text-purple-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">POV Suggestions Test Page</h1>
        <p className="text-gray-600">Test the POV suggestions API with different parameters and see the results.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <Card>
          <CardHeader>
            <CardTitle>Test Parameters</CardTitle>
            <CardDescription>Configure the POI details and API settings</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="poi_id">POI ID</Label>
                  <Input
                    id="poi_id"
                    value={formData.poi_id}
                    onChange={(e) => setFormData({ ...formData, poi_id: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="api_type">API Type</Label>
                  <Select value={apiType} onValueChange={(value: 'basic' | 'enhanced') => setApiType(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basic">Basic POV API</SelectItem>
                      <SelectItem value="enhanced">Enhanced POV API (with Gemini)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="poi_name">POI Name</Label>
                <Input
                  id="poi_name"
                  value={formData.poi_name}
                  onChange={(e) => setFormData({ ...formData, poi_name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="poi_lat">Latitude</Label>
                  <Input
                    id="poi_lat"
                    type="number"
                    step="0.0001"
                    value={formData.poi_lat}
                    onChange={(e) => setFormData({ ...formData, poi_lat: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label htmlFor="poi_lng">Longitude</Label>
                  <Input
                    id="poi_lng"
                    type="number"
                    step="0.0001"
                    value={formData.poi_lng}
                    onChange={(e) => setFormData({ ...formData, poi_lng: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="poi_types">POI Types (comma-separated)</Label>
                <Input
                  id="poi_types"
                  value={formData.poi_types}
                  onChange={(e) => setFormData({ ...formData, poi_types: e.target.value })}
                  placeholder="tourist_attraction,monument"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="limit">Limit</Label>
                  <Input
                    id="limit"
                    type="number"
                    min="1"
                    max="50"
                    value={formData.limit}
                    onChange={(e) => setFormData({ ...formData, limit: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label htmlFor="min_confidence">Min Confidence (%)</Label>
                  <Input
                    id="min_confidence"
                    type="number"
                    min="0"
                    max="100"
                    value={formData.min_confidence}
                    onChange={(e) => setFormData({ ...formData, min_confidence: Number(e.target.value) })}
                  />
                </div>
              </div>

              {apiType === 'enhanced' && (
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="use_gemini"
                    checked={formData.use_gemini}
                    onChange={(e) => setFormData({ ...formData, use_gemini: e.target.checked })}
                  />
                  <Label htmlFor="use_gemini">Use Gemini AI Enhancement</Label>
                </div>
              )}

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating Suggestions...
                  </>
                ) : (
                  'Generate POV Suggestions'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Results */}
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>
              {suggestions.length > 0 
                ? `Found ${suggestions.length} POV suggestions`
                : 'No suggestions generated yet'
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-red-800 font-medium">Error</p>
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                <span className="ml-2 text-gray-600">Generating suggestions...</span>
              </div>
            )}

            <div className="space-y-4 max-h-96 overflow-y-auto">
              {suggestions.map((suggestion, index) => (
                <div key={suggestion.id || index} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <MapPin className="h-4 w-4 text-blue-500" />
                      <span className="font-medium">Suggestion #{index + 1}</span>
                      {suggestion.source && (
                        <Badge variant="outline" className="text-xs">
                          {suggestion.source}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center space-x-1">
                      <span className="text-lg font-bold text-green-600">
                        {suggestion.confidence_score.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center space-x-2">
                      <Navigation className="h-4 w-4 text-gray-400" />
                      <span>{suggestion.distance_m}m, {suggestion.bearing_deg}°</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Eye className="h-4 w-4 text-gray-400" />
                      <Badge className={getVisibilityColor(suggestion.estimated_visibility)}>
                        {suggestion.estimated_visibility}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Badge className={getAccessTypeColor(suggestion.access_type)}>
                      {suggestion.access_type}
                    </Badge>
                    {suggestion.vantage_type && (
                      <Badge variant="outline">{suggestion.vantage_type}</Badge>
                    )}
                    {suggestion.pattern_based && (
                      <Badge variant="outline">Pattern Based</Badge>
                    )}
                  </div>

                  <div className="text-sm text-gray-600">
                    <p className="font-medium">Reasoning:</p>
                    <p>{suggestion.reasoning}</p>
                    {suggestion.gemini_reasoning && (
                      <>
                        <p className="font-medium mt-2">Gemini Analysis:</p>
                        <p>{suggestion.gemini_reasoning}</p>
                      </>
                    )}
                  </div>

                  <div className="text-xs text-gray-500">
                    Coordinates: {suggestion.lat.toFixed(6)}, {suggestion.lng.toFixed(6)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Test Examples */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Quick Test Examples</CardTitle>
          <CardDescription>Click to load pre-configured test cases</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Button
              variant="outline"
              onClick={() => setFormData({
                poi_id: 'cristo-redentor',
                poi_name: 'Cristo Redentor',
                poi_lat: -22.9519,
                poi_lng: -43.2105,
                poi_types: 'tourist_attraction,monument',
                limit: 8,
                min_confidence: 70,
                use_gemini: true
              })}
            >
              Cristo Redentor (Landmark)
            </Button>
            <Button
              variant="outline"
              onClick={() => setFormData({
                poi_id: 'ibirapuera-park',
                poi_name: 'Parque Ibirapuera',
                poi_lat: -23.5873,
                poi_lng: -46.6572,
                poi_types: 'park,natural_feature',
                limit: 10,
                min_confidence: 60,
                use_gemini: true
              })}
            >
              Parque Ibirapuera (Park)
            </Button>
            <Button
              variant="outline"
              onClick={() => setFormData({
                poi_id: 'copan-building',
                poi_name: 'Edifício Copan',
                poi_lat: -23.5406,
                poi_lng: -46.6436,
                poi_types: 'establishment,point_of_interest',
                limit: 6,
                min_confidence: 75,
                use_gemini: true
              })}
            >
              Edifício Copan (Building)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
