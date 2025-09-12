# 🔧 Technical Specifications - POI Name Validation System

## 📋 System Requirements

### Hardware Requirements
- **CPU:** Standard server configuration (existing infrastructure)
- **Memory:** 4GB RAM minimum for batch processing
- **Storage:** 100MB for validation results and logs
- **Network:** Stable internet connection for Gemini API calls

### Software Requirements
- **Node.js:** v18+ (existing)
- **TypeScript:** v5+ (existing)
- **Database:** PostgreSQL with existing Supabase setup
- **API:** Google Gemini API access (existing)

## 🏗️ Architecture Components

### 1. Core Validation Service
```typescript
interface POIValidationService {
  validatePOIName(poi: POI): Promise<ValidationResult>
  processBatch(pois: POI[]): Promise<ValidationResult[]>
  getValidationStats(): Promise<ValidationStats>
}
```

### 2. Gemini Integration
```typescript
interface GeminiValidator {
  analyzePOIName(poi: POI): Promise<GeminiAnalysis>
  generatePrompt(poi: POI): string
  parseResponse(response: string): ValidationResult
}
```

### 3. Batch Processor
```typescript
interface BatchProcessor {
  processAllPOIs(): Promise<ProcessingResult>
  processBatch(batch: POI[]): Promise<BatchResult>
  handleRateLimit(): Promise<void>
}
```

### 4. Manual Review System
```typescript
interface ReviewSystem {
  getPOIsForReview(): Promise<ValidationResult[]>
  approveChange(validationId: string, newName: string): Promise<void>
  rejectChange(validationId: string, reason: string): Promise<void>
}
```

## 🏷️ Data Models

### POI (Point of Interest)
```typescript
interface POI {
  id: string
  name: string
  city: string
  state?: string
  country: string
  category: string
  formatted_address?: string
  osm_tags?: Record<string, string>
  coordinates: {
    lat: number
    lng: number
  }
}
```

### Validation Result
```typescript
interface ValidationResult {
  id: string
  attraction_id: string
  current_name: string
  is_accurate: boolean
  confidence_score: number
  suggested_name?: string
  reasoning: string
  name_issues: string[]
  requires_manual_review: boolean
  review_priority: 'low' | 'medium' | 'high' | 'critical'
  approved: boolean
  auto_approved: boolean
  name_changed: boolean
  old_name?: string
  new_name_applied?: string
  processed_at: string
  gemini_model_used: string
  processing_time_ms: number
  // New fields for contextual descriptors
  poi_type?: string
  descriptors_added?: string[]
  classification_confidence?: number
  evidence_found?: boolean
  evidence_source?: string
}
```

### Validation Stats
```typescript
interface ValidationStats {
  total_validations: number
  accurate_names: number
  inaccurate_names: number
  pending_review: number
  approved_changes: number
  auto_approved_changes: number
  names_changed: number
  avg_confidence_score: number
  confidence_distribution: {
    high: number
    medium: number
    low: number
  }
  processing_progress: {
    total_pois: number
    processed: number
    remaining: number
    percentage: number
  }
}
```

## 🤖 Gemini Integration

### Model Selection
```typescript
enum GeminiModel {
  FLASH = 'gemini-1.5-flash',
  PRO = 'gemini-1.5-pro'
}

interface ModelSelection {
  model: GeminiModel
  reasoning: string
  estimated_cost: number
}
```

### Prompt Engineering
```typescript
interface ValidationPrompt {
  system_prompt: string
  user_prompt: string
  expected_output_format: string
  examples: ValidationExample[]
}

const VALIDATION_PROMPT: ValidationPrompt = {
  system_prompt: `You are an expert in geographic information systems and point of interest (POI) naming conventions. Your task is to analyze POI names and determine if they are accurate, descriptive, and helpful for users. You should also intelligently classify POI types and add contextual descriptors when needed.

CRITICAL RULE: NEVER INVENT OR MAKE UP INFORMATION. If you cannot find clear evidence for a suggestion based on the provided data, simply return null for suggested_name and explain that you cannot make a confident suggestion. It is better to leave a name unchanged than to suggest something incorrect.`,
  
  user_prompt: `Analyze this POI and determine if the name needs improvement with contextual descriptors:

