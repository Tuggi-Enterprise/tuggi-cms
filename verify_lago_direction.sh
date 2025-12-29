#!/bin/bash

echo "🧮 Calculando Direção Real - Lago do Taboão"
echo "============================================"
echo ""

cat > /tmp/calc_lago.js << 'EOF'
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

// Dados REAIS extraídos do log (linha 91)
const heading = 311.4174925226006;  // Direção que o usuário está indo
const bearing = 327.3;               // Direção do POI em relação ao Norte

console.log("📍 Dados do Log:");
console.log(`   User Heading: ${heading.toFixed(2)}° (Noroeste)`);
console.log(`   POI Bearing:  ${bearing.toFixed(2)}° (Noroeste)`);
console.log("");

// Cálculo manual do diff
let diff = bearing - heading;
console.log(`🔢 Cálculo da Diferença Angular:`);
console.log(`   diff = bearing - heading`);
console.log(`   diff = ${bearing} - ${heading}`);
console.log(`   diff = ${diff.toFixed(2)}°`);
console.log("");

// Normalização
let normalized_diff = diff;
while (normalized_diff > 180) normalized_diff -= 360;
while (normalized_diff < -180) normalized_diff += 360;

console.log(`📐 Diferença Normalizada: ${normalized_diff.toFixed(2)}°`);
console.log("");

// Classificação
const direction = getDirectionBucket(heading, bearing);

console.log(`🎯 Resultado da Classificação:`);
console.log(`   Direção: "${direction}"`);
console.log("");

// Interpretação
console.log(`📖 Interpretação:`);
if (direction === "ahead") {
    console.log(`   ✅ O POI está ADIANTE (dentro do cone de ±45°)`);
    console.log(`   ✅ A IA está CORRETA ao dizer "surge adiante"`);
} else if (direction === "right") {
    console.log(`   ⚠️  O POI está à DIREITA`);
    console.log(`   ❌ A IA deveria dizer "olhe à direita"`);
} else if (direction === "left") {
    console.log(`   ⚠️  O POI está à ESQUERDA`);
    console.log(`   ❌ A IA deveria dizer "olhe à esquerda"`);
} else {
    console.log(`   ⚠️  O POI está ATRÁS`);
    console.log(`   ❌ A IA deveria dizer "olhe para trás"`);
}
console.log("");

// Visualização
console.log(`🧭 Visualização:`);
console.log(`   Usuário indo para: ${heading.toFixed(0)}° (Noroeste)`);
console.log(`   POI localizado em: ${bearing.toFixed(0)}° (Noroeste)`);
console.log(`   Diferença angular: ${normalized_diff.toFixed(1)}°`);
console.log("");
console.log(`   Cone "AHEAD": -45° a +45° (90° total)`);
console.log(`   Cone "RIGHT": +45° a +135°`);
console.log(`   Cone "LEFT":  -45° a -135°`);
console.log(`   Cone "BEHIND": ±135° a ±180°`);
EOF

node /tmp/calc_lago.js
rm /tmp/calc_lago.js
