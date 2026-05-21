/**
 * Zod Validation Schemas for all Edge Functions
 *
 * Provides typed request body validation with comprehensive error handling
 * Prevents invalid data from reaching business logic (XSS, injection, oversized payloads)
 */

import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

// ============================================
// SHARED VALIDATION RULES
// ============================================

// Common field validators
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGE_CODES = [
  // Short codes
  "en",
  "pt",
  "es",
  "fr",
  "de",
  "it",
  "ja",
  "zh",
  "ko",
  "ar",
  "ru",
  // Full locale codes (used by Tuggi app)
  "en-us",
  "en-gb",
  "pt-br",
  "pt-pt",
  "es-es",
  "es-mx",
  "fr-fr",
  "fr-ca",
  "de-de",
  "de-at",
  "it-it",
  "ja-jp",
  "zh-cn",
  "zh-tw",
  "cmn-cn",
  "ko-kr",
  "ar-sa",
  "ru-ru",
];
const VOICE_GENDERS = ["male", "female"];
const COORDINATE_MIN = -180;
const COORDINATE_MAX = 180;
const LAT_MIN = -90;
const LAT_MAX = 90;

// Common string validators
export const NonEmptyString = z.string()
  .min(1, "Cannot be empty")
  .max(500, "Exceeds maximum length of 500");

export const PoiId = z.string()
  .uuid("Invalid POI ID format")
  .or(z.string().regex(UUID_REGEX, "Invalid UUID format"))
  .or(z.string().min(1).max(100)); // Also allow non-UUID identifiers

export const AttractionId = z.string()
  .min(1, "Attraction ID is required")
  .max(100, "Attraction ID too long");

export const Language = z.enum(LANGUAGE_CODES as [string, ...string[]]);

export const VoiceGender = z.enum(["male", "female"]);

export const Coordinate = z.number()
  .min(COORDINATE_MIN, `Coordinate must be >= ${COORDINATE_MIN}`)
  .max(COORDINATE_MAX, `Coordinate must be <= ${COORDINATE_MAX}`);

export const Latitude = z.number()
  .min(LAT_MIN, `Latitude must be between ${LAT_MIN} and ${LAT_MAX}`)
  .max(LAT_MAX, `Latitude must be between ${LAT_MIN} and ${LAT_MAX}`);

export const LongitudeValue = z.number()
  .min(
    COORDINATE_MIN,
    `Longitude must be between ${COORDINATE_MIN} and ${COORDINATE_MAX}`,
  )
  .max(
    COORDINATE_MAX,
    `Longitude must be between ${COORDINATE_MIN} and ${COORDINATE_MAX}`,
  );

export const LocationObject = z.object({
  lat: Latitude,
  lng: LongitudeValue,
});

// ============================================
// FUNCTION-SPECIFIC SCHEMAS
// ============================================

/**
 * generate-description
 * Supports single POI or batch processing
 */
export const GenerateDescriptionSingleSchema = z.object({
  poi_id: PoiId,
  language: Language,
  gender: VoiceGender.optional(),
  generate_audio: z.boolean().optional(),
  raw_context: z.string().max(5000).optional(), // CMS override
  force: z.boolean().optional(),
});

export const GenerateDescriptionBatchSchema = z.object({
  user_location: LocationObject.optional(),
  language: Language,
  gender: VoiceGender.optional(),
  user_tier: z.string().max(50).optional(),
  requests: z.array(z.object({
    poi_id: PoiId,
    trigger_point_id: z.string().optional(),
    trigger_point: LocationObject.optional(),
    poi_type: z.string().max(50).optional(),
  })).min(1, "At least one request is required"),
  generate_audio: z.boolean().optional(),
});

export const GenerateDescriptionSchema = z.union([
  GenerateDescriptionSingleSchema,
  GenerateDescriptionBatchSchema,
]);

/**
 * generate-trigger-points
 * City-based trigger point generation
 */
export const GenerateTriggerPointsSchema = z.object({
  city: z.string()
    .min(2, "City name too short")
    .max(100, "City name too long"),
  state: z.string()
    .max(50, "State name too long")
    .optional(),
  country: z.string()
    .max(100, "Country name too long")
    .default("Brazil"),
  language: Language.optional(),
  use_osm_data: z.boolean().optional(),
  use_ai_enhancement: z.boolean().optional(),
  confidence_threshold: z.number()
    .min(0, "Confidence threshold must be >= 0")
    .max(1, "Confidence threshold must be <= 1")
    .optional(),
  max_retries: z.number()
    .min(1, "Max retries must be >= 1")
    .max(10, "Max retries must be <= 10")
    .optional(),
});

