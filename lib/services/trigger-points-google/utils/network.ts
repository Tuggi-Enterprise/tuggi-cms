/**
 * Network utilities for safe API calls
 */

export async function safeFetchJSON<T>(url: string, options?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const text = await response.text();
      console.warn(`⚠️ API call failed [${response.status}]: ${url.substring(0, 100)}...`);
      // console.debug(`Response body: ${text.substring(0, 200)}...`);
      return null;
    }
    
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.warn(`⚠️ Expected JSON but received ${contentType} for ${url.substring(0, 100)}...`);
      // console.debug(`Response body snippet: ${text.substring(0, 200)}...`);
      return null;
    }
    
    try {
      return await response.json() as T;
    } catch (parseError) {
      console.warn(`⚠️ Failed to parse JSON response from ${url.substring(0, 100)}...`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Network error calling ${url.substring(0, 100)}...:`, error);
    return null;
  }
}
