// _shared/scoring.ts

export interface DescriptionScore {
    score_overall: number;
    subscores: {
        factuality: number;
        completeness: number;
        language: number;
        rules: number;
    };
    flags: string[];
}

/**
 * Heuristic scoring for descriptions
 */
export function calculateHeuristicScore(
    description: string,
    facts: any[],
    poiName: string,
    cityName: string
): DescriptionScore {
    const wordCount = description.split(/\s+/).length;
    
    // 1. Language & Structure (0-100)
    let langScore = 70; // Base
    if (wordCount >= 30 && wordCount <= 80) langScore += 20;
    else if (wordCount >= 20 && wordCount <= 120) langScore += 10;
    if (description.match(/\b(século|fundad|construíd|estabelecid)\b/i)) langScore += 10;
    
    // 2. Completeness (0-100)
    let completenessScore = 40;
    if (description.toLowerCase().includes(poiName.toLowerCase().split(' ')[0])) completenessScore += 20;
    if (description.includes(cityName)) completenessScore += 20;
    if (description.match(/\b\d{4}\b/)) completenessScore += 20;

    // 3. Factuality (Base assumption for Master Gen, usually high but penalized if empty)
    let factualityScore = facts.length >= 5 ? 100 : facts.length * 20;
    
    // 4. Rules (0-100)
    let rulesScore = 100;
    const prohibited = [/\b(telefone|rua|avenida|endereço|aberto|fechado|preço|ingresso)\b/i];
    const flags: string[] = [];
    
    for (const pattern of prohibited) {
        if (pattern.test(description)) {
            rulesScore -= 30;
            flags.push('prohibited_content');
        }
    }

    if (description.includes('...')) {
        rulesScore -= 10;
        flags.push('truncated');
    }

    // Weighted Overall
    const overall = Math.round(
        (factualityScore * 0.40) +
        (completenessScore * 0.30) +
        (langScore * 0.20) +
        (rulesScore * 0.10)
    );

    return {
        score_overall: Math.max(0, Math.min(100, overall)),
        subscores: {
            factuality: factualityScore,
            completeness: completenessScore,
            language: langScore,
            rules: rulesScore
        },
        flags
    };
}