POI Data:
- Name: "{name}"
- Location: {city}, {state}, {country}
- Coordinates: {lat}, {lng}
- Address: {formatted_address}
- Category: {category}
- OSM Tags: {osm_tags}

Tasks:
1. Identify the POI TYPE (placa, estátua, pico, monte, mirante, igreja, parque, etc.)
2. Determine if the name needs contextual descriptors
3. Suggest appropriate descriptors based on POI type

IMPORTANT: Only suggest changes if you have clear evidence from the provided data. Do not invent specific names or locations.

Examples of transformations (ONLY when evidence supports):
- "Eu amo Itapevi" → "Placa 'Eu amo Itapevi'" (if OSM tags indicate it's a sign/placa)
- "Estátua" → "Estátua do Cristo Redentor" (ONLY if OSM tags have name:pt="Cristo Redentor")
- "Mirante" → "Mirante da Vista Panorâmica" (ONLY if OSM tags provide specific name)
- "Pico" → "Pico do Jaraguá" (ONLY if OSM tags have name:pt="Jaraguá")
- "Igreja" → "Igreja de Nossa Senhora da Candelária" (ONLY if OSM tags have specific name)

If you cannot find clear evidence for a specific name, suggest generic descriptors only:
- "Estátua" → "Estátua" (keep original if no specific name found)
- "Mirante" → "Mirante" (keep original if no specific name found)

Respond in JSON format:
{
  "is_accurate": boolean,
  "confidence_score": number (0-100),
  "poi_type": string,
  "suggested_name": string or null,
  "reasoning": string,
  "name_issues": string[],
  "improvement_suggestions": string[],
  "descriptors_added": string[],
  "classification_confidence": number (0-100),
  "evidence_found": boolean,
  "evidence_source": string
}`,
  
  expected_output_format: "JSON",
  examples: [
    {
      input: { 
        name: "Eu amo Itapevi", 
        city: "Itapevi", 
        category: "landmark",
        osm_tags: { "tourism": "attraction", "amenity": "information" }
      },
      output: { 
        is_accurate: false, 
        confidence_score: 85, 
        poi_type: "placa",
        suggested_name: "Placa 'Eu amo Itapevi'", 
        reasoning: "Generic name 'Eu amo Itapevi' appears to be a city welcome sign. Adding 'Placa' descriptor for clarity.",
        descriptors_added: ["Placa"],
        classification_confidence: 90,
        evidence_found: true,
        evidence_source: "OSM tags indicate tourism=information, which suggests this is an informational sign"
      }
    },
    {
      input: { 
        name: "Estátua", 
        city: "São Paulo", 
        category: "landmark",
        osm_tags: { "tourism": "attraction", "historic": "monument", "name:pt": "Monumento às Bandeiras" }
      },
      output: { 
        is_accurate: false, 
        confidence_score: 20, 
        poi_type: "estatua",
        suggested_name: "Monumento às Bandeiras", 
        reasoning: "Generic name 'Estátua' is not descriptive enough. OSM tags indicate this is the 'Monumento às Bandeiras' monument.",
        descriptors_added: ["Monumento"],
        classification_confidence: 95,
        evidence_found: true,
        evidence_source: "OSM tags contain name:pt='Monumento às Bandeiras' which provides the specific name"
      }
    },
    {
      input: { 
        name: "Estátua", 
        city: "São Paulo", 
        category: "landmark",
        osm_tags: { "tourism": "attraction", "historic": "monument" }
      },
      output: { 
        is_accurate: false, 
        confidence_score: 30, 
        poi_type: "estatua",
        suggested_name: null, 
        reasoning: "Generic name 'Estátua' is not descriptive, but no specific name found in OSM tags. Cannot suggest a specific name without evidence.",
        descriptors_added: [],
        classification_confidence: 95,
        evidence_found: false,
        evidence_source: "No specific name found in OSM tags - only generic monument classification"
      }
    }
  ]
}
```

### Rate Limiting Configuration
```typescript
interface RateLimitConfig {
  model: GeminiModel
  requests_per_minute: number
  requests_per_hour: number
  cooldown_ms: number
  max_retries: number
  backoff_multiplier: number
}

const RATE_LIMITS: Record<GeminiModel, RateLimitConfig> = {
  [GeminiModel.FLASH]: {
    requests_per_minute: 15,
    requests_per_hour: 1500,
    cooldown_ms: 4000,
    max_retries: 3,
    backoff_multiplier: 2
  },
  [GeminiModel.PRO]: {
    requests_per_minute: 8,
    requests_per_hour: 1000,
    cooldown_ms: 8000,
    max_retries: 3,
    backoff_multiplier: 2
  }
}
```

## 🏷️ POI Classification & Contextual Descriptors

### POI Type Classification
```typescript
interface POIClassification {
  baseType: 'placa' | 'estatua' | 'pico' | 'monte' | 'mirante' | 'igreja' | 'parque' | 'outro'
  confidence: number
  reasoning: string
  suggestedDescriptor: string
}

function classifyPOI(poi: POI, osmTags: OSMTags): POIClassification {
  // Classification logic based on:
  // 1. Current POI name patterns
  // 2. OSM tags (tourism, historic, natural, etc.)
  // 3. Geographic context
  // 4. Local naming conventions
}
```

### Descriptor Rules Engine
```typescript
interface DescriptorRules {
  [key: string]: {
    patterns: string[]
    descriptors: string[]
    examples: string[]
    osmTags: string[]
  }
}

const DESCRIPTOR_RULES: DescriptorRules = {
  placa: {
    patterns: ['eu amo', 'bem-vindo', 'welcome', 'bem vindo', 'entrada'],
    descriptors: ['Placa'],
    examples: ['Eu amo Itapevi', 'Bem-vindo a São Paulo'],
    osmTags: ['tourism=information', 'amenity=information']
  },
  estatua: {
    patterns: ['cristo', 'santa', 'são', 'monumento', 'estátua'],
    descriptors: ['Estátua', 'Monumento'],
    examples: ['Cristo Redentor', 'Santa Rita', 'Monumento às Bandeiras'],
    osmTags: ['tourism=attraction', 'historic=monument']
  },
  pico: {
    patterns: ['pico', 'monte', 'morro'],
    descriptors: ['Pico', 'Monte', 'Morro'],
    examples: ['Pico do Jaraguá', 'Monte das Oliveiras'],
    osmTags: ['natural=peak', 'tourism=viewpoint']
  },
  mirante: {
    patterns: ['mirante', 'vista', 'panorâmica'],
    descriptors: ['Mirante', 'Vista Panorâmica'],
    examples: ['Mirante da Vista', 'Vista Panorâmica'],
    osmTags: ['tourism=viewpoint', 'natural=peak']
  },
  igreja: {
    patterns: ['igreja', 'capela', 'basílica'],
    descriptors: ['Igreja', 'Capela', 'Basílica'],
    examples: ['Igreja de Nossa Senhora', 'Capela São João'],
    osmTags: ['amenity=place_of_worship', 'religion=christian']
  }
}
```

### Contextual Name Enhancement
```typescript
function enhanceNameWithContext(
  currentName: string, 
  classification: POIClassification, 
  osmTags: OSMTags
): string {
  // If name already has descriptor, keep it
  if (hasDescriptor(currentName)) {
    return currentName
  }
  
  // If OSM tags have specific name, use it with descriptor
  if (osmTags['name:pt'] && osmTags['name:pt'] !== currentName) {
    return `${classification.suggestedDescriptor} ${osmTags['name:pt']}`
  }
  
  // Add appropriate descriptor to current name
  const descriptor = classification.suggestedDescriptor
  return `${descriptor} ${currentName}`
}

function hasDescriptor(name: string): boolean {
  const descriptors = ['placa', 'estátua', 'pico', 'monte', 'mirante', 'igreja', 'capela', 'basílica']
  return descriptors.some(desc => name.toLowerCase().includes(desc))
}
```

### Classification Examples
```typescript
// Example transformations
const examples = [
  {
    input: { name: "Eu amo Itapevi", osmTags: { "tourism": "information" } },
    output: { 
      poiType: "placa", 
      suggestedName: "Placa 'Eu amo Itapevi'",
      confidence: 90,
      reasoning: "City welcome sign pattern detected"
    }
  },
  {
    input: { name: "Cristo", osmTags: { "historic": "monument", "tourism": "attraction" } },
    output: { 
      poiType: "estatua", 
      suggestedName: "Estátua do Cristo Redentor",
      confidence: 85,
      reasoning: "Monument pattern with religious context"
    }
  },
  {
    input: { name: "Mirante", osmTags: { "tourism": "viewpoint", "natural": "peak" } },
    output: { 
      poiType: "mirante", 
      suggestedName: "Mirante da Vista Panorâmica",
      confidence: 80,
      reasoning: "Generic viewpoint needs descriptive context"
    }
  }
]
```

## 🤖 Automatic Name Changes

### Confidence-Based Decision Matrix
| Confidence Score | Action | Description |
|------------------|--------|-------------|
| **90-100** | **AUTO-APPROVE** | High confidence - automatically apply suggested name |
| **80-89** | **AUTO-APPROVE** | High confidence - automatically apply suggested name |
| **70-79** | **AUTO-APPROVE** | Medium-high confidence - automatically apply suggested name |
| **60-69** | **MANUAL REVIEW** | Medium confidence - requires human approval |
| **50-59** | **MANUAL REVIEW** | Low-medium confidence - requires human approval |
| **0-49** | **MANUAL REVIEW** | Very low confidence - requires human approval |

### Decision Algorithm
```typescript
interface AutoChangeDecision {
  shouldChange: boolean
  newName: string
  confidence: number
  reasoning: string
  appliedAt?: string
}

function decideAutoChange(validation: ValidationResult): AutoChangeDecision {
  // Auto-approve if confidence >= 70 and suggested name exists
  if (validation.confidence_score >= 70 && validation.suggested_name) {
    return {
      shouldChange: true,
      newName: validation.suggested_name,
      confidence: validation.confidence_score,
      reasoning: `Auto-approved based on confidence score: ${validation.confidence_score}`
    }
  }
  
  // Manual review required for lower confidence
  return {
    shouldChange: false,
    newName: validation.current_name,
    confidence: validation.confidence_score,
    reasoning: `Manual review required - confidence score: ${validation.confidence_score}`
  }
}
```

### Implementation Flow
```typescript
async function processPOIValidation(poi: POI): Promise<ValidationResult> {
  // 1. Get Gemini validation using OSM tags
  const validation = await geminiService.validatePOIName(poi)
  
  // 2. Make auto-change decision
  const decision = decideAutoChange(validation)
  
  // 3. Apply automatic changes if approved
  if (decision.shouldChange) {
    await applyNameChange(poi.id, decision.newName, validation)
  }
  
  // 4. Save validation result
  return await saveValidationResult(validation, decision)
}
```

## 🏷️ OSM Tags Integration

### OSM Tags Structure
```typescript
interface OSMTags {
  // Basic identification
  name?: string
  "name:pt"?: string
  "name:en"?: string
  "name:es"?: string
  
  // Tourism and attractions
  tourism?: string // "attraction", "museum", "gallery", "zoo", "theme_park"
  historic?: string // "monument", "memorial", "castle", "church"
  amenity?: string // "restaurant", "hospital", "school", "theatre"
  
  // Religious sites
  religion?: string // "christian", "muslim", "buddhist", "hindu"
  denomination?: string // "catholic", "protestant", "orthodox"
  
  // Cultural and educational
  leisure?: string // "park", "garden", "sports_centre"
  sport?: string // "football", "tennis", "swimming"
  education?: string // "university", "college", "school"
  
  // Commercial
  shop?: string // "supermarket", "clothes", "electronics"
  office?: string // "government", "company", "ngo"
  
  // Transportation
  public_transport?: string // "station", "stop_position"
  railway?: string // "station", "halt", "tram_stop"
  
  // Natural features
  natural?: string // "peak", "beach", "waterfall", "cave"
  waterway?: string // "river", "canal", "stream"
  
  // Additional metadata
  wikipedia?: string
  wikidata?: string
  website?: string
  phone?: string
  opening_hours?: string
  fee?: string
  wheelchair?: string
}
```

### OSM Context Analysis
```typescript
function analyzeOSMContext(osmTags: OSMTags): OSMAnalysis {
  const analysis: OSMAnalysis = {
    category: determineCategory(osmTags),
    specificity: calculateSpecificity(osmTags),
    completeness: calculateCompleteness(osmTags),
    suggestions: []
  }
  
  // Tourism attractions
  if (osmTags.tourism) {
    analysis.suggestions.push(...getTourismSuggestions(osmTags))
  }
  
  // Historic sites
  if (osmTags.historic) {
    analysis.suggestions.push(...getHistoricSuggestions(osmTags))
  }
  
  // Religious sites
  if (osmTags.religion) {
    analysis.suggestions.push(...getReligiousSuggestions(osmTags))
  }
  
  return analysis
}

function extractNameFromOSMTags(osmTags: OSMTags, currentName: string): NameExtraction {
  // Priority order for name extraction
  const namePriority = [
    'name:pt',    // Portuguese name (primary for Brazil)
    'name',       // Default name
    'name:en',    // English name
    'name:es'     // Spanish name
  ]
  
  for (const tag of namePriority) {
    if (osmTags[tag] && osmTags[tag] !== currentName) {
      return {
        suggestedName: osmTags[tag],
        source: tag,
        confidence: calculateNameConfidence(osmTags[tag], currentName, osmTags)
      }
    }
  }
  
  return {
    suggestedName: null,
    source: null,
    confidence: 0
  }
}
```

### Enhanced Prompt with OSM
```typescript
function buildOSMEnhancedPrompt(poi: POI): string {
  const osmContext = analyzeOSMContext(poi.osm_tags || {})
  
  return `
Analyze this POI and determine if the name is accurate and descriptive:

POI Data:
- Name: "${poi.name}"
- Location: ${poi.city}, ${poi.state}, ${poi.country}
- Coordinates: ${poi.coordinates.lat}, ${poi.coordinates.lng}
- Address: ${poi.formatted_address}
- Category: ${poi.category}

OSM Tags Context:
${formatOSMTagsForPrompt(poi.osm_tags || {})}

OSM Analysis:
- Detected Category: ${osmContext.category}
- Specificity Level: ${osmContext.specificity}
- Completeness: ${osmContext.completeness}
- Suggestions: ${osmContext.suggestions.join(', ')}

Based on the OSM tags, provide a more accurate and descriptive name if needed.

Respond in JSON format:
{
  "is_accurate": boolean,
  "confidence_score": number (0-100),
  "suggested_name": string or null,
  "reasoning": string,
  "name_issues": string[],
  "improvement_suggestions": string[],
  "osm_insights": string[]
}
`
}
```

## 🗄️ Database Schema

### Core Validation Table
```sql
CREATE TABLE core.poi_name_validations (
  -- Primary key
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign key to attractions table
  attraction_id uuid NOT NULL REFERENCES core.attractions(id) ON DELETE CASCADE,
  
  -- Current POI data (snapshot at validation time)
  current_name text NOT NULL,
  current_category text,
  current_address text,
  current_coordinates point,
  current_city text,
  current_state text,
  current_country text,
  current_osm_tags jsonb,
  
  -- Validation results
  is_accurate boolean NOT NULL,
  confidence_score integer NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  suggested_name text,
  reasoning text NOT NULL,
  name_issues text[] DEFAULT '{}',
  improvement_suggestions text[] DEFAULT '{}',
  
  -- POI Classification and Contextual Descriptors
  poi_type text,
  classification_confidence integer CHECK (classification_confidence >= 0 AND classification_confidence <= 100),
  descriptors_added text[] DEFAULT '{}',
  evidence_found boolean DEFAULT false,
  evidence_source text,
  
  -- Review workflow
  requires_manual_review boolean DEFAULT false,
  review_priority text CHECK (review_priority IN ('low', 'medium', 'high', 'critical')),
  approved boolean DEFAULT false,
  approved_by uuid REFERENCES drive.profiles(id),
  approved_at timestamp with time zone,
  rejection_reason text,
  reviewer_notes text,
  
  -- Automatic change tracking
  auto_approved boolean DEFAULT false,
  auto_approved_at timestamp with time zone,
  name_changed boolean DEFAULT false,
  old_name text,
  new_name_applied text,
  
  -- Processing metadata
  processed_at timestamp with time zone DEFAULT now(),
  gemini_model_used text NOT NULL,
  processing_time_ms integer NOT NULL,
  api_tokens_used integer,
  retry_count integer DEFAULT 0,
  batch_id uuid REFERENCES core.poi_validation_batches(id),
  
  -- Constraints
  CONSTRAINT poi_name_validations_attraction_id_key UNIQUE (attraction_id),
  CONSTRAINT poi_name_validations_confidence_check CHECK (confidence_score >= 0 AND confidence_score <= 100)
);

-- Indexes for performance
CREATE INDEX idx_poi_name_validations_attraction_id ON core.poi_name_validations(attraction_id);
CREATE INDEX idx_poi_name_validations_confidence ON core.poi_name_validations(confidence_score);
CREATE INDEX idx_poi_name_validations_review ON core.poi_name_validations(requires_manual_review, review_priority);
CREATE INDEX idx_poi_name_validations_processed ON core.poi_name_validations(processed_at);
CREATE INDEX idx_poi_name_validations_approved ON core.poi_name_validations(approved);
CREATE INDEX idx_poi_name_validations_batch ON core.poi_name_validations(batch_id);
CREATE INDEX idx_poi_name_validations_name_gin ON core.poi_name_validations USING gin(current_name gin_trgm_ops);
CREATE INDEX idx_poi_name_validations_osm_tags_gin ON core.poi_name_validations USING gin (current_osm_tags);
```

### Batch Processing Table
```sql
CREATE TABLE core.poi_validation_batches (
  -- Primary key
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Batch metadata
  batch_name text,
  total_pois integer NOT NULL,
  processed_count integer DEFAULT 0,
  failed_count integer DEFAULT 0,
  success_count integer DEFAULT 0,
  
  -- Processing status
  status text CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
  priority text CHECK (priority IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
  
  -- Timing
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  estimated_completion_time timestamp with time zone,
  
  -- Configuration
  batch_size integer DEFAULT 50,
  gemini_model_used text NOT NULL,
  rate_limit_config jsonb,
  
  -- Results
  processing_stats jsonb,
  error_log jsonb,
  
  -- Metadata
  created_by uuid REFERENCES drive.profiles(id),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
```

### Validation Statistics View
```sql
CREATE VIEW core.poi_validation_stats AS
SELECT 
  -- Basic counts
  COUNT(*) as total_validations,
  COUNT(*) FILTER (WHERE is_accurate = true) as accurate_names,
  COUNT(*) FILTER (WHERE is_accurate = false) as inaccurate_names,
  COUNT(*) FILTER (WHERE requires_manual_review = true) as pending_review,
  COUNT(*) FILTER (WHERE approved = true) as approved_changes,
  COUNT(*) FILTER (WHERE auto_approved = true) as auto_approved_changes,
  COUNT(*) FILTER (WHERE name_changed = true) as names_changed,
  
  -- POI Classification statistics
  COUNT(*) FILTER (WHERE poi_type IS NOT NULL) as classified_pois,
  COUNT(*) FILTER (WHERE array_length(descriptors_added, 1) > 0) as pois_with_descriptors,
  COUNT(*) FILTER (WHERE evidence_found = true) as pois_with_evidence,
  COUNT(*) FILTER (WHERE evidence_found = false) as pois_without_evidence,
  AVG(classification_confidence) as avg_classification_confidence,
  
  -- Confidence statistics
  AVG(confidence_score) as avg_confidence_score,
  MIN(confidence_score) as min_confidence_score,
  MAX(confidence_score) as max_confidence_score,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY confidence_score) as median_confidence_score,
  
  -- Confidence distribution
  COUNT(*) FILTER (WHERE confidence_score >= 90) as high_confidence,
  COUNT(*) FILTER (WHERE confidence_score BETWEEN 70 AND 89) as medium_confidence,
  COUNT(*) FILTER (WHERE confidence_score < 70) as low_confidence,
  
  -- Processing statistics
  AVG(processing_time_ms) as avg_processing_time_ms,
  SUM(processing_time_ms) as total_processing_time_ms,
  AVG(api_tokens_used) as avg_api_tokens_used,
  SUM(api_tokens_used) as total_api_tokens_used,
  
  -- Review statistics
  COUNT(*) FILTER (WHERE review_priority = 'critical') as critical_reviews,
  COUNT(*) FILTER (WHERE review_priority = 'high') as high_priority_reviews,
  COUNT(*) FILTER (WHERE review_priority = 'medium') as medium_priority_reviews,
  COUNT(*) FILTER (WHERE review_priority = 'low') as low_priority_reviews,
  
  -- Timing
  MIN(processed_at) as first_validation,
  MAX(processed_at) as last_validation
FROM core.poi_name_validations;
```

## 🔌 API Endpoints

### Validation Endpoints

#### POST /api/poi-validation/validate
Validate a single POI name.

**Request:**
```http
POST /api/poi-validation/validate
Content-Type: application/json

{
  "poi_id": "uuid",
  "force_revalidation": false
}
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": true,
  "validation_id": "uuid",
  "result": {
    "id": "uuid",
    "attraction_id": "uuid",
    "current_name": "Estátua",
    "is_accurate": false,
    "confidence_score": 25,
    "suggested_name": "Estátua do Monumento às Bandeiras",
    "reasoning": "Generic name 'Estátua' is not descriptive enough for users to identify the specific monument",
    "name_issues": ["too_generic", "lacks_specificity"],
    "requires_manual_review": true,
    "review_priority": "high",
    "approved": false,
    "auto_approved": false,
    "name_changed": false,
    "poi_type": "estatua",
    "descriptors_added": ["Monumento"],
    "classification_confidence": 95,
    "processed_at": "2024-01-15T10:30:00Z",
    "gemini_model_used": "gemini-1.5-flash",
    "processing_time_ms": 2500
  },
  "processing_time_ms": 2500
}
```

#### POST /api/poi-validation/batch
Process a batch of POIs for validation.

**Request:**
```http
POST /api/poi-validation/batch
Content-Type: application/json

{
  "poi_ids": ["uuid1", "uuid2", "uuid3"],
  "batch_size": 50,
  "priority": "medium"
}
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": true,
  "batch_id": "uuid",
  "total_pois": 3,
  "processed_count": 3,
  "failed_count": 0,
  "estimated_completion_time": "2024-01-15T10:35:00Z",
  "results": [
    {
      "poi_id": "uuid1",
      "validation_id": "uuid",
      "status": "completed",
      "processing_time_ms": 2500
    }
  ]
}
```

### Review Endpoints

#### GET /api/poi-validation/review
Get POIs that require manual review.

**Request:**
```http
GET /api/poi-validation/review?limit=20&priority=high&confidence_threshold=70
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "validations": [
    {
      "id": "uuid",
      "attraction_id": "uuid",
      "current_name": "Estátua",
      "is_accurate": false,
      "confidence_score": 25,
      "suggested_name": "Estátua do Monumento às Bandeiras",
      "reasoning": "Generic name 'Estátua' is not descriptive enough",
      "name_issues": ["too_generic", "lacks_specificity"],
      "requires_manual_review": true,
      "review_priority": "high",
      "approved": false,
      "processed_at": "2024-01-15T10:30:00Z"
    }
  ],
  "total_count": 150,
  "has_more": true
}
```

#### POST /api/poi-validation/review/approve
Approve a name change suggestion.

**Request:**
```http
POST /api/poi-validation/review/approve
Content-Type: application/json

{
  "validation_id": "uuid",
  "new_name": "Estátua do Monumento às Bandeiras",
  "reviewer_notes": "Approved after verifying the monument's official name"
}
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": true,
  "applied_changes": {
    "poi_id": "uuid",
    "old_name": "Estátua",
    "new_name": "Estátua do Monumento às Bandeiras"
  },
  "approved_at": "2024-01-15T10:30:00Z",
  "approved_by": "uuid"
}
```

### Statistics Endpoints

#### GET /api/poi-validation/stats
Get overall validation statistics.

**Request:**
```http
GET /api/poi-validation/stats
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "total_validations": 21000,
  "accurate_names": 16800,
  "inaccurate_names": 4200,
  "pending_review": 840,
  "approved_changes": 3360,
  "auto_approved_changes": 12600,
  "names_changed": 15960,
  "classified_pois": 18900,
  "pois_with_descriptors": 12600,
  "avg_classification_confidence": 87.2,
  "avg_confidence_score": 78.5,
  "confidence_distribution": {
    "high": 14700,
    "medium": 5250,
    "low": 1050
  },
  "processing_progress": {
    "total_pois": 21000,
    "processed": 21000,
    "remaining": 0,
    "percentage": 100
  }
}
```

## 📊 Performance Specifications

### Processing Performance
- **Batch Size:** 50 POIs per batch
- **Processing Rate:** 15 requests/minute (Flash), 8 requests/minute (Pro)
- **Total Processing Time:** 2-3 hours (Flash), 4-6 hours (Pro)
- **Memory Usage:** < 100MB per batch
- **Storage Growth:** ~1MB per 1000 validations

### Error Handling
```typescript
interface ErrorHandling {
  retry_policy: {
    max_retries: number
    backoff_strategy: 'exponential' | 'linear'
    retryable_errors: string[]
  }
  fallback_strategy: {
    use_cached_result: boolean
    skip_validation: boolean
    manual_review: boolean
  }
  monitoring: {
    error_rate_threshold: number
    alert_conditions: string[]
    logging_level: 'debug' | 'info' | 'warn' | 'error'
  }
}
```

### Monitoring & Alerting
```typescript
interface MonitoringConfig {
  metrics: {
    processing_rate: number
    error_rate: number
    api_cost: number
    confidence_distribution: Record<string, number>
  }
  alerts: {
    high_error_rate: { threshold: number, action: string }
    cost_exceeded: { threshold: number, action: string }
    processing_stalled: { threshold: number, action: string }
  }
  dashboards: {
    real_time_processing: string[]
    quality_metrics: string[]
    cost_tracking: string[]
  }
}
```

## 🔒 Security Specifications

### Data Protection
- All POI data remains within existing infrastructure
- No external data sharing or storage
- Encrypted API communications
- Role-based access control for manual review

### API Security
```typescript
interface SecurityConfig {
  authentication: {
    method: 'jwt' | 'api_key'
    required_roles: string[]
    rate_limiting: boolean
  }
  authorization: {
    validation_access: string[]
    review_access: string[]
    admin_access: string[]
  }
  data_encryption: {
    at_rest: boolean
    in_transit: boolean
    key_management: string
  }
}
```

### Audit Trail
```typescript
interface AuditLog {
  id: string
  timestamp: string
  user_id: string
  action: string
  resource_id: string
  old_value: any
  new_value: any
  ip_address: string
  user_agent: string
}
```

## ⚠️ System Limitations

### API Rate Limits
- **Gemini Flash:** 15 requests/minute, 1,500 requests/hour
- **Gemini Pro:** 8 requests/minute, 1,000 requests/hour
- **Cooldown Period:** 4 seconds (Flash), 8 seconds (Pro)
- **Daily Limits:** Subject to Google's quota policies

### Processing Constraints
- **Batch Size:** Maximum 50 POIs per batch
- **Concurrent Processing:** Single-threaded to respect rate limits
- **Memory Usage:** Limited to 100MB per batch
- **Processing Time:** 2-3 hours for all 21k POIs (Flash model)

### Database Limitations
- **Storage Growth:** ~1MB per 1,000 validations
- **Query Performance:** Indexed queries < 100ms
- **Concurrent Connections:** Limited by Supabase plan
- **Backup Frequency:** Daily automated backups

### Cost Constraints
- **Gemini Flash:** ~$0.075 per 1M input tokens, $0.30 per 1M output tokens
- **Estimated Total Cost:** $2-3 for all 21k POIs
- **Cost Monitoring:** Real-time tracking with alerts
- **Budget Limit:** $10 maximum (with 3x buffer)

### Quality Constraints
- **Confidence Threshold:** Minimum 70% for automatic approval
- **Manual Review:** Required for confidence < 70%
- **False Positive Rate:** Target < 5%
- **False Negative Rate:** Target < 10%

### Time Constraints
- **Total Processing Time:** Maximum 4 hours for all POIs
- **Batch Processing:** Maximum 10 minutes per batch
- **Individual POI:** Maximum 30 seconds per validation
- **Manual Review:** Maximum 2 minutes per POI

---

**Document Version:** 1.0  
**Last Updated:** 2024  
**Purpose:** Complete technical specifications for POI Name Validation System