-- Inserir fontes de verificação confiáveis para o México
-- Primeiro, verificar se o México existe e obter seu ID
DO $$
DECLARE
    mexico_id uuid;
BEGIN
    -- Buscar o ID do México
    SELECT id INTO mexico_id FROM core.countries WHERE code = 'MX';
    
    -- Se o México não existir, inserir primeiro
    IF mexico_id IS NULL THEN
        INSERT INTO core.countries (code, name, name_native, flag_emoji, language_code, is_active)
        VALUES ('MX', 'México', 'México', '🇲🇽', 'es', true)
        RETURNING id INTO mexico_id;
        RAISE NOTICE 'México inserido com ID: %', mexico_id;
    ELSE
        RAISE NOTICE 'México já existe com ID: %', mexico_id;
    END IF;
    
    -- Inserir fontes oficiais do governo mexicano
    INSERT INTO core.country_verification_sources 
    (country_id, source_name, source_type, base_url, search_endpoint, api_key_required, priority, is_active, config)
    VALUES 
    -- Site oficial de turismo do México (SECTUR)
    (mexico_id, 'VisitMexico Oficial', 'government_tourism', 'https://www.visitmexico.com', '/search', false, 1, true, 
     '{"description": "Site oficial de turismo do México - Secretaria de Turismo (SECTUR)", "language": "es", "content_types": ["attractions", "hotels", "restaurants", "events"]}'::jsonb),
    
    -- Site do governo mexicano
    (mexico_id, 'Governo de México - SECTUR', 'government_official', 'https://www.gob.mx/sectur', '/buscar', false, 1, true,
     '{"description": "Portal oficial do governo mexicano - Secretaria de Turismo", "language": "es", "content_types": ["official_info", "policies", "statistics"]}'::jsonb),
    
    -- UNESCO World Heritage
    (mexico_id, 'UNESCO World Heritage Mexico', 'international_organization', 'https://whc.unesco.org', '/en/statesparties/mx', false, 2, true,
     '{"description": "Patrimônios mundiais da UNESCO no México", "language": "en", "content_types": ["heritage_sites", "cultural_sites", "natural_sites"]}'::jsonb),
    
    -- Lonely Planet
    (mexico_id, 'Lonely Planet Mexico', 'travel_guide', 'https://www.lonelyplanet.com', '/destinations/mexico', false, 3, true,
     '{"description": "Guia de viagem Lonely Planet para o México", "language": "en", "content_types": ["attractions", "travel_tips", "restaurants", "hotels"]}'::jsonb),
    
    -- TripAdvisor
    (mexico_id, 'TripAdvisor Mexico', 'travel_platform', 'https://www.tripadvisor.com', '/Tourism-g150800-Mexico_City_Central_Mexico_and_Gulf_Coast-Vacations.html', false, 4, true,
     '{"description": "Plataforma de viagens com avaliações e informações turísticas", "language": "multiple", "content_types": ["reviews", "attractions", "hotels", "restaurants"]}'::jsonb),
    
    -- Wikipedia (fonte complementar)
    (mexico_id, 'Wikipedia Turismo México', 'encyclopedia', 'https://pt.wikipedia.org', '/wiki/Turismo_no_México', false, 5, true,
     '{"description": "Enciclopédia colaborativa com informações sobre turismo no México", "language": "pt", "content_types": ["general_info", "history", "culture", "attractions"]}'::jsonb),
    
    -- Site específico da Cidade do México
    (mexico_id, 'Visit Mexico MX', 'tourism_portal', 'https://www.visit-mexico.mx', '/mexico-city', false, 2, true,
     '{"description": "Portal turístico especializado no México", "language": "en", "content_types": ["attractions", "travel_guides", "events", "accommodations"]}'::jsonb),
    
    -- Museus e Sítios Culturais
    (mexico_id, 'Museo Nacional de Antropología - INAH', 'official_museum', 'https://mna.inah.gob.mx/', '', false, 1, true,
     '{"description": "Museu Nacional de Antropologia - Instituto Nacional de Antropologia e História", "language": "es", "content_types": ["anthropology", "archaeology", "culture"], "institution": "INAH"}'::jsonb),
    
    (mexico_id, 'Museo del Templo Mayor - INAH', 'official_museum', 'https://www.templomayor.inah.gob.mx/', '', false, 1, true,
     '{"description": "Museu do Templo Mayor - Instituto Nacional de Antropologia e História", "language": "es", "content_types": ["archaeology", "aztec_culture", "history"], "institution": "INAH"}'::jsonb),
    
    (mexico_id, 'Museo Frida Kahlo - Casa Azul', 'official_museum', 'https://www.museofridakahlo.org.mx/', '', false, 2, true,
     '{"description": "Casa Azul - Museu oficial de Frida Kahlo", "language": "es", "content_types": ["art", "biography", "culture"], "artist": "Frida Kahlo"}'::jsonb),
    
    (mexico_id, 'Mexico City Official Website - Museums', 'government_official', 'https://mexicocity.cdmx.gob.mx/', '', false, 1, true,
     '{"description": "Site oficial da Cidade do México - informações sobre museus", "language": "en", "content_types": ["city_info", "museums", "culture"], "government": "CDMX"}'::jsonb),
    
    (mexico_id, 'Palacio Nacional - Secretaría de Hacienda', 'government_official', 'https://www.gob.mx/shcp/acciones-y-programas/cultura-en-la-secretaria-de-hacienda-y-credito-publico', '', false, 1, true,
     '{"description": "Palácio Nacional - Secretaria da Fazenda e Crédito Público", "language": "es", "content_types": ["history", "culture", "government"], "institution": "SHCP"}'::jsonb),
    
    (mexico_id, '101 Museos - Guía de Museos México', 'cultural_directory', 'https://www.101museos.com/', '', false, 3, true,
     '{"description": "Guia abrangente de museus no México", "language": "es", "content_types": ["museum_directory", "culture", "art"]}'::jsonb);
    
    RAISE NOTICE 'Fontes de verificação inseridas com sucesso para o México (ID: %)', mexico_id;
END $$;