
export function getDirectionBucket(heading: number, bearing: number): string {
    if (heading === -1 || heading === null || heading === undefined) return "around";

    // Calculate angular difference and normalize to [-180, 180]
    let diff = bearing - heading;

    // Normalize to [-180, 180] range
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;

    // Classify direction based on normalized difference
    if (diff > 45 && diff < 135) return "right";
    if (diff < -45 && diff > -135) return "left";
    if (Math.abs(diff) >= 135) return "behind";
    return "ahead";
}


export function getCardinalDirection(angle: number): string {
    const directions = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
    const index = Math.round(((angle %= 360) < 0 ? angle + 360 : angle) / 45) % 8;
    return directions[index];
}

/**
 * Calculate the bearing between two points
 * @returns Bearing in degrees (0-360)
 */
export function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
        Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    let θ = Math.atan2(y, x);
    let bearing = (θ * 180 / Math.PI + 360) % 360;

    return bearing;
}
