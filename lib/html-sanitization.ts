/**
 * HTML sanitization — the only place in the Next app that pulls DOMPurify.
 *
 * `isomorphic-dompurify` loads `jsdom` on the server: 535 traced files that end
 * up inside the serverless bundle of every route that can reach this module,
 * statically, at module-evaluation time. On 2026-08-05 that took
 * GET /api/admin/clients down in production with a 500 HTML page (the handler
 * never ran, so not even the 401 path answered) while `next dev` and a local
 * `next build && next start` were both green — the failure only shows up in the
 * traced serverless bundle.
 *
 * Hence the boundary: `lib/input-validation.ts` holds the schemas that only need
 * zod and must stay reachable from any route; sanitizing user-authored HTML
 * lives here, apart. If a route handler ever needs one of these, import it
 * dynamically inside the handler (`await import('@/lib/html-sanitization')`) so
 * jsdom stays out of the module-evaluation path.
 *
 * `tests/api/route-module-graph.test.ts` enforces the boundary.
 */

import { z } from 'zod'
import DOMPurify from 'isomorphic-dompurify'
import { schemas } from './input-validation'

/** Schemas that strip markup from free text. They require a DOM. */
export const sanitizingSchemas = {
  // Basic string validation with XSS protection
  safeString: z.string().min(1).max(1000).transform((val: string) => {
    return DOMPurify.sanitize(val, { ALLOWED_TAGS: [] })
  }),

  // Audio generation validation
  audioText: z.string().min(1).max(4000).transform((val: string) => {
    // Remove potentially harmful characters but keep basic punctuation
    return DOMPurify.sanitize(val, { ALLOWED_TAGS: [] })
      .replace(/[<>"']/g, '') // Remove quotes and angle brackets
      .trim()
  }),

  // Description generation validation
  poiName: z.string().min(1).max(200).transform((val: string) => {
    return DOMPurify.sanitize(val, { ALLOWED_TAGS: [] }).trim()
  }),

  cityName: z.string().min(1).max(100).transform((val: string) => {
    return DOMPurify.sanitize(val, { ALLOWED_TAGS: [] }).trim()
  }),

  countryName: z.string().min(1).max(100).transform((val: string) => {
    return DOMPurify.sanitize(val, { ALLOWED_TAGS: [] }).trim()
  }),
}

export function sanitizeHtml(html: string, allowedTags: string[] = []): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: allowedTags })
}

// Common validation schemas for API routes. They mix sanitizing and plain
// schemas, so they live on the sanitizing side of the boundary.
export const apiSchemas = {
  // Places API validation
  placesNearby: {
    location: z.string().regex(/^-?\d+\.\d+,-?\d+\.\d+$/).optional(),
    radius: schemas.radius,
    type: z.string().max(50).optional(),
    keyword: sanitizingSchemas.safeString.optional(),
    language: schemas.languageCode
  },

  placeDetails: {
    place_id: schemas.placeId,
    fields: z.string().max(500).optional(),
    language: schemas.languageCode
  },

  // Audio generation validation
  audioGenerate: {
    text: sanitizingSchemas.audioText,
    voice: schemas.audioVoice,
    speed: schemas.audioSpeed,
    language: schemas.languageCode
  },

  // Description generation validation
  descriptionGenerate: {
    name: sanitizingSchemas.poiName,
    city: sanitizingSchemas.cityName,
    country: sanitizingSchemas.countryName,
    language: schemas.languageCode
  }
}
