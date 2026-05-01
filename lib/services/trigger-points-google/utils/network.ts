/**
 * Network utilities for safe API calls
 */

export async function safeFetchJSON<T>(url: string, options?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Accept': 'application/json',
        ...options?.headers,
      }
    });
    
    const text = await response.text();
    
    if (!response.ok) {
      console.warn(`⚠️ API call failed [${response.status}]: ${url.substring(0, 100)}...`);
      return null;
    }
    
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('application/json') && !text.trim().startsWith('{') && !text.trim().startsWith('[')) {
      console.warn(`⚠️ Expected JSON but received ${contentType} for ${url.substring(0, 100)}...`);
      return null;
    }
    
    try {
      return JSON.parse(text) as T;
    } catch (parseError) {
      console.warn(`⚠️ Failed to parse JSON response from ${url.substring(0, 100)}...`);
      if (text.trim().startsWith('<')) {
        console.warn('   -> Response appears to be HTML/XML');
      }
      return null;
    }
  } catch (error) {
    console.error(`❌ Network error calling ${url.substring(0, 100)}...:`, error);
    return null;
  }
}
