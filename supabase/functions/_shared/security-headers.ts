/**
 * Security Headers Configuration
 * Provides comprehensive security headers for all API responses
 * Protects against: XSS, clickjacking, MIME sniffing, and more
 */

/**
 * Standard security headers for all API responses
 * Implements OWASP security best practices
 */
export const securityHeaders = {
  // Prevent MIME type sniffing
  'X-Content-Type-Options': 'nosniff',
  
  // Prevent clickjacking attacks
  'X-Frame-Options': 'DENY',
  
  // Enable XSS protection in older browsers
  'X-XSS-Protection': '1; mode=block',
  
  // Strict Transport Security (HSTS) - 1 year
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  
  // Referrer Policy - don't send referrer to third parties
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  
  // Content Security Policy - restrict resource loading
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '),
  
  // Permissions Policy (formerly Feature Policy)
  'Permissions-Policy': [
    'accelerometer=()',
    'camera=()',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'payment=()',
    'usb=()'
  ].join(', ')
};

/**
 * Create response headers combining CORS and security headers
 * @param corsHeaders - CORS headers from the function
 * @returns Combined headers object with both CORS and security headers
 */
export function createSecureHeaders(corsHeaders: Record<string, string>): Record<string, string> {
  return {
    ...corsHeaders,
    ...securityHeaders,
    'Content-Type': 'application/json'
  };
}

/**
 * Create response headers for file downloads (images, audio)
 * More permissive CSP for media resources
 * @param corsHeaders - CORS headers from the function
 * @returns Combined headers object optimized for file responses
 */
export function createSecureMediaHeaders(corsHeaders: Record<string, string>): Record<string, string> {
  return {
    ...corsHeaders,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Relaxed CSP for media downloads
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; frame-ancestors 'none'",
    'Permissions-Policy': [
      'accelerometer=()',
      'camera=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'usb=()'
    ].join(', ')
  };
}

/**
 * Ensure response includes security headers
 * Use this to wrap any Response object to add security headers
 * @param response - Original response
 * @param corsHeaders - CORS headers to merge with security headers
 * @returns New Response with security headers added
 */
export function withSecurityHeaders(
  response: Response,
  corsHeaders: Record<string, string>
): Response {
  const secureHeaders = createSecureHeaders(corsHeaders);
  
  // Create new response with merged headers
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers({
      ...Object.fromEntries(response.headers.entries()),
      ...secureHeaders
    })
  });
}

/**
 * Log security header configuration on startup
 */
export function logSecurityHeaders(): void {
  console.log('🔒 Security Headers Configuration:');
  console.log('  ✅ X-Content-Type-Options: nosniff (prevent MIME sniffing)');
  console.log('  ✅ X-Frame-Options: DENY (prevent clickjacking)');
  console.log('  ✅ X-XSS-Protection: enabled (XSS protection)');
  console.log('  ✅ Strict-Transport-Security: enabled (HSTS 1 year)');
  console.log('  ✅ Referrer-Policy: strict-origin-when-cross-origin');
  console.log('  ✅ Content-Security-Policy: configured');
  console.log('  ✅ Permissions-Policy: restricted');
}