/**
 * generate-description (alternative single POI)
 */
export const GenerateSingleDescriptionSchema = z.object({
  poi_id: PoiId,
  language: Language,
  gender: VoiceGender.optional(),
});

/**
 * generate-native-narration
 * Native language narration generation
 */
export const GenerateNativeNarrationSchema = z.object({
  poi_id: PoiId,
  language: Language,
  gender: VoiceGender,
  text: z.string()
    .min(10, "Text too short")
    .max(5000, "Text exceeds maximum length of 5000 characters")
    .optional(),
  location: LocationObject.optional(),
});

/**
 * generate-contextual-narration
 * Contextual narration based on user location
 */
export const GenerateContextualNarrationSchema = z.object({
  poi_id: PoiId,
  language: Language,
  user_location: LocationObject.optional(),
  heading: z.number()
    .min(0, "Heading must be between 0 and 360")
    .max(360, "Heading must be between 0 and 360")
    .optional(),
  narrative_type: z.enum(["visual", "auditory", "contextual"]).optional(),
});

/**
 * generate-translated-audio
 * Generate narration in target language — supports POI mode and Route mode.
 *
 * POI mode:   pass attractionId  → translates description → writes to attraction_descriptions
 * Route mode: pass routeId       → translates name + description → writes to custom_route_descriptions
 *
 * Either attractionId OR routeId is required (mutually exclusive).
 */
export const GenerateTranslatedAudioSchema = z.object({
  // ─── POI mode (existing) ────────────────────────────────
  attractionId: AttractionId.optional(),
  originalDescription: z.string().max(5000).optional(),

  // ─── Route mode (new) ───────────────────────────────────
  routeId: AttractionId.optional(),
  originalName: z.string().max(500).optional(),   // route name to translate
  generateAudio: z.boolean().optional(),           // default true; false = text only

  // ─── Common ─────────────────────────────────────────────
  targetLanguage: Language,
  voiceGender: VoiceGender,
}).refine(
  (data) => Boolean(data.attractionId) || Boolean(data.routeId),
  { message: "Either attractionId (POI mode) or routeId (route mode) is required" }
);

/**
 * extract-iphan-images
 * Extract IPHAN heritage images
 */
export const ExtractIphanImagesSchema = z.object({
  attractionId: AttractionId,
  attractionName: z.string()
    .min(1, "Attraction name is required")
    .max(300, "Attraction name too long"),
  searchQuery: z.string()
    .min(1, "Search query is required")
    .max(300, "Search query too long"),
});

/**
 * extract-osm-images
 * Extract OpenStreetMap images
 */
export const ExtractOsmImagesSchema = z.object({
  attractionId: AttractionId,
  attractionName: z.string()
    .min(1, "Attraction name is required")
    .max(300, "Attraction name too long"),
  imageUrl: z.string()
    .url("Invalid image URL")
    .max(2000, "Image URL too long"),
});

/**
 * extract-specialized-images
 * Extract from specialized sources
 */
export const ExtractSpecializedImagesSchema = z.object({
  attractionId: AttractionId,
  attractionName: z.string()
    .min(1, "Attraction name is required")
    .max(300, "Attraction name too long"),
  source: z.enum(["wikipedia", "wikidata", "panoramio", "geograph"]).optional(),
});

/**
 * extract-website-images
 * Extract images from website URLs
 */
export const ExtractWebsiteImagesSchema = z.object({
  attractionId: AttractionId,
  attractionName: z.string()
    .min(1, "Attraction name is required")
    .max(300, "Attraction name too long"),
  websiteUrl: z.string()
    .url("Invalid website URL")
    .max(2000, "Website URL too long"),
});

/**
 * extract-wikidata-images
 * Extract from Wikidata
 */
export const ExtractWikidataImagesSchema = z.object({
  attractionId: AttractionId,
  attractionName: z.string()
    .min(1, "Attraction name is required")
    .max(300, "Attraction name too long"),
  wikidataId: z.string()
    .min(1, "Wikidata ID is required")
    .max(50, "Wikidata ID too long")
    .optional(),
});

/**
 * extract-wikipedia-images
 * Extract from Wikipedia
 */
export const ExtractWikipediaImagesSchema = z.object({
  attractionId: AttractionId,
  attractionName: z.string()
    .min(1, "Attraction name is required")
    .max(300, "Attraction name too long"),
  language: Language.optional(),
});

