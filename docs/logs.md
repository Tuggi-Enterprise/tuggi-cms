[AiGuideService:JIT] 🔍 Tier check for Estádio Cicero De Souza Marques: tier=premium, isPremium=YES
[AiGuideService] 🚀 Starting JIT Generation Race for POI: 6e62bea1-d1c2-316a-a7e9-2ff04483fba0
[AiGuideService:CACHE_DEBUG] 🔑 Hash Signature: "6e62bea1-d1c2-316a-a7e9-2ff04483fba0:primary:drive:north:none:none"
[AiGuideService:JIT] 📡 Requesting Unified Narration (Audio + Text)...
'[AiGuideService:PHASE_BACKEND_CALL] 📡 Full Request Object [Action: generate_audio]:', '{\n  "action": "generate_audio",\n  "travel_mode": "drive",\n  "hash": "d8c19bb9ee8de1413206989207dc6c578aaf629768609a888b16cb5a7a1b77ab",\n  "target_poi": {\n    "id": "6e62bea1-d1c2-316a-a7e9-2ff04483fba0",\n    "type": "primary",\n    "name": "Estádio Cicero De Souza Marques",\n    "bearing": 188,\n    "distance": 0,\n    "location": {\n      "latitude": -22.9489334810715,\n      "longitude": -46.5300635446653\n    }\n  },\n  "user_context": {\n    "speed": 0,\n    "heading": 235.77754612584351,\n    "language": "en-us",\n    "accuracy": null,\n    "altitude": 0,\n    "platform": "ios",\n    "app_version": "0.0.27",\n    "timestamp": 1767387992102,\n    "location": {\n      "latitude": -22.94891149989434,\n      "longitude": -46.53028136787054\n    },\n    "next_poi_candidates": [],\n    "user_profile": {\n      "id": "44e580aa-61cf-475e-9db0-c0ed7d069334",\n      "email": "",\n      "tier": "premium"\n    },\n    "trip_session_id": "7c861cdd-11a9-47e0-a66f-f65359b35376",\n    "trip_start_timestamp": 1767387969369\n  }\n}'
[AiGuideService] 🛡️ Payload Summary: Heading: 235.77754612584351, PreviousPOI: none
'[AiGuideService] Network Error:', { [FunctionsHttpError: Edge Function returned a non-2xx status code]
  name: 'FunctionsHttpError',
  context: 
   { type: 'default',
     status: 500,
     ok: false,
     statusText: '',
     headers: 
      { map: 
         { 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, accept, origin, referer, user-agent',
           'access-control-allow-origin': '*',
           'alt-svc': 'h3=":443"; ma=86400',
           'cf-cache-status': 'DYNAMIC',
           'cf-ray': '9b7d3886bc28c14e-GRU',
           'content-encoding': 'gzip',
           'content-length': '221',
           'content-type': 'application/json',
           date: 'Fri, 02 Jan 2026 21:06:34 GMT',
           priority: 'u=3,i',
           'sb-project-ref': 'tysnkzmljlmmqpbotkxv',
           'sb-request-id': '019b8088-9045-7c3d-9d4e-7f0c66aa0058',
           server: 'cloudflare',
           'server-timing': 'cfExtPri',
           'set-cookie': '__cf_bm=_RNZXszQuX3CyQifZgxjrIFv2jspsq31UgXIXaEgPQY-1767387994-1.0.1.1-fKc.zC.Iqr5oJhLPnp9l3jrh1.vDB3aCctLiUAYCq0utUGXhDw_13g7Du1.kIXqdttbhDH6ftu4HWF_wS5G8VOIdaS.Tb7WuoOeJA56qNxc; path=/; expires=Fri, 02-Jan-26 21:36:34 GMT; domain=.supabase.co; HttpOnly; Secure; SameSite=None',
           'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
           vary: 'Accept-Encoding',
           'x-deno-execution-id': '43b803f3-ca63-4c18-86e6-45ca7f997f50',
           'x-sb-edge-region': 'sa-east-1',
           'x-served-by': 'supabase-edge-runtime' } },
     url: 'https://tysnkzmljlmmqpbotkxv.supabase.co/functions/v1/generate-contextual-narration',
     bodyUsed: false,
     _bodyInit: 
      { _data: 
         { size: 237,
           offset: 0,
           blobId: '01A10867-659E-4390-AEBF-14EED465A774',
           type: 'application/json',
           name: 'generate-contextual-narration.json',
           __collector: {} } },
     _bodyBlob: 
      { _data: 
         { size: 237,
           offset: 0,
           blobId: '01A10867-659E-4390-AEBF-14EED465A774',
           type: 'application/json',
           name: 'generate-contextual-narration.json',
           __collector: {} } } } }
[AiGuideService:JIT] ❌ Unified generation failed
[AiGuideService:JIT] 🔊 Playing fallback for 6e62bea1-d1c2-316a-a7e9-2ff04483fba0: 1 tracks