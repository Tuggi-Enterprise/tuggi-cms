-- Script para inserir fontes de verificação para a Flórida
-- Este script adiciona os Estados Unidos na tabela core.countries (se não existir)
-- e insere fontes confiáveis de verificação para a Flórida

-- Inserir Estados Unidos se não existir
INSERT INTO core.countries (name, code, region, created_at, updated_at)
SELECT 'United States', 'US', 'North America', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM core.countries WHERE code = 'US'
);

-- Inserir fontes de verificação para a Flórida
INSERT INTO core.country_verification_sources (
    country_id,
    name,
    url,
    source_type,
    priority,
    is_active,
    configuration,
    created_at,
    updated_at
) VALUES
-- Fontes oficiais de turismo (prioridade alta)
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Visit Florida - Official Tourism Website',
    'https://www.visitflorida.org/',
    'tourism',
    1,
    true,
    '{"description": "Official tourism website of Florida, promoting tourism and providing comprehensive information about attractions, events, and destinations", "focus": ["tourism", "attractions", "events", "destinations"]}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Visit Florida Regional Guide',
    'https://www.visitflorida.com/',
    'tourism',
    2,
    true,
    '{"description": "Regional tourism guide for Florida with detailed information about different areas and attractions", "focus": ["regional_tourism", "destinations", "travel_guides"]}',
    NOW(),
    NOW()
),

-- Atrações turísticas famosas (prioridade alta)
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Kennedy Space Center Visitor Complex',
    'https://www.kennedyspacecenter.com/',
    'attraction',
    1,
    true,
    '{"description": "Official website of Kennedy Space Center, #1 top attraction in the United States, offering space exploration experiences and exhibits", "focus": ["space", "science", "history", "attractions"]}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Visit Orlando - Theme Parks',
    'https://www.visitorlando.com/',
    'attraction',
    2,
    true,
    '{"description": "Official Orlando tourism site featuring Disney World, Universal Studios, SeaWorld, and other major theme parks", "focus": ["theme_parks", "disney", "universal", "attractions"]}',
    NOW(),
    NOW()
),

-- Museus de arte e cultura (prioridade média)
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Salvador Dalí Museum',
    'https://thedali.org/',
    'museum',
    1,
    true,
    '{"description": "Official website of Salvador Dalí Museum in St. Petersburg, featuring the world\'s largest collection of Dalí works outside Spain", "focus": ["art", "surrealism", "culture", "exhibitions"]}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'The Ringling Museum of Art',
    'https://www.ringling.org/',
    'museum',
    1,
    true,
    '{"description": "The State Art Museum of Florida, administered by Florida State University, featuring art museum, circus museum, and historic mansion", "focus": ["art", "circus", "history", "culture"]}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Pérez Art Museum Miami (PAMM)',
    'https://www.pamm.org/en/',
    'museum',
    1,
    true,
    '{"description": "Contemporary art museum in Miami focusing on 20th and 21st century art, with emphasis on Latin American, Caribbean, and African diaspora artists", "focus": ["contemporary_art", "latin_american", "caribbean", "culture"]}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Sarasota Art Museum',
    'https://www.sarasotaartmuseum.org/',
    'museum',
    2,
    true,
    '{"description": "Contemporary art museum of Ringling College, featuring rotating exhibitions and site-specific installations", "focus": ["contemporary_art", "exhibitions", "education"]}',
    NOW(),
    NOW()
),

-- Museus de ciência e história (prioridade média)
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'The Bishop Museum of Science and Nature',
    'https://bishopscience.org/',
    'museum',
    2,
    true,
    '{"description": "Science and nature museum featuring planetarium, Florida history exhibits, and manatee rehabilitation habitat", "focus": ["science", "nature", "florida_history", "planetarium"]}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'American Space Museum & Walk of Fame',
    'https://spacewalkoffame.org/',
    'museum',
    3,
    true,
    '{"description": "Space museum in Titusville with artifacts from NASA, astronauts, and space workers, featuring exhibits on space history", "focus": ["space", "nasa", "history", "astronauts"]}',
    NOW(),
    NOW()
),

