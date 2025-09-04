/**
 * Scoring and Validation Utilities
 * Pure functions for scoring features and validating results
 */

import type { BoundaryData, LandmarkInfo, TriggerPoint } from '../types/interfaces.ts';
import { calculateDistance, calculateBearing, normalizeAngleDifference } from './calculations.ts';

// calculateFeatureRelevance kept in main file due to specific business logic

// scoreBoundaryRelevance kept in main file due to specific business logic

// calculatePOIConfidenceScore kept in main file due to specific business logic

// validatePOIPolygon kept in main file due to specific business logic

// validateBearingPosition kept in main file due to specific business logic

// isInBearingRange moved to lib/utils/calculations.ts to avoid duplication
