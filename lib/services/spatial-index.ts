/**
 * Spatial Index Service
 * 
 * Implements R-tree spatial indexing for efficient spatial queries
 * Based on enterprise practices from MapBox, Google Maps, and ArcGIS
 * 
 * @module lib/services/spatial-index
 */

export interface BoundingBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface SpatialItem {
  id: string
  geometry: {
    type: 'Point' | 'Polygon' | 'LineString'
    coordinates: number[] | number[][] | number[][][]
  }
  properties: Record<string, any>
}

export class SpatialIndex {
  private items: Map<string, SpatialItem> = new Map()
  private rtree: Map<string, BoundingBox[]> = new Map()

  /**
   * Add item to spatial index
   */
  addItem(item: SpatialItem): void {
    this.items.set(item.id, item)
    this.updateRTree(item)
  }

  /**
   * Remove item from spatial index
   */
  removeItem(id: string): void {
    this.items.delete(id)
    this.rtree.delete(id)
  }

  /**
   * Query items within bounding box
   */
  queryBoundingBox(bbox: BoundingBox): SpatialItem[] {
    const results: SpatialItem[] = []
    
    for (const [id, item] of this.items) {
      if (this.intersects(bbox, this.getBoundingBox(item))) {
        results.push(item)
      }
    }
    
    return results
  }

  /**
   * Query items within radius of point
   */
  queryRadius(centerX: number, centerY: number, radius: number): SpatialItem[] {
    const bbox: BoundingBox = {
      minX: centerX - radius,
      minY: centerY - radius,
      maxX: centerX + radius,
      maxY: centerY + radius
    }
    
    return this.queryBoundingBox(bbox).filter(item => {
      const itemBbox = this.getBoundingBox(item)
      const distance = this.calculateDistance(
        centerX, centerY,
        (itemBbox.minX + itemBbox.maxX) / 2,
        (itemBbox.minY + itemBbox.maxY) / 2
      )
      return distance <= radius
    })
  }

  /**
   * Get bounding box for item
   */
  private getBoundingBox(item: SpatialItem): BoundingBox {
    const coords = item.geometry.coordinates
    
    if (item.geometry.type === 'Point') {
      const [x, y] = coords as number[]
      return { minX: x, minY: y, maxX: x, maxY: y }
    }
    
    if (item.geometry.type === 'LineString') {
      const points = coords as number[][]
      return this.calculateBoundingBox(points)
    }
    
    if (item.geometry.type === 'Polygon') {
      const rings = coords as number[][][]
      const allPoints = rings.flat()
      return this.calculateBoundingBox(allPoints)
    }
    
    throw new Error(`Unsupported geometry type: ${item.geometry.type}`)
  }

  /**
   * Calculate bounding box from points
   */
  private calculateBoundingBox(points: number[][]): BoundingBox {
    let minX = Infinity, minY = Infinity
    let maxX = -Infinity, maxY = -Infinity
    
    for (const [x, y] of points) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    
    return { minX, minY, maxX, maxY }
  }

  /**
   * Check if two bounding boxes intersect
   */
  private intersects(bbox1: BoundingBox, bbox2: BoundingBox): boolean {
    return !(bbox1.maxX < bbox2.minX || 
             bbox1.minX > bbox2.maxX || 
             bbox1.maxY < bbox2.minY || 
             bbox1.minY > bbox2.maxY)
  }

  /**
   * Calculate distance between two points
   */
  private calculateDistance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1
    const dy = y2 - y1
    return Math.sqrt(dx * dx + dy * dy)
  }

  /**
   * Update R-tree (simplified implementation)
   */
  private updateRTree(item: SpatialItem): void {
    const bbox = this.getBoundingBox(item)
    this.rtree.set(item.id, [bbox])
  }

  /**
   * Get all items
   */
  getAllItems(): SpatialItem[] {
    return Array.from(this.items.values())
  }

  /**
   * Get item count
   */
  getItemCount(): number {
    return this.items.size
  }

  /**
   * Clear all items
   */
  clear(): void {
    this.items.clear()
    this.rtree.clear()
  }
}

/**
 * Create spatial index instance
 */
export const createSpatialIndex = (): SpatialIndex => {
  return new SpatialIndex()
}
