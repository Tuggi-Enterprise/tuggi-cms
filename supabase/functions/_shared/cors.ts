// SECURITY NOTE: The CORS configuration below allows all origins (*)
// For production, this should be restricted to specific domains
// Example: 'Access-Control-Allow-Origin': 'https://yourdomain.com'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // TODO: Restrict to specific domains in production
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, accept, origin, referer, user-agent',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
  'Access-Control-Max-Age': '86400',
}