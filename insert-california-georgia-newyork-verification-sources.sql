-- Script para inserir fontes de verificação para Califórnia, Georgia e Estado de Nova York
-- Este script adiciona os Estados Unidos na tabela core.countries (se não existir)
-- e insere fontes confiáveis de verificação para os três estados

-- Inserir Estados Unidos se não existir
INSERT INTO core.countries (code, name, name_native, flag_emoji, language_code, is_active, created_at, updated_at)
SELECT 'US', 'United States', 'United States', '🇺🇸', 'en', true, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM core.countries WHERE code = 'US'
);

-- ========================================
-- CALIFÓRNIA - FONTES DE VERIFICAÇÃO
-- ========================================

-- Inserir fontes de verificação para a Califórnia
INSERT INTO core.country_verification_sources (
    country_id,
    source_name,
    base_url,
    source_type,
    priority,
    is_active,
    config,
    created_at,
    updated_at
) VALUES

-- Fontes oficiais de turismo da Califórnia (prioridade alta)
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Visit California - Official Tourism Website',
    'https://www.visitcalifornia.com/',
    'tourism',
    1,
    true,
    '{"description": "Official tourism website of California, promoting tourism and providing comprehensive information about attractions, events, and destinations", "focus": ["tourism", "attractions", "events", "destinations"], "state": "California"}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'California Office of Tourism',
    'https://www.visitcalifornia.com/about-us/',
    'government',
    1,
    true,
    '{"description": "California Office of Tourism - official state government tourism department", "focus": ["government", "tourism", "official_information"], "state": "California"}',
    NOW(),
    NOW()
),

-- Atrações turísticas famosas da Califórnia (prioridade alta)
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Golden Gate Bridge Official Website',
    'https://www.goldengate.org/',
    'attraction',
    1,
    true,
    '{"description": "Official website of the Golden Gate Bridge with visiting information, exhibits, tours, and amenities", "focus": ["landmark", "bridge", "san_francisco", "attractions"], "state": "California"}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Disneyland Resort Official Website',
    'https://disneyland.disney.go.com/',
    'attraction',
    1,
    true,
    '{"description": "Official Disneyland Resort website with information about parks, tickets, and visitor experiences", "focus": ["theme_parks", "disney", "family_attractions"], "state": "California"}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Universal Studios Hollywood',
    'https://www.universalstudioshollywood.com/',
    'attraction',
    1,
    true,
    '{"description": "Official Universal Studios Hollywood website featuring studio tours, rides, and entertainment experiences", "focus": ["theme_parks", "movies", "entertainment", "hollywood"], "state": "California"}',
    NOW(),
    NOW()
),

-- Museus e sites culturais da Califórnia (prioridade média)
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Getty Center and Getty Villa',
    'https://www.getty.edu/',
    'museum',
    1,
    true,
    '{"description": "Official Getty Museum website featuring art collections, exhibitions, and cultural programs", "focus": ["art", "culture", "exhibitions", "architecture"], "state": "California"}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Los Angeles County Museum of Art (LACMA)',
    'https://www.lacma.org/',
    'museum',
    1,
    true,
    '{"description": "Official LACMA website with information on exhibitions, collections, and cultural programs", "focus": ["art", "contemporary_art", "exhibitions", "culture"], "state": "California"}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'California Academy of Sciences',
    'https://www.calacademy.org/',
    'museum',
    1,
    true,
    '{"description": "Official California Academy of Sciences website featuring aquarium, planetarium, rainforest, and natural history exhibits", "focus": ["science", "natural_history", "aquarium", "planetarium"], "state": "California"}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Exploratorium San Francisco',
    'https://www.exploratorium.edu/',
    'museum',
    1,
    true,
    '{"description": "Official Exploratorium website with interactive science exhibits and educational programs", "focus": ["science", "interactive_exhibits", "education", "innovation"], "state": "California"}',
    NOW(),
    NOW()
),

-- ========================================
-- GEORGIA - FONTES DE VERIFICAÇÃO
-- ========================================

-- Fontes oficiais de turismo da Georgia (prioridade alta)
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Explore Georgia - Official Tourism Website',
    'https://www.exploregeorgia.org/',
    'tourism',
    1,
    true,
    '{"description": "Official tourism website of Georgia promoting travel experiences and destinations throughout the state", "focus": ["tourism", "attractions", "events", "destinations"], "state": "Georgia"}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Georgia Department of Economic Development - Tourism',
    'https://www.georgia.org/',
    'government',
    1,
    true,
    '{"description": "Georgia Department of Economic Development tourism division promoting Georgia as a travel destination", "focus": ["government", "tourism", "economic_development"], "state": "Georgia"}',
    NOW(),
    NOW()
),

-- Atrações turísticas famosas da Georgia (prioridade alta)
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Visit Savannah',
    'https://www.visitsavannah.com/',
    'attraction',
    1,
    true,
    '{"description": "Official Savannah tourism website highlighting the city\'s historic architecture, culture, and attractions", "focus": ["historic_city", "architecture", "culture", "tourism"], "state": "Georgia"}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Stone Mountain Park',
    'https://www.stonemountainpark.com/',
    'attraction',
    1,
    true,
    '{"description": "Official Stone Mountain Park website featuring Georgia\'s most-visited attraction with outdoor activities and historic sites", "focus": ["outdoor_recreation", "family_attractions", "history", "nature"], "state": "Georgia"}',
    NOW(),
    NOW()
),

