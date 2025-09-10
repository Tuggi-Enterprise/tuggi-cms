'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function TestWikimediaExtraction() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Sample data from the user's POI
  const sampleData = {
    attractionId: 'e179587f-97b7-44db-ad39-a5b43658444c',
    attractionName: 'Monumento à Mãe Preta',
    wikimediaUrl: 'https://commons.wikimedia.org/wiki/Category:Mãe Preta by Júlio Guerra (bronze, 1955)',
    osmTags: {
      name: 'Monumento à Mãe Preta',
      historic: 'memorial',
      wikidata: 'Q45052140',
      wikimedia_commons: 'Category:Mãe Preta by Júlio Guerra (bronze, 1955)'
    }
  };

  const [formData, setFormData] = useState(sampleData);

  const handleTest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/test-wikimedia-extraction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to extract image');
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleDebug = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/debug-wikimedia', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      setResult({
        success: true,
        data: data,
        message: 'Debug completed'
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadSample = () => {
    setFormData(sampleData);
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Wikimedia Commons Image Extraction Test</h1>
          <p className="text-muted-foreground mt-2">
            Test the modified store-poi-images edge function with Wikimedia Commons images
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Test Configuration</CardTitle>
            <CardDescription>
              Configure the test parameters or use the sample data from "Monumento à Mãe Preta"
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button onClick={handleLoadSample} variant="outline">
                Load Sample Data
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="attractionId">Attraction ID</Label>
                <Input
                  id="attractionId"
                  value={formData.attractionId}
                  onChange={(e) => setFormData({ ...formData, attractionId: e.target.value })}
                  placeholder="e179587f-97b7-44db-ad39-a5b43658444c"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="attractionName">Attraction Name</Label>
                <Input
                  id="attractionName"
                  value={formData.attractionName}
                  onChange={(e) => setFormData({ ...formData, attractionName: e.target.value })}
                  placeholder="Monumento à Mãe Preta"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="wikimediaUrl">Wikimedia Commons URL</Label>
              <Input
                id="wikimediaUrl"
                value={formData.wikimediaUrl}
                onChange={(e) => setFormData({ ...formData, wikimediaUrl: e.target.value })}
                placeholder="https://commons.wikimedia.org/wiki/Category:..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="osmTags">OSM Tags (JSON)</Label>
              <Textarea
                id="osmTags"
                value={JSON.stringify(formData.osmTags, null, 2)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    setFormData({ ...formData, osmTags: parsed });
                  } catch {
                    // Invalid JSON, don't update
                  }
                }}
                rows={6}
                placeholder='{"name": "...", "wikimedia_commons": "..."}'
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleDebug} disabled={loading} variant="outline" className="flex-1">
                {loading ? 'Debugging...' : 'Debug Request'}
              </Button>
              <Button onClick={handleTest} disabled={loading} className="flex-1">
                {loading ? 'Testing...' : 'Test Wikimedia Image Extraction'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <div className="text-red-600 font-medium">❌ Error</div>
              <div className="text-red-700 mt-1">{error}</div>
            </CardContent>
          </Card>
        )}

        {result && (
          <Card>
            <CardHeader>
              <CardTitle>Test Results</CardTitle>
              <CardDescription>
                {result.success ? '✅ Success!' : '❌ Failed'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-2">Response Data:</h4>
                  <pre className="bg-muted p-4 rounded-md overflow-auto text-sm">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>

                {result.data?.images && result.data.images.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2">Extracted Image:</h4>
                    <div className="space-y-2">
                      <p><strong>Image ID:</strong> {result.data.images[0].id}</p>
                      <p><strong>Public URL:</strong> 
                        <a 
                          href={result.data.images[0].url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline ml-2"
                        >
                          {result.data.images[0].url}
                        </a>
                      </p>
                      <p><strong>Storage Path:</strong> {result.data.images[0].storage_path}</p>
                    </div>
                    
                    <div className="mt-4">
                      <img 
                        src={result.data.images[0].url} 
                        alt="Extracted image"
                        className="max-w-full h-auto rounded-md border"
                        style={{ maxHeight: '400px' }}
                      />
                    </div>
                  </div>
                )}

                {result.data?.errors && result.data.errors.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2 text-red-600">Errors:</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {result.data.errors.map((error: string, index: number) => (
                        <li key={index} className="text-red-600">{error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>How it works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2">1. Wikimedia Commons API</h4>
              <p className="text-sm text-muted-foreground">
                The system uses the Wikimedia Commons API to extract images from categories or direct file URLs.
              </p>
            </div>
            
            <div>
              <h4 className="font-semibold mb-2">2. Image Selection</h4>
              <p className="text-sm text-muted-foreground">
                For categories, it selects the first available image. For direct file URLs, it processes the specific file.
              </p>
            </div>
            
            <div>
              <h4 className="font-semibold mb-2">3. Download & Storage</h4>
              <p className="text-sm text-muted-foreground">
                Downloads the image in high resolution (1600px width) and stores it in the Supabase Storage bucket.
              </p>
            </div>
            
            <div>
              <h4 className="font-semibold mb-2">4. Database Update</h4>
              <p className="text-sm text-muted-foreground">
                Creates a record in the attraction_image table and updates the attraction's primary image URL.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
