#!/bin/bash

# Test Direction Bucket Calculation with Real Data from Logs
# This script validates that the getDirectionBucket function produces correct results

echo "🧪 Testing Direction Bucket Calculation with Real Log Data"
echo "=========================================================="
echo ""

# Create a temporary Node.js test script
cat > /tmp/test_direction.js << 'EOF'
// Exact implementation from utils.ts
function getDirectionBucket(heading, bearing) {
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

// Test cases extracted from real logs
const testCases = [
    // Case 1: From logs.md line 877
    // User heading: 300.1°, POI bearing: 317.9°
    // Diff: 17.8° - This is AHEAD (within ±45° cone)
    {
        name: "Município de Bragança Paulista (Log Case 1)",
        heading: 300.1074996174516,
        bearing: 317.9,
        expected: "ahead",
        context: "User heading NW (300°), POI at NW (318°) - diff 17.8° is ahead"
    },
    
    // Case 2: Extreme test - POI directly ahead
    {
        name: "POI Directly Ahead",
        heading: 0,
        bearing: 0,
        expected: "ahead",
        context: "Both heading and bearing are North (0°)"
    },
    
    // Case 3: POI directly behind
    {
        name: "POI Directly Behind",
        heading: 0,
        bearing: 180,
        expected: "behind",
        context: "Heading North (0°), POI at South (180°)"
    },
    
    // Case 4: POI to the left
    {
        name: "POI to the Left",
        heading: 90,
        bearing: 0,
        expected: "left",
        context: "Heading East (90°), POI at North (0°) - diff -90° is left"
    },
    
    // Case 5: POI to the right
    {
        name: "POI to the Right",
        heading: 90,
        bearing: 180,
        expected: "right",
        context: "Heading East (90°), POI at South (180°) - diff 90° is right"
    },
    
    // Case 6: Edge case - exactly 45° to the right (boundary)
    {
        name: "Boundary Test - 45° Right",
        heading: 0,
        bearing: 45,
        expected: "ahead",
        context: "At 45° boundary, should still be 'ahead' (not > 45)"
    },
    
    // Case 7: Edge case - just over 45° to the right
    {
        name: "Boundary Test - 46° Right",
        heading: 0,
        bearing: 46,
        expected: "right",
        context: "Just over 45° boundary, should be 'right'"
    },
    
    // Case 8: Edge case - exactly 135° to the right (boundary)
    {
        name: "Boundary Test - 135° Right",
        heading: 0,
        bearing: 135,
        expected: "behind",
        context: "At 135° boundary, should be 'behind' (>= 135)"
    },
    
    // Case 9: Wrap-around test (crossing 0°/360°)
    {
        name: "Wrap-around Test - Crossing North",
        heading: 350,
        bearing: 10,
        expected: "ahead",
        context: "Heading 350° (almost North), POI at 10° (just past North) - diff 20° is ahead"
    },
    
    // Case 10: Invalid heading
    {
        name: "Invalid Heading Test",
        heading: -1,
        bearing: 90,
        expected: "around",
        context: "Invalid heading should return 'around'"
    },
    
    // Case 11: Real case from logs - heading 311.4, bearing 327.3
    // Diff: 15.9° - This is AHEAD
    {
        name: "Lago do Taboão (Real Log Case)",
        heading: 311.4174925226006,
        bearing: 327.3,
        expected: "ahead",
        context: "From logs: User heading NW (311°), POI at NW (327°) - diff 15.9° is ahead"
    },
    
    // Case 12: Real case - heading 323.37, bearing 304.4
    // Diff: -19° - This is AHEAD (within ±45°)
    {
        name: "Locomotiva (Real Log Case)",
        heading: 323.37452405854026,
        bearing: 304.4,
        expected: "ahead",
        context: "From logs: User heading NW (323°), POI at NW (304°) - diff -19° is ahead"
    },
    
    // Additional test: Clear RIGHT case
    {
        name: "Clear Right Case",
        heading: 0,
        bearing: 90,
        expected: "right",
        context: "Heading North, POI at East - diff 90° is clearly right"
    },
    
    // Additional test: Clear LEFT case
    {
        name: "Clear Left Case",
        heading: 0,
        bearing: 270,
        expected: "left",
        context: "Heading North, POI at West - diff -90° is clearly left"
    }
];

let passed = 0;
let failed = 0;

console.log("Running tests...\n");

testCases.forEach((test, index) => {
    const result = getDirectionBucket(test.heading, test.bearing);
    const success = result === test.expected;
    
    if (success) {
        passed++;
        console.log(`✅ Test ${index + 1}: ${test.name}`);
    } else {
        failed++;
        console.log(`❌ Test ${index + 1}: ${test.name}`);
        console.log(`   Context: ${test.context}`);
        console.log(`   Heading: ${test.heading}°, Bearing: ${test.bearing}°`);
        console.log(`   Expected: "${test.expected}", Got: "${result}"`);
        
        // Calculate the diff for debugging
        const diff = ((test.bearing - test.heading + 180) % 360) - 180;
        console.log(`   Calculated diff: ${diff.toFixed(2)}°`);
    }
    console.log("");
});

console.log("========================================================");
console.log(`Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);

if (failed > 0) {
    process.exit(1);
}
EOF

# Run the test
node /tmp/test_direction.js

# Cleanup
rm /tmp/test_direction.js
