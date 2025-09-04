/**
 * Street Processing Utilities
 * Pure functions for street analysis and processing
 */

import type { GeoPoint } from '../types/interfaces.ts';
import { calculateDistance, calculateBearing } from './calculations.ts';
import { distanceToLineSegment } from './geometry.ts';

/**
 * Find the closest point on a street to a target location
 */
export function findClosestPointOnStreet(streetCoordinates: number[][], targetLat: number, targetLng: number): {
  lat: number;
  lng: number;
  point: number[];
  index: number;
  distance: number;
} {
  let closestPoint = streetCoordinates[0];
  let closestIndex = 0;
  let minDistance = calculateDistance(targetLat, targetLng, streetCoordinates[0][1], streetCoordinates[0][0]);
  
  for (let i = 1; i < streetCoordinates.length; i++) {
    const distance = calculateDistance(targetLat, targetLng, streetCoordinates[i][1], streetCoordinates[i][0]);
    if (distance < minDistance) {
      minDistance = distance;
      closestPoint = streetCoordinates[i];
      closestIndex = i;
    }
  }
  
  return {
    lat: closestPoint[1], // lat from [lng, lat]
    lng: closestPoint[0], // lng from [lng, lat]
    point: closestPoint,
    index: closestIndex,
    distance: minDistance
  };
}

/**
 * Calculate confidence score for a street based on its tags and distance
 */
export function calculateStreetConfidence(tags: any, distance: number): number {
  let confidence = 0.5; // Base confidence
  
  // Highway type scoring
  if (tags.highway) {
    const highwayBonus = {
      'motorway': 0.9,
      'trunk': 0.8,
      'primary': 0.8,
      'secondary': 0.7,
      'tertiary': 0.6,
      'residential': 0.5,
      'service': 0.3,
      'footway': 0.2,
      'path': 0.1
    };
    confidence += highwayBonus[tags.highway] || 0.4;
  }
  
  // Name bonus
  if (tags.name) {
    confidence += 0.1;
  }
  
  // Distance penalty (closer is better)
  const distancePenalty = Math.min(distance / 1000, 0.3); // Max 30% penalty
  confidence -= distancePenalty;
  
  return Math.max(0.1, Math.min(1.0, confidence));
}

/**
 * Calculate street direction based on coordinates and point index
 */
export function calculateStreetDirection(coordinates: number[][], pointIndex: number, isReverse: boolean = false): number {
  const totalPoints = coordinates.length;
  let fromIndex, toIndex;
  
  if (isReverse) {
    // For reverse direction, we look backwards
    if (pointIndex === 0) {
      fromIndex = 1;
      toIndex = 0;
    } else {
      fromIndex = Math.min(pointIndex + 1, totalPoints - 1);
      toIndex = pointIndex;
    }
  } else {
    // For normal direction, we look forwards
    if (pointIndex === totalPoints - 1) {
      fromIndex = totalPoints - 2;
      toIndex = totalPoints - 1;
    } else {
      fromIndex = pointIndex;
      toIndex = Math.min(pointIndex + 1, totalPoints - 1);
    }
  }
  
  const fromPoint = coordinates[fromIndex];
  const toPoint = coordinates[toIndex];
  
  return calculateBearing(fromPoint[1], fromPoint[0], toPoint[1], toPoint[0]);
}

/**
 * Find the closest point index on a street to POI coordinates
 */
export function findClosestPointIndexOnStreet(coordinates: number[][], poiLat: number, poiLng: number): number {
  let closestIndex = 0;
  let minDistance = calculateDistance(poiLat, poiLng, coordinates[0][1], coordinates[0][0]);
  
  for (let i = 1; i < coordinates.length; i++) {
    const distance = calculateDistance(poiLat, poiLng, coordinates[i][1], coordinates[i][0]);
    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = i;
    }
  }
  
  return closestIndex;
}

/**
 * Calculate position bonus based on stream position for trigger points
 */
export function calculateStreamPositionBonus(
  pointIndex: number, 
  closestIndex: number, 
  isOneway: boolean, 
  isReverse: boolean, 
  streetLength: number
): number {
  let bonus = 0;
  
  // Position relative to closest point
  const relativePosition = Math.abs(pointIndex - closestIndex) / streetLength;
  
  if (isOneway) {
    // For one-way streets, prefer points in the direction of travel
    if (!isReverse && pointIndex > closestIndex) {
      bonus += 0.1; // Forward direction bonus
    } else if (isReverse && pointIndex < closestIndex) {
      bonus += 0.1; // Reverse direction bonus
    }
  }
  
  // Slight preference for points not too far from closest
  if (relativePosition < 0.3) {
    bonus += 0.05;
  }
  
  return bonus;
}

// validateFrontalStreetView kept in main file due to complex logic and dependencies

// classifyTriggerPointsByStreet kept in main file due to different implementation

// processOverpassStreetData kept in main file due to complex business logic and dependencies