/**
 * store-poi-audio
 * Store generated audio for POI
 */
export const StorePoiAudioSchema = z.object({
  poi_id: PoiId,
  language: Language,
  gender: VoiceGender,
  audio_url: z.string()
    .url("Invalid audio URL")
    .max(2000, "Audio URL too long"),
  audio_duration_seconds: z.number()
    .min(1, "Duration must be > 0")
    .max(3600, "Duration must be < 1 hour")
    .optional(),
  narration_type: z.enum(["native", "translated", "contextual"]).optional(),
});

/**
 * store-poi-images
 * Store images for POI
 */
export const StorePoiImagesSchema = z.object({
  poi_id: PoiId,
  images: z.array(z.object({
    url: z.string()
      .url("Invalid image URL")
      .max(2000, "Image URL too long"),
    source: z.string().max(100).optional(),
    alt_text: z.string().max(300).optional(),
  })).min(1, "At least one image is required"),
});

/**
 * city-correction
 * Batch city correction processing
 */
export const CityCorrectionSchema = z.object({
  pois: z.array(z.object({
    id: PoiId,
    name: z.string().max(300),
    latitude: Latitude,
    longitude: LongitudeValue,
    city: z.string().max(100),
    state: z.string().max(100).optional(),
    country: z.string().max(100),
  })).min(1, "At least one POI is required"),
  confidence_threshold: z.number()
    .min(0, "Confidence threshold must be >= 0")
    .max(1, "Confidence threshold must be <= 1")
    .optional(),
  enable_cross_validation: z.boolean().optional(),
  batch_size: z.number()
    .min(1, "Batch size must be >= 1")
    .max(1000, "Batch size must be <= 1000")
    .optional(),
  dry_run: z.boolean().optional(),
});

/**
 * city-correction-monitor
 * Monitor city correction jobs
 */
export const CityCorrectionMonitorSchema = z.object({
  // No required body - monitors system state
  include_stuck_jobs: z.boolean().optional(),
  include_completed_jobs: z.boolean().optional(),
  max_age_minutes: z.number()
    .min(1, "Max age must be >= 1 minute")
    .max(1440, "Max age must be <= 24 hours")
    .optional(),
}).strict().optional(); // Optional body for monitor endpoint

/**
 * unified-image-processing
 * Process images from multiple sources
 */
export const UnifiedImageProcessingSchema = z.object({
  attractionId: AttractionId,
  attractionName: z.string()
    .min(1, "Attraction name is required")
    .max(300, "Attraction name too long"),
  sources: z.array(z.enum(["iphan", "osm", "wikipedia", "wikidata", "website"]))
    .min(1, "At least one source is required")
    .optional(),
  maxImagesPerSource: z.number()
    .min(1, "Max images must be >= 1")
    .max(100, "Max images must be <= 100")
    .optional(),
});

/**
 * verify-batch
 * Verify batch operation completion
 */
export const VerifyBatchSchema = z.object({
  batch_id: z.string()
    .min(1, "Batch ID is required")
    .max(100, "Batch ID too long"),
  operation_type: z.enum(["description", "audio", "images", "trigger_points"])
    .optional(),
  include_details: z.boolean().optional(),
});

// ============================================
// VALIDATION HELPER FUNCTION
// ============================================

interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  errors?: Record<string, string[]>;
}

/**
 * Validate request body against schema
 * Returns structured validation result with error details
 */
export async function validateRequestBody<T>(
  schema: z.ZodSchema<T>,
  req: Request,
  functionName: string,
): Promise<ValidationResult<T>> {
  try {
    const body = await req.json();
    const result = schema.safeParse(body);

    if (!result.success) {
      const errors: Record<string, string[]> = {};
      result.error.errors.forEach((err) => {
        const path = err.path.join(".");
        if (!errors[path]) errors[path] = [];
        errors[path].push(err.message);
      });

      console.warn(
        `[${functionName}] Validation failed:`,
        JSON.stringify(errors),
      );
      return { valid: false, errors };
    }

    console.log(`[${functionName}] Validation passed`);
    return { valid: true, data: result.data };
  } catch (error) {
    console.error(`[${functionName}] Failed to parse request body:`, error);
    return {
      valid: false,
      errors: { body: ["Invalid JSON or malformed request body"] },
    };
  }
}

/**
 * Create error response for validation failures
 */
export function createValidationErrorResponse(
  errors: Record<string, string[]>,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      error: "Validation failed",
      details: errors,
    }),
    {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    },
  );
}
