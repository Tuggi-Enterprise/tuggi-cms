/**
 * Shape of a building as the engine reads it (E3, E8). The fetcher class that lived here had no
 * caller and chose the POI border by name similarity; it left on 2026-10-11 (INV-E1c, a name is
 * not identity).
 */
export interface BuildingData {
  id: string;
  geometry: Array<{ lat: number; lng: number }>;
  height: number;
  tags?: Record<string, string>;
}