-- Museus especializados (prioridade baixa)
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'National Naval Aviation Museum',
    'https://www.navalaviationmuseum.org/',
    'museum',
    3,
    true,
    '{"description": "Specialized aviation museum at Naval Air Station Pensacola, focusing on naval aviation history of the United States", "focus": ["aviation", "naval_history", "military", "aircraft"]}',
    NOW(),
    NOW()
),
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Orlando Science Center',
    'https://www.osc.org/',
    'museum',
    3,
    true,
    '{"description": "Interactive science museum in Orlando providing experience-based learning opportunities in science and technology", "focus": ["science", "technology", "interactive_exhibits", "education"]}',
    NOW(),
    NOW()
),

-- Fonte governamental (prioridade média)
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Florida Department of State - Tourism',
    'https://dos.myflorida.com/',
    'government',
    2,
    true,
    '{"description": "Official Florida Department of State website with information on tourism and recreation", "focus": ["government", "tourism", "recreation", "official_information"]}',
    NOW(),
    NOW()
);

-- Fontes específicas das principais cidades da Flórida
-- Specialized Museums
INSERT INTO core.country_verification_sources (
    country_id,
    name,
    url,
    source_type,
    priority,
    is_active,
    configuration,
    created_at,
    updated_at
) VALUES
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Mel Fisher Maritime Heritage Society',
    'https://melfisher.org/',
    'museum',
    3,
    true,
    '{"focus": "maritime_history", "location": "Key West", "specialty": "treasure_hunting_history"}',
    NOW(),
    NOW()
),

-- Major Cities Tourism - Orlando
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Visit Orlando',
    'https://www.visitorlando.com/',
    'tourism',
    2,
    true,
    '{"city": "Orlando", "focus": "theme_parks_attractions", "official": true, "coverage": "central_florida"}',
    NOW(),
    NOW()
),

-- Major Cities Tourism - Miami
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Greater Miami Convention & Visitors Bureau',
    'https://www.miamiandbeaches.com/',
    'tourism',
    2,
    true,
    '{"city": "Miami", "focus": "beaches_culture_nightlife", "official": true, "coverage": "greater_miami_miami_beach"}',
    NOW(),
    NOW()
),

-- Major Cities Tourism - Florida Keys & Key West
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Florida Keys & Key West Tourism Council',
    'https://fla-keys.com/',
    'tourism',
    2,
    true,
    '{"city": "Key West", "focus": "keys_islands_marine_activities", "official": true, "coverage": "florida_keys"}',
    NOW(),
    NOW()
),

-- Major Cities Tourism - Jacksonville
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Visit Jacksonville',
    'https://www.visitjacksonville.com/',
    'tourism',
    2,
    true,
    '{"city": "Jacksonville", "focus": "beaches_culture_nature", "official": true, "coverage": "northeast_florida"}',
    NOW(),
    NOW()
),

-- Government Source
(
    (SELECT id FROM core.countries WHERE code = 'US'),
    'Florida Department of State - Tourism',
    'https://dos.myflorida.com/florida-facts/florida-maps-geography-and-statistics/tourism-and-recreation/',
    'government',
    2,
    true,
    '{"department": "state", "focus": "tourism_recreation", "official": true}',
    NOW(),
    NOW()
);

-- Comentário sobre as fontes inseridas
/*
Foram inseridas 19 fontes confiáveis de verificação para a Flórida:

1. Turismo Oficial:
   - Visit Florida (site oficial)
   - Visit Florida Regional Guide
   - Florida Department of State

2. Atrações Principais:
   - Kennedy Space Center (atração #1 dos EUA)
   - Visit Orlando (Disney, Universal, etc.)

3. Principais Cidades:
   - Visit Orlando (turismo oficial de Orlando)
   - Greater Miami Convention & Visitors Bureau (Miami)
   - Florida Keys & Key West Tourism Council (Key West)
   - Visit Jacksonville (Jacksonville)

4. Museus de Arte:
   - Salvador Dalí Museum (maior coleção mundial fora da Espanha)
   - The Ringling Museum (museu estadual de arte da Flórida)
   - Pérez Art Museum Miami (arte contemporânea)
   - Sarasota Art Museum (arte contemporânea)

5. Museus de Ciência e História:
   - The Bishop Museum of Science and Nature
   - American Space Museum & Walk of Fame
   - National Naval Aviation Museum
   - Orlando Science Center
   - Mel Fisher Maritime Heritage Society (Key West)

Todas as fontes são oficiais e confiáveis para coleta de conteúdo sobre a Flórida.
*/