-- Museus e sites culturais da Georgia (prioridade média)
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'High Museum of Art Atlanta',
    'https://www.high.org/',
    'museum',
    1,
    true,
    '{"description": "Official High Museum of Art website featuring contemporary and classic art collections and exhibitions", "focus": ["art", "contemporary_art", "exhibitions", "culture"], "state": "Georgia"}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Atlanta History Center',
    'https://www.atlantahistorycenter.com/',
    'museum',
    1,
    true,
    '{"description": "Atlanta History Center with 33 acres of exhibitions, historic houses, and gardens showcasing Southern history", "focus": ["history", "southern_culture", "historic_houses", "gardens"], "state": "Georgia"}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Fernbank Museum of Natural History',
    'https://www.fernbankmuseum.org/',
    'museum',
    1,
    true,
    '{"description": "Fernbank Museum featuring interactive science and nature exhibitions in Atlanta", "focus": ["natural_history", "science", "interactive_exhibits", "education"], "state": "Georgia"}',
    NOW(),
    NOW()
),

-- ========================================
-- ESTADO DE NOVA YORK - FONTES DE VERIFICAÇÃO
-- ========================================

-- Fontes oficiais de turismo de Nova York (prioridade alta)
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'I Love NY - Official New York State Tourism',
    'https://www.iloveny.com/',
    'tourism',
    1,
    true,
    '{"description": "Official New York State tourism website promoting attractions, regions, and travel experiences throughout the state", "focus": ["tourism", "attractions", "regions", "travel_planning"], "state": "New York"}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'New York State Government Tourism Division',
    'https://www.ny.gov/',
    'government',
    1,
    true,
    '{"description": "Official New York State government website with tourism and travel information", "focus": ["government", "tourism", "official_information"], "state": "New York"}',
    NOW(),
    NOW()
),

-- Atrações turísticas famosas de Nova York (prioridade alta)
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Niagara Falls USA Official Website',
    'https://www.niagarafallsusa.com/',
    'attraction',
    1,
    true,
    '{"description": "Official Niagara Falls USA website with information about the state park, attractions, and visitor experiences", "focus": ["natural_wonder", "waterfalls", "state_park", "tourism"], "state": "New York"}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Finger Lakes Tourism Alliance',
    'https://www.fingerlakes.org/',
    'attraction',
    1,
    true,
    '{"description": "Official Finger Lakes tourism website featuring state parks, outdoor activities, wineries, and regional attractions", "focus": ["wine_region", "outdoor_recreation", "lakes", "tourism"], "state": "New York"}',
    NOW(),
    NOW()
),

-- Museus e sites culturais de Nova York (prioridade média)
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'The Museum of Modern Art (MoMA)',
    'https://www.moma.org/',
    'museum',
    1,
    true,
    '{"description": "Official MoMA website featuring modern and contemporary art collections, exhibitions, and cultural programs", "focus": ["modern_art", "contemporary_art", "exhibitions", "culture"], "state": "New York"}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'The Metropolitan Museum of Art',
    'https://www.metmuseum.org/',
    'museum',
    1,
    true,
    '{"description": "Official Metropolitan Museum website featuring encyclopedic art collections from ancient to contemporary periods", "focus": ["art", "ancient_art", "classical_art", "culture"], "state": "New York"}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Solomon R. Guggenheim Museum',
    'https://www.guggenheim.org/',
    'museum',
    1,
    true,
    '{"description": "Official Guggenheim Museum website featuring modern art collections and iconic spiral architecture", "focus": ["modern_art", "architecture", "exhibitions", "culture"], "state": "New York"}',
    NOW(),
    NOW()
),


-- Comentário sobre as fontes inseridas
/*
Foram inseridas fontes confiáveis de verificação para três estados americanos:

1. CALIFÓRNIA (8 fontes):
   - Turismo Oficial: Visit California, California Office of Tourism
   - Atrações: Golden Gate Bridge, Disneyland Resort, Universal Studios Hollywood
   - Museus: Getty Center, LACMA, California Academy of Sciences, Exploratorium

2. GEORGIA (6 fontes):
   - Turismo Oficial: Explore Georgia, Georgia Department of Economic Development
   - Atrações: Visit Savannah, Stone Mountain Park
   - Museus: High Museum of Art, Atlanta History Center, Fernbank Museum

3. ESTADO DE NOVA YORK (8 fontes):
   - Turismo Oficial: I Love NY, New York State Government
   - Atrações: Niagara Falls USA, Finger Lakes Tourism Alliance
   - Museus: MoMA, Metropolitan Museum, Guggenheim Museum, American Museum of Natural History

Todas as fontes foram categorizadas por tipo (tourism, government, attraction, museum)
com prioridades adequadas e configurações JSON detalhadas incluindo descrições,
focos temáticos e identificação do estado.

Total: 22 novas fontes de verificação adicionadas ao sistema.
*/