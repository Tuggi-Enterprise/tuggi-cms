[TurboModuleRegistry] AccessibilityInfo not ready yet (get), using fallback proxy. The real module will be used once ReactInstance is created.
ProgressBarAndroid has been extracted from react-native core and will be removed in a future release. It can now be installed and imported from '@react-native-community/progress-bar-android' instead of 'react-native'. See https://github.com/react-native-progress-view/progress-bar-android
SafeAreaView has been deprecated and will be removed in a future release. Please use 'react-native-safe-area-context' instead. See https://github.com/th3rdwave/react-native-safe-area-context
Clipboard has been extracted from react-native core and will be removed in a future release. It can now be installed and imported from '@react-native-clipboard/clipboard' instead of 'react-native'. See https://github.com/react-native-clipboard/clipboard
[TurboModuleRegistry] DialogManagerAndroid not ready yet (get), using fallback proxy. The real module will be used once ReactInstance is created.
[TurboModuleRegistry] PermissionsAndroid not ready yet (get), using fallback proxy. The real module will be used once ReactInstance is created.
PushNotificationIOS has been extracted from react-native core and will be removed in a future release. It can now be installed and imported from '@react-native-community/push-notification-ios' instead of 'react-native'. See https://github.com/react-native-push-notification/ios
[TurboModuleRegistry] PushNotificationManager not ready yet (get), using fallback proxy. The real module will be used once ReactInstance is created.
[TurboModuleRegistry] ShareModule not ready yet (get), using fallback proxy. The real module will be used once ReactInstance is created.
[GPS-IOS:NATIVE:INFO] ✅ GPS tracking stopped
[GuideLocationService] ✅ Native iOS GPS service stopped
[TrailSimulator] ✅ Native iOS GPS service stopped for simulation
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.986718',
  lng: '-46.520499',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:34:55.016Z',
  age: 7100 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.986718, lng=-46.520499, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.986718, lng=-46.520499, speed=50.00 m/s, heading=152.3, total TPs=105
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 5 TPs (from 105 total)
[TriggerDetectionService] 🔍 After distance filter: 5 TPs (from 105 total)
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 290, crc 3833732382, actualSize 29720
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 1)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9867',
  lng: '-46.5205',
  source: 'simulated',
  timestamp: '2025-12-29T17:34:55.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9867', lng: '-46.5205', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.986718',
  lng: '-46.520499',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '152.3',
  timestamp: '2025-12-29T17:35:02.120Z',
  age: 7.929931640625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9867, lng=-46.5205
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9867, lng=-46.5205, radius=2.00km, context=movement
[POICacheHelper] ✅ Found 3 POIs within 2.0km radius from cache (limited from 3 total)
[POILoadingService] ✅ Cache HIT: Found 3 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.0s (context: movement)
[AudioPreloadService] 🔍 Checking 3 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 3 total POIs, 3 with audio, 0 without audio
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 3 POIs, 20 TPs
[AudioPreloadService] 📥 Preloading audio for 3 POIs
[AudioPreloadService] ⏳ Waiting for all 3 preload operations to complete...
[AudioPreloadService] 🔍 Preload [2/3]: Checking cache for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [1/3]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/3]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/3]: Completed for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - duration: 0.004s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/3]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.007s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/3]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.010s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.011s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979349,-46.529028,30
[GuideEngine] 🕒 Schedule check: 3 active POIs (out of 3 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.978985', lng: '-46.529333' },
  last: { lat: '-22.986718', lng: '-46.520499' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978985,-46.529333,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.978985', lng: '-46.529333' },
  last: { lat: '-22.986718', lng: '-46.520499' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978985,-46.529333,30
[NativeMarkerManager] ⚠️ Using all TPs as last resort (count: 20)
[POICustomClusterRenderer] 🎨 renderClusters called: 0 clusters
[NativeMarkerManager] 🔍 Rendering 20 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0035)
[NativeMarkerManager] Update complete: 20 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978985,-46.529333,30
[NativeMarkerManager] ⚠️ Using all TPs as last resort (count: 20)
[POICustomClusterRenderer] 🎨 renderClusters called: 0 clusters
[NativeMarkerManager] 🔍 Rendering 20 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0046)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978985,-46.529333,30
[NativeMarkerManager] Update complete: 20 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978985,-46.529333,30
[NativeMarkerManager] ⚠️ Using all TPs as last resort (count: 20)
[POICustomClusterRenderer] 🎨 renderClusters called: 0 clusters
[NativeMarkerManager] 🔍 Rendering 20 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0065)
[NativeMarkerManager] ⚠️ Using all TPs as last resort (count: 20)
[POICustomClusterRenderer] 🎨 renderClusters called: 0 clusters
[NativeMarkerManager] 🔍 Rendering 20 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0071)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978985,-46.529333,30
[NativeMarkerManager] Update complete: 20 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978985,-46.529333,30
[POICustomClusterRenderer] 🎨 renderClusters called: 0 clusters
[NativeMarkerManager] 🔍 Rendering 1 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0094)
[NativeMarkerManager] Update complete: 20 markers
[NativeMarkerManager] Update complete: 1 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 0 clusters
[NativeMarkerManager] 🔍 Rendering 1 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0109)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978985,-46.529333,30
[POICustomClusterRenderer] 🎨 renderClusters called: 0 clusters
[NativeMarkerManager] 🔍 Rendering 5 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0126)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978985,-46.529333,30
[NativeMarkerManager] Update complete: 1 markers
[NativeMarkerManager] Update complete: 5 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978985,-46.529333,30
[POICustomClusterRenderer] 🎨 renderClusters called: 2 clusters
[NativeMarkerManager] 🔍 Rendering 12 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0167)
[NativeMarkerManager] Update complete: 14 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 2 clusters
[NativeMarkerManager] 🔍 Rendering 12 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0191)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978985,-46.529333,30
[NativeMarkerManager] Update complete: 14 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 2 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978985,-46.529333,30
[NativeMarkerManager] 🔍 Rendering 13 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0221)
[NativeMarkerManager] Update complete: 15 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 2 clusters
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9867, lng=-46.5205, radius=4.63km, context=viewport_change
[NativeMarkerManager] 🔍 Rendering 13 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0278)
[NativeMarkerManager] Update complete: 15 markers
[POICacheHelper] ✅ Found 35 POIs within 4.6km radius from cache (limited from 35 total)
[POILoadingService] ✅ Cache HIT: Found 35 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[AudioPreloadService] 🔍 Checking 35 POIs for audio preload
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 35 total POIs, 35 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.007s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - duration: 0.014s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 35 POIs, 138 TPs
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 35 visible POIs, 0 cached POIs, total: 35 POIs. TPs: 138 visible, 0 cached, total: 138
[GuideEngine] 🕒 Schedule check: 35 active POIs (out of 35 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.016s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978985,-46.529333,30
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.018s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.019s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.026s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 3 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.978985', lng: '-46.529333' },
  last: { lat: '-22.986718', lng: '-46.520499' } }
[NativeMarkerManager] 🔍 Rendering 29 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0278)
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978985,-46.529333,30
[NativeMarkerManager] Update complete: 32 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 3 clusters
[RouteTrailSyncService] Syncing 1 pending points...
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.986327',
  lng: '-46.521512',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:34:56.016Z',
  age: 7113 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.986327, lng=-46.521512, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.986327, lng=-46.521512, speed=50.00 m/s, heading=292.7, total TPs=138
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 TP near user: Parque Ecológico Municipal Bosque Das Araucárias (lat=-22.986527, lng=-46.521099) - distance=47.76m
[TriggerDetectionService] 🔍 Distance filter result: 19 TPs (from 138 total)
[TriggerDetectionService] 🔍 After distance filter: 19 TPs (from 138 total)
[StorageService] setItem called for key: last_gps_location
[TriggerDetectionService] 🔍 TP nearby: Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - distance=47.76m, baseRadius=30m, adaptiveRadius=45.00m, speed=50.00 m/s
[TriggerDetectionService] ⏸️ TP outside adaptive radius: Parque Ecológico Municipal Bosque Das Araucárias (distance=47.76m > adaptiveRadius=45.00m)
[StorageService] setItem completed for key: last_gps_location
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 2)
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9863',
  lng: '-46.5215',
  source: 'simulated',
  timestamp: '2025-12-29T17:34:56.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9863', lng: '-46.5215', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.986327',
  lng: '-46.521512',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '292.7',
  timestamp: '2025-12-29T17:35:03.131Z',
  age: 1.419189453125 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9863, lng=-46.5215
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978985,-46.529333,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.978781', lng: '-46.529471' },
  last: { lat: '-22.986327', lng: '-46.521512' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
🌐 [NetworkSpeedLogger] Network: WIFI (FAST 🚀) - ✅ Network speed OK - ✅ CONNECTED - Guide Active
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
[POICustomClusterRenderer] 🎨 renderClusters called: 7 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
[NativeMarkerManager] 🔍 Rendering 57 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0290)
[NativeMarkerManager] Update complete: 65 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 7 clusters
[NativeMarkerManager] 🔍 Rendering 58 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0299)
[NativeMarkerManager] Update complete: 66 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
[NativeMarkerManager] 🔍 Rendering 83 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0299)
[NativeMarkerManager] Update complete: 98 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9866, lng=-46.5209, radius=5.26km, context=viewport_change
[POICacheHelper] ✅ Found 41 POIs within 5.3km radius from cache (limited from 41 total)
[POILoadingService] ✅ Cache HIT: Found 41 POIs in cache
[AudioPreloadService] 🔍 Checking 41 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 41 total POIs, 41 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.005s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - duration: 0.010s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.014s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 41 POIs, 153 TPs
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 41 visible POIs, 0 cached POIs, total: 41 POIs. TPs: 153 visible, 0 cached, total: 153
[GuideEngine] 🕒 Schedule check: 41 active POIs (out of 41 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.019s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.023s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.025s
[NativeMarkerManager] 🔍 Rendering 84 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] Update complete: 99 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
[NativeMarkerManager] 🔍 Rendering 86 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 102 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.978781', lng: '-46.529471' },
  last: { lat: '-22.986327', lng: '-46.521512' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[NativeMarkerManager] 🔍 Rendering 86 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
[NativeMarkerManager] Update complete: 101 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
[POICustomClusterRenderer] 🎨 renderClusters called: 7 clusters
[NativeMarkerManager] 🔍 Rendering 72 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0285)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
[POICustomClusterRenderer] 🎨 renderClusters called: 7 clusters
[NativeMarkerManager] 🔍 Rendering 72 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0255)
[NativeMarkerManager] Update complete: 82 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
[POICustomClusterRenderer] 🎨 renderClusters called: 7 clusters
[NativeMarkerManager] 🔍 Rendering 72 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0247)
[NativeMarkerManager] Update complete: 82 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 7 clusters
[NativeMarkerManager] Update complete: 82 markers
[NativeMarkerManager] 🔍 Rendering 72 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0247)
[NativeMarkerManager] Update complete: 82 markers
[RouteTrailHelper] 🧹 Removed 1 synced points from MMKV pending buffer
[RouteTrailSyncService] ✅ Synced 1 points successfully
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559","name":"Parque Ecológico Municipal Bosque Das Araucárias","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"la
[POICustomClusterRenderer] 🎨 renderClusters called: 7 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"69d3d623-d201-4ffe-9933-603e9af0e06f","name":"Trigger Point 69d3d623-d201-4ffe-9933-603e9af0e06f","attraction_id":"057b3ece-3f90-3b56-81e8-010f20b14668","attraction_name":"Aeroporto Estadual A
[POILoadingService] 🔍 [SYNC] Received 20 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 20 valid trigger points
[POICacheHelper] ✅ Saved 3 POIs to cache v4
[POILoadingService] ✅ Synced 3 POIs, 20 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 3 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 3 POIs, 20 TPs
[GuideEngine] 🕒 Schedule check: 3 active POIs (out of 3 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.978781', lng: '-46.529471' },
  last: { lat: '-22.986327', lng: '-46.521512' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
[POICustomClusterRenderer] 🎨 renderClusters called: 3 clusters
[NativeMarkerManager] 🔍 Rendering 20 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0247)
[NativeMarkerManager] Update complete: 23 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9863, lng=-46.5215, radius=5.26km, context=viewport_change
[POICacheHelper] ✅ Found 42 POIs within 5.3km radius from cache (limited from 42 total)
[POILoadingService] ✅ Cache HIT: Found 42 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 42 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 42 POIs, 157 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 42 total POIs, 42 with audio, 0 without audio
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[AudioPreloadService] 📥 Preloading audio for 5 POIs
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 42 visible POIs, 0 cached POIs, total: 42 POIs. TPs: 157 visible, 0 cached, total: 157
[GuideEngine] 🕒 Schedule check: 42 active POIs (out of 42 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - duration: 0.006s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.010s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.013s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.016s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[AudioPreloadService] ✅ Preload [5/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.018s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.022s
[POICustomClusterRenderer] 🎨 renderClusters called: 7 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.978781', lng: '-46.529471' },
  last: { lat: '-22.986327', lng: '-46.521512' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
[NativeMarkerManager] 🔍 Rendering 72 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0247)
[NativeMarkerManager] Update complete: 82 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.986204',
  lng: '-46.521830',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:34:57.016Z',
  age: 7113 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.986204, lng=-46.521830, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.986204, lng=-46.521830, speed=50.00 m/s, heading=292.8, total TPs=157
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 21 TPs (from 157 total)
[TriggerDetectionService] 🔍 After distance filter: 21 TPs (from 157 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9862',
  lng: '-46.5218',
  source: 'simulated',
  timestamp: '2025-12-29T17:34:57.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9862', lng: '-46.5218', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 2)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.986204',
  lng: '-46.521830',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '292.8',
  timestamp: '2025-12-29T17:35:04.130Z',
  age: 0.36181640625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9862, lng=-46.5218
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978781,-46.529471,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.978652', lng: '-46.529574' },
  last: { lat: '-22.986204', lng: '-46.521830' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978652,-46.529574,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978652,-46.529574,30
[POICustomClusterRenderer] 🎨 renderClusters called: 7 clusters
[POICustomClusterRenderer] 🎨 renderClusters called: 7 clusters
[NativeMarkerManager] 🔍 Rendering 72 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0247)
[NativeMarkerManager] Update complete: 82 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978652,-46.529574,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978652,-46.529574,30
[POICustomClusterRenderer] 🎨 renderClusters called: 7 clusters
[NativeMarkerManager] 🔍 Rendering 72 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0247)
[NativeMarkerManager] Update complete: 82 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978652,-46.529574,30
[POICustomClusterRenderer] 🎨 renderClusters called: 8 clusters
[NativeMarkerManager] 🔍 Rendering 72 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0247)
[POICustomClusterRenderer] 🎨 renderClusters called: 8 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978652,-46.529574,30
[NativeMarkerManager] 🔍 Rendering 72 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0247)
[NativeMarkerManager] Update complete: 83 markers
[NativeMarkerManager] Update complete: 83 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978652,-46.529574,30
[POICustomClusterRenderer] 🎨 renderClusters called: 8 clusters
[NativeMarkerManager] 🔍 Rendering 72 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0247)
[POICustomClusterRenderer] 🎨 renderClusters called: 8 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978652,-46.529574,30
nw_protocol_socket_set_no_wake_from_sleep [C8.1.1:2] setsockopt SO_NOWAKEFROMSLEEP failed [22: Invalid argument]
nw_protocol_socket_set_no_wake_from_sleep setsockopt SO_NOWAKEFROMSLEEP failed [22: Invalid argument]
nw_protocol_socket_set_no_wake_from_sleep [C8.1.1:2] setsockopt SO_NOWAKEFROMSLEEP failed [22: Invalid argument]
[NativeMarkerManager] 🔍 Rendering 72 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0247)
[NativeMarkerManager] Update complete: 83 markers
nw_protocol_socket_set_no_wake_from_sleep setsockopt SO_NOWAKEFROMSLEEP failed [22: Invalid argument]
[NativeMarkerManager] Update complete: 83 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 8 clusters
[NativeMarkerManager] 🔍 Rendering 72 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0247)
[NativeMarkerManager] Update complete: 83 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978652,-46.529574,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICustomClusterRenderer] 🎨 renderClusters called: 8 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978652,-46.529574,30
[NativeMarkerManager] 🔍 Rendering 72 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0247)
[NativeMarkerManager] Update complete: 83 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 8 clusters
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9863, lng=-46.5216, radius=5.24km, context=viewport_change
[POICacheHelper] ✅ Found 42 POIs within 5.2km radius from cache (limited from 42 total)
[POILoadingService] ✅ Cache HIT: Found 42 POIs in cache
[NativeMarkerManager] 🔍 Rendering 72 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0247)
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[NativeMarkerManager] Update complete: 83 markers
[AudioPreloadService] 🔍 Checking 42 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 42 total POIs, 42 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.005s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.010s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.014s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 42 POIs, 157 TPs
[AudioCacheHelper] ✅ Found cached audio: poiId=2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - duration: 0.017s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 42 visible POIs, 0 cached POIs, total: 42 POIs. TPs: 157 visible, 0 cached, total: 157
[GuideEngine] 🕒 Schedule check: 42 active POIs (out of 42 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978652,-46.529574,30
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.020s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.023s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 8 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.978652', lng: '-46.529574' },
  last: { lat: '-22.986204', lng: '-46.521830' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978652,-46.529574,30
[NativeMarkerManager] 🔍 Rendering 72 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0247)
[NativeMarkerManager] Update complete: 83 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 8 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 138 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 138 valid trigger points
[POICacheHelper] ✅ Saved 35 POIs to cache v4
[POILoadingService] ✅ Synced 35 POIs, 138 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 35 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 35 POIs, 138 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 35 active POIs (out of 35 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978652,-46.529574,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 8 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.978652', lng: '-46.529574' },
  last: { lat: '-22.986204', lng: '-46.521830' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978652,-46.529574,30
[NativeMarkerManager] 🔍 Rendering 72 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0247)
[NativeMarkerManager] Update complete: 83 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.986020',
  lng: '-46.522244',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:34:58.016Z',
  age: 7130 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.986020, lng=-46.522244, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.986020, lng=-46.522244, speed=50.00 m/s, heading=295.8, total TPs=138
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 23 TPs (from 138 total)
[TriggerDetectionService] 🔍 After distance filter: 23 TPs (from 138 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9860',
  lng: '-46.5222',
  source: 'simulated',
  timestamp: '2025-12-29T17:34:58.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9860', lng: '-46.5222', source: 'simulated' }
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 291, crc 2784556395, actualSize 30697
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.986020',
  lng: '-46.522244',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '295.8',
  timestamp: '2025-12-29T17:35:05.147Z',
  age: 0.93701171875 }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 3)
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9860, lng=-46.5222
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978652,-46.529574,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.978477', lng: '-46.529741' },
  last: { lat: '-22.986020', lng: '-46.522244' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978477,-46.529741,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978477,-46.529741,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978477,-46.529741,30
[POICustomClusterRenderer] 🎨 renderClusters called: 8 clusters
[NativeMarkerManager] 🔍 Rendering 73 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0248)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978477,-46.529741,30
[POICustomClusterRenderer] 🎨 renderClusters called: 8 clusters
[NativeMarkerManager] 🔍 Rendering 73 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0248)
[NativeMarkerManager] Update complete: 85 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978477,-46.529741,30
[NativeMarkerManager] 🔍 Rendering 73 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0249)
[NativeMarkerManager] Update complete: 85 markers
[NativeMarkerManager] Update complete: 86 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978477,-46.529741,30
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManager] 🔍 Rendering 73 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0250)
[NativeMarkerManager] Update complete: 86 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978477,-46.529741,30
[NativeMarkerManager] 🔍 Rendering 73 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0252)
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[NativeMarkerManager] Update complete: 86 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978477,-46.529741,30
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManager] 🔍 Rendering 74 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0252)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978477,-46.529741,30
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManager] 🔍 Rendering 75 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0253)
[NativeMarkerManager] Update complete: 87 markers
[NativeMarkerManager] Update complete: 88 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9862, lng=-46.5219, radius=5.24km, context=viewport_change
[POICacheHelper] ✅ Found 42 POIs within 5.2km radius from cache (limited from 42 total)
[POILoadingService] ✅ Cache HIT: Found 42 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[AudioPreloadService] 🔍 Checking 42 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 42 total POIs, 42 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978477,-46.529741,30
[NativeMarkerManager] 🔍 Rendering 76 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0254)
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.007s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - duration: 0.009s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 42 POIs, 157 TPs
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.024s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] Update complete: 89 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 42 visible POIs, 0 cached POIs, total: 42 POIs. TPs: 157 visible, 0 cached, total: 157
[GuideEngine] 🕒 Schedule check: 42 active POIs (out of 42 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.030s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978477,-46.529741,30
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.034s
[NativeMarkerManager] 🔍 Rendering 76 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0256)
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.036s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] Update complete: 89 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978477,-46.529741,30
[NativeMarkerManager] 🔍 Rendering 76 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0257)
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[NativeMarkerManager] Update complete: 89 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.978477', lng: '-46.529741' },
  last: { lat: '-22.986020', lng: '-46.522244' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978477,-46.529741,30
[NativeMarkerManager] 🔍 Rendering 76 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0257)
[NativeMarkerManager] Update complete: 89 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 157 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 157 valid trigger points
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICacheHelper] ✅ Saved 42 POIs to cache v4
[POILoadingService] ✅ Synced 42 POIs, 157 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 42 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 42 POIs, 157 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 42 active POIs (out of 42 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978477,-46.529741,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.978477', lng: '-46.529741' },
  last: { lat: '-22.986020', lng: '-46.522244' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978477,-46.529741,30
[NativeMarkerManager] 🔍 Rendering 76 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0257)
[NativeMarkerManager] Update complete: 89 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.985799',
  lng: '-46.522658',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:34:59.016Z',
  age: 7146 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.985799, lng=-46.522658, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.985799, lng=-46.522658, speed=50.00 m/s, heading=300.1, total TPs=157
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 23 TPs (from 157 total)
[TriggerDetectionService] 🔍 After distance filter: 23 TPs (from 157 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9858',
  lng: '-46.5227',
  source: 'simulated',
  timestamp: '2025-12-29T17:34:59.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9858', lng: '-46.5227', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 4)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.985799',
  lng: '-46.522658',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '300.1',
  timestamp: '2025-12-29T17:35:06.163Z',
  age: 0.39013671875 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9858, lng=-46.5227
[AiGuideService:PHASE1_CONE] 👁️ Detected 1 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 50cd5835-70db-41be-9084-3adcae63c15e | Dist: 395m | Angle: 17.8°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978477,-46.529741,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.978414', lng: '-46.529818' },
  last: { lat: '-22.985799', lng: '-46.522658' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978414,-46.529818,30
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978414,-46.529818,30
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978414,-46.529818,30
[NativeMarkerManager] 🔍 Rendering 78 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0258)
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManager] Update complete: 91 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978414,-46.529818,30
[NativeMarkerManager] 🔍 Rendering 79 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0259)
[NativeMarkerManager] Update complete: 92 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978414,-46.529818,30
[NativeMarkerManager] 🔍 Rendering 81 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0260)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978414,-46.529818,30
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManager] 🔍 Rendering 82 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0263)
[NativeMarkerManager] Update complete: 94 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManager] 🔍 Rendering 84 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0264)
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 157 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 157 valid trigger points
[NativeMarkerManager] Update complete: 95 markers
[NativeMarkerManager] Update complete: 98 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978414,-46.529818,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978414,-46.529818,30
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManager] 🔍 Rendering 86 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0270)
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManager] Update complete: 100 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978414,-46.529818,30
[NativeMarkerManager] 🔍 Rendering 86 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0270)
[NativeMarkerManager] Update complete: 100 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9860, lng=-46.5223, radius=5.26km, context=viewport_change
[POICacheHelper] ✅ Saved 42 POIs to cache v4
[POICacheHelper] ✅ Found 42 POIs within 5.3km radius from cache (limited from 42 total)
[POILoadingService] ✅ Cache HIT: Found 42 POIs in cache
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[NativeMarkerManager] 🔍 Rendering 86 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0270)
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[POILoadingService] ✅ Synced 42 POIs, 157 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 42 POIs synced
[NativeMarkerManager] Update complete: 100 markers
[AudioPreloadService] 🔍 Checking 42 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 42 total POIs, 42 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.019s
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 42 POIs, 157 TPs
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.046s
[POILoadingService] 🔍 [SYNC] Received 157 trigger points from RPC
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 42 POIs, 157 TPs
[POILoadingService] ✅ [SYNC] Parsed 157 valid trigger points
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - duration: 0.068s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.066s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.065s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.087s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 42 active POIs (out of 42 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 42 visible POIs, 0 cached POIs, total: 42 POIs. TPs: 157 visible, 0 cached, total: 157
[GuideEngine] 🕒 Schedule check: 42 active POIs (out of 42 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[POICacheHelper] ✅ Saved 42 POIs to cache v4
[POILoadingService] ✅ Synced 42 POIs, 157 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 42 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 42 POIs, 157 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 42 active POIs (out of 42 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978414,-46.529818,30
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.978414', lng: '-46.529818' },
  last: { lat: '-22.985799', lng: '-46.522658' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978414,-46.529818,30
[NativeMarkerManager] 🔍 Rendering 86 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0270)
[NativeMarkerManager] Update complete: 100 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[AudioCache] ✅ Found Cache for POI=50cd5835-70db-41be-9084-3adcae63c15e: [Audio: false, Text: true]
[AiGuideService:CACHE_FOUND_TEXT] 📜 Found cached text for POI 50cd5835-70db-41be-9084-3adcae63c15e, but audio is missing. Proceeding to fresh generation.
[AiGuideService:PHASE2_TEXT_REQ] 📜 Requesting text for POI 50cd5835-70db-41be-9084-3adcae63c15e
'[AiGuideService:PHASE_BACKEND_CALL] 📡 Full Request Object [Action: generate_text]:', '{\n  "action": "generate_text",\n  "travel_mode": "drive",\n  "target_poi": {\n    "id": "50cd5835-70db-41be-9084-3adcae63c15e",\n    "type": "tuggi",\n    "bearing": 317.9,\n    "distance": 395,\n    "location": {\n      "latitude": -22.985799,\n      "longitude": -46.522658\n    }\n  },\n  "user_context": {\n    "speed": 180,\n    "heading": 300.1074996174516,\n    "language": "pt-br",\n    "location": {\n      "latitude": -22.985799,\n      "longitude": -46.522658\n    }\n  }\n}'
[AiGuideService] 🛡️ Payload Summary: Heading: 300.1074996174516, PreviousPOI: none
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.985268',
  lng: '-46.523370',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:00.016Z',
  age: 7146 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.985268, lng=-46.523370, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.985268, lng=-46.523370, speed=50.00 m/s, heading=309.0, total TPs=157
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 24 TPs (from 157 total)
[TriggerDetectionService] 🔍 After distance filter: 24 TPs (from 157 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9853',
  lng: '-46.5234',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:00.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9853', lng: '-46.5234', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 5)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.985268',
  lng: '-46.523370',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '309.0',
  timestamp: '2025-12-29T17:35:07.163Z',
  age: 0.333984375 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9853, lng=-46.5234
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.978414,-46.529818,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.977967', lng: '-46.530430' },
  last: { lat: '-22.985268', lng: '-46.523370' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977967,-46.530430,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977967,-46.530430,30
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977967,-46.530430,30
[NativeMarkerManager] 🔍 Rendering 86 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0272)
[NativeMarkerManager] Update complete: 101 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9858, lng=-46.5227, radius=5.26km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977967,-46.530430,30
[POICacheHelper] ✅ Found 43 POIs within 5.3km radius from cache (limited from 43 total)
[POILoadingService] ✅ Cache HIT: Found 43 POIs in cache
[AudioPreloadService] 🔍 Checking 43 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 43 total POIs, 43 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] 🔍 Rendering 86 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0274)
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.005s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] Update complete: 101 markers
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.012s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 43 POIs, 160 TPs
[AudioCacheHelper] ✅ Found cached audio: poiId=2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - duration: 0.015s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 43 visible POIs, 0 cached POIs, total: 43 POIs. TPs: 160 visible, 0 cached, total: 160
[GuideEngine] 🕒 Schedule check: 43 active POIs (out of 43 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.019s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977967,-46.530430,30
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.025s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.027s
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[NativeMarkerManager] 🔍 Rendering 86 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0274)
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977967,-46.530430,30
[NativeMarkerManager] 🔍 Rendering 86 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0274)
[NativeMarkerManager] Update complete: 102 markers
[NativeMarkerManager] Update complete: 102 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.977967', lng: '-46.530430' },
  last: { lat: '-22.985268', lng: '-46.523370' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977967,-46.530430,30
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[NativeMarkerManager] 🔍 Rendering 87 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0278)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977967,-46.530430,30
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[NativeMarkerManager] Update complete: 103 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977967,-46.530430,30
[NativeMarkerManager] 🔍 Rendering 88 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0281)
[NativeMarkerManager] Update complete: 104 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977967,-46.530430,30
[NativeMarkerManager] 🔍 Rendering 88 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0284)
[NativeMarkerManager] Update complete: 104 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977967,-46.530430,30
[NativeMarkerManager] 🔍 Rendering 88 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0286)
[NativeMarkerManager] Update complete: 104 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977967,-46.530430,30
[NativeMarkerManager] 🔍 Rendering 88 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0290)
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[NativeMarkerManager] Update complete: 104 markers
[NativeMarkerManager] 🔍 Rendering 88 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0292)
[NativeMarkerManager] Update complete: 104 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977967,-46.530430,30
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[NativeMarkerManager] 🔍 Rendering 88 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0292)
[NativeMarkerManager] Update complete: 104 markers
[AiGuideService:PHASE2_TEXT_SUCCESS] ✅ Generated Text for 50cd5835-70db-41be-9084-3adcae63c15e: "E então, meus amigos, à medida que avançamos, olhem adiante! Estamos chegando em Bragança Paulista, uma terra com raízes que remontam a 1763, quando era conhecida como Conceição do Jaguary. Imaginem só, tudo começou com uma capela erguida por Antônio Pires Pimentel e sua esposa. Mas a história que realmente me arrepia é a do "Clube dos Escravos", uma associação do século XIX que abriu as portas do conhecimento para muitos. Hoje, essa cidade nos encanta com um título delicioso: a "Capital da Linguiça"! E preparem-se, pois a nossa jornada está apenas começando, e mais surpresas incríveis nos esperam logo ali adiante!"
[AudioCache] 📜 Contextual Text Saved only for 50cd5835-70db-41be-9084-3adcae63c15e (Hash: 50cd5835-70db-41be-9084-3adcae63c15e:tuggi:pt-br:drive:ahead:none:none:none)
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 157 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 157 valid trigger points
[POICacheHelper] ✅ Saved 42 POIs to cache v4
[POILoadingService] ✅ Synced 42 POIs, 157 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 42 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 42 POIs, 157 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 42 active POIs (out of 42 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977967,-46.530430,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.977967', lng: '-46.530430' },
  last: { lat: '-22.985268', lng: '-46.523370' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977967,-46.530430,30
[NativeMarkerManager] 🔍 Rendering 88 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0292)
[NativeMarkerManager] Update complete: 104 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.984845',
  lng: '-46.523769',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:01.016Z',
  age: 7163 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.984845, lng=-46.523769, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.984845, lng=-46.523769, speed=50.00 m/s, heading=319.0, total TPs=157
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 24 TPs (from 157 total)
[TriggerDetectionService] 🔍 After distance filter: 24 TPs (from 157 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9848',
  lng: '-46.5238',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:01.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9848', lng: '-46.5238', source: 'simulated' }
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 292, crc 2915469704, actualSize 32185
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.984845',
  lng: '-46.523769',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '319.0',
  timestamp: '2025-12-29T17:35:08.180Z',
  age: 0.8271484375 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 6)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977967,-46.530430,30
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9848, lng=-46.5238
[AiGuideService:PHASE1_CONE] 👁️ Detected 1 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 50cd5835-70db-41be-9084-3adcae63c15e | Dist: 240m | Angle: 2.0°
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.977660', lng: '-46.530808' },
  last: { lat: '-22.984845', lng: '-46.523769' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977660,-46.530808,30
🌐 [NetworkSpeedLogger] Network: WIFI (FAST 🚀) - ✅ Network speed OK - ✅ CONNECTED - Guide Active
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977660,-46.530808,30
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9852, lng=-46.5234, radius=5.17km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[POICacheHelper] ✅ Found 42 POIs within 5.2km radius from cache (limited from 42 total)
[POILoadingService] ✅ Cache HIT: Found 42 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 42 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 42 total POIs, 42 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.006s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.011s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 42 POIs, 157 TPs
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 42 visible POIs, 0 cached POIs, total: 42 POIs. TPs: 157 visible, 0 cached, total: 157
[AudioCacheHelper] ✅ Found cached audio: poiId=2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e, lang=pt-br, gender=male
[GuideEngine] 🕒 Schedule check: 42 active POIs (out of 42 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioPreloadService] ✅ Preload [3/5]: Completed for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - duration: 0.033s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977660,-46.530808,30
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] 🔍 Rendering 89 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0294)
[NativeMarkerManager] Update complete: 106 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.051s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977660,-46.530808,30
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.055s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.057s
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.977660', lng: '-46.530808' },
  last: { lat: '-22.984845', lng: '-46.523769' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977660,-46.530808,30
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0294)
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] Update complete: 107 markers
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0295)
[NativeMarkerManager] Update complete: 107 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[NativeMarkerManager] Update complete: 108 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977660,-46.530808,30
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977660,-46.530808,30
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0302)
[NativeMarkerManager] Update complete: 109 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977660,-46.530808,30
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[NativeMarkerManager] Update complete: 109 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 109 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977660,-46.530808,30
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977660,-46.530808,30
[NativeMarkerManager] 🔍 Rendering 91 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 110 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977660,-46.530808,30
[NativeMarkerManager] 🔍 Rendering 91 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
[NativeMarkerManager] Update complete: 110 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977660,-46.530808,30
[NativeMarkerManager] 🔍 Rendering 91 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] Update complete: 110 markers
[NativeMarkerManager] 🔍 Rendering 91 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
[NativeMarkerManager] Update complete: 110 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 157 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 157 valid trigger points
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.983787',
  lng: '-46.524688',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:02.016Z',
  age: 7180 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.983787, lng=-46.524688, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.983787, lng=-46.524688, speed=50.00 m/s, heading=321.4, total TPs=157
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 31 TPs (from 157 total)
[TriggerDetectionService] 🔍 After distance filter: 31 TPs (from 157 total)
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9838, lng=-46.5247, radius=2.00km, context=movement
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9838',
  lng: '-46.5247',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:02.016Z' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 7)
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9838', lng: '-46.5247', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.983787',
  lng: '-46.524688',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '321.4',
  timestamp: '2025-12-29T17:35:09.200Z',
  age: 3.916015625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9838, lng=-46.5247
[AiGuideService:PHASE1_CONE] 👁️ Detected 1 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 50cd5835-70db-41be-9084-3adcae63c15e | Dist: 89m | Angle: -0.8°
[POICacheHelper] ✅ Saved 42 POIs to cache v4
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977660,-46.530808,30
[POICacheHelper] ✅ Found 6 POIs within 2.0km radius from cache (limited from 6 total)
[POILoadingService] ✅ Cache HIT: Found 6 POIs in cache
[AudioPreloadService] 🔍 Checking 6 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.0s (context: movement)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 6 total POIs, 6 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[POILoadingService] ✅ Synced 42 POIs, 157 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 42 POIs synced
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 6 POIs, 33 TPs
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.004s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.007s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.009s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.012s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.014s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 42 POIs, 157 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.049s
[GuideEngine] 🕒 Schedule check: 6 active POIs (out of 6 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 42 active POIs (out of 42 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977660,-46.530808,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.977449', lng: '-46.531005' },
  last: { lat: '-22.983787', lng: '-46.524688' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977449,-46.531005,30
[NativeMarkerManager] 🔍 Rendering 91 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
[NativeMarkerManager] Update complete: 110 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977449,-46.531005,30
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977449,-46.531005,30
[NativeMarkerManager] 🔍 Rendering 91 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
[NativeMarkerManager] Update complete: 110 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9848, lng=-46.5238, radius=5.15km, context=viewport_change
[POICacheHelper] ✅ Found 43 POIs within 5.1km radius from cache (limited from 43 total)
[POILoadingService] ✅ Cache HIT: Found 43 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 43 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 43 total POIs, 43 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.007s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.010s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 43 POIs, 160 TPs
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 43 visible POIs, 0 cached POIs, total: 43 POIs. TPs: 160 visible, 0 cached, total: 160
[GuideEngine] 🕒 Schedule check: 43 active POIs (out of 43 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.014s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977449,-46.531005,30
[AudioPreloadService] ✅ Preload [5/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.018s
[NativeMarkerManager] 🔍 Rendering 92 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Mirante Por do sol (POI: 2ece2f9a-13b3-398e-a6aa-f19c1d1a8e7e) - duration: 0.023s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.026s
[NativeMarkerManager] Update complete: 111 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977449,-46.531005,30
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.977449', lng: '-46.531005' },
  last: { lat: '-22.983787', lng: '-46.524688' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977449,-46.531005,30
[NativeMarkerManager] 🔍 Rendering 92 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] Update complete: 111 markers
[NativeMarkerManager] 🔍 Rendering 93 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0310)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977449,-46.531005,30
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] Update complete: 112 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977449,-46.531005,30
[NativeMarkerManager] 🔍 Rendering 93 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0310)
[NativeMarkerManager] Update complete: 112 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977449,-46.531005,30
[NativeMarkerManager] 🔍 Rendering 93 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0310)
[NativeMarkerManager] Update complete: 112 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] 🔍 Rendering 94 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 113 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977449,-46.531005,30
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] 🔍 Rendering 94 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 113 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977449,-46.531005,30
[NativeMarkerManager] 🔍 Rendering 94 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 113 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] 🔍 Rendering 94 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 113 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977449,-46.531005,30
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977449,-46.531005,30
[NativeMarkerManager] 🔍 Rendering 94 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 113 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] 🔍 Rendering 94 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 113 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 160 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 160 valid trigger points
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[POICacheHelper] ✅ Saved 43 POIs to cache v4
[POILoadingService] ✅ Synced 43 POIs, 160 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 43 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 43 POIs, 160 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 43 active POIs (out of 43 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977449,-46.531005,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.977449', lng: '-46.531005' },
  last: { lat: '-22.983787', lng: '-46.524688' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977449,-46.531005,30
[NativeMarkerManager] 🔍 Rendering 94 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 113 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.983258',
  lng: '-46.525122',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:03.016Z',
  age: 7196 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.983258, lng=-46.525122, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.983258, lng=-46.525122, speed=50.00 m/s, heading=322.9, total TPs=160
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 TP near user: Município de Bragança Paulista (lat=-22.983167, lng=-46.525242) - distance=15.94m
[StorageService] setItem called for key: last_gps_location
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 8)
[TriggerDetectionService] 🔍 Distance filter result: 33 TPs (from 160 total)
[TriggerDetectionService] 🔍 After distance filter: 33 TPs (from 160 total)
[StorageService] setItem completed for key: last_gps_location
[TriggerDetectionService] 🔍 TP nearby: Município de Bragança Paulista (POI: 50cd5835-70db-41be-9084-3adcae63c15e) - distance=15.94m, baseRadius=47m, adaptiveRadius=70.50m, speed=50.00 m/s
[TriggerDetectionService] ✅ Added POI to cooldown: 50cd5835-70db-41be-9084-3adcae63c15e (duration: 630s, total in cooldown: 1)
[TriggerDetectionService] 🧭 BEARING DEBUG: Município de Bragança Paulista (POI: 50cd5835-70db-41be-9084-3adcae63c15e) - tp.expectedBearing=328.3, userBearing(trail)=322.9, location.heading=322.9
[TriggerDetectionService] 🔍 Direction calculated (expectedBearing vs trail): Município de Bragança Paulista - expectedBearing=328.3, userBearing=322.9 (from trail), delta=5.4, direction=front
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9833',
  lng: '-46.5251',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:03.016Z' }
[TriggerDetectionService] 🎯 Trigger detected: Município de Bragança Paulista (POI: 50cd5835-70db-41be-9084-3adcae63c15e, distance: 15.9m, direction: front)
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9833', lng: '-46.5251', source: 'simulated' }
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.983258',
  lng: '-46.525122',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '322.9',
  timestamp: '2025-12-29T17:35:10.213Z',
  age: 13.548095703125 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9833, lng=-46.5251
[AiGuideService:PHASE1_CONE] 👁️ Detected 1 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 50cd5835-70db-41be-9084-3adcae63c15e | Dist: 16m | Angle: -13.5°
[AudioCacheHelper] ✅ Found cached audio: poiId=nil, lang=pt-br, gender=male
[TriggerDetectionService] ✅ Found directional audio in cache: /Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/vtyixk-pt-br-male.mp3
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ❌ No row found in cache (SQLITE_DONE)
[AudioCacheHelper] ❌ Audio not found in cache: poiId=50cd5835-70db-41be-9084-3adcae63c15e, lang=pt-br, gender=male
[AudioCacheHelper] ❌ Audio not found in cache
[TriggerDetectionService] 🔊 Playing audio sequence for Município de Bragança Paulista
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977449,-46.531005,30
[TuggiAudioPlayer] 🎵 playSequenceDirectly: Starting sequence with 2 tracks (native call)
[TuggiAudioPlayer] 🎵 Playing track 0 directly: /Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/vtyixk-pt-br-male.mp3
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.977271', lng: '-46.531120' },
  last: { lat: '-22.983258', lng: '-46.525122' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977271,-46.531120,30
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.983052',
  lng: '-46.525292',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:04.016Z',
  age: 7815 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9831',
  lng: '-46.5253',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:04.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9831', lng: '-46.5253', source: 'simulated' }
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977271,-46.531120,30
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.983052, lng=-46.525292, speed=50.00), dispatching to background thread
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 293, crc 3525966169, actualSize 33729
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 9)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.983052',
  lng: '-46.525292',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '322.8',
  timestamp: '2025-12-29T17:35:11.841Z',
  age: 280.543212890625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9831, lng=-46.5253
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977271,-46.531120,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] ⏹️ Sync cancelled for key: sync_-22.9848_-46.5238_5.1
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.977134', lng: '-46.531190' },
  last: { lat: '-22.983052', lng: '-46.525292' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977134,-46.531190,30
[POILoadingService] 🔍 [SYNC] Received 160 trigger points from RPC
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"057b3ece-3f90-3b56-81e8-010f20b14668","name":"Aeroporto Estadual Arthur Siqueira","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.98
[POILoadingService] ✅ [SYNC] Parsed 160 valid trigger points
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9833, lng=-46.5251, radius=5.21km, context=viewport_change
AudioSessionManager: 🎵 Switching to ducking mode for TP playback...
[POICacheHelper] ✅ Found 43 POIs within 5.2km radius from cache (limited from 43 total)
[POILoadingService] ✅ Cache HIT: Found 43 POIs in cache
[AudioPreloadService] 🔍 Checking 43 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 43 total POIs, 43 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[NativeMarkerManager] Update complete: 118 markers
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.005s
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
AudioSessionManager: 🦆 DUCKING ACTIVE (Spotify volume reduced)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.010s
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 43 POIs, 160 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 43 visible POIs, 0 cached POIs, total: 43 POIs. TPs: 160 visible, 0 cached, total: 160
[GuideEngine] 🕒 Schedule check: 43 active POIs (out of 43 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.016s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977134,-46.531190,30
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.017s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.019s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.030s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977134,-46.531190,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 118 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.977134', lng: '-46.531190' },
  last: { lat: '-22.983052', lng: '-46.525292' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977134,-46.531190,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977134,-46.531190,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
       LoudnessManager.mm:1755  ReadPListFile: unable to open stream for LoudnessManager plist
[POICacheHelper] ✅ Saved 43 POIs to cache v4
       LoudnessManager.mm:1261  GetHardwarePlatformKey: cannot get acoustic ID
       LoudnessManager.mm:1215  IsHardwareSupported: no plist loaded, returning false
       LoudnessManager.mm:1215  IsHardwareSupported: no plist loaded, returning false
[POILoadingService] ✅ Synced 43 POIs, 160 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 43 POIs synced
[NativeMarkerManager] Update complete: 118 markers
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 43 POIs, 160 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 43 active POIs (out of 43 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977134,-46.531190,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[TuggiAudioPlayer] ✅ Track 0 started playing (native call)
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 1: sendEventSafelyWithName called
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 2: Event name: onPlaybackTrackChanged
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 5: Bridge available
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 6: Current thread: BACKGROUND
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 7: Body type: __NSDictionaryI, body: {
    trackIndex = 0;
    url = "/Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/vtyixk-pt-br-male.mp3";
}
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 8: Not on main thread, dispatching to main queue
[RCTEventEmitter+ThreadSafe:INFO] 📤 COMPLETE: sendEventSafelyWithName finished for event: onPlaybackTrackChanged
[TriggerDetectionService] 📢 Posted 'TriggerDetectedEvent' notification for Município de Bragança Paulista
[TriggerDetectionService] 📊 System volume captured: 60.0%
[TriggerDetectionService] 🔍 Processing location update: lat=-22.983052, lng=-46.525292, speed=50.00 m/s, heading=322.8, total TPs=160
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 TP near user: Município de Bragança Paulista (lat=-22.983167, lng=-46.525242) - distance=13.76m
[TriggerDetectionService] 🔍 Distance filter result: 35 TPs (from 160 total)
[TriggerDetectionService] 🔍 After distance filter: 35 TPs (from 160 total)
[TriggerDetectionService] 🔍 TP nearby: Município de Bragança Paulista (POI: 50cd5835-70db-41be-9084-3adcae63c15e) - distance=13.76m, baseRadius=47m, adaptiveRadius=70.50m, speed=50.00 m/s
[TriggerDetectionService] ⏸️ POI in cooldown: 50cd5835-70db-41be-9084-3adcae63c15e (remaining: 628s, total in cooldown: 1)
[TriggerDetectionService] ⏸️ TP in cooldown: Município de Bragança Paulista (POI: 50cd5835-70db-41be-9084-3adcae63c15e)
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] 🔍 Rendering 99 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977134,-46.531190,30
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 9: Now on main thread after dispatch
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 10: Bridge still available, sending event
[RCTEventEmitter+ThreadSafe:SUCCESS] ✅ STEP 11: Event sent successfully (dispatched to main)
         HALC_ProxyIOContext.cpp:1623  HALC_ProxyIOContext::IOWorkLoop: skipping cycle due to overload
[NativeMarkerManager] Update complete: 119 markers
'[NativeAudioService] 🎵 Track changed:', { url: '/Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/vtyixk-pt-br-male.mp3',
  trackIndex: 0 }
'[NativeAudioService] ✅ Event received on platform:', 'ios'
'[NativeAudioService] 📊 Event data:', '{"url":"/Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/vtyixk-pt-br-male.mp3","trackIndex":0}'
[SimpleAudioService] 🎵 Track changed: 0 - Audio confirmed playing
'[SimpleAudioService] 📊 Track changed event data:', '{"url":"/Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/vtyixk-pt-br-male.mp3","trackIndex":0}'
'[SimpleAudioService] 🔍 Pending trigger data:', null
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.977134', lng: '-46.531190' },
  last: { lat: '-22.983052', lng: '-46.525292' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977134,-46.531190,30
TuggiAudioPlayer: ✅ Now Playing Info updated (direct call) - Title: Município de Bragança Paulista, Artist: Tuggi
[TRIGGER-IOS:BRIDGE:SUCCESS] ✅ TriggerDetected event enqueued to JS (dispatched): Município de Bragança Paulista
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
         HALC_ProxyIOContext.cpp:1623  HALC_ProxyIOContext::IOWorkLoop: skipping cycle due to overload
[GuideEngine:JS:DEBUG] 🎯 STEP 2: Trigger detected event received in JavaScript listener
'[GuideEngine:JS:DEBUG] 🎯 STEP 3: Event data:', { triggerId: '2f7c5e2e-633b-4eed-bdf0-8b5a47455bf0',
  poiId: '50cd5835-70db-41be-9084-3adcae63c15e',
  name: 'Município de Bragança Paulista',
  latitude: -22.9831668767169,
  longitude: -46.5252421455383,
  direction: 'front',
  audioDescriptionId: '3cf3a72c-95db-4d1d-8355-527d21f944f2',
  timestamp: 1767029712366 }
[GuideEngine:JS:DEBUG] 🎯 STEP 4: Processing trigger detected event...
🎯 [GuideEngine] Native trigger detected: Município de Bragança Paulista (audioDescriptionId: 3cf3a72c-95db-4d1d-8355-527d21f944f2)
[AiGuideService] 🚩 Last visited POI updated: 50cd5835-70db-41be-9084-3adcae63c15e (tuggi) - Name: Município de Bragança Paulista
[NativeMarkerManager] 🔍 Rendering 99 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 119 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"69d3d623-d201-4ffe-9933-603e9af0e06f","name":"Trigger Point 69d3d623-d201-4ffe-9933-603e9af0e06f","attraction_id":"057b3ece-3f90-3b56-81e8-010f20b14668","attraction_name":"Aeroporto Estadual A
[POILoadingService] 🔍 [SYNC] Received 33 trigger points from RPC
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[POILoadingService] ✅ [SYNC] Parsed 33 valid trigger points
[NativeMarkerManager] 🔍 Rendering 99 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 119 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977134,-46.531190,30
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] 🔍 Rendering 99 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 119 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[SupabaseRPCClient] 📥 Raw response (first 200 chars): "9bc6bb08-c8ef-4ac9-845f-1bd191618b77"
[SupabaseRPCClient] 🔧 Detected string response, wrapping in array: [9bc6bb08-c8ef-4ac9-845f-1bd191618b77]
[POILoadingService] ⏹️ Sync cancelled after network fetch: sync_-22.9848_-46.5238_5.1
[TriggerDetectionService] ✅ POI visit recorded: Município de Bragança Paulista (visitId: 9bc6bb08-c8ef-4ac9-845f-1bd191618b77)
[POILoadingService] ⚠️ Background sync returned no POIs or was cancelled
[POICacheHelper] ✅ Saved 6 POIs to cache v4
[POILoadingService] ✅ Synced 6 POIs, 33 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 6 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 6 POIs, 33 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
[GuideEngine] 🕒 Schedule check: 6 active POIs (out of 6 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977134,-46.531190,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.977134', lng: '-46.531190' },
  last: { lat: '-22.983052', lng: '-46.525292' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977134,-46.531190,30
[POICustomClusterRenderer] 🎨 renderClusters called: 6 clusters
[NativeMarkerManager] 🔍 Rendering 33 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 39 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.982650',
  lng: '-46.525671',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:05.016Z',
  age: 7830 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.982650, lng=-46.525671, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.982650, lng=-46.525671, speed=50.00 m/s, heading=319.0, total TPs=33
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 29 TPs (from 33 total)
[StorageService] setItem called for key: last_gps_location
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 10)
[TriggerDetectionService] 🔍 After distance filter: 29 TPs (from 33 total)
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9826',
  lng: '-46.5257',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:05.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9826', lng: '-46.5257', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.982650',
  lng: '-46.525671',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '319.0',
  timestamp: '2025-12-29T17:35:12.847Z',
  age: 18.116943359375 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9826, lng=-46.5257
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977134,-46.531190,30
[GuideEngine] 🚀 Triggering Audio Pipe for Município de Bragança Paulista (Hash: 3138add09f222872c90685d185cfc05df4cd8f69942a4213e8d0f549a3b5ccf2)
🎵 [SimpleAudioService] Playing guide audio for POI: Município de Bragança Paulista
[StorageService] setItem called for key: cache_audio_state
[StorageService] setItem completed for key: cache_audio_state
[SimpleAudioService] Releasing audio system for other apps...
[NativeAudioService] ⏹️ Stopping playback
TuggiAudioPlayer: ⏹️ Stopping playback
'🔄 [AudioPlaybackProvider] Audio state changed:', { isPlaying: true,
  currentPOI: 'Município de Bragança Paulista',
  currentDirection: null,
  playbackType: 'guide',
  currentAudioUrl: '' }
[StorageService] setItem called for key: cache_audio_state
[StorageService] setItem completed for key: cache_audio_state
[StorageService] setItem called for key: cache_audio_state
[StorageService] setItem completed for key: cache_audio_state
'🔄 [AudioPlaybackProvider] Audio state changed:', { isPlaying: false,
  currentPOI: null,
  currentDirection: null,
  playbackType: null,
  currentAudioUrl: null }
[StorageService] setItem called for key: cache_audio_state
[StorageService] setItem completed for key: cache_audio_state
TuggiAudioPlayer: ⏹️ Local playback stopped
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.977013', lng: '-46.531246' },
  last: { lat: '-22.982650', lng: '-46.525671' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
AudioSessionManager: 📢 Notifying other apps to restore volume...
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977013,-46.531246,30
AudioSessionManager: 🤝 COEXISTENCE ACTIVE (Spotify volume restored)
TuggiAudioPlayer: ✅ Now Playing Info cleared
[SimpleAudioService] ✅ Audio system released successfully - other apps should resume automatically
[StorageService] setItem called for key: can_cache_audio_a47cf2d0-7413-4e78-afd3-7d262c019ffa
[StorageService] setItem completed for key: can_cache_audio_a47cf2d0-7413-4e78-afd3-7d262c019ffa
[AudioCache:JS:DEBUG] 🔍 getCachedAudio: Looking for audio in table=poi_audio_cache, searchColumn=poi_id, searchKey=50cd5835-70db-41be-9084-3adcae63c15e, actualLang=pt-br, requestedLang=pt-br, gender=male, poiId=50cd5835-70db-41be-9084-3adcae63c15e
🎵 [SimpleAudioService] Not emitting audio_stopped - wasPlaying was false
[AudioCache:JS:DEBUG] 🔍 getCachedAudio: Query result for actualLang=pt-br: found=false
[AudioCache] ⚠️ downloadAndCacheAudio: Empty or invalid URL provided for POI: 50cd5835-70db-41be-9084-3adcae63c15e
'[SimpleAudioService] Failed to get cached audio: ', [Error: URL cannot be empty]
'[NativeAudioService] ❌ Play failed:', [Error: URL cannot be empty]
[POICustomClusterRenderer] 🎨 renderClusters called: 6 clusters
[SimpleAudioService] Releasing audio system for other apps...
🎵 [SimpleAudioService] Removed POI 50cd5835-70db-41be-9084-3adcae63c15e from queue after audio completion
[NativeAudioService] ⏹️ Stopping playback
TuggiAudioPlayer: ⏹️ Stopping playback
[StorageService] setItem called for key: cache_audio_state
[StorageService] setItem completed for key: cache_audio_state
'🔄 [AudioPlaybackProvider] Audio state changed:', { isPlaying: false,
  currentPOI: null,
  currentDirection: null,
  playbackType: null,
  currentAudioUrl: null }
AudioSessionManager: 📢 Notifying other apps to restore volume...
AudioSessionManager: 🤝 COEXISTENCE ACTIVE (Spotify volume restored)
TuggiAudioPlayer: ✅ Now Playing Info cleared
[StorageService] setItem called for key: cache_audio_state
[StorageService] setItem completed for key: cache_audio_state
[SimpleAudioService] ✅ Audio system released successfully - other apps should resume automatically
[CooldownContext] 🎯 Event: cooldown_registered for POI: 50cd5835-70db-41be-9084-3adcae63c15e
✅ [GuideEngine] Cooldown registered for native trigger: Município de Bragança Paulista (poiId: 50cd5835-70db-41be-9084-3adcae63c15e)
🎵 [SimpleAudioService] Syncing state from native trigger: Município de Bragança Paulista (direction: front)
[SimpleAudioService] 🔍 Initializing NativeAudioService before audio starts...
🎵 [SimpleAudioService] Not emitting audio_stopped - wasPlaying was false
[SimpleAudioService] ✅ NativeAudioService initialized successfully - event listeners should be ready
'[GuideMapScreen] Cooldown IDs updated: 1 POIs in cooldown', [ '50cd5835-70db-41be-9084-3adcae63c15e' ]
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977013,-46.531246,30
[SimpleAudioService] ⏳ Waiting for playback-track-changed event to confirm audio started for Município de Bragança Paulista
[SimpleAudioService] 📊 Pending trigger data stored: {"poiName":"Município de Bragança Paulista","direction":"front"}
✅ [GuideEngine] Audio state synced for native trigger: Município de Bragança Paulista
[POICustomClusterRenderer] 🎨 renderClusters called: 6 clusters
[NativeMarkerManager] 🔍 Rendering 33 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 39 markers
🎵 [GuideEngine] increment_poi_play: Using PUBLIC client for audioDescriptionId=3cf3a72c-95db-4d1d-8355-527d21f944f2
🌐 [NetworkSpeedLogger] Network: WIFI (FAST 🚀) - ✅ Network speed OK - ✅ CONNECTED - Guide Active
[POICustomClusterRenderer] 🎨 renderClusters called: 6 clusters
✅ [GuideEngine] increment_attraction_play_count_secure: Success for Município de Bragança Paulista
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.982624',
  lng: '-46.525699',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:06.016Z',
  age: 7846 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.982624, lng=-46.525699, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.982624, lng=-46.525699, speed=50.00 m/s, heading=315.2, total TPs=33
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 29 TPs (from 33 total)
[TriggerDetectionService] 🔍 After distance filter: 29 TPs (from 33 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9826',
  lng: '-46.5257',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:06.016Z' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 11)
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9826', lng: '-46.5257', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.982624',
  lng: '-46.525699',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '315.2',
  timestamp: '2025-12-29T17:35:13.865Z',
  age: 3.031982421875 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9826, lng=-46.5257
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.977013,-46.531246,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.976871', lng: '-46.531299' },
  last: { lat: '-22.982624', lng: '-46.525699' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.976871,-46.531299,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.982521',
  lng: '-46.525813',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:07.016Z',
  age: 7863 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.982521, lng=-46.525813, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.982521, lng=-46.525813, speed=50.00 m/s, heading=314.5, total TPs=33
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 30 TPs (from 33 total)
[StorageService] setItem called for key: last_gps_location
[TriggerDetectionService] 🔍 After distance filter: 30 TPs (from 33 total)
[StorageService] setItem completed for key: last_gps_location
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 294, crc 2331296107, actualSize 35288
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9825',
  lng: '-46.5258',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:07.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9825', lng: '-46.5258', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 12)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.982521',
  lng: '-46.525813',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '314.5',
  timestamp: '2025-12-29T17:35:14.882Z',
  age: 2.947021484375 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9825, lng=-46.5258
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.976871,-46.531299,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.976703', lng: '-46.531356' },
  last: { lat: '-22.982521', lng: '-46.525813' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.976703,-46.531356,30
[POILoadingService] 🔍 [SYNC] Received 160 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 160 valid trigger points
[POICacheHelper] ✅ Saved 43 POIs to cache v4
[POILoadingService] ✅ Synced 43 POIs, 160 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 43 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 43 POIs, 160 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 43 active POIs (out of 43 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.976703,-46.531356,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.976703', lng: '-46.531356' },
  last: { lat: '-22.982521', lng: '-46.525813' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.976703,-46.531356,30
[NativeMarkerManager] 🔍 Rendering 96 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 116 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.982418',
  lng: '-46.525886',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:08.016Z',
  age: 7879 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.982418, lng=-46.525886, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.982418, lng=-46.525886, speed=50.00 m/s, heading=326.9, total TPs=160
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 39 TPs (from 160 total)
[TriggerDetectionService] 🔍 After distance filter: 39 TPs (from 160 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9824',
  lng: '-46.5259',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:08.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9824', lng: '-46.5259', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 13)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.982418',
  lng: '-46.525886',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '326.9',
  timestamp: '2025-12-29T17:35:15.898Z',
  age: 2.837158203125 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9824, lng=-46.5259
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.976703,-46.531356,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.976582', lng: '-46.531414' },
  last: { lat: '-22.982418', lng: '-46.525886' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.976582,-46.531414,30
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.982319',
  lng: '-46.525938',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:09.016Z',
  age: 7896 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.982319, lng=-46.525938, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.982319, lng=-46.525938, speed=50.00 m/s, heading=334.2, total TPs=160
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 39 TPs (from 160 total)
[TriggerDetectionService] 🔍 After distance filter: 39 TPs (from 160 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9823',
  lng: '-46.5259',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:09.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9823', lng: '-46.5259', source: 'simulated' }
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 295, crc 3524837085, actualSize 36356
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.982319',
  lng: '-46.525938',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '334.2',
  timestamp: '2025-12-29T17:35:16.914Z',
  age: 3.0400390625 }
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
📍 [GuideLocationService] Processing location update through LocationManager...
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 14)
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9823, lng=-46.5259
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.976582,-46.531414,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.976256', lng: '-46.531650' },
  last: { lat: '-22.982319', lng: '-46.525938' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.976256,-46.531650,30
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.982304',
  lng: '-46.525927',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:10.016Z',
  age: 7912 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.982304, lng=-46.525927, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.982304, lng=-46.525927, speed=50.00 m/s, heading=34.0, total TPs=160
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 40 TPs (from 160 total)
[TriggerDetectionService] 🔍 After distance filter: 40 TPs (from 160 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9823',
  lng: '-46.5259',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:10.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9823', lng: '-46.5259', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.982304',
  lng: '-46.525927',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '34.0',
  timestamp: '2025-12-29T17:35:17.932Z',
  age: 2.876953125 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 15)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.976256,-46.531650,30
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9823, lng=-46.5259
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.976168', lng: '-46.531704' },
  last: { lat: '-22.982304', lng: '-46.525927' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.976168,-46.531704,30
🌐 [NetworkSpeedLogger] Network: WIFI (FAST 🚀) - ✅ Network speed OK - ✅ CONNECTED - Guide Active
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.982267',
  lng: '-46.525916',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:11.016Z',
  age: 7929 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.982267, lng=-46.525916, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.982267, lng=-46.525916, speed=50.00 m/s, heading=15.3, total TPs=160
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 40 TPs (from 160 total)
[TriggerDetectionService] 🔍 After distance filter: 40 TPs (from 160 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9823',
  lng: '-46.5259',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:11.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9823', lng: '-46.5259', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 16)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.982267',
  lng: '-46.525916',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '15.3',
  timestamp: '2025-12-29T17:35:18.947Z',
  age: 2.646240234375 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9823, lng=-46.5259
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.976168,-46.531704,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.975810', lng: '-46.531901' },
  last: { lat: '-22.982267', lng: '-46.525916' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975810,-46.531901,30
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.982234',
  lng: '-46.525918',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:12.016Z',
  age: 7945 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.982234, lng=-46.525918, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.982234, lng=-46.525918, speed=50.00 m/s, heading=356.8, total TPs=160
[StorageService] setItem called for key: last_gps_location
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[StorageService] setItem completed for key: last_gps_location
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 296, crc 1884377514, actualSize 37901
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
[TriggerDetectionService] 🔍 Distance filter result: 42 TPs (from 160 total)
[TriggerDetectionService] 🔍 After distance filter: 42 TPs (from 160 total)
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9822',
  lng: '-46.5259',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:12.016Z' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 17)
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9822', lng: '-46.5259', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.982234',
  lng: '-46.525918',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '356.8',
  timestamp: '2025-12-29T17:35:19.963Z',
  age: 6.098876953125 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9822, lng=-46.5259
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975810,-46.531901,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.975508', lng: '-46.532086' },
  last: { lat: '-22.982234', lng: '-46.525918' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975508,-46.532086,30
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.982203',
  lng: '-46.525930',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:13.016Z',
  age: 7962 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.982203, lng=-46.525930, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.982203, lng=-46.525930, speed=50.00 m/s, heading=340.4, total TPs=160
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 42 TPs (from 160 total)
[TriggerDetectionService] 🔍 After distance filter: 42 TPs (from 160 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9822',
  lng: '-46.5259',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:13.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9822', lng: '-46.5259', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 18)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.982203',
  lng: '-46.525930',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '340.4',
  timestamp: '2025-12-29T17:35:20.980Z',
  age: 2.35009765625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9822, lng=-46.5259
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975508,-46.532086,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975508,-46.532086,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.975293', lng: '-46.532242' },
  last: { lat: '-22.982203', lng: '-46.525930' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975293,-46.532242,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975293,-46.532242,30
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975293,-46.532242,30
[NativeMarkerManager] 🔍 Rendering 96 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 115 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9830, lng=-46.5253, radius=5.22km, context=viewport_change
[POICacheHelper] ✅ Found 43 POIs within 5.2km radius from cache (limited from 43 total)
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[POILoadingService] ✅ Cache HIT: Found 43 POIs in cache
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975293,-46.532242,30
[AudioPreloadService] 🔍 Checking 43 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 43 total POIs, 43 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.005s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] 🔍 Rendering 96 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.009s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] Update complete: 115 markers
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.014s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.019s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.027s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.030s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 43 POIs, 160 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 43 visible POIs, 0 cached POIs, total: 43 POIs. TPs: 160 visible, 0 cached, total: 160
[GuideEngine] 🕒 Schedule check: 43 active POIs (out of 43 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975293,-46.532242,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] Update complete: 116 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.975293', lng: '-46.532242' },
  last: { lat: '-22.982203', lng: '-46.525930' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975293,-46.532242,30
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975293,-46.532242,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] Update complete: 116 markers
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 116 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975293,-46.532242,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975293,-46.532242,30
[NativeMarkerManager] 🔍 Rendering 96 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] Update complete: 116 markers
[NativeMarkerManager] 🔍 Rendering 96 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 116 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975293,-46.532242,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975293,-46.532242,30
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[NativeMarkerManager] 🔍 Rendering 96 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[NativeMarkerManager] Update complete: 114 markers
[NativeMarkerManager] 🔍 Rendering 96 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 114 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.982177',
  lng: '-46.525952',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:14.016Z',
  age: 7979 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.982177, lng=-46.525952, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.982177, lng=-46.525952, speed=50.00 m/s, heading=322.1, total TPs=160
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9822',
  lng: '-46.5260',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:14.016Z' }
[TriggerDetectionService] 🔍 Distance filter result: 42 TPs (from 160 total)
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9822', lng: '-46.5260', source: 'simulated' }
[TriggerDetectionService] 🔍 After distance filter: 42 TPs (from 160 total)
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 297, crc 3924123345, actualSize 38984
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.982177',
  lng: '-46.525952',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '322.1',
  timestamp: '2025-12-29T17:35:21.999Z',
  age: 1.2890625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 19)
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9822, lng=-46.5260
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975293,-46.532242,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.975200', lng: '-46.532318' },
  last: { lat: '-22.982177', lng: '-46.525952' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975200,-46.532318,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975200,-46.532318,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975200,-46.532318,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 117 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9822, lng=-46.5259, radius=5.22km, context=viewport_change
[POICacheHelper] ✅ Found 45 POIs within 5.2km radius from cache (limited from 45 total)
[POILoadingService] ✅ Cache HIT: Found 45 POIs in cache
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975200,-46.532318,30
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[AudioPreloadService] 🔍 Checking 45 POIs for audio preload
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 45 total POIs, 45 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.005s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.009s
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] Update complete: 117 markers
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.015s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.020s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.025s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.026s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 45 POIs, 173 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 45 visible POIs, 0 cached POIs, total: 45 POIs. TPs: 173 visible, 0 cached, total: 173
[GuideEngine] 🕒 Schedule check: 45 active POIs (out of 45 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975200,-46.532318,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975200,-46.532318,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] Update complete: 117 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.975200', lng: '-46.532318' },
  last: { lat: '-22.982177', lng: '-46.525952' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975200,-46.532318,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 118 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 118 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975200,-46.532318,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 118 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975200,-46.532318,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 119 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975200,-46.532318,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 117 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975200,-46.532318,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 117 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 117 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.982158',
  lng: '-46.525981',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:15.016Z',
  age: 7995 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.982158, lng=-46.525981, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.982158, lng=-46.525981, speed=50.00 m/s, heading=305.4, total TPs=173
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 42 TPs (from 173 total)
[TriggerDetectionService] 🔍 After distance filter: 42 TPs (from 173 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9822',
  lng: '-46.5260',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:15.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9822', lng: '-46.5260', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 20)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.982158',
  lng: '-46.525981',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '305.4',
  timestamp: '2025-12-29T17:35:23.013Z',
  age: 2.01708984375 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9822, lng=-46.5260
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975200,-46.532318,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.975110', lng: '-46.532427' },
  last: { lat: '-22.982158', lng: '-46.525981' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975110,-46.532427,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975110,-46.532427,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975110,-46.532427,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 118 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9822, lng=-46.5260, radius=5.18km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975110,-46.532427,30
[POICacheHelper] ✅ Found 44 POIs within 5.2km radius from cache (limited from 44 total)
[POILoadingService] ✅ Cache HIT: Found 44 POIs in cache
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0310)
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 44 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 44 total POIs, 44 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[NativeMarkerManager] Update complete: 118 markers
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.015s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 44 POIs, 163 TPs
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.019s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 44 visible POIs, 1 cached POIs, total: 45 POIs. TPs: 163 visible, 10 cached, total: 173
[GuideEngine] 🕒 Schedule check: 45 active POIs (out of 45 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975110,-46.532427,30
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.015s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.019s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] 🔍 Rendering 96 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0310)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.023s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.038s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] Update complete: 117 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.975110', lng: '-46.532427' },
  last: { lat: '-22.982158', lng: '-46.525981' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975110,-46.532427,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 95 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0305)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975110,-46.532427,30
[NativeMarkerManager] Update complete: 116 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975110,-46.532427,30
[NativeMarkerManager] 🔍 Rendering 92 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0300)
[NativeMarkerManager] Update complete: 113 markers
🌐 [NetworkSpeedLogger] Network: WIFI (FAST 🚀) - ✅ Network speed OK - ✅ CONNECTED - Guide Active
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975110,-46.532427,30
[NativeMarkerManager] 🔍 Rendering 91 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0294)
[NativeMarkerManager] Update complete: 112 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975110,-46.532427,30
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0290)
[NativeMarkerManager] Update complete: 111 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975110,-46.532427,30
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0284)
[NativeMarkerManager] Update complete: 111 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0284)
[NativeMarkerManager] Update complete: 111 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 160 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 160 valid trigger points
[POICacheHelper] ✅ Saved 43 POIs to cache v4
[POILoadingService] ✅ Synced 43 POIs, 160 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 43 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 43 POIs, 160 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 43 active POIs (out of 43 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975110,-46.532427,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.975110', lng: '-46.532427' },
  last: { lat: '-22.982158', lng: '-46.525981' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975110,-46.532427,30
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0284)
[NativeMarkerManager] Update complete: 111 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.982147',
  lng: '-46.526014',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:16.016Z',
  age: 8012 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.982147, lng=-46.526014, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.982147, lng=-46.526014, speed=50.00 m/s, heading=289.9, total TPs=160
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 42 TPs (from 160 total)
[StorageService] setItem called for key: last_gps_location
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 298, crc 1949859411, actualSize 40027
[TriggerDetectionService] 🔍 After distance filter: 42 TPs (from 160 total)
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9821',
  lng: '-46.5260',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:16.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9821', lng: '-46.5260', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 21)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.982147',
  lng: '-46.526014',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '289.9',
  timestamp: '2025-12-29T17:35:24.029Z',
  age: 5.838134765625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9821, lng=-46.5260
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.975110,-46.532427,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.974991', lng: '-46.532585' },
  last: { lat: '-22.982147', lng: '-46.526014' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9822, lng=-46.5260, radius=5.24km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[POICacheHelper] ✅ Found 45 POIs within 5.2km radius from cache (limited from 45 total)
[POILoadingService] ✅ Cache HIT: Found 45 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 45 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 45 total POIs, 45 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.004s
[NativeMarkerManager] 🔍 Rendering 89 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0282)
[NativeMarkerManager] Update complete: 110 markers
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.008s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.012s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.018s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 45 POIs, 173 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 45 visible POIs, 0 cached POIs, total: 45 POIs. TPs: 173 visible, 0 cached, total: 173
[GuideEngine] 🕒 Schedule check: 45 active POIs (out of 45 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.046s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.047s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] 🔍 Rendering 87 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0282)
[NativeMarkerManager] Update complete: 107 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.974991', lng: '-46.532585' },
  last: { lat: '-22.982147', lng: '-46.526014' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] 🔍 Rendering 87 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0274)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[NativeMarkerManager] Update complete: 106 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[NativeMarkerManager] 🔍 Rendering 86 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0263)
[NativeMarkerManager] Update complete: 105 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[NativeMarkerManager] 🔍 Rendering 85 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0261)
[NativeMarkerManager] Update complete: 102 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[NativeMarkerManager] 🔍 Rendering 85 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0251)
[NativeMarkerManager] Update complete: 102 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[NativeMarkerManager] 🔍 Rendering 83 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0250)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[NativeMarkerManager] Update complete: 100 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[NativeMarkerManager] 🔍 Rendering 83 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0239)
[NativeMarkerManager] Update complete: 100 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[NativeMarkerManager] 🔍 Rendering 83 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0237)
[NativeMarkerManager] Update complete: 100 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[NativeMarkerManager] 🔍 Rendering 83 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0237)
[NativeMarkerManager] Update complete: 100 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9821, lng=-46.5260, radius=5.25km, context=viewport_change
[POICacheHelper] ✅ Found 45 POIs within 5.3km radius from cache (limited from 45 total)
[POILoadingService] ✅ Cache HIT: Found 45 POIs in cache
[AudioPreloadService] 🔍 Checking 45 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 45 total POIs, 45 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.006s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.010s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 45 POIs, 173 TPs
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 45 visible POIs, 0 cached POIs, total: 45 POIs. TPs: 173 visible, 0 cached, total: 173
[GuideEngine] 🕒 Schedule check: 45 active POIs (out of 45 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.015s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.025s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.026s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.033s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.974991', lng: '-46.532585' },
  last: { lat: '-22.982147', lng: '-46.526014' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[NativeMarkerManager] 🔍 Rendering 83 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0237)
[NativeMarkerManager] Update complete: 100 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 173 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 173 valid trigger points
[POICacheHelper] ✅ Saved 45 POIs to cache v4
[POILoadingService] ✅ Synced 45 POIs, 173 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 45 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 45 POIs, 173 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 45 active POIs (out of 45 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[POICustomClusterRenderer] 🎨 renderClusters called: 11 clusters
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.974991', lng: '-46.532585' },
  last: { lat: '-22.982147', lng: '-46.526014' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[NativeMarkerManager] 🔍 Rendering 83 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0237)
[NativeMarkerManager] Update complete: 100 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.982146',
  lng: '-46.526050',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:17.016Z',
  age: 8012 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.982146, lng=-46.526050, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.982146, lng=-46.526050, speed=50.00 m/s, heading=271.7, total TPs=173
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 42 TPs (from 173 total)
[StorageService] setItem called for key: last_gps_location
[TriggerDetectionService] 🔍 After distance filter: 42 TPs (from 173 total)
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9821',
  lng: '-46.5260',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:17.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9821', lng: '-46.5260', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.982146',
  lng: '-46.526050',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '271.7',
  timestamp: '2025-12-29T17:35:25.029Z',
  age: -0.0478515625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 22)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974991,-46.532585,30
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9821, lng=-46.5260
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.974893', lng: '-46.532705' },
  last: { lat: '-22.982146', lng: '-46.526050' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManager] 🔍 Rendering 82 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0232)
[NativeMarkerManager] Update complete: 98 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManager] 🔍 Rendering 82 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0227)
[NativeMarkerManager] Update complete: 98 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[NativeMarkerManager] 🔍 Rendering 79 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0227)
[NativeMarkerManager] Update complete: 94 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[POICustomClusterRenderer] 🎨 renderClusters called: 8 clusters
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0221)
[NativeMarkerManager] Update complete: 84 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9821, lng=-46.5260, radius=5.19km, context=viewport_change
[POICacheHelper] ✅ Found 44 POIs within 5.2km radius from cache (limited from 44 total)
[POILoadingService] ✅ Cache HIT: Found 44 POIs in cache
[POICustomClusterRenderer] 🎨 renderClusters called: 8 clusters
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[AudioPreloadService] 🔍 Checking 44 POIs for audio preload
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 44 total POIs, 44 with audio, 0 without audio
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[NativeMarkerManager] 🔍 Rendering 70 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0211)
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.006s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 44 POIs, 163 TPs
[NativeMarkerManager] Update complete: 83 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 44 visible POIs, 1 cached POIs, total: 45 POIs. TPs: 163 visible, 10 cached, total: 173
[GuideEngine] 🕒 Schedule check: 45 active POIs (out of 45 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.038s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POICustomClusterRenderer] 🎨 renderClusters called: 7 clusters
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.048s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] 🔍 Rendering 65 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0207)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.053s
[NativeMarkerManager] Update complete: 76 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.057s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.060s
[POICustomClusterRenderer] 🎨 renderClusters called: 6 clusters
[NativeMarkerManager] 🔍 Rendering 60 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0207)
[POICustomClusterRenderer] 🎨 renderClusters called: 6 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.974893', lng: '-46.532705' },
  last: { lat: '-22.982146', lng: '-46.526050' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[NativeMarkerManager] 🔍 Rendering 60 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0192)
[NativeMarkerManager] Update complete: 68 markers
[NativeMarkerManager] Update complete: 68 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 6 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[NativeMarkerManager] 🔍 Rendering 55 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0175)
[NativeMarkerManager] Update complete: 61 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[POICustomClusterRenderer] 🎨 renderClusters called: 6 clusters
[NativeMarkerManager] 🔍 Rendering 50 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0168)
[NativeMarkerManager] Update complete: 56 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 6 clusters
[NativeMarkerManager] 🔍 Rendering 50 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0159)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[NativeMarkerManager] Update complete: 56 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 6 clusters
[NativeMarkerManager] 🔍 Rendering 50 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0159)
[NativeMarkerManager] Update complete: 56 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 6 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 163 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 163 valid trigger points
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9821, lng=-46.5260, radius=4.84km, context=viewport_change
[POICacheHelper] ✅ Found 43 POIs within 4.8km radius from cache (limited from 43 total)
[POILoadingService] ✅ Cache HIT: Found 43 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 43 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 43 total POIs, 43 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 43 POIs, 160 TPs
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.011s
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 43 visible POIs, 2 cached POIs, total: 45 POIs. TPs: 160 visible, 13 cached, total: 173
[GuideEngine] 🕒 Schedule check: 45 active POIs (out of 45 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.014s
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.011s
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.011s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.009s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.033s
[POICustomClusterRenderer] 🎨 renderClusters called: 6 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.974893', lng: '-46.532705' },
  last: { lat: '-22.982146', lng: '-46.526050' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[NativeMarkerManager] 🔍 Rendering 50 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0159)
[NativeMarkerManager] Update complete: 56 markers
[POICacheHelper] ✅ Saved 44 POIs to cache v4
[POILoadingService] ✅ Synced 44 POIs, 163 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 44 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 44 POIs, 163 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 44 active POIs (out of 44 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[POICustomClusterRenderer] 🎨 renderClusters called: 6 clusters
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 6 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.974893', lng: '-46.532705' },
  last: { lat: '-22.982146', lng: '-46.526050' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
[NativeMarkerManager] 🔍 Rendering 50 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0159)
[NativeMarkerManager] Update complete: 56 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.982091',
  lng: '-46.526134',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:18.016Z',
  age: 8040 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.982091, lng=-46.526134, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.982091, lng=-46.526134, speed=50.00 m/s, heading=305.4, total TPs=163
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[StorageService] setItem called for key: last_gps_location
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 299, crc 2850370667, actualSize 41057
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
[TriggerDetectionService] 🔍 Distance filter result: 42 TPs (from 163 total)
[TriggerDetectionService] 🔍 After distance filter: 42 TPs (from 163 total)
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9821',
  lng: '-46.5261',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:18.016Z' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 23)
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9821', lng: '-46.5261', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.982091',
  lng: '-46.526134',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '305.4',
  timestamp: '2025-12-29T17:35:26.056Z',
  age: 26.189208984375 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9821, lng=-46.5261
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974893,-46.532705,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.974745', lng: '-46.532860' },
  last: { lat: '-22.982091', lng: '-46.526134' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974745,-46.532860,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974745,-46.532860,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POILoadingService] ⏹️ Sync cancelled after network fetch: sync_-22.9822_-46.5260_5.2
[POILoadingService] ⚠️ Background sync returned no POIs or was cancelled
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974745,-46.532860,30
[POICustomClusterRenderer] 🎨 renderClusters called: 6 clusters
[NativeMarkerManager] 🔍 Rendering 63 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0170)
[NativeMarkerManager] Update complete: 72 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 6 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974745,-46.532860,30
[NativeMarkerManager] 🔍 Rendering 63 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0182)
[NativeMarkerManager] Update complete: 72 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 8 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974745,-46.532860,30
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0183)
[POICustomClusterRenderer] 🎨 renderClusters called: 8 clusters
[NativeMarkerManager] Update complete: 84 markers
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0210)
[NativeMarkerManager] Update complete: 84 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974745,-46.532860,30
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9821, lng=-46.5261, radius=5.08km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[POICacheHelper] ✅ Found 43 POIs within 5.1km radius from cache (limited from 43 total)
[POILoadingService] ✅ Cache HIT: Found 43 POIs in cache
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974745,-46.532860,30
[AudioPreloadService] 🔍 Checking 43 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 43 total POIs, 43 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[NativeMarkerManager] 🔍 Rendering 85 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0225)
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.007s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.014s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] Update complete: 102 markers
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.017s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 43 POIs, 160 TPs
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.022s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 43 visible POIs, 1 cached POIs, total: 44 POIs. TPs: 160 visible, 3 cached, total: 163
[GuideEngine] 🕒 Schedule check: 44 active POIs (out of 44 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974745,-46.532860,30
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974745,-46.532860,30
[NativeMarkerManager] 🔍 Rendering 87 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0253)
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] 🔍 Rendering 87 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0253)
[NativeMarkerManager] Update complete: 104 markers
[NativeMarkerManager] Update complete: 106 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.974745', lng: '-46.532860' },
  last: { lat: '-22.982091', lng: '-46.526134' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974745,-46.532860,30
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.099s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.101s
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0262)
[NativeMarkerManager] Update complete: 111 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974745,-46.532860,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974745,-46.532860,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0284)
[NativeMarkerManager] Update complete: 111 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0284)
[NativeMarkerManager] Update complete: 111 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9821, lng=-46.5261, radius=5.23km, context=viewport_change
[POICacheHelper] ✅ Found 45 POIs within 5.2km radius from cache (limited from 45 total)
[POILoadingService] ✅ Cache HIT: Found 45 POIs in cache
[AudioPreloadService] 🔍 Checking 45 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 45 total POIs, 45 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.007s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 45 POIs, 173 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.041s
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 45 visible POIs, 0 cached POIs, total: 45 POIs. TPs: 173 visible, 0 cached, total: 173
[GuideEngine] 🕒 Schedule check: 45 active POIs (out of 45 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974745,-46.532860,30
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.045s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.049s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.051s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.056s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.974745', lng: '-46.532860' },
  last: { lat: '-22.982091', lng: '-46.526134' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974745,-46.532860,30
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0284)
[NativeMarkerManager] Update complete: 111 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.981970',
  lng: '-46.526322',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:19.016Z',
  age: 8045 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.981970, lng=-46.526322, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.981970, lng=-46.526322, speed=50.00 m/s, heading=305.0, total TPs=173
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[StorageService] setItem called for key: last_gps_location
[TriggerDetectionService] 🔍 Distance filter result: 43 TPs (from 173 total)
[StorageService] setItem completed for key: last_gps_location
[TriggerDetectionService] 🔍 After distance filter: 43 TPs (from 173 total)
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9820',
  lng: '-46.5263',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:19.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9820', lng: '-46.5263', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.981970',
  lng: '-46.526322',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '305.0',
  timestamp: '2025-12-29T17:35:27.062Z',
  age: 0.37890625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 24)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.974745,-46.532860,30
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9820, lng=-46.5263
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981970', lng: '-46.526322' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POILoadingService] 🔍 [SYNC] Received 173 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 173 valid trigger points
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0284)
[NativeMarkerManager] Update complete: 111 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0284)
[NativeMarkerManager] Update complete: 111 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0284)
[NativeMarkerManager] Update complete: 111 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0284)
[NativeMarkerManager] Update complete: 111 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0284)
[NativeMarkerManager] Update complete: 111 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0284)
[NativeMarkerManager] Update complete: 111 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0283)
[NativeMarkerManager] Update complete: 111 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICacheHelper] ✅ Saved 45 POIs to cache v4
[POILoadingService] ✅ Synced 45 POIs, 173 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 45 POIs synced
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0283)
[NativeMarkerManager] Update complete: 111 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9820, lng=-46.5262, radius=5.23km, context=viewport_change
[POICacheHelper] ✅ Found 45 POIs within 5.2km radius from cache (limited from 45 total)
[POILoadingService] ✅ Cache HIT: Found 45 POIs in cache
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 45 POIs, 173 TPs
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 45 active POIs (out of 45 total)
[AudioPreloadService] 🔍 Checking 45 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 45 total POIs, 45 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0283)
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.012s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] Update complete: 111 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.025s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 45 POIs, 173 TPs
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[AudioPreloadService] ✅ Preload [2/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.034s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 45 visible POIs, 0 cached POIs, total: 45 POIs. TPs: 173 visible, 0 cached, total: 173
[GuideEngine] 🕒 Schedule check: 45 active POIs (out of 45 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.042s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0283)
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981970', lng: '-46.526322' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.045s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.051s
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] Update complete: 111 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981970', lng: '-46.526322' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0283)
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] Update complete: 111 markers
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0283)
[NativeMarkerManager] Update complete: 111 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 173 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 173 valid trigger points
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[POICacheHelper] ✅ Saved 45 POIs to cache v4
[POILoadingService] ✅ Synced 45 POIs, 173 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 45 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 45 POIs, 173 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 45 active POIs (out of 45 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981970', lng: '-46.526322' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0283)
[NativeMarkerManager] Update complete: 111 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.981827',
  lng: '-46.526498',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:20.016Z',
  age: 8062 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.981827, lng=-46.526498, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.981827, lng=-46.526498, speed=50.00 m/s, heading=311.4, total TPs=173
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 43 TPs (from 173 total)
[StorageService] setItem called for key: last_gps_location
[TriggerDetectionService] 🔍 After distance filter: 43 TPs (from 173 total)
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9818',
  lng: '-46.5265',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:20.016Z' }
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 300, crc 856173989, actualSize 42062
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9818', lng: '-46.5265', source: 'simulated' }
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.981827',
  lng: '-46.526498',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '311.4',
  timestamp: '2025-12-29T17:35:28.080Z',
  age: 0.834228515625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 25)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9818, lng=-46.5265
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981827', lng: '-46.526498' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0284)
[POILoadingService] 🔍 [SYNC] Received 160 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 160 valid trigger points
[NativeMarkerManager] Update complete: 111 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9820, lng=-46.5263, radius=5.23km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICacheHelper] ✅ Found 45 POIs within 5.2km radius from cache (limited from 45 total)
[POILoadingService] ✅ Cache HIT: Found 45 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[NativeMarkerManager] 🔍 Rendering 90 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0286)
[AudioPreloadService] 🔍 Checking 45 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 45 total POIs, 45 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 45 POIs, 173 TPs
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[NativeMarkerManager] Update complete: 111 markers
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.024s
[NativeMarkerManager] 🔍 Rendering 91 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0286)
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 45 visible POIs, 0 cached POIs, total: 45 POIs. TPs: 173 visible, 0 cached, total: 173
[GuideEngine] 🕒 Schedule check: 45 active POIs (out of 45 total)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.050s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.060s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] Update complete: 112 markers
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.031s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] 🔍 Rendering 95 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0291)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.042s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.121s
[NativeMarkerManager] Update complete: 116 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981827', lng: '-46.526498' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 95 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0296)
[NativeMarkerManager] Update complete: 116 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 95 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] Update complete: 116 markers
🌐 [NetworkSpeedLogger] Network: WIFI (FAST 🚀) - ✅ Network speed OK - ✅ CONNECTED - Guide Active
[NativeMarkerManager] 🔍 Rendering 95 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[NativeMarkerManager] Update complete: 116 markers
[POICacheHelper] ✅ Saved 43 POIs to cache v4
[POILoadingService] ✅ Synced 43 POIs, 160 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 43 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 43 POIs, 160 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 43 active POIs (out of 43 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981827', lng: '-46.526498' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 95 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[NativeMarkerManager] Update complete: 116 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 160 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 160 valid trigger points
[POICacheHelper] ✅ Saved 43 POIs to cache v4
[POILoadingService] ✅ Synced 43 POIs, 160 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 43 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 43 POIs, 160 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 43 active POIs (out of 43 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981827', lng: '-46.526498' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 95 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[NativeMarkerManager] Update complete: 116 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.981686',
  lng: '-46.526640',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:21.016Z',
  age: 8078 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.981686, lng=-46.526640, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.981686, lng=-46.526640, speed=50.00 m/s, heading=317.2, total TPs=160
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 41 TPs (from 160 total)
[TriggerDetectionService] 🔍 After distance filter: 41 TPs (from 160 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9817',
  lng: '-46.5266',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:21.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9817', lng: '-46.5266', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 26)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.981686',
  lng: '-46.526640',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '317.2',
  timestamp: '2025-12-29T17:35:29.096Z',
  age: 0.77294921875 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9817, lng=-46.5266
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981686', lng: '-46.526640' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] 🔍 Rendering 96 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0298)
[NativeMarkerManager] Update complete: 117 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9818, lng=-46.5265, radius=5.12km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICacheHelper] ✅ Found 44 POIs within 5.1km radius from cache (limited from 44 total)
[NativeMarkerManager] 🔍 Rendering 96 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0299)
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] ✅ Cache HIT: Found 44 POIs in cache
[NativeMarkerManager] Update complete: 117 markers
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 44 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 44 total POIs, 44 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POILoadingService] 🔍 [SYNC] Received 173 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 173 valid trigger points
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.014s
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 44 POIs, 163 TPs
[AudioPreloadService] ✅ Preload [2/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.022s
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 44 visible POIs, 0 cached POIs, total: 44 POIs. TPs: 163 visible, 0 cached, total: 163
[GuideEngine] 🕒 Schedule check: 44 active POIs (out of 44 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] ✅ Preload [3/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.030s
[NativeMarkerManager] 🔍 Rendering 96 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0299)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.031s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] Update complete: 117 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981686', lng: '-46.526640' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.027s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.063s
[NativeMarkerManager] 🔍 Rendering 96 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0300)
[NativeMarkerManager] Update complete: 117 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0302)
[NativeMarkerManager] Update complete: 118 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[NativeMarkerManager] Update complete: 118 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0305)
[NativeMarkerManager] Update complete: 118 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0305)
[NativeMarkerManager] Update complete: 119 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICacheHelper] ✅ Saved 45 POIs to cache v4
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0307)
[POILoadingService] ✅ Synced 45 POIs, 173 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 45 POIs synced
[NativeMarkerManager] Update complete: 119 markers
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 45 POIs, 173 TPs
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 45 active POIs (out of 45 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0307)
[NativeMarkerManager] Update complete: 119 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981686', lng: '-46.526640' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0307)
[NativeMarkerManager] Update complete: 119 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 173 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 173 valid trigger points
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.981478',
  lng: '-46.526871',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:22.016Z',
  age: 8095 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.981478, lng=-46.526871, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.981478, lng=-46.526871, speed=50.00 m/s, heading=314.4, total TPs=173
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 43 TPs (from 173 total)
[TriggerDetectionService] 🔍 After distance filter: 43 TPs (from 173 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 301, crc 2945450268, actualSize 43088
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9815',
  lng: '-46.5269',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:22.016Z' }
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9815', lng: '-46.5269', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.981478',
  lng: '-46.526871',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '314.4',
  timestamp: '2025-12-29T17:35:30.114Z',
  age: 2.3369140625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 27)
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9815, lng=-46.5269
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICacheHelper] ✅ Saved 45 POIs to cache v4
[POILoadingService] ✅ Synced 45 POIs, 173 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 45 POIs synced
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981478', lng: '-46.526871' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 45 POIs, 173 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 45 active POIs (out of 45 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981478', lng: '-46.526871' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0307)
[NativeMarkerManager] Update complete: 119 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] Update complete: 119 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9817, lng=-46.5267, radius=5.10km, context=viewport_change
[POICacheHelper] ✅ Found 44 POIs within 5.1km radius from cache (limited from 44 total)
[POILoadingService] ✅ Cache HIT: Found 44 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[AudioPreloadService] 🔍 Checking 44 POIs for audio preload
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 44 total POIs, 44 with audio, 0 without audio
[NativeMarkerManager] Update complete: 119 markers
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.004s
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.010s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.015s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.019s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.019s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.025s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 44 POIs, 163 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 44 visible POIs, 1 cached POIs, total: 45 POIs. TPs: 163 visible, 10 cached, total: 173
[GuideEngine] 🕒 Schedule check: 45 active POIs (out of 45 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0305)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 119 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981478', lng: '-46.526871' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[NativeMarkerManager] Update complete: 119 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[NativeMarkerManager] Update complete: 118 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0303)
[NativeMarkerManager] Update complete: 118 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0302)
[NativeMarkerManager] Update complete: 118 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0302)
[NativeMarkerManager] Update complete: 118 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 174 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 174 valid trigger points
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[POICacheHelper] ✅ Saved 46 POIs to cache v4
[POILoadingService] ✅ Synced 46 POIs, 174 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 46 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 46 POIs, 174 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 46 active POIs (out of 46 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981478', lng: '-46.526871' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0302)
[NativeMarkerManager] Update complete: 118 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.981392',
  lng: '-46.526958',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:23.016Z',
  age: 8111 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.981392, lng=-46.526958, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.981392, lng=-46.526958, speed=50.00 m/s, heading=317.0, total TPs=174
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 46 TPs (from 174 total)
[TriggerDetectionService] 🔍 After distance filter: 46 TPs (from 174 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9814',
  lng: '-46.5270',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:23.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9814', lng: '-46.5270', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 28)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.981392',
  lng: '-46.526958',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '317.0',
  timestamp: '2025-12-29T17:35:31.129Z',
  age: 1.119140625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9814, lng=-46.5270
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981392', lng: '-46.526958' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0303)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] Update complete: 119 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0303)
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] Update complete: 119 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9815, lng=-46.5269, radius=5.06km, context=viewport_change
[POICacheHelper] ✅ Found 44 POIs within 5.1km radius from cache (limited from 44 total)
[POILoadingService] ✅ Cache HIT: Found 44 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 44 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 44 total POIs, 44 with audio, 0 without audio
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0303)
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[NativeMarkerManager] Update complete: 119 markers
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.012s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 44 POIs, 163 TPs
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.024s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 44 visible POIs, 2 cached POIs, total: 46 POIs. TPs: 163 visible, 11 cached, total: 174
[GuideEngine] 🕒 Schedule check: 46 active POIs (out of 46 total)
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.058s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.061s
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0303)
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] Update complete: 119 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.081s
[NativeMarkerManager] 🔍 Rendering 97 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.090s
[NativeMarkerManager] Update complete: 119 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981392', lng: '-46.526958' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[NativeMarkerManager] Update complete: 120 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0305)
[NativeMarkerManager] Update complete: 120 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 120 markers
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 163 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 163 valid trigger points
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[POICacheHelper] ✅ Saved 44 POIs to cache v4
[POILoadingService] ✅ Synced 44 POIs, 163 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 44 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 44 POIs, 163 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 44 active POIs (out of 44 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.968113', lng: '-46.531130' },
  last: { lat: '-22.981392', lng: '-46.526958' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.981260',
  lng: '-46.527092',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:24.016Z',
  age: 8128 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.981260, lng=-46.527092, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.981260, lng=-46.527092, speed=50.00 m/s, heading=316.9, total TPs=163
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 48 TPs (from 163 total)
[TriggerDetectionService] 🔍 After distance filter: 48 TPs (from 163 total)
[StorageService] setItem called for key: last_gps_location
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 302, crc 888443134, actualSize 44125
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9813',
  lng: '-46.5271',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:24.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9813', lng: '-46.5271', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 29)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.981260',
  lng: '-46.527092',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '316.9',
  timestamp: '2025-12-29T17:35:32.146Z',
  age: 2.0390625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9813, lng=-46.5271
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.968113,-46.531130,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.986718', lng: '-46.520499' },
  last: { lat: '-22.981260', lng: '-46.527092' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9814, lng=-46.5270, radius=5.10km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[POICacheHelper] ✅ Found 44 POIs within 5.1km radius from cache (limited from 44 total)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[POILoadingService] ✅ Cache HIT: Found 44 POIs in cache
[AudioPreloadService] 🔍 Checking 44 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 44 total POIs, 44 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.013s
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[NativeMarkerManager] Update complete: 120 markers
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.020s
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 44 POIs, 163 TPs
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 44 visible POIs, 0 cached POIs, total: 44 POIs. TPs: 163 visible, 0 cached, total: 163
[GuideEngine] 🕒 Schedule check: 44 active POIs (out of 44 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioPreloadService] ✅ Preload [3/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.026s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.018s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.014s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.035s
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] Update complete: 120 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.986718', lng: '-46.520499' },
  last: { lat: '-22.981260', lng: '-46.527092' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 120 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
[POISyncService] 🔄 Performing periodic sync for 3.0km radius
[GuideEngine:JS:DEBUG] 🔄 STEP 2: POI sync started event received in JavaScript listener
'[GuideEngine:JS:DEBUG] 🔄 STEP 3: Event data:', {}
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[GuideEngine:JS:SUCCESS] 🔄 COMPLETE: POI sync started flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 163 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 163 valid trigger points
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICacheHelper] ✅ Saved 44 POIs to cache v4
[POILoadingService] ✅ Synced 44 POIs, 163 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 44 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 44 POIs, 163 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 44 active POIs (out of 44 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.986718', lng: '-46.520499' },
  last: { lat: '-22.981260', lng: '-46.527092' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 83 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 83 valid trigger points
[POICacheHelper] ✅ Saved 21 POIs to cache v4
[POILoadingService] ✅ Synced 21 POIs, 83 TPs for region and emitted POILoaded notification
[POISyncService] ✅ Periodic sync completed: 21 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 21 POIs, 83 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 21 active POIs (out of 21 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[GuideEngine:JS:DEBUG] ✅ STEP 2: POI sync completed event received in JavaScript listener
'[GuideEngine:JS:DEBUG] ✅ STEP 3: Event data:', { syncedCount: 21, fullData: { syncedCount: 21 } }
[GuideEngine:JS:SUCCESS] ✅ STEP 4: POI sync completed: 21 POIs synced
[GuideEngine:JS:INFO] ✅ COMPLETE: POI sync completed flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.986718', lng: '-46.520499' },
  last: { lat: '-22.981260', lng: '-46.527092' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[NativeMarkerManager] 🔍 Rendering 83 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 104 markers
[RouteTrailSyncService] Syncing 29 pending points...
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.980913',
  lng: '-46.527446',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:25.016Z',
  age: 8144 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.980913, lng=-46.527446, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.980913, lng=-46.527446, speed=50.00 m/s, heading=316.8, total TPs=83
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 48 TPs (from 83 total)
[TriggerDetectionService] 🔍 After distance filter: 48 TPs (from 83 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9809',
  lng: '-46.5274',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:25.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9809', lng: '-46.5274', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.980913',
  lng: '-46.527446',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '316.8',
  timestamp: '2025-12-29T17:35:33.161Z',
  age: 0.210205078125 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 30)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986718,-46.520499,30
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9809, lng=-46.5274
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.986327', lng: '-46.521512' },
  last: { lat: '-22.980913', lng: '-46.527446' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986327,-46.521512,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986327,-46.521512,30
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9812, lng=-46.5271, radius=5.10km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986327,-46.521512,30
[POICacheHelper] ✅ Found 44 POIs within 5.1km radius from cache (limited from 44 total)
[POILoadingService] ✅ Cache HIT: Found 44 POIs in cache
[AudioPreloadService] 🔍 Checking 44 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 44 total POIs, 44 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[NativeMarkerManager] 🔍 Rendering 83 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.008s
[NativeMarkerManager] Update complete: 104 markers
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.020s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 44 POIs, 163 TPs
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 44 visible POIs, 0 cached POIs, total: 44 POIs. TPs: 163 visible, 0 cached, total: 163
[POICustomClusterRenderer] 🎨 renderClusters called: 12 clusters
[GuideEngine] 🕒 Schedule check: 44 active POIs (out of 44 total)
[AudioPreloadService] ✅ Preload [3/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.025s
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986327,-46.521512,30
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.031s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] 🔍 Rendering 83 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.036s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.040s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] Update complete: 104 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.986327', lng: '-46.521512' },
  last: { lat: '-22.980913', lng: '-46.527446' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986327,-46.521512,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 120 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986327,-46.521512,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986327,-46.521512,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
[RouteTrailHelper] 🧹 Removed 29 synced points from MMKV pending buffer
[RouteTrailSyncService] ✅ Synced 29 points successfully
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986327,-46.521512,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
🌐 [NetworkSpeedLogger] Network: WIFI (FAST 🚀) - ✅ Network speed OK - ✅ CONNECTED - Guide Active
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986327,-46.521512,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986327,-46.521512,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 163 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 163 valid trigger points
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[POICacheHelper] ✅ Saved 44 POIs to cache v4
[POILoadingService] ✅ Synced 44 POIs, 163 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 44 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 44 POIs, 163 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 44 active POIs (out of 44 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986327,-46.521512,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.986327', lng: '-46.521512' },
  last: { lat: '-22.980913', lng: '-46.527446' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986327,-46.521512,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 120 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.980432',
  lng: '-46.527963',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:26.016Z',
  age: 8161 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.980432, lng=-46.527963, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.980432, lng=-46.527963, speed=50.00 m/s, heading=315.3, total TPs=163
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9804, lng=-46.5280, radius=2.00km, context=movement
[TriggerDetectionService] 🔍 Distance filter result: 56 TPs (from 163 total)
[TriggerDetectionService] 🔍 After distance filter: 56 TPs (from 163 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9804',
  lng: '-46.5280',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:26.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9804', lng: '-46.5280', source: 'simulated' }
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 303, crc 1384482690, actualSize 30168
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.980432',
  lng: '-46.527963',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '315.3',
  timestamp: '2025-12-29T17:35:34.179Z',
  age: 0.781982421875 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 2)
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9804, lng=-46.5280
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986327,-46.521512,30
[POICacheHelper] ✅ Found 14 POIs within 2.0km radius from cache (limited from 14 total)
[POILoadingService] ✅ Cache HIT: Found 14 POIs in cache
[AudioPreloadService] 🔍 Checking 14 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.0s (context: movement)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 14 total POIs, 14 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 14 POIs, 58 TPs
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.009s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.013s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
[GuideEngine] 🕒 Schedule check: 14 active POIs (out of 14 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.019s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986327,-46.521512,30
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.029s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.032s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.040s
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.986204', lng: '-46.521830' },
  last: { lat: '-22.980432', lng: '-46.527963' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986204,-46.521830,30
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[NativeMarkerManager] 🔍 Rendering 58 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 72 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986204,-46.521830,30
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9808, lng=-46.5275, radius=5.09km, context=viewport_change
[POICacheHelper] ✅ Found 46 POIs within 5.1km radius from cache (limited from 46 total)
[POILoadingService] ✅ Cache HIT: Found 46 POIs in cache
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 46 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 46 total POIs, 46 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.005s
[NativeMarkerManager] 🔍 Rendering 58 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 72 markers
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986204,-46.521830,30
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.009s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.012s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.015s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 46 POIs, 174 TPs
[AudioCacheHelper] ✅ Found cached audio: poiId=6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Ecológico Municipal Bosque Das Araucárias (POI: 6cf04ec7-6ac1-4b5b-a5f0-13ecd1d7f559) - duration: 0.020s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.021s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 46 visible POIs, 0 cached POIs, total: 46 POIs. TPs: 174 visible, 0 cached, total: 174
[GuideEngine] 🕒 Schedule check: 46 active POIs (out of 46 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986204,-46.521830,30
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[NativeMarkerManager] 🔍 Rendering 58 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 72 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986204,-46.521830,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.986204', lng: '-46.521830' },
  last: { lat: '-22.980432', lng: '-46.527963' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986204,-46.521830,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 120 markers
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0305)
[NativeMarkerManager] Update complete: 120 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0305)
[NativeMarkerManager] Update complete: 120 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986204,-46.521830,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986204,-46.521830,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[NativeMarkerManager] Update complete: 120 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986204,-46.521830,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[NativeMarkerManager] Update complete: 120 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[NativeMarkerManager] Update complete: 120 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 163 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 163 valid trigger points
[POICacheHelper] ✅ Saved 44 POIs to cache v4
[POILoadingService] ✅ Synced 44 POIs, 163 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 44 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 44 POIs, 163 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 44 active POIs (out of 44 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986204,-46.521830,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.986204', lng: '-46.521830' },
  last: { lat: '-22.980432', lng: '-46.527963' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986204,-46.521830,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[NativeMarkerManager] Update complete: 120 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.980109',
  lng: '-46.528295',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:27.016Z',
  age: 8178 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.980109, lng=-46.528295, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.980109, lng=-46.528295, speed=50.00 m/s, heading=316.6, total TPs=163
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 58 TPs (from 163 total)
[TriggerDetectionService] 🔍 After distance filter: 58 TPs (from 163 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9801',
  lng: '-46.5283',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:27.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9801', lng: '-46.5283', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 3)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.980109',
  lng: '-46.528295',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '316.6',
  timestamp: '2025-12-29T17:35:35.195Z',
  age: 1.408935546875 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9801, lng=-46.5283
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986204,-46.521830,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.986020', lng: '-46.522244' },
  last: { lat: '-22.980109', lng: '-46.528295' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986020,-46.522244,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986020,-46.522244,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986020,-46.522244,30
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[NativeMarkerManager] Update complete: 120 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9804, lng=-46.5280, radius=5.06km, context=viewport_change
[POICacheHelper] ✅ Found 46 POIs within 5.1km radius from cache (limited from 46 total)
[POILoadingService] ✅ Cache HIT: Found 46 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 46 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 46 total POIs, 46 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.007s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 46 POIs, 174 TPs
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.012s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 46 visible POIs, 0 cached POIs, total: 46 POIs. TPs: 174 visible, 0 cached, total: 174
[GuideEngine] 🕒 Schedule check: 46 active POIs (out of 46 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.017s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986020,-46.522244,30
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[NativeMarkerManager] 🔍 Rendering 98 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[AudioPreloadService] ✅ Preload [4/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.022s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] Update complete: 120 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986020,-46.522244,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.045s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.049s
[NativeMarkerManager] 🔍 Rendering 99 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.986020', lng: '-46.522244' },
  last: { lat: '-22.980109', lng: '-46.528295' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986020,-46.522244,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 121 markers
[NativeMarkerManager] 🔍 Rendering 99 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[NativeMarkerManager] Update complete: 121 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986020,-46.522244,30
[NativeMarkerManager] 🔍 Rendering 99 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[NativeMarkerManager] Update complete: 121 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986020,-46.522244,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 100 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0305)
[NativeMarkerManager] Update complete: 122 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986020,-46.522244,30
[NativeMarkerManager] 🔍 Rendering 101 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0305)
[NativeMarkerManager] Update complete: 123 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986020,-46.522244,30
[NativeMarkerManager] 🔍 Rendering 101 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0305)
[NativeMarkerManager] Update complete: 123 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 101 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 123 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986020,-46.522244,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986020,-46.522244,30
[NativeMarkerManager] 🔍 Rendering 101 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 123 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 101 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 123 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 173 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 173 valid trigger points
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"69d3d623-d201-4ffe-9933-603e9af0e06f","name":"Trigger Point 69d3d623-d201-4ffe-9933-603e9af0e06f","attraction_id":"057b3ece-3f90-3b56-81e8-010f20b14668","attraction_name":"Aeroporto Estadual A
[POICacheHelper] ✅ Saved 45 POIs to cache v4
[POILoadingService] 🔍 [SYNC] Received 58 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 58 valid trigger points
[POILoadingService] ✅ Synced 45 POIs, 173 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 45 POIs synced
[POICacheHelper] ✅ Saved 14 POIs to cache v4
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 45 POIs, 173 TPs
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[POILoadingService] ✅ Synced 14 POIs, 58 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 14 POIs synced
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 45 active POIs (out of 45 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986020,-46.522244,30
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 14 POIs, 58 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
[GuideEngine] 🕒 Schedule check: 14 active POIs (out of 14 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.986020', lng: '-46.522244' },
  last: { lat: '-22.980109', lng: '-46.528295' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986020,-46.522244,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManager] 🔍 Rendering 101 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] Update complete: 123 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.986020', lng: '-46.522244' },
  last: { lat: '-22.980109', lng: '-46.528295' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986020,-46.522244,30
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManager] 🔍 Rendering 58 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 72 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.979661',
  lng: '-46.528752',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:28.016Z',
  age: 8194 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.979661, lng=-46.528752, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.979661, lng=-46.528752, speed=50.00 m/s, heading=316.8, total TPs=58
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 58 TPs (from 58 total)
[TriggerDetectionService] 🔍 After distance filter: 58 TPs (from 58 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9797',
  lng: '-46.5288',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:28.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9797', lng: '-46.5288', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 4)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.979661',
  lng: '-46.528752',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '316.8',
  timestamp: '2025-12-29T17:35:36.212Z',
  age: 0.780029296875 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9797, lng=-46.5288
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.986020,-46.522244,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.985799', lng: '-46.522658' },
  last: { lat: '-22.979661', lng: '-46.528752' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985799,-46.522658,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985799,-46.522658,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985799,-46.522658,30
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManager] 🔍 Rendering 58 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 72 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985799,-46.522658,30
[NativeMarkerManager] 🔍 Rendering 58 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 72 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985799,-46.522658,30
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9801, lng=-46.5283, radius=5.09km, context=viewport_change
[POICacheHelper] ✅ Found 46 POIs within 5.1km radius from cache (limited from 46 total)
[POILoadingService] ✅ Cache HIT: Found 46 POIs in cache
[NativeMarkerManager] 🔍 Rendering 58 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 72 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985799,-46.522658,30
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 46 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 46 total POIs, 46 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.005s
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 46 POIs, 174 TPs
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 46 visible POIs, 0 cached POIs, total: 46 POIs. TPs: 174 visible, 0 cached, total: 174
[GuideEngine] 🕒 Schedule check: 46 active POIs (out of 46 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985799,-46.522658,30
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.014s
[NativeMarkerManager] 🔍 Rendering 58 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.018s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.021s
[NativeMarkerManager] 🔍 Rendering 58 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[NativeMarkerManager] Update complete: 72 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.025s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.035s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985799,-46.522658,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 103 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 72 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.985799', lng: '-46.522658' },
  last: { lat: '-22.979661', lng: '-46.528752' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985799,-46.522658,30
[NativeMarkerManager] Update complete: 126 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985799,-46.522658,30
[NativeMarkerManager] 🔍 Rendering 105 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 128 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 105 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 128 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985799,-46.522658,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 105 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 128 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985799,-46.522658,30
[NativeMarkerManager] 🔍 Rendering 105 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 128 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985799,-46.522658,30
[NativeMarkerManager] 🔍 Rendering 105 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 128 markers
[NativeMarkerManager] 🔍 Rendering 105 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 128 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 174 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 174 valid trigger points
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[POICacheHelper] ✅ Saved 46 POIs to cache v4
[POILoadingService] ✅ Synced 46 POIs, 174 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 46 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 46 POIs, 174 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 46 active POIs (out of 46 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985799,-46.522658,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.985799', lng: '-46.522658' },
  last: { lat: '-22.979661', lng: '-46.528752' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985799,-46.522658,30
[NativeMarkerManager] 🔍 Rendering 105 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 128 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.979349',
  lng: '-46.529028',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:29.016Z',
  age: 8211 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.979349, lng=-46.529028, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.979349, lng=-46.529028, speed=50.00 m/s, heading=320.8, total TPs=174
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 64 TPs (from 174 total)
[StorageService] setItem called for key: last_gps_location
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 304, crc 538699203, actualSize 31658
[TriggerDetectionService] 🔍 After distance filter: 64 TPs (from 174 total)
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
[StorageService] setItem completed for key: last_gps_location
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 5)
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9793',
  lng: '-46.5290',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:29.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9793', lng: '-46.5290', source: 'simulated' }
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.979349',
  lng: '-46.529028',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '320.8',
  timestamp: '2025-12-29T17:35:37.228Z',
  age: 30.756103515625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9793, lng=-46.5290
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985799,-46.522658,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.985268', lng: '-46.523370' },
  last: { lat: '-22.979349', lng: '-46.529028' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985268,-46.523370,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985268,-46.523370,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985268,-46.523370,30
[NativeMarkerManager] 🔍 Rendering 106 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 129 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9796, lng=-46.5288, radius=5.10km, context=viewport_change
[POICacheHelper] ✅ Found 47 POIs within 5.1km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985268,-46.523370,30
[NativeMarkerManager] 🔍 Rendering 106 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0307)
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.006s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[NativeMarkerManager] Update complete: 129 markers
[AudioPreloadService] ✅ Preload [2/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.015s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.021s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985268,-46.523370,30
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.029s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.032s
[NativeMarkerManager] 🔍 Rendering 106 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0307)
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.036s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] Update complete: 130 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.985268', lng: '-46.523370' },
  last: { lat: '-22.979349', lng: '-46.529028' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985268,-46.523370,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985268,-46.523370,30
[NativeMarkerManager] 🔍 Rendering 107 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0308)
[NativeMarkerManager] Update complete: 131 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985268,-46.523370,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985268,-46.523370,30
[NativeMarkerManager] 🔍 Rendering 108 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 132 markers
[NativeMarkerManager] 🔍 Rendering 108 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
[NativeMarkerManager] Update complete: 132 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 110 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0310)
[NativeMarkerManager] Update complete: 134 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985268,-46.523370,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985268,-46.523370,30
[NativeMarkerManager] 🔍 Rendering 110 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0310)
[NativeMarkerManager] Update complete: 134 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985268,-46.523370,30
[NativeMarkerManager] 🔍 Rendering 110 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 134 markers
[NativeMarkerManager] 🔍 Rendering 110 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 134 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 174 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 174 valid trigger points
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[POICacheHelper] ✅ Saved 46 POIs to cache v4
[POILoadingService] ✅ Synced 46 POIs, 174 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 46 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 46 POIs, 174 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 46 active POIs (out of 46 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985268,-46.523370,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.985268', lng: '-46.523370' },
  last: { lat: '-22.979349', lng: '-46.529028' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985268,-46.523370,30
[NativeMarkerManager] 🔍 Rendering 110 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 134 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.978985',
  lng: '-46.529333',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:30.016Z',
  age: 8228 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.978985, lng=-46.529333, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.978985, lng=-46.529333, speed=50.00 m/s, heading=322.4, total TPs=174
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 65 TPs (from 174 total)
[StorageService] setItem called for key: last_gps_location
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 6)
[TriggerDetectionService] 🔍 After distance filter: 65 TPs (from 174 total)
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9790',
  lng: '-46.5293',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:30.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9790', lng: '-46.5293', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.978985',
  lng: '-46.529333',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '322.4',
  timestamp: '2025-12-29T17:35:38.245Z',
  age: 48.65576171875 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9790, lng=-46.5293
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.985268,-46.523370,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.984845', lng: '-46.523769' },
  last: { lat: '-22.978985', lng: '-46.529333' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.984845,-46.523769,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.984845,-46.523769,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.984845,-46.523769,30
[NativeMarkerManager] 🔍 Rendering 110 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 134 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9793, lng=-46.5291, radius=5.18km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[POICacheHelper] ✅ Found 47 POIs within 5.2km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.984845,-46.523769,30
[NativeMarkerManager] 🔍 Rendering 110 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.005s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.013s
[NativeMarkerManager] Update complete: 134 markers
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.015s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.018s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.022s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.026s
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.984845,-46.523769,30
[NativeMarkerManager] 🔍 Rendering 110 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] Update complete: 134 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.984845', lng: '-46.523769' },
  last: { lat: '-22.978985', lng: '-46.529333' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.984845,-46.523769,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 110 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.984845,-46.523769,30
[NativeMarkerManager] Update complete: 134 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.984845,-46.523769,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.984845,-46.523769,30
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 135 markers
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 135 markers
🌐 [NetworkSpeedLogger] Network: WIFI (FAST 🚀) - ✅ Network speed OK - ✅ CONNECTED - Guide Active
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.984845,-46.523769,30
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 136 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.984845,-46.523769,30
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 136 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.984845,-46.523769,30
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 136 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 136 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 174 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 174 valid trigger points
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[POICacheHelper] ✅ Saved 46 POIs to cache v4
[POILoadingService] ✅ Synced 46 POIs, 174 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 46 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 46 POIs, 174 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 46 active POIs (out of 46 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.984845,-46.523769,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.984845', lng: '-46.523769' },
  last: { lat: '-22.978985', lng: '-46.529333' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.984845,-46.523769,30
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 136 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.978781',
  lng: '-46.529471',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:31.016Z',
  age: 8228 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.978781, lng=-46.529471, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.978781, lng=-46.529471, speed=50.00 m/s, heading=328.1, total TPs=174
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 65 TPs (from 174 total)
[StorageService] setItem called for key: last_gps_location
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 7)
[TriggerDetectionService] 🔍 After distance filter: 65 TPs (from 174 total)
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9788',
  lng: '-46.5295',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:31.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9788', lng: '-46.5295', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.978781',
  lng: '-46.529471',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '328.1',
  timestamp: '2025-12-29T17:35:39.245Z',
  age: 11.9892578125 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9788, lng=-46.5295
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.984845,-46.523769,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.983787', lng: '-46.524688' },
  last: { lat: '-22.978781', lng: '-46.529471' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983787,-46.524688,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983787,-46.524688,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983787,-46.524688,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 137 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9790, lng=-46.5293, radius=5.21km, context=viewport_change
[POICacheHelper] ✅ Found 47 POIs within 5.2km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983787,-46.524688,30
[AudioPreloadService] ✅ Preload [1/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.045s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.049s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.056s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] Update complete: 137 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983787,-46.524688,30
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.064s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.035s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.075s
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.983787', lng: '-46.524688' },
  last: { lat: '-22.978781', lng: '-46.529471' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983787,-46.524688,30
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 137 markers
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 138 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983787,-46.524688,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983787,-46.524688,30
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 138 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 138 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983787,-46.524688,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 138 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983787,-46.524688,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 138 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983787,-46.524688,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983787,-46.524688,30
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 138 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 138 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 138 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983787,-46.524688,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.983787', lng: '-46.524688' },
  last: { lat: '-22.978781', lng: '-46.529471' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983787,-46.524688,30
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 138 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.978652',
  lng: '-46.529574',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:32.016Z',
  age: 8244 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.978652, lng=-46.529574, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.978652, lng=-46.529574, speed=50.00 m/s, heading=323.7, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 66 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 66 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9787',
  lng: '-46.5296',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:32.016Z' }
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 305, crc 3374494468, actualSize 33238
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9787', lng: '-46.5296', source: 'simulated' }
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.978652',
  lng: '-46.529574',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '323.7',
  timestamp: '2025-12-29T17:35:40.261Z',
  age: 0.17578125 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 8)
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9787, lng=-46.5296
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983787,-46.524688,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.983258', lng: '-46.525122' },
  last: { lat: '-22.978652', lng: '-46.529574' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983258,-46.525122,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983258,-46.525122,30
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9788, lng=-46.5295, radius=5.26km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[POICacheHelper] ✅ Found 47 POIs within 5.3km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[NativeMarkerManager] Update complete: 138 markers
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.008s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.011s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.013s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.017s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.018s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.025s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983258,-46.525122,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.983258', lng: '-46.525122' },
  last: { lat: '-22.978652', lng: '-46.529574' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983258,-46.525122,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983258,-46.525122,30
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 138 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983258,-46.525122,30
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 138 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983258,-46.525122,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 138 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983258,-46.525122,30
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 138 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 138 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983258,-46.525122,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983258,-46.525122,30
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 138 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983258,-46.525122,30
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 138 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 138 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983258,-46.525122,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.983258', lng: '-46.525122' },
  last: { lat: '-22.978652', lng: '-46.529574' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983258,-46.525122,30
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 138 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.978477',
  lng: '-46.529741',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:33.016Z',
  age: 8261 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.978477, lng=-46.529741, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.978477, lng=-46.529741, speed=50.00 m/s, heading=318.7, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 67 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 9)
[TriggerDetectionService] 🔍 After distance filter: 67 TPs (from 175 total)
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9785',
  lng: '-46.5297',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:33.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9785', lng: '-46.5297', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.978477',
  lng: '-46.529741',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '318.7',
  timestamp: '2025-12-29T17:35:41.278Z',
  age: 5.781982421875 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9785, lng=-46.5297
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983258,-46.525122,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.983052', lng: '-46.525292' },
  last: { lat: '-22.978477', lng: '-46.529741' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983052,-46.525292,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983052,-46.525292,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9786, lng=-46.5296, radius=5.22km, context=viewport_change
[POICacheHelper] ✅ Found 47 POIs within 5.2km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.007s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.013s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.016s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983052,-46.525292,30
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.049s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.051s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.055s
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.983052', lng: '-46.525292' },
  last: { lat: '-22.978477', lng: '-46.529741' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983052,-46.525292,30
[NativeMarkerManager] Update complete: 138 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 138 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983052,-46.525292,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983052,-46.525292,30
[NativeMarkerManager] 🔍 Rendering 112 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 138 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983052,-46.525292,30
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 137 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983052,-46.525292,30
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0310)
[NativeMarkerManager] Update complete: 137 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0310)
[NativeMarkerManager] Update complete: 137 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983052,-46.525292,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983052,-46.525292,30
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
[NativeMarkerManager] Update complete: 137 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
[NativeMarkerManager] Update complete: 137 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983052,-46.525292,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.983052', lng: '-46.525292' },
  last: { lat: '-22.978477', lng: '-46.529741' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983052,-46.525292,30
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
[NativeMarkerManager] Update complete: 137 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.978414',
  lng: '-46.529818',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:34.016Z',
  age: 8277 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.978414, lng=-46.529818, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.978414, lng=-46.529818, speed=50.00 m/s, heading=311.6, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 67 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 67 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9784',
  lng: '-46.5298',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:34.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9784', lng: '-46.5298', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.978414',
  lng: '-46.529818',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '311.6',
  timestamp: '2025-12-29T17:35:42.294Z',
  age: 0.356201171875 }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 10)
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9784, lng=-46.5298
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.983052,-46.525292,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982650', lng: '-46.525671' },
  last: { lat: '-22.978414', lng: '-46.529818' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982650,-46.525671,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982650,-46.525671,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982650,-46.525671,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0308)
[NativeMarkerManager] Update complete: 137 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9785, lng=-46.5297, radius=5.13km, context=viewport_change
[POICacheHelper] ✅ Found 47 POIs within 5.1km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982650,-46.525671,30
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.006s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0307)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.014s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[NativeMarkerManager] Update complete: 137 markers
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.018s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.023s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.030s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.034s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982650,-46.525671,30
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0307)
[NativeMarkerManager] Update complete: 136 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982650,-46.525671,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982650', lng: '-46.525671' },
  last: { lat: '-22.978414', lng: '-46.529818' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982650,-46.525671,30
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0307)
[NativeMarkerManager] Update complete: 135 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0305)
[NativeMarkerManager] Update complete: 135 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982650,-46.525671,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 110 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[NativeMarkerManager] Update complete: 134 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982650,-46.525671,30
[NativeMarkerManager] 🔍 Rendering 108 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0302)
[NativeMarkerManager] Update complete: 132 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982650,-46.525671,30
[NativeMarkerManager] 🔍 Rendering 108 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0298)
[NativeMarkerManager] Update complete: 132 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982650,-46.525671,30
[NativeMarkerManager] 🔍 Rendering 108 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0298)
[NativeMarkerManager] Update complete: 132 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 108 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0298)
[NativeMarkerManager] Update complete: 132 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982650,-46.525671,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982650', lng: '-46.525671' },
  last: { lat: '-22.978414', lng: '-46.529818' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982650,-46.525671,30
[NativeMarkerManager] 🔍 Rendering 108 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0298)
[NativeMarkerManager] Update complete: 132 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.977967',
  lng: '-46.530430',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:35.016Z',
  age: 8294 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.977967, lng=-46.530430, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.977967, lng=-46.530430, speed=50.00 m/s, heading=308.4, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 71 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 306, crc 2561216476, actualSize 34790
[TriggerDetectionService] 🔍 After distance filter: 71 TPs (from 175 total)
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
[StorageService] setItem completed for key: last_gps_location
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 11)
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9780',
  lng: '-46.5304',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:35.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9780', lng: '-46.5304', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.977967',
  lng: '-46.530430',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '308.4',
  timestamp: '2025-12-29T17:35:43.311Z',
  age: 29.656982421875 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9780, lng=-46.5304
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982650,-46.525671,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982624', lng: '-46.525699' },
  last: { lat: '-22.977967', lng: '-46.530430' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982624,-46.525699,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982624,-46.525699,30
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9784, lng=-46.5299, radius=5.14km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982624,-46.525699,30
[POICacheHelper] ✅ Found 47 POIs within 5.1km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] 🔍 Rendering 108 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.006s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] Update complete: 132 markers
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982624,-46.525699,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.048s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.056s
[NativeMarkerManager] 🔍 Rendering 108 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] Update complete: 132 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982624', lng: '-46.525699' },
  last: { lat: '-22.977967', lng: '-46.530430' } }
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982624,-46.525699,30
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.063s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.070s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.073s
[NativeMarkerManager] 🔍 Rendering 108 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982624,-46.525699,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 132 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982624,-46.525699,30
[NativeMarkerManager] 🔍 Rendering 108 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0296)
[NativeMarkerManager] Update complete: 132 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982624,-46.525699,30
[NativeMarkerManager] 🔍 Rendering 107 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0295)
[NativeMarkerManager] Update complete: 131 markers
🌐 [NetworkSpeedLogger] Network: WIFI (FAST 🚀) - ✅ Network speed OK - ✅ CONNECTED - Guide Active
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982624,-46.525699,30
[NativeMarkerManager] 🔍 Rendering 107 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0294)
[NativeMarkerManager] Update complete: 131 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982624,-46.525699,30
[NativeMarkerManager] 🔍 Rendering 107 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0293)
[NativeMarkerManager] Update complete: 131 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982624,-46.525699,30
[NativeMarkerManager] 🔍 Rendering 107 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0292)
[NativeMarkerManager] Update complete: 131 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982624,-46.525699,30
[NativeMarkerManager] 🔍 Rendering 107 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0291)
[NativeMarkerManager] Update complete: 131 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 107 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0291)
[NativeMarkerManager] Update complete: 131 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982624,-46.525699,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982624', lng: '-46.525699' },
  last: { lat: '-22.977967', lng: '-46.530430' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982624,-46.525699,30
[NativeMarkerManager] 🔍 Rendering 107 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0291)
[NativeMarkerManager] Update complete: 131 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.977660',
  lng: '-46.530808',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:36.016Z',
  age: 8294 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.977660, lng=-46.530808, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.977660, lng=-46.530808, speed=50.00 m/s, heading=311.4, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 72 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 72 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9777',
  lng: '-46.5308',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:36.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9777', lng: '-46.5308', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.977660',
  lng: '-46.530808',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '311.4',
  timestamp: '2025-12-29T17:35:44.311Z',
  age: 0.656982421875 }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 12)
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9777, lng=-46.5308
[AiGuideService:PHASE1_CONE] 👁️ Detected 1 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 378m | Angle: 15.9°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982624,-46.525699,30
[AudioCache] ✅ Found Cache for POI=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b: [Audio: true, Text: true]
[AiGuideService:CACHE_HIT_AUDIO] 🎯 Found exact context audio for POI 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b. Bypassing AI generation.
[AiGuideService:LINK_NATIVE] 🔗 Linking cached audio to native for POI 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[TriggerDetectionService:AI] 🗣️ Contextual Audio Linked for POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b -> /Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/rjk3jp-pt-br-male.mp3
[TriggerDetectionService:AI] 📊 Current Override Pool Size: 1
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982521', lng: '-46.525813' },
  last: { lat: '-22.977660', lng: '-46.530808' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982521,-46.525813,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982521,-46.525813,30
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9779, lng=-46.5305, radius=5.19km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982521,-46.525813,30
[POICacheHelper] ✅ Found 47 POIs within 5.2km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[NativeMarkerManager] 🔍 Rendering 108 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0292)
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[NativeMarkerManager] Update complete: 132 markers
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.013s
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982521,-46.525813,30
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.011s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.012s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] 🔍 Rendering 108 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0293)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.015s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.019s
[NativeMarkerManager] Update complete: 132 markers
[NativeMarkerManagerBridge] Stopped observing events
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.037s
[NativeMarkerManagerBridge] Started observing events
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982521', lng: '-46.525813' },
  last: { lat: '-22.977660', lng: '-46.530808' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982521,-46.525813,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982521,-46.525813,30
[NativeMarkerManager] 🔍 Rendering 110 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0293)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 134 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982521,-46.525813,30
[NativeMarkerManager] 🔍 Rendering 110 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0294)
[NativeMarkerManager] Update complete: 135 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982521,-46.525813,30
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0295)
[NativeMarkerManager] Update complete: 136 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0296)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982521,-46.525813,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 137 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982521,-46.525813,30
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[NativeMarkerManager] Update complete: 137 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[NativeMarkerManager] Update complete: 137 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982521,-46.525813,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982521', lng: '-46.525813' },
  last: { lat: '-22.977660', lng: '-46.530808' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982521,-46.525813,30
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[NativeMarkerManager] Update complete: 137 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.977449',
  lng: '-46.531005',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:37.016Z',
  age: 8310 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.977449, lng=-46.531005, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.977449, lng=-46.531005, speed=50.00 m/s, heading=319.3, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 72 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 72 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9774',
  lng: '-46.5310',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:37.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9774', lng: '-46.5310', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.977449',
  lng: '-46.531005',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '319.3',
  timestamp: '2025-12-29T17:35:45.328Z',
  age: 0.989990234375 }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 13)
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9774, lng=-46.5310
[AiGuideService:PHASE1_CONE] 👁️ Detected 1 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 347m | Angle: 8.7°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982521,-46.525813,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982418', lng: '-46.525886' },
  last: { lat: '-22.977449', lng: '-46.531005' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982418,-46.525886,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982418,-46.525886,30
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9776, lng=-46.5308, radius=5.11km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[POICacheHelper] ✅ Found 47 POIs within 5.1km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[NativeMarkerManager] 🔍 Rendering 111 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0299)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[NativeMarkerManager] Update complete: 137 markers
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.006s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.011s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.016s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982418,-46.525886,30
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.019s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.023s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.036s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982418', lng: '-46.525886' },
  last: { lat: '-22.977449', lng: '-46.531005' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982418,-46.525886,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 113 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0300)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982418,-46.525886,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 139 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982418,-46.525886,30
[NativeMarkerManager] 🔍 Rendering 113 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[NativeMarkerManager] Update complete: 139 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982418,-46.525886,30
[NativeMarkerManager] 🔍 Rendering 115 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 142 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982418,-46.525886,30
[NativeMarkerManager] 🔍 Rendering 117 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0307)
[NativeMarkerManager] Update complete: 144 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982418,-46.525886,30
[NativeMarkerManager] 🔍 Rendering 117 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0308)
[NativeMarkerManager] Update complete: 145 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982418,-46.525886,30
[NativeMarkerManager] 🔍 Rendering 117 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
[NativeMarkerManager] Update complete: 145 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 117 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
[NativeMarkerManager] Update complete: 145 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.977271',
  lng: '-46.531120',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:38.016Z',
  age: 8327 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.977271, lng=-46.531120, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.977271, lng=-46.531120, speed=50.00 m/s, heading=329.3, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 72 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 72 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 307, crc 2476481590, actualSize 36234
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9773',
  lng: '-46.5311',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:38.016Z' }
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9773', lng: '-46.5311', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 14)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.977271',
  lng: '-46.531120',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '329.3',
  timestamp: '2025-12-29T17:35:46.347Z',
  age: 3.75390625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9773, lng=-46.5311
[AiGuideService:PHASE1_CONE] 👁️ Detected 1 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 324m | Angle: -1.3°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982418,-46.525886,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982319', lng: '-46.525938' },
  last: { lat: '-22.977271', lng: '-46.531120' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982319,-46.525938,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982319,-46.525938,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982319,-46.525938,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[NativeMarkerManager] 🔍 Rendering 120 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0310)
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[NativeMarkerManager] Update complete: 148 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9774, lng=-46.5310, radius=5.16km, context=viewport_change
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982319,-46.525938,30
[POICacheHelper] ✅ Found 47 POIs within 5.2km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[NativeMarkerManager] 🔍 Rendering 120 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 148 markers
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.013s
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.020s
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982319,-46.525938,30
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.018s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.020s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] 🔍 Rendering 121 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.015s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.040s
[NativeMarkerManager] Update complete: 149 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982319', lng: '-46.525938' },
  last: { lat: '-22.977271', lng: '-46.531120' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982319,-46.525938,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982319,-46.525938,30
[NativeMarkerManager] 🔍 Rendering 122 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 150 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982319,-46.525938,30
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[NativeMarkerManager] 🔍 Rendering 126 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 154 markers
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982319,-46.525938,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] 🔍 Rendering 127 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 155 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982319', lng: '-46.525938' },
  last: { lat: '-22.977271', lng: '-46.531120' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982319,-46.525938,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982319,-46.525938,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 156 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982319,-46.525938,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 156 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 156 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982319,-46.525938,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982319', lng: '-46.525938' },
  last: { lat: '-22.977271', lng: '-46.531120' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982319,-46.525938,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 156 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.977134',
  lng: '-46.531190',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:39.016Z',
  age: 8344 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.977134, lng=-46.531190, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.977134, lng=-46.531190, speed=50.00 m/s, heading=334.8, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[StorageService] setItem called for key: last_gps_location
[TriggerDetectionService] 🔍 Distance filter result: 72 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 72 TPs (from 175 total)
[StorageService] setItem completed for key: last_gps_location
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 15)
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9771',
  lng: '-46.5312',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:39.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9771', lng: '-46.5312', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.977134',
  lng: '-46.531190',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '334.8',
  timestamp: '2025-12-29T17:35:47.361Z',
  age: 40.9140625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9771, lng=-46.5312
[AiGuideService:PHASE1_CONE] 👁️ Detected 1 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 307m | Angle: -7.2°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982319,-46.525938,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982304', lng: '-46.525927' },
  last: { lat: '-22.977134', lng: '-46.531190' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982304,-46.525927,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982304,-46.525927,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982304,-46.525927,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 156 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9773, lng=-46.5311, radius=5.27km, context=viewport_change
[POICacheHelper] ✅ Found 47 POIs within 5.3km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982304,-46.525927,30
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[NativeMarkerManager] Update complete: 156 markers
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.024s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.014s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.019s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.023s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982304,-46.525927,30
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.029s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.050s
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManagerBridge] Stopped observing events
Sending `onMarkersRendered` with no listeners registered.
[NativeMarkerManagerBridge] Started observing events
Sending `onMarkersRendered` with no listeners registered.
[NativeMarkerManager] Update complete: 156 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982304', lng: '-46.525927' },
  last: { lat: '-22.977134', lng: '-46.531190' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982304,-46.525927,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982304,-46.525927,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 156 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982304,-46.525927,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 156 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 156 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982304,-46.525927,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982304,-46.525927,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 156 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 156 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982304,-46.525927,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982304,-46.525927,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 156 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 156 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.977013',
  lng: '-46.531246',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:40.016Z',
  age: 8360 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.977013, lng=-46.531246, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.977013, lng=-46.531246, speed=50.00 m/s, heading=336.9, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 72 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 72 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9770, lng=-46.5312, radius=2.00km, context=movement
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9770',
  lng: '-46.5312',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:40.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9770', lng: '-46.5312', source: 'simulated' }
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 308, crc 243500642, actualSize 37290
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.977013',
  lng: '-46.531246',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '336.9',
  timestamp: '2025-12-29T17:35:48.380Z',
  age: 2.81103515625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 16)
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9770, lng=-46.5312
[AiGuideService:PHASE1_CONE] 👁️ Detected 1 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 293m | Angle: -9.8°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982304,-46.525927,30
[POICacheHelper] ✅ Found 18 POIs within 2.0km radius from cache (limited from 18 total)
[POILoadingService] ✅ Cache HIT: Found 18 POIs in cache
[AudioPreloadService] 🔍 Checking 18 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[POILoadingService] 🔄 Sync delay: 1.0s (context: movement)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 18 total POIs, 18 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.004s
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.007s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 18 POIs, 71 TPs
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.011s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.012s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.015s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.020s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 18 active POIs (out of 18 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982304,-46.525927,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982267', lng: '-46.525916' },
  last: { lat: '-22.977013', lng: '-46.531246' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982267,-46.525916,30
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 89 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982267,-46.525916,30
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982267,-46.525916,30
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[NativeMarkerManager] Update complete: 89 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9771, lng=-46.5312, radius=5.26km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982267,-46.525916,30
[POICacheHelper] ✅ Found 47 POIs within 5.3km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.007s
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] Update complete: 89 markers
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.018s
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.017s
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982267,-46.525916,30
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.013s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.012s
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
🌐 [NetworkSpeedLogger] Network: WIFI (FAST 🚀) - ✅ Network speed OK - ✅ CONNECTED - Guide Active
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] Update complete: 89 markers
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.057s
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982267', lng: '-46.525916' },
  last: { lat: '-22.977013', lng: '-46.531246' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982267,-46.525916,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[NativeMarkerManager] Update complete: 156 markers
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982267,-46.525916,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 156 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982267,-46.525916,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982267', lng: '-46.525916' },
  last: { lat: '-22.977013', lng: '-46.531246' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982267,-46.525916,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 156 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982267,-46.525916,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 156 markers
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 156 markers
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 156 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982267,-46.525916,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982267', lng: '-46.525916' },
  last: { lat: '-22.977013', lng: '-46.531246' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982267,-46.525916,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 156 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.976871',
  lng: '-46.531299',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:41.016Z',
  age: 8377 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.976871, lng=-46.531299, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.976871, lng=-46.531299, speed=50.00 m/s, heading=341.0, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 72 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 72 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9769',
  lng: '-46.5313',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:41.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9769', lng: '-46.5313', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.976871',
  lng: '-46.531299',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '341.0',
  timestamp: '2025-12-29T17:35:49.394Z',
  age: -0.041015625 }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 17)
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9769, lng=-46.5313
[AiGuideService:PHASE1_CONE] 👁️ Detected 1 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 277m | Angle: -14.8°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982267,-46.525916,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982234', lng: '-46.525918' },
  last: { lat: '-22.976871', lng: '-46.531299' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982234,-46.525918,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982234,-46.525918,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982234,-46.525918,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 156 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9770, lng=-46.5312, radius=5.24km, context=viewport_change
[POICacheHelper] ✅ Found 47 POIs within 5.2km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[NativeMarkerManager] Update complete: 156 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982234,-46.525918,30
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.023s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.028s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.035s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.020s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982234,-46.525918,30
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.024s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.074s
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 156 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982234', lng: '-46.525918' },
  last: { lat: '-22.976871', lng: '-46.531299' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982234,-46.525918,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982234,-46.525918,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 156 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 156 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982234,-46.525918,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982234,-46.525918,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 156 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 156 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982234,-46.525918,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982234,-46.525918,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 156 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982234,-46.525918,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 156 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 156 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 71 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 71 valid trigger points
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.976703',
  lng: '-46.531356',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:42.016Z',
  age: 8394 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.976703, lng=-46.531356, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.976703, lng=-46.531356, speed=50.00 m/s, heading=342.7, total TPs=71
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 70 TPs (from 71 total)
[TriggerDetectionService] 🔍 After distance filter: 70 TPs (from 71 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9767',
  lng: '-46.5314',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:42.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9767', lng: '-46.5314', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 18)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.976703',
  lng: '-46.531356',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '342.7',
  timestamp: '2025-12-29T17:35:50.413Z',
  age: 2.652099609375 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9767, lng=-46.5314
[AiGuideService:PHASE1_CONE] 👁️ Detected 1 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 258m | Angle: -17.6°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982234,-46.525918,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982203', lng: '-46.525930' },
  last: { lat: '-22.976703', lng: '-46.531356' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982203,-46.525930,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982203,-46.525930,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982203,-46.525930,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 156 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9769, lng=-46.5313, radius=5.19km, context=viewport_change
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982203,-46.525930,30
[POICacheHelper] ✅ Saved 18 POIs to cache v4
[POICacheHelper] ✅ Found 47 POIs within 5.2km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] Update complete: 156 markers
[POILoadingService] ✅ Synced 18 POIs, 71 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 18 POIs synced
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.007s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.011s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.015s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.017s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982203,-46.525930,30
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.025s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.032s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 18 POIs, 71 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 18 active POIs (out of 18 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982203', lng: '-46.525930' },
  last: { lat: '-22.976703', lng: '-46.531356' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982203,-46.525930,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 156 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982203,-46.525930,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982203', lng: '-46.525930' },
  last: { lat: '-22.976703', lng: '-46.531356' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982203,-46.525930,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 156 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 89 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982203,-46.525930,30
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManager] Update complete: 89 markers
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 89 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982203,-46.525930,30
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 89 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982203,-46.525930,30
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 89 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 89 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.976582',
  lng: '-46.531414',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:43.016Z',
  age: 8410 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.976582, lng=-46.531414, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.976582, lng=-46.531414, speed=50.00 m/s, heading=336.2, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 72 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 72 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 309, crc 856286705, actualSize 39172
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9766',
  lng: '-46.5314',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:43.016Z' }
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9766', lng: '-46.5314', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 19)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.976582',
  lng: '-46.531414',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '336.2',
  timestamp: '2025-12-29T17:35:51.428Z',
  age: 2.369140625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9766, lng=-46.5314
[AiGuideService:PHASE1_CONE] 👁️ Detected 1 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 244m | Angle: -11.8°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982203,-46.525930,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982177', lng: '-46.525952' },
  last: { lat: '-22.976582', lng: '-46.531414' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982177,-46.525952,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982177,-46.525952,30
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982177,-46.525952,30
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0311)
[NativeMarkerManager] Update complete: 89 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9767, lng=-46.5314, radius=5.18km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982177,-46.525952,30
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[POICacheHelper] ✅ Found 47 POIs within 5.2km radius from cache (limited from 47 total)
[NativeMarkerManager] Update complete: 89 markers
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982177,-46.525952,30
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.019s
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.021s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[POICustomClusterRenderer] 🎨 renderClusters called: 9 clusters
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.025s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982177,-46.525952,30
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[NativeMarkerManager] 🔍 Rendering 71 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.027s
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.043s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.060s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] Update complete: 89 markers
[NativeMarkerManager] Update complete: 89 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982177,-46.525952,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982177', lng: '-46.525952' },
  last: { lat: '-22.976582', lng: '-46.531414' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982177,-46.525952,30
[NativeMarkerManager] Update complete: 158 markers
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982177,-46.525952,30
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 158 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982177,-46.525952,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982177', lng: '-46.525952' },
  last: { lat: '-22.976582', lng: '-46.531414' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982177,-46.525952,30
[NativeMarkerManager] 🔍 Rendering 130 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 159 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982177,-46.525952,30
[NativeMarkerManager] 🔍 Rendering 130 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 159 markers
[NativeMarkerManager] 🔍 Rendering 130 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 159 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 130 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 159 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982177,-46.525952,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982177', lng: '-46.525952' },
  last: { lat: '-22.976582', lng: '-46.531414' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982177,-46.525952,30
[NativeMarkerManager] 🔍 Rendering 130 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 159 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.976256',
  lng: '-46.531650',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:44.016Z',
  age: 8427 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.976256, lng=-46.531650, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.976256, lng=-46.531650, speed=50.00 m/s, heading=326.3, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 72 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 20)
[TriggerDetectionService] 🔍 After distance filter: 72 TPs (from 175 total)
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9763',
  lng: '-46.5316',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:44.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9763', lng: '-46.5316', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.976256',
  lng: '-46.531650',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '326.3',
  timestamp: '2025-12-29T17:35:52.444Z',
  age: 6.85595703125 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9763, lng=-46.5316
[AiGuideService:PHASE1_CONE] 👁️ Detected 1 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 200m | Angle: -2.3°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982177,-46.525952,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982158', lng: '-46.525981' },
  last: { lat: '-22.976256', lng: '-46.531650' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982158,-46.525981,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982158,-46.525981,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982158,-46.525981,30
[NativeMarkerManager] 🔍 Rendering 130 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 159 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9766, lng=-46.5314, radius=5.26km, context=viewport_change
[POICacheHelper] ✅ Found 47 POIs within 5.3km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982158,-46.525981,30
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.005s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.009s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.013s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] 🔍 Rendering 130 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.017s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] Update complete: 159 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.022s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982158,-46.525981,30
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.023s
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982158', lng: '-46.525981' },
  last: { lat: '-22.976256', lng: '-46.531650' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982158,-46.525981,30
[NativeMarkerManager] 🔍 Rendering 130 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] Update complete: 159 markers
[NativeMarkerManager] 🔍 Rendering 130 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 159 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982158,-46.525981,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 133 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 163 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982158,-46.525981,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 133 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 163 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982158,-46.525981,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 133 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 163 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982158,-46.525981,30
[NativeMarkerManager] 🔍 Rendering 133 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 163 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982158,-46.525981,30
[NativeMarkerManager] 🔍 Rendering 133 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 163 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 133 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 163 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.976168',
  lng: '-46.531704',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:45.016Z',
  age: 8444 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.976168, lng=-46.531704, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.976168, lng=-46.531704, speed=50.00 m/s, heading=330.5, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 72 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 72 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 310, crc 4094490735, actualSize 40520
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9762',
  lng: '-46.5317',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:45.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9762', lng: '-46.5317', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.976168',
  lng: '-46.531704',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '330.5',
  timestamp: '2025-12-29T17:35:53.463Z',
  age: 2.366943359375 }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 21)
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9762, lng=-46.5317
[AiGuideService:PHASE1_CONE] 👁️ Detected 1 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 189m | Angle: -6.9°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982158,-46.525981,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982147', lng: '-46.526014' },
  last: { lat: '-22.976168', lng: '-46.531704' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982147,-46.526014,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982147,-46.526014,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982147,-46.526014,30
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9762, lng=-46.5317, radius=5.25km, context=viewport_change
[NativeMarkerManager] 🔍 Rendering 133 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 163 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[POICacheHelper] ✅ Found 47 POIs within 5.2km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
🌐 [NetworkSpeedLogger] Network: WIFI (FAST 🚀) - ✅ Network speed OK - ✅ CONNECTED - Guide Active
[NativeMarkerManager] 🔍 Rendering 133 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[NativeMarkerManager] Update complete: 163 markers
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982147,-46.526014,30
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.005s
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.009s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.012s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.016s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982147,-46.526014,30
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.027s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.038s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982147,-46.526014,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] 🔍 Rendering 133 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 164 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982147', lng: '-46.526014' },
  last: { lat: '-22.976168', lng: '-46.531704' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982147,-46.526014,30
[NativeMarkerManager] 🔍 Rendering 133 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 164 markers
[NativeMarkerManager] 🔍 Rendering 133 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 164 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 133 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 164 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982147,-46.526014,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982147,-46.526014,30
[NativeMarkerManager] 🔍 Rendering 133 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 164 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 133 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 164 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982147,-46.526014,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 133 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 164 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982147,-46.526014,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982147', lng: '-46.526014' },
  last: { lat: '-22.976168', lng: '-46.531704' } }
[NativeMarkerManager] 🔍 Rendering 133 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982147,-46.526014,30
[NativeMarkerManager] Update complete: 164 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.975810',
  lng: '-46.531901',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:46.016Z',
  age: 8460 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.975810, lng=-46.531901, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.975810, lng=-46.531901, speed=50.00 m/s, heading=333.1, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 73 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 73 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9758',
  lng: '-46.5319',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:46.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9758', lng: '-46.5319', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.975810',
  lng: '-46.531901',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '333.1',
  timestamp: '2025-12-29T17:35:54.477Z',
  age: 0.34326171875 }
📍 [GuideLocationService] Processing location update through LocationManager...
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 22)
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9758, lng=-46.5319
[AiGuideService:PHASE1_CONE] 👁️ Detected 1 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 145m | Angle: -12.5°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982147,-46.526014,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982146', lng: '-46.526050' },
  last: { lat: '-22.975810', lng: '-46.531901' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982146,-46.526050,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982146,-46.526050,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982146,-46.526050,30
[NativeMarkerManager] 🔍 Rendering 134 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 165 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9761, lng=-46.5317, radius=5.27km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982146,-46.526050,30
[POICacheHelper] ✅ Found 47 POIs within 5.3km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[NativeMarkerManager] 🔍 Rendering 134 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[NativeMarkerManager] Update complete: 165 markers
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.006s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.013s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.019s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[AudioCacheHelper] ✅ Found cached audio: poiId=057b3ece-3f90-3b56-81e8-010f20b14668, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Aeroporto Estadual Arthur Siqueira (POI: 057b3ece-3f90-3b56-81e8-010f20b14668) - duration: 0.026s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982146,-46.526050,30
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.033s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.040s
[NativeMarkerManager] 🔍 Rendering 135 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 166 markers
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982146,-46.526050,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982146', lng: '-46.526050' },
  last: { lat: '-22.975810', lng: '-46.531901' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982146,-46.526050,30
[NativeMarkerManager] 🔍 Rendering 135 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 166 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982146,-46.526050,30
[NativeMarkerManager] 🔍 Rendering 136 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] Update complete: 167 markers
[NativeMarkerManager] 🔍 Rendering 136 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 167 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982146,-46.526050,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 136 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 167 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982146,-46.526050,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 136 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 167 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982146,-46.526050,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 136 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 167 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 136 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 167 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982146,-46.526050,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982146', lng: '-46.526050' },
  last: { lat: '-22.975810', lng: '-46.531901' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982146,-46.526050,30
[NativeMarkerManager] 🔍 Rendering 136 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 167 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.975508',
  lng: '-46.532086',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:47.016Z',
  age: 8477 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.975508, lng=-46.532086, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.975508, lng=-46.532086, speed=50.00 m/s, heading=330.6, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 73 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 73 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 311, crc 334737668, actualSize 41689
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9755',
  lng: '-46.5321',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:47.016Z' }
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9755', lng: '-46.5321', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 23)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.975508',
  lng: '-46.532086',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '330.6',
  timestamp: '2025-12-29T17:35:55.494Z',
  age: 0.85498046875 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9755, lng=-46.5321
[AiGuideService:PHASE1_CONE] 👁️ Detected 2 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 107m | Angle: -13.5°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 382m | Angle: -7.4°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982146,-46.526050,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982091', lng: '-46.526134' },
  last: { lat: '-22.975508', lng: '-46.532086' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982091,-46.526134,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982091,-46.526134,30
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9758, lng=-46.5319, radius=5.27km, context=viewport_change
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982091,-46.526134,30
[POICacheHelper] ✅ Found 47 POIs within 5.3km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[NativeMarkerManager] 🔍 Rendering 136 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[NativeMarkerManager] Update complete: 167 markers
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.005s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.012s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.019s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[AudioPreloadService] ✅ Preload [4/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.025s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982091,-46.526134,30
[AudioCacheHelper] ✅ Found cached audio: poiId=7678babb-3ee4-3b8f-8af8-60e89fda1b57, lang=pt-br, gender=male
[NativeMarkerManager] 🔍 Rendering 136 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] Update complete: 167 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982091', lng: '-46.526134' },
  last: { lat: '-22.975508', lng: '-46.532086' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982091,-46.526134,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - duration: 0.067s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982091,-46.526134,30
[NativeMarkerManager] 🔍 Rendering 136 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.089s
[NativeMarkerManager] Update complete: 167 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982091,-46.526134,30
[NativeMarkerManager] 🔍 Rendering 136 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 167 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982091,-46.526134,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 168 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982091,-46.526134,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 168 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982091,-46.526134,30
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 168 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982091,-46.526134,30
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 168 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 168 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982091,-46.526134,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.982091', lng: '-46.526134' },
  last: { lat: '-22.975508', lng: '-46.532086' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982091,-46.526134,30
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 168 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.975293',
  lng: '-46.532242',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:48.016Z',
  age: 8493 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.975293, lng=-46.532242, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.975293, lng=-46.532242, speed=50.00 m/s, heading=326.3, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 73 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[TriggerDetectionService] 🔍 After distance filter: 73 TPs (from 175 total)
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9753',
  lng: '-46.5322',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:48.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9753', lng: '-46.5322', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.975293',
  lng: '-46.532242',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '326.3',
  timestamp: '2025-12-29T17:35:56.510Z',
  age: 0.549072265625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 24)
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9753, lng=-46.5322
[AiGuideService:PHASE1_CONE] 👁️ Detected 4 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 79m | Angle: -12.4°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 353m | Angle: -3.3°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 391m | Angle: -31.5°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 384m | Angle: 5.9°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.982091,-46.526134,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.981970', lng: '-46.526322' },
  last: { lat: '-22.975293', lng: '-46.532242' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981970,-46.526322,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981970,-46.526322,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981970,-46.526322,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9755, lng=-46.5321, radius=5.27km, context=viewport_change
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 168 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[POICacheHelper] ✅ Found 47 POIs within 5.3km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[NativeMarkerManager] Update complete: 168 markers
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - BEFORE getCachedAudio
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.008s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.014s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981970,-46.526322,30
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.017s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.022s
[NativeMarkerManagerBridge] Stopped observing events
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManagerBridge] Started observing events
[AudioCacheHelper] ✅ Found cached audio: poiId=7678babb-3ee4-3b8f-8af8-60e89fda1b57, lang=pt-br, gender=male
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981970,-46.526322,30
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - duration: 0.029s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.037s
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.981970', lng: '-46.526322' },
  last: { lat: '-22.975293', lng: '-46.532242' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981970,-46.526322,30
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] Update complete: 168 markers
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 168 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981970,-46.526322,30
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 168 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981970,-46.526322,30
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 168 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981970,-46.526322,30
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 168 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981970,-46.526322,30
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 168 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 168 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.975200',
  lng: '-46.532318',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:49.016Z',
  age: 8493 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.975200, lng=-46.532318, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.975200, lng=-46.532318, speed=50.00 m/s, heading=323.0, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 73 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 73 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9752',
  lng: '-46.5323',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:49.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9752', lng: '-46.5323', source: 'simulated' }
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 312, crc 623409560, actualSize 42730
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.975200',
  lng: '-46.532318',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '323.0',
  timestamp: '2025-12-29T17:35:57.510Z',
  age: 1.048095703125 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 25)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981970,-46.526322,30
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9752, lng=-46.5323
[AiGuideService:PHASE1_CONE] 👁️ Detected 4 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 66m | Angle: -11.0°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 341m | Angle: -0.1°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 379m | Angle: -29.2°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 371m | Angle: 9.4°
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.981827', lng: '-46.526498' },
  last: { lat: '-22.975200', lng: '-46.532318' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981827,-46.526498,30
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981827,-46.526498,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.981827', lng: '-46.526498' },
  last: { lat: '-22.975200', lng: '-46.532318' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981827,-46.526498,30
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManager] Update complete: 168 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9753, lng=-46.5322, radius=5.25km, context=viewport_change
[POICacheHelper] ✅ Found 47 POIs within 5.2km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981827,-46.526498,30
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.006s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.010s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.014s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ Found cached audio: poiId=7678babb-3ee4-3b8f-8af8-60e89fda1b57, lang=pt-br, gender=male
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981827,-46.526498,30
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - duration: 0.017s
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.022s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.029s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981827,-46.526498,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] Update complete: 168 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.981827', lng: '-46.526498' },
  last: { lat: '-22.975200', lng: '-46.532318' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981827,-46.526498,30
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] Update complete: 168 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981827,-46.526498,30
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 168 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981827,-46.526498,30
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 168 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981827,-46.526498,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 168 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981827,-46.526498,30
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 168 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 168 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981827,-46.526498,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.981827', lng: '-46.526498' },
  last: { lat: '-22.975200', lng: '-46.532318' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981827,-46.526498,30
[NativeMarkerManager] 🔍 Rendering 137 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 168 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.975110',
  lng: '-46.532427',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:50.016Z',
  age: 8510 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9751',
  lng: '-46.5324',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:50.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9751', lng: '-46.5324', source: 'simulated' }
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981827,-46.526498,30
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.975110, lng=-46.532427, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.975110, lng=-46.532427, speed=50.00 m/s, heading=311.9, total TPs=175
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 26)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.975110',
  lng: '-46.532427',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '311.9',
  timestamp: '2025-12-29T17:35:58.555Z',
  age: 1.872802734375 }
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 73 TPs (from 175 total)
📍 [GuideLocationService] Processing location update through LocationManager...
[TriggerDetectionService] 🔍 After distance filter: 73 TPs (from 175 total)
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9751, lng=-46.5324
[AiGuideService:PHASE1_CONE] 👁️ Detected 4 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 51m | Angle: 0.2°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 326m | Angle: 11.5°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 365m | Angle: -18.8°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 357m | Angle: 21.4°
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.981686', lng: '-46.526640' },
  last: { lat: '-22.975110', lng: '-46.532427' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981686,-46.526640,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981686,-46.526640,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981686,-46.526640,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9752, lng=-46.5323, radius=5.20km, context=viewport_change
🌐 [NetworkSpeedLogger] Network: WIFI (FAST 🚀) - ✅ Network speed OK - ✅ CONNECTED - Guide Active
[NativeMarkerManager] 🔍 Rendering 136 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 167 markers
[POICacheHelper] ✅ Found 47 POIs within 5.2km radius from cache (limited from 47 total)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[NativeMarkerManager] 🔍 Rendering 136 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - BEFORE getCachedAudio
[NativeMarkerManager] Update complete: 167 markers
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.006s
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981686,-46.526640,30
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.011s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.023s
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[AudioCacheHelper] ✅ Found cached audio: poiId=7678babb-3ee4-3b8f-8af8-60e89fda1b57, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - duration: 0.030s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981686,-46.526640,30
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.041s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.042s
[NativeMarkerManager] 🔍 Rendering 136 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] Update complete: 167 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.981686', lng: '-46.526640' },
  last: { lat: '-22.975110', lng: '-46.532427' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981686,-46.526640,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981686,-46.526640,30
[NativeMarkerManager] 🔍 Rendering 135 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 165 markers
[NativeMarkerManager] 🔍 Rendering 135 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0306)
[NativeMarkerManager] Update complete: 165 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981686,-46.526640,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981686,-46.526640,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0301)
[NativeMarkerManager] Update complete: 157 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0298)
[NativeMarkerManager] Update complete: 157 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981686,-46.526640,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0298)
[NativeMarkerManager] Update complete: 157 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.974991',
  lng: '-46.532585',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:51.016Z',
  age: 8526 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[StorageService] setItem called for key: last_gps_location
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9750',
  lng: '-46.5326',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:51.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9750', lng: '-46.5326', source: 'simulated' }
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.974991, lng=-46.532585, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.974991, lng=-46.532585, speed=50.00 m/s, heading=309.3, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 TP near user: Lago do Taboão (lat=-22.974800, lng=-46.532800) - distance=30.59m
[TriggerDetectionService] 🔍 Distance filter result: 73 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 73 TPs (from 175 total)
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 313, crc 2344713723, actualSize 43817
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
[TriggerDetectionService] 🔍 TP nearby: Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - distance=30.59m, baseRadius=30m, adaptiveRadius=45.00m, speed=50.00 m/s
[TriggerDetectionService] ✅ Added POI to cooldown: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b (duration: 630s, total in cooldown: 2)
[TriggerDetectionService] 🧭 BEARING DEBUG: Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - tp.expectedBearing=236.0, userBearing(trail)=309.3, location.heading=309.3
[TriggerDetectionService] 🔍 Direction calculated (expectedBearing vs trail): Lago do Taboão - expectedBearing=236.0, userBearing=309.3 (from trail), delta=-73.3, direction=left
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 27)
[TriggerDetectionService] 🎯 Trigger detected: Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, distance: 30.6m, direction: left)
[TriggerDetectionService] 🎯 Using Contextual Audio Override for Lago do Taboão: /Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/rjk3jp-pt-br-male.mp3
[TriggerDetectionService] 🔊 Playing audio sequence for Lago do Taboão
[TuggiAudioPlayer] 🎵 playSequenceDirectly: Starting sequence with 1 tracks (native call)
[TuggiAudioPlayer] 🎵 Playing track 0 directly: /Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/rjk3jp-pt-br-male.mp3
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.974991',
  lng: '-46.532585',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '309.3',
  timestamp: '2025-12-29T17:35:59.577Z',
  age: 3.295166015625 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9750, lng=-46.5326
[AiGuideService:PHASE1_CONE] 👁️ Detected 4 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 31m | Angle: 4.7°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 306m | Angle: 15.1°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 345m | Angle: -17.1°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 338m | Angle: 25.5°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981686,-46.526640,30
AudioSessionManager: 🎵 Switching to ducking mode for TP playback...
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.981478', lng: '-46.526871' },
  last: { lat: '-22.974991', lng: '-46.532585' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981478,-46.526871,30
AudioSessionManager: 🦆 DUCKING ACTIVE (Spotify volume reduced)
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0298)
[NativeMarkerManager] Update complete: 157 markers
       LoudnessManager.mm:1215  IsHardwareSupported: no plist loaded, returning false
       LoudnessManager.mm:1215  IsHardwareSupported: no plist loaded, returning false
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981478,-46.526871,30
[TuggiAudioPlayer] ✅ Track 0 started playing (native call)
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 1: sendEventSafelyWithName called
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 2: Event name: onPlaybackTrackChanged
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 5: Bridge available
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 6: Current thread: BACKGROUND
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 7: Body type: __NSDictionaryI, body: {
    trackIndex = 0;
    url = "/Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/rjk3jp-pt-br-male.mp3";
}
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 8: Not on main thread, dispatching to main queue
[RCTEventEmitter+ThreadSafe:INFO] 📤 COMPLETE: sendEventSafelyWithName finished for event: onPlaybackTrackChanged
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 9: Now on main thread after dispatch
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 10: Bridge still available, sending event
[RCTEventEmitter+ThreadSafe:SUCCESS] ✅ STEP 11: Event sent successfully (dispatched to main)
[TriggerDetectionService] 📢 Posted 'TriggerDetectedEvent' notification for Lago do Taboão
[TriggerDetectionService] 📊 System volume captured: 60.0%
TuggiAudioPlayer: ✅ Now Playing Info updated (direct call) - Title: Lago do Taboão, Artist: Tuggi
[TRIGGER-IOS:BRIDGE:SUCCESS] ✅ TriggerDetected event enqueued to JS (dispatched): Lago do Taboão
'[NativeAudioService] 🎵 Track changed:', { url: '/Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/rjk3jp-pt-br-male.mp3',
  trackIndex: 0 }
'[NativeAudioService] ✅ Event received on platform:', 'ios'
'[NativeAudioService] 📊 Event data:', '{"url":"/Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/rjk3jp-pt-br-male.mp3","trackIndex":0}'
[SimpleAudioService] 🎵 Track changed: 0 - Audio confirmed playing
'[SimpleAudioService] 📊 Track changed event data:', '{"url":"/Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/rjk3jp-pt-br-male.mp3","trackIndex":0}'
'[SimpleAudioService] 🔍 Pending trigger data:', { poiName: 'Município de Bragança Paulista',
  direction: 'front' }
[SimpleAudioService] ✅ Audio confirmed playing - updating state for Município de Bragança Paulista
[StorageService] setItem called for key: cache_audio_state
[StorageService] setItem completed for key: cache_audio_state
'🔄 [AudioPlaybackProvider] Audio state changed:', { isPlaying: true,
  currentPOI: 'Município de Bragança Paulista',
  currentDirection: 'front',
  playbackType: 'guide',
  currentAudioUrl: null }
[StorageService] setItem called for key: cache_audio_state
[StorageService] setItem completed for key: cache_audio_state
[GuideEngine:JS:DEBUG] 🎯 STEP 2: Trigger detected event received in JavaScript listener
'[GuideEngine:JS:DEBUG] 🎯 STEP 3: Event data:', { triggerId: '2f6fb994-4138-41df-a56e-04e14c34b1f1',
  poiId: '967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b',
  name: 'Lago do Taboão',
  latitude: -22.9748,
  longitude: -46.5328,
  direction: 'left',
  audioDescriptionId: 'd20cd0d1-c1b5-4466-b488-b52ec77d542b',
  timestamp: 1767029759642 }
[GuideEngine:JS:DEBUG] 🎯 STEP 4: Processing trigger detected event...
🎯 [GuideEngine] Native trigger detected: Lago do Taboão (audioDescriptionId: d20cd0d1-c1b5-4466-b488-b52ec77d542b)
[AiGuideService] 🚩 Last visited POI updated: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b (tuggi) - Name: Lago do Taboão
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981478,-46.526871,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0298)
[NativeMarkerManager] Update complete: 157 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981478,-46.526871,30
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9751, lng=-46.5324, radius=5.13km, context=viewport_change
[GuideEngine] 🚀 Triggering Audio Pipe for Lago do Taboão (Hash: 94af473165ade757f4fc513b4c0d53c380f9024f305d47c5c956a9cf990dabe6)
🎵 [SimpleAudioService] Playing guide audio for POI: Lago do Taboão
[StorageService] setItem called for key: cache_audio_state
[StorageService] setItem completed for key: cache_audio_state
[NativeAudioService] ⏹️ Stopping playback
[POICacheHelper] ✅ Found 47 POIs within 5.1km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
'🔄 [AudioPlaybackProvider] Audio state changed:', { isPlaying: true,
  currentPOI: 'Lago do Taboão',
  currentDirection: null,
  playbackType: 'guide',
  currentAudioUrl: '/Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/rjk3jp-pt-br-male.mp3' }
[StorageService] setItem called for key: cache_audio_state
[StorageService] setItem completed for key: cache_audio_state
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981478,-46.526871,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
TuggiAudioPlayer: ⏹️ Stopping playback
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.007s
TuggiAudioPlayer: ⏹️ Local playback stopped
AudioSessionManager: 📢 Notifying other apps to restore volume...
AudioSessionManager: 🤝 COEXISTENCE ACTIVE (Spotify volume restored)
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0298)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981478,-46.526871,30
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.015s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.018s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=7678babb-3ee4-3b8f-8af8-60e89fda1b57, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - duration: 0.024s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.028s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.031s
[SimpleAudioService] Releasing audio system for other apps...
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[NativeAudioService] ⏹️ Stopping playback
TuggiAudioPlayer: ⏹️ Stopping playback
[StorageService] setItem called for key: cache_audio_state
[StorageService] setItem completed for key: cache_audio_state
AudioSessionManager: 📢 Notifying other apps to restore volume...
'🔄 [AudioPlaybackProvider] Audio state changed:', { isPlaying: false,
  currentPOI: null,
  currentDirection: null,
  playbackType: null,
  currentAudioUrl: null }
AudioSessionManager: 🤝 COEXISTENCE ACTIVE (Spotify volume restored)
[StorageService] setItem called for key: cache_audio_state
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
TuggiAudioPlayer: ✅ Now Playing Info cleared
[StorageService] setItem completed for key: cache_audio_state
[NativeMarkerManager] Update complete: 157 markers
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981478,-46.526871,30
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[SimpleAudioService] ✅ Audio system released successfully - other apps should resume automatically
[StorageService] setItem called for key: can_cache_audio_a47cf2d0-7413-4e78-afd3-7d262c019ffa
[StorageService] setItem completed for key: can_cache_audio_a47cf2d0-7413-4e78-afd3-7d262c019ffa
[AudioCache:JS:DEBUG] 🔍 getCachedAudio: Looking for audio in table=poi_audio_cache, searchColumn=poi_id, searchKey=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, actualLang=pt-br, requestedLang=pt-br, gender=male, poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[NativeMarkerManager] Update complete: 157 markers
[AudioCache:JS:DEBUG] 🔍 getCachedAudio: Query result for actualLang=pt-br: found=true
[AudioCache:JS:DEBUG] ✅ getCachedAudio: Found entry in DB: relativePath=audio/1vd4fxjjaifht-pt-br-male.mp3, absolutePath=/Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/1vd4fxjjaifht-pt-br-male.mp3
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.981478', lng: '-46.526871' },
  last: { lat: '-22.974991', lng: '-46.532585' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981478,-46.526871,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[AudioCache:JS:DEBUG] 🔍 getCachedAudio: File exists check: true
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981478,-46.526871,30
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0295)
[AudioCache:JS:DEBUG] ✅ getCachedAudio: Returning cached path: /Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/1vd4fxjjaifht-pt-br-male.mp3
[NativeAudioService] 🎵 Playing single track: /Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/1vd4fxjjaifht-pt-br-male.mp3
TuggiAudioPlayer: 🎵 Playing single track: /Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/1vd4fxjjaifht-pt-br-male.mp3
TuggiAudioPlayer: 🎵 Playing track 0: /Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/1vd4fxjjaifht-pt-br-male.mp3
[NativeMarkerManager] Update complete: 157 markers
AudioSessionManager: 🎵 Switching to ducking mode for TP playback...
AudioSessionManager: 🦆 DUCKING ACTIVE (Spotify volume reduced)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981478,-46.526871,30
       LoudnessManager.mm:1215  IsHardwareSupported: no plist loaded, returning false
       LoudnessManager.mm:1215  IsHardwareSupported: no plist loaded, returning false
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 1: sendEventSafelyWithName called
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 2: Event name: onPlaybackTrackChanged
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 5: Bridge available
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 6: Current thread: BACKGROUND
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 7: Body type: __NSDictionaryI, body: {
    trackIndex = 0;
    url = "/Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/1vd4fxjjaifht-pt-br-male.mp3";
}
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981478,-46.526871,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0295)
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 8: Not on main thread, dispatching to main queue
[RCTEventEmitter+ThreadSafe:INFO] 📤 COMPLETE: sendEventSafelyWithName finished for event: onPlaybackTrackChanged
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 9: Now on main thread after dispatch
[RCTEventEmitter+ThreadSafe:DEBUG] 📤 STEP 10: Bridge still available, sending event
[RCTEventEmitter+ThreadSafe:SUCCESS] ✅ STEP 11: Event sent successfully (dispatched to main)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
TuggiAudioPlayer: ✅ Now Playing Info updated - Title: Lago do Taboão, Artist: Tuggi
[NativeMarkerManager] Update complete: 156 markers
'[NativeAudioService] 🎵 Track changed:', { url: '/Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/1vd4fxjjaifht-pt-br-male.mp3',
  trackIndex: 0 }
'[NativeAudioService] ✅ Event received on platform:', 'ios'
'[NativeAudioService] 📊 Event data:', '{"url":"/Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/1vd4fxjjaifht-pt-br-male.mp3","trackIndex":0}'
[SimpleAudioService] 🎵 Track changed: 0 - Audio confirmed playing
'[SimpleAudioService] 📊 Track changed event data:', '{"url":"/Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/1vd4fxjjaifht-pt-br-male.mp3","trackIndex":0}'
'[SimpleAudioService] 🔍 Pending trigger data:', null
[StorageService] setItem called for key: cache_audio_state
[StorageService] setItem completed for key: cache_audio_state
[SimpleAudioService] Car metadata configured via track metadata
[SimpleAudioService] ✅ Single audio playback started successfully
[CooldownContext] 🎯 Event: cooldown_registered for POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
✅ [GuideEngine] Cooldown registered for native trigger: Lago do Taboão (poiId: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b)
🎵 [SimpleAudioService] Syncing state from native trigger: Lago do Taboão (direction: left)
[SimpleAudioService] 🔍 Initializing NativeAudioService before audio starts...
'🔄 [AudioPlaybackProvider] Audio state changed:', { isPlaying: true,
  currentPOI: 'Lago do Taboão',
  currentDirection: 'Lago do Taboão',
  playbackType: 'manual',
  currentAudioUrl: '/Users/leandroramos/Library/Developer/CoreSimulator/Devices/2ACACA45-86F7-4020-8459-123F95B51F4A/data/Containers/Data/Application/4F930985-05C7-4912-BDE2-9CF97A87CB2D/Documents/audio/rjk3jp-pt-br-male.mp3' }
[StorageService] setItem called for key: cache_audio_state
[StorageService] setItem completed for key: cache_audio_state
[SimpleAudioService] ✅ NativeAudioService initialized successfully - event listeners should be ready
'[GuideMapScreen] Cooldown IDs updated: 2 POIs in cooldown', [ '50cd5835-70db-41be-9084-3adcae63c15e',
  '967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b' ]
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981478,-46.526871,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0293)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 156 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981478,-46.526871,30
[NativeMarkerManager] 🔍 Rendering 128 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0293)
[NativeMarkerManager] Update complete: 156 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): "d1909182-964d-4a57-855a-94c00026c2b4"
[SupabaseRPCClient] 🔧 Detected string response, wrapping in array: [d1909182-964d-4a57-855a-94c00026c2b4]
[TriggerDetectionService] ✅ POI visit recorded: Lago do Taboão (visitId: d1909182-964d-4a57-855a-94c00026c2b4)
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[SimpleAudioService] ⏳ Waiting for playback-track-changed event to confirm audio started for Lago do Taboão
[SimpleAudioService] 📊 Pending trigger data stored: {"poiName":"Lago do Taboão","direction":"left"}
✅ [GuideEngine] Audio state synced for native trigger: Lago do Taboão
🎵 [GuideEngine] increment_poi_play: Using PUBLIC client for audioDescriptionId=d20cd0d1-c1b5-4466-b488-b52ec77d542b
[NativeMarkerManager] 🔍 Rendering 118 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0293)
[NativeMarkerManager] Update complete: 146 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
✅ [GuideEngine] increment_attraction_play_count_secure: Success for Lago do Taboão
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981478,-46.526871,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.981478', lng: '-46.526871' },
  last: { lat: '-22.974991', lng: '-46.532585' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981478,-46.526871,30
[NativeMarkerManager] 🔍 Rendering 118 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0293)
[NativeMarkerManager] Update complete: 146 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.974893',
  lng: '-46.532705',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:52.016Z',
  age: 8543 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.974893, lng=-46.532705, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.974893, lng=-46.532705, speed=50.00 m/s, heading=311.6, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 TP near user: Lago do Taboão (lat=-22.974800, lng=-46.532800) - distance=14.20m
[TriggerDetectionService] 🔍 Distance filter result: 73 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 73 TPs (from 175 total)
[TriggerDetectionService] 🔍 TP nearby: Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - distance=14.20m, baseRadius=30m, adaptiveRadius=45.00m, speed=50.00 m/s
[TriggerDetectionService] ⏸️ POI in cooldown: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b (remaining: 629s, total in cooldown: 2)
[TriggerDetectionService] ⏸️ TP in cooldown: Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b)
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9749',
  lng: '-46.5327',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:52.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9749', lng: '-46.5327', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 28)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.974893',
  lng: '-46.532705',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '311.6',
  timestamp: '2025-12-29T17:36:00.560Z',
  age: 1.27001953125 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9749, lng=-46.5327
[AiGuideService:PHASE1_CONE] 👁️ Detected 4 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 14m | Angle: 5.2°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 290m | Angle: 13.5°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 330m | Angle: -20.4°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 323m | Angle: 24.4°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981478,-46.526871,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.981392', lng: '-46.526958' },
  last: { lat: '-22.974893', lng: '-46.532705' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981392,-46.526958,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981392,-46.526958,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981392,-46.526958,30
[NativeMarkerManager] 🔍 Rendering 119 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0293)
[NativeMarkerManager] Update complete: 147 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9750, lng=-46.5326, radius=5.17km, context=viewport_change
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICacheHelper] ✅ Found 47 POIs within 5.2km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981392,-46.526958,30
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[NativeMarkerManager] 🔍 Rendering 119 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0294)
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[NativeMarkerManager] Update complete: 147 markers
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.029s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.036s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.015s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=7678babb-3ee4-3b8f-8af8-60e89fda1b57, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - duration: 0.020s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.024s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.051s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981392,-46.526958,30
[NativeMarkerManager] 🔍 Rendering 119 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0294)
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] Update complete: 147 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.981392', lng: '-46.526958' },
  last: { lat: '-22.974893', lng: '-46.532705' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981392,-46.526958,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 119 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0295)
[NativeMarkerManager] Update complete: 147 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981392,-46.526958,30
[NativeMarkerManager] 🔍 Rendering 119 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0295)
[NativeMarkerManager] Update complete: 147 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981392,-46.526958,30
[NativeMarkerManager] 🔍 Rendering 120 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0296)
[NativeMarkerManager] Update complete: 149 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981392,-46.526958,30
[NativeMarkerManager] 🔍 Rendering 120 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[NativeMarkerManager] Update complete: 149 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981392,-46.526958,30
[NativeMarkerManager] 🔍 Rendering 120 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[NativeMarkerManager] Update complete: 149 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981392,-46.526958,30
[NativeMarkerManager] 🔍 Rendering 120 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[NativeMarkerManager] Update complete: 149 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 120 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[NativeMarkerManager] Update complete: 149 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981392,-46.526958,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.981392', lng: '-46.526958' },
  last: { lat: '-22.974893', lng: '-46.532705' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981392,-46.526958,30
[NativeMarkerManager] 🔍 Rendering 120 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0297)
[NativeMarkerManager] Update complete: 149 markers
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.974745',
  lng: '-46.532860',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:53.016Z',
  age: 8560 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.974745, lng=-46.532860, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.974745, lng=-46.532860, speed=50.00 m/s, heading=316.0, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 TP near user: Lago do Taboão (lat=-22.974800, lng=-46.532800) - distance=8.67m
[StorageService] setItem called for key: last_gps_location
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 314, crc 770242745, actualSize 45099
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
[TriggerDetectionService] 🔍 Distance filter result: 74 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 74 TPs (from 175 total)
[TriggerDetectionService] 🔍 TP nearby: Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - distance=8.67m, baseRadius=30m, adaptiveRadius=45.00m, speed=50.00 m/s
[TriggerDetectionService] ⏸️ POI in cooldown: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b (remaining: 628s, total in cooldown: 2)
[TriggerDetectionService] ⏸️ TP in cooldown: Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b)
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9747',
  lng: '-46.5329',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:53.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9747', lng: '-46.5329', source: 'simulated' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 29)
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.974745',
  lng: '-46.532860',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '316.0',
  timestamp: '2025-12-29T17:36:01.577Z',
  age: 38.741943359375 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9747, lng=-46.5329
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981392,-46.526958,30
[AiGuideService:PHASE1_CONE] 👁️ Detected 3 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 267m | Angle: 9.8°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 309m | Angle: -26.6°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 301m | Angle: 21.4°
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.981260', lng: '-46.527092' },
  last: { lat: '-22.974745', lng: '-46.532860' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981260,-46.527092,30
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981260,-46.527092,30
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9749, lng=-46.5327, radius=5.13km, context=viewport_change
[POICacheHelper] ✅ Found 47 POIs within 5.1km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[POICustomClusterRenderer] 🎨 renderClusters called: 13 clusters
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981260,-46.527092,30
[NativeMarkerManager] 🔍 Rendering 122 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0298)
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.074s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.079s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=7678babb-3ee4-3b8f-8af8-60e89fda1b57, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - duration: 0.084s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.049s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] Update complete: 152 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[AudioCacheHelper] ✅ Found cached audio: poiId=5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Praça Doutor João Baptista Ciuffo (POI: 5a27c9c0-c52d-372e-9cad-1a8ba0ed3b36) - duration: 0.055s
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.981260', lng: '-46.527092' },
  last: { lat: '-22.974745', lng: '-46.532860' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981260,-46.527092,30
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.097s
[NativeMarkerManager] 🔍 Rendering 123 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0299)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981260,-46.527092,30
[NativeMarkerManager] Update complete: 153 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981260,-46.527092,30
[NativeMarkerManager] 🔍 Rendering 125 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0300)
[NativeMarkerManager] Update complete: 155 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981260,-46.527092,30
[NativeMarkerManager] 🔍 Rendering 126 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0303)
[NativeMarkerManager] Update complete: 156 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 126 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0304)
[NativeMarkerManager] Update complete: 156 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981260,-46.527092,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981260,-46.527092,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 126 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0305)
[NativeMarkerManager] Update complete: 156 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981260,-46.527092,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 126 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0305)
[NativeMarkerManager] Update complete: 156 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 126 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0305)
[NativeMarkerManager] Update complete: 156 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.974570',
  lng: '-46.532960',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:54.016Z',
  age: 8577 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.974570, lng=-46.532960, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.974570, lng=-46.532960, speed=50.00 m/s, heading=332.3, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 TP near user: Lago do Taboão (lat=-22.974800, lng=-46.532800) - distance=30.37m
[StorageService] setItem called for key: last_gps_location
[TriggerDetectionService] 🔍 Distance filter result: 75 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 75 TPs (from 175 total)
[StorageService] setItem completed for key: last_gps_location
[TriggerDetectionService] 🔍 TP nearby: Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - distance=30.37m, baseRadius=30m, adaptiveRadius=45.00m, speed=50.00 m/s
[TriggerDetectionService] ⏸️ POI in cooldown: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b (remaining: 627s, total in cooldown: 2)
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9746',
  lng: '-46.5330',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:54.016Z' }
[TriggerDetectionService] ⏸️ TP in cooldown: Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b)
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9746', lng: '-46.5330', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.974570',
  lng: '-46.532960',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '332.3',
  timestamp: '2025-12-29T17:36:02.594Z',
  age: 0.90185546875 }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 30)
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9746, lng=-46.5330
[AiGuideService:PHASE1_CONE] 👁️ Detected 2 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 280m | Angle: 5.6°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 245m | Angle: -6.9°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.981260,-46.527092,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.980913', lng: '-46.527446' },
  last: { lat: '-22.974570', lng: '-46.532960' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980913,-46.527446,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980913,-46.527446,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980913,-46.527446,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9747, lng=-46.5329, radius=5.11km, context=viewport_change
[NativeMarkerManager] 🔍 Rendering 127 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0307)
[NativeMarkerManager] Update complete: 157 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980913,-46.527446,30
[POICacheHelper] ✅ Found 47 POIs within 5.1km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Locomotiva Doutor Luiz Leme (POI: b68362d1-52cc-4480-8085-1c504fa17595) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.005s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.009s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=7678babb-3ee4-3b8f-8af8-60e89fda1b57, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - duration: 0.012s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[NativeMarkerManager] 🔍 Rendering 127 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
[NativeMarkerManager] Update complete: 157 markers
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.016s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=b68362d1-52cc-4480-8085-1c504fa17595, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Locomotiva Doutor Luiz Leme (POI: b68362d1-52cc-4480-8085-1c504fa17595) - duration: 0.022s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.024s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
[NativeMarkerManager] 🔍 Rendering 127 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0309)
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980913,-46.527446,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 16 clusters
[NativeMarkerManager] Update complete: 157 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.980913', lng: '-46.527446' },
  last: { lat: '-22.974570', lng: '-46.532960' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980913,-46.527446,30
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0310)
[NativeMarkerManager] Update complete: 162 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 16 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980913,-46.527446,30
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 162 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 16 clusters
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 162 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980913,-46.527446,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980913,-46.527446,30
[POICustomClusterRenderer] 🎨 renderClusters called: 16 clusters
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 162 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 16 clusters
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 162 markers
[RouteTrailSyncService] Syncing 30 pending points...
[POICustomClusterRenderer] 🎨 renderClusters called: 16 clusters
[RouteTrailHelper] 🧹 Removed 30 synced points from MMKV pending buffer
[RouteTrailSyncService] ✅ Synced 30 points successfully
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.974307',
  lng: '-46.533056',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:55.016Z',
  age: 8593 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.974307, lng=-46.533056, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.974307, lng=-46.533056, speed=50.00 m/s, heading=341.4, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[TriggerDetectionService] 🔍 Distance filter result: 76 TPs (from 175 total)
[StorageService] setItem called for key: last_gps_location
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 315, crc 895122761, actualSize 30543
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
[TriggerDetectionService] 🔍 After distance filter: 76 TPs (from 175 total)
[StorageService] setItem completed for key: last_gps_location
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 1)
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9743',
  lng: '-46.5331',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:55.016Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9743', lng: '-46.5331', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.974307',
  lng: '-46.533056',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '341.4',
  timestamp: '2025-12-29T17:36:03.611Z',
  age: 13.412109375 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9743, lng=-46.5331
[AiGuideService:PHASE1_CONE] 👁️ Detected 2 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 249m | Angle: -4.1°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 216m | Angle: -18.4°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980913,-46.527446,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.980432', lng: '-46.527963' },
  last: { lat: '-22.974307', lng: '-46.533056' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980432,-46.527963,30
🌐 [NetworkSpeedLogger] Network: WIFI (FAST 🚀) - ✅ Network speed OK - ✅ CONNECTED - Guide Active
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980432,-46.527963,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980432,-46.527963,30
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980432,-46.527963,30
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 161 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980432,-46.527963,30
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 161 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980432,-46.527963,30
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 161 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9745, lng=-46.5330, radius=5.27km, context=viewport_change
[POICacheHelper] ✅ Found 47 POIs within 5.3km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Locomotiva Doutor Luiz Leme (POI: b68362d1-52cc-4480-8085-1c504fa17595) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.006s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.011s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 161 markers
[AudioCacheHelper] ✅ Found cached audio: poiId=7678babb-3ee4-3b8f-8af8-60e89fda1b57, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - duration: 0.016s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=b68362d1-52cc-4480-8085-1c504fa17595, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Locomotiva Doutor Luiz Leme (POI: b68362d1-52cc-4480-8085-1c504fa17595) - duration: 0.019s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.022s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.024s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980432,-46.527963,30
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[NativeMarkerManager] Update complete: 161 markers
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.980432', lng: '-46.527963' },
  last: { lat: '-22.974307', lng: '-46.533056' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980432,-46.527963,30
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980432,-46.527963,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] Update complete: 161 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980432,-46.527963,30
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 160 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 160 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980432,-46.527963,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980432,-46.527963,30
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 160 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 160 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.974041',
  lng: '-46.533190',
  accuracy: '5.0',
  speed: '50.0',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:56.016Z',
  age: 8610 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.974041, lng=-46.533190, speed=50.00), dispatching to background thread
[TriggerDetectionService] 🔍 Processing location update: lat=-22.974041, lng=-46.533190, speed=50.00 m/s, heading=335.1, total TPs=175
[TriggerDetectionService] 🔍 Filtering trigger points by distance: radius=2000m (viewport NOT used for trigger detection)
[StorageService] setItem called for key: last_gps_location
[TriggerDetectionService] 🔍 Distance filter result: 76 TPs (from 175 total)
[TriggerDetectionService] 🔍 After distance filter: 76 TPs (from 175 total)
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9740',
  lng: '-46.5332',
  source: 'simulated',
  timestamp: '2025-12-29T17:35:56.016Z' }
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 2)
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9740', lng: '-46.5332', source: 'simulated' }
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.974041',
  lng: '-46.533190',
  accuracy: '10.0',
  speed: '50.0',
  bearing: '335.1',
  timestamp: '2025-12-29T17:36:04.628Z',
  age: 1.5810546875 }
📍 [GuideLocationService] Processing location update through LocationManager...
[LocationWatcher] ⏭️ Ignoring native GPS update during Trail Simulator simulation
📍 [GuideLocationService] ✅ Location update processed successfully
[TrailSimulator] ✅ Posted native location notification for TriggerDetectionService (iOS): lat=-22.9740, lng=-46.5332
[AiGuideService:PHASE1_CONE] 👁️ Detected 2 POIs in Cone (400m/45° at 180.0 km/h) [Filter: ON]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 216m | Angle: 2.6°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b | Dist: 184m | Angle: -14.2°
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980432,-46.527963,30
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.980109', lng: '-46.528295' },
  last: { lat: '-22.974041', lng: '-46.533190' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980109,-46.528295,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980109,-46.528295,30
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980109,-46.528295,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980109,-46.528295,30
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0312)
[NativeMarkerManager] Update complete: 160 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9743, lng=-46.5331, radius=5.20km, context=viewport_change
[POICacheHelper] ✅ Found 47 POIs within 5.2km radius from cache (limited from 47 total)
[POILoadingService] ✅ Cache HIT: Found 47 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 47 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 47 total POIs, 47 with audio, 0 without audio
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
[AudioPreloadService] 📥 Preloading audio for 5 POIs
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 47 visible POIs, 0 cached POIs, total: 47 POIs. TPs: 175 visible, 0 cached, total: 175
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Locomotiva Doutor Luiz Leme (POI: b68362d1-52cc-4480-8085-1c504fa17595) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980109,-46.528295,30
[POICustomClusterRenderer] 🎨 renderClusters called: 14 clusters
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.019s
[NativeMarkerManagerBridge] Stopped observing events
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManagerBridge] Started observing events
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.024s
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.980109', lng: '-46.528295' },
  last: { lat: '-22.974041', lng: '-46.533190' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980109,-46.528295,30
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=b68362d1-52cc-4480-8085-1c504fa17595, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Locomotiva Doutor Luiz Leme (POI: b68362d1-52cc-4480-8085-1c504fa17595) - duration: 0.028s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[AudioCacheHelper] ✅ Found cached audio: poiId=7678babb-3ee4-3b8f-8af8-60e89fda1b57, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Praça Donato Cortese (POI: 7678babb-3ee4-3b8f-8af8-60e89fda1b57) - duration: 0.034s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.038s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.039s
[NativeMarkerManager] Update complete: 160 markers
[GuideLocationService] 📍 Starting native iOS GPS service (enableBackground=false)...
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 161 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980109,-46.528295,30
nw_path_evaluator_call_update_handler [C5E3D6D0-F7C2-4F02-97EA-AF8D09093E57] not delivering update, path=0x12e6f5d90, update_block=0x10842ef50, client_queue=0x0
[GPS-IOS:NATIVE:INFO] ✅ GPS tracking started (bg=NO)
[GuideLocationService] ✅ Native iOS GPS service started successfully (background=false)
[GuideLocationService] 📍 Waiting for location updates from CLLocationManager...
[TrailSimulator] ✅ Native iOS GPS service restored after simulation
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[NativeMarkerManager] 🔍 Rendering 129 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0313)
[NativeMarkerManager] Update complete: 161 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980109,-46.528295,30
[NativeMarkerManager] 🔍 Rendering 130 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0314)
[NativeMarkerManager] Update complete: 162 markers
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.968113, lng=-46.531130, speed=-1.00), dispatching to background thread
[TriggerDetectionService] ⏸️ Skipping processing: user stationary (speed=0.00 m/s < 0.5 m/s) and no nearby TPs
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9681, lng=-46.5311, radius=2.00km, context=movement
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.968113',
  lng: '-46.531130',
  accuracy: '5.0',
  speed: '-1.0',
  bearing: '17.7',
  timestamp: '2025-12-29T17:36:04.515Z',
  age: 440.2109375 }
📍 [GuideLocationService] Processing location update through LocationManager...
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.968113',
  lng: '-46.531130',
  accuracy: '5.0',
  speed: '-1.0',
  source: 'native-gps',
  timestamp: '2025-12-29T17:36:04.515Z',
  age: 440.2109375 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
[RouteTrailHelper] ⚡ Saved point to MMKV Pending Buffer (size: 3)
📍 [GuideLocationService] ✅ Location update processed successfully
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9681',
  lng: '-46.5311',
  source: 'native-gps',
  timestamp: '2025-12-29T17:36:04.515Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9681', lng: '-46.5311', source: 'native-gps' }
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.980109,-46.528295,30
[POICacheHelper] ✅ Found 28 POIs within 2.0km radius from cache (limited from 28 total)
[POILoadingService] ✅ Cache HIT: Found 28 POIs in cache
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.0s (context: movement)
[AudioPreloadService] 🔍 Checking 28 POIs for audio preload
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 28 total POIs, 28 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Estádio Nabi Abi Chedid (POI: 1259e7b9-77c1-3db0-b538-380218aebb77) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Prefeitura Municipal de Bragança Paulista (POI: 29f4127f-0203-438a-9de4-680b8d9d3c2a) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.006s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AiGuideService:PHASE1_CONE] 👁️ Detected 4 POIs in Cone (400m/45° at -3.6 km/h) [Filter: OFF]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 12ebb46a-70b9-33f6-9b02-3cdb364a4600 | Dist: 379m | Angle: 0.0°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 12ebb46a-70b9-33f6-9b02-3cdb364a4600 | Dist: 265m | Angle: 0.0°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 75e27b48-363f-36cf-998f-3bff9bfb4b7c | Dist: 131m | Angle: 0.0°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 75e27b48-363f-36cf-998f-3bff9bfb4b7c | Dist: 284m | Angle: 0.0°
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AiGuideService:PHASE2_TEXT_REQ] 📜 Requesting text for POI 12ebb46a-70b9-33f6-9b02-3cdb364a4600
'[AiGuideService:PHASE_BACKEND_CALL] 📡 Full Request Object [Action: generate_text]:', '{\n  "action": "generate_text",\n  "travel_mode": "drive",\n  "target_poi": {\n    "id": "12ebb46a-70b9-33f6-9b02-3cdb364a4600",\n    "type": "tuggi",\n    "bearing": 17.7,\n    "distance": 265,\n    "location": {\n      "latitude": -22.968113,\n      "longitude": -46.53113\n    }\n  },\n  "user_context": {\n    "speed": -3.6,\n    "heading": 17.742321226846286,\n    "language": "pt-br",\n    "location": {\n      "latitude": -22.968113,\n      "longitude": -46.53113\n    },\n    "previous_poi": {\n      "id": "967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b",\n      "name": "Lago do Taboão",\n      "type": "tuggi",\n      "played_at": "2025-12-29T17:35:59.677Z"\n    },\n    "next_poi": {\n      "id": "967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b",\n      "type": "tuggi",\n      "distance": 184,\n      "bearing": 3.5\n    }\n  }\n}'
[AiGuideService] 🛡️ Payload Summary: Heading: 17.742321226846286, PreviousPOI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.017s
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.979661', lng: '-46.528752' },
  last: { lat: '-22.968113', lng: '-46.531130' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 28 POIs, 105 TPs
[POICustomClusterRenderer] 🎨 renderClusters called: 15 clusters
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=1259e7b9-77c1-3db0-b538-380218aebb77, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Estádio Nabi Abi Chedid (POI: 1259e7b9-77c1-3db0-b538-380218aebb77) - duration: 0.024s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AiGuideService:PHASE2_TEXT_REQ] 📜 Requesting text for POI 12ebb46a-70b9-33f6-9b02-3cdb364a4600
'[AiGuideService:PHASE_BACKEND_CALL] 📡 Full Request Object [Action: generate_text]:', '{\n  "action": "generate_text",\n  "travel_mode": "drive",\n  "target_poi": {\n    "id": "12ebb46a-70b9-33f6-9b02-3cdb364a4600",\n    "type": "tuggi",\n    "bearing": 17.7,\n    "distance": 265,\n    "location": {\n      "latitude": -22.968113,\n      "longitude": -46.53113\n    }\n  },\n  "user_context": {\n    "speed": -3.6,\n    "heading": 17.742321226846286,\n    "language": "pt-br",\n    "location": {\n      "latitude": -22.968113,\n      "longitude": -46.53113\n    },\n    "previous_poi": {\n      "id": "967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b",\n      "name": "Lago do Taboão",\n      "type": "tuggi",\n      "played_at": "2025-12-29T17:35:59.677Z"\n    },\n    "next_poi": {\n      "id": "967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b",\n      "type": "tuggi",\n      "distance": 184,\n      "bearing": 3.5\n    }\n  }\n}'
[NativeMarkerManager] 🔍 Rendering 131 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0315)
[AudioCacheHelper] ✅ Found cached audio: poiId=29f4127f-0203-438a-9de4-680b8d9d3c2a, lang=pt-br, gender=male
[AiGuideService] 🛡️ Payload Summary: Heading: 17.742321226846286, PreviousPOI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[AudioPreloadService] ✅ Preload [3/5]: Completed for Prefeitura Municipal de Bragança Paulista (POI: 29f4127f-0203-438a-9de4-680b8d9d3c2a) - duration: 0.061s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[GuideEngine] 🕒 Schedule check: 28 active POIs (out of 28 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioPreloadService] ✅ Preload [5/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.093s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.096s
[NativeMarkerManager] Update complete: 163 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[AudioCache] ✅ Found Cache for POI=75e27b48-363f-36cf-998f-3bff9bfb4b7c: [Audio: false, Text: true]
[AiGuideService:CACHE_FOUND_TEXT] 📜 Found cached text for POI 75e27b48-363f-36cf-998f-3bff9bfb4b7c, but audio is missing. Proceeding to fresh generation.
[AiGuideService:PHASE2_TEXT_REQ] 📜 Requesting text for POI 75e27b48-363f-36cf-998f-3bff9bfb4b7c
'[AiGuideService:PHASE_BACKEND_CALL] 📡 Full Request Object [Action: generate_text]:', '{\n  "action": "generate_text",\n  "travel_mode": "drive",\n  "target_poi": {\n    "id": "75e27b48-363f-36cf-998f-3bff9bfb4b7c",\n    "type": "tuggi",\n    "bearing": 17.7,\n    "distance": 284,\n    "location": {\n      "latitude": -22.968113,\n      "longitude": -46.53113\n    }\n  },\n  "user_context": {\n    "speed": -3.6,\n    "heading": 17.742321226846286,\n    "language": "pt-br",\n    "location": {\n      "latitude": -22.968113,\n      "longitude": -46.53113\n    },\n    "previous_poi": {\n      "id": "967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b",\n      "name": "Lago do Taboão",\n      "type": "tuggi",\n      "played_at": "2025-12-29T17:35:59.677Z"\n    },\n    "next_poi": {\n      "id": "967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b",\n      "type": "tuggi",\n      "distance": 184,\n      "bearing": 3.5\n    }\n  }\n}'
[AiGuideService] 🛡️ Payload Summary: Heading: 17.742321226846286, PreviousPOI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[AudioCache] ✅ Found Cache for POI=75e27b48-363f-36cf-998f-3bff9bfb4b7c: [Audio: false, Text: true]
[AiGuideService:CACHE_FOUND_TEXT] 📜 Found cached text for POI 75e27b48-363f-36cf-998f-3bff9bfb4b7c, but audio is missing. Proceeding to fresh generation.
[AiGuideService:PHASE2_TEXT_REQ] 📜 Requesting text for POI 75e27b48-363f-36cf-998f-3bff9bfb4b7c
'[AiGuideService:PHASE_BACKEND_CALL] 📡 Full Request Object [Action: generate_text]:', '{\n  "action": "generate_text",\n  "travel_mode": "drive",\n  "target_poi": {\n    "id": "75e27b48-363f-36cf-998f-3bff9bfb4b7c",\n    "type": "tuggi",\n    "bearing": 17.7,\n    "distance": 284,\n    "location": {\n      "latitude": -22.968113,\n      "longitude": -46.53113\n    }\n  },\n  "user_context": {\n    "speed": -3.6,\n    "heading": 17.742321226846286,\n    "language": "pt-br",\n    "location": {\n      "latitude": -22.968113,\n      "longitude": -46.53113\n    },\n    "previous_poi": {\n      "id": "967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b",\n      "name": "Lago do Taboão",\n      "type": "tuggi",\n      "played_at": "2025-12-29T17:35:59.677Z"\n    },\n    "next_poi": {\n      "id": "967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b",\n      "type": "tuggi",\n      "distance": 184,\n      "bearing": 3.5\n    }\n  }\n}'
[AiGuideService] 🛡️ Payload Summary: Heading: 17.742321226846286, PreviousPOI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.979661', lng: '-46.528752' },
  last: { lat: '-22.968113', lng: '-46.531130' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[NativeMarkerManager] 🔍 Rendering 84 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0316)
[NativeMarkerManager] Update complete: 106 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 10 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[NativeMarkerManager] 🔍 Rendering 82 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0243)
[NativeMarkerManager] Update complete: 104 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[POICustomClusterRenderer] 🎨 renderClusters called: 7 clusters
[NativeMarkerManager] 🔍 Rendering 37 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0242)
[NativeMarkerManager] Update complete: 46 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[POICustomClusterRenderer] 🎨 renderClusters called: 4 clusters
[NativeMarkerManager] 🔍 Rendering 16 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0138)
[NativeMarkerManager] Update complete: 21 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 5 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[NativeMarkerManager] 🔍 Rendering 16 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0103)
[NativeMarkerManager] Update complete: 21 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[POICustomClusterRenderer] 🎨 renderClusters called: 3 clusters
[NativeMarkerManager] 🔍 Rendering 5 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0100)
[NativeMarkerManager] Update complete: 8 markers
_quic_packet_builder_calculate_size packet builder for pn space application data has frames, but none of those frames fit in this packet. The MSS is 1236
_quic_packet_builder_calculate_size packet builder for pn space application data has frames, but none of those frames fit in this packet. The MSS is 1236
[POICustomClusterRenderer] 🎨 renderClusters called: 2 clusters
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[NativeMarkerManager] 🔍 Rendering 3 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0059)
[NativeMarkerManager] Update complete: 5 markers
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9688, lng=-46.5314, radius=2.00km, context=viewport_change
[POICacheHelper] ✅ Found 27 POIs within 2.0km radius from cache (limited from 27 total)
[POILoadingService] ✅ Cache HIT: Found 27 POIs in cache
[POICustomClusterRenderer] 🎨 renderClusters called: 1 clusters
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍 Checking 27 POIs for audio preload
[NativeMarkerManager] 🔍 Rendering 3 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0048)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 27 total POIs, 27 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Prefeitura Municipal de Bragança Paulista (POI: 29f4127f-0203-438a-9de4-680b8d9d3c2a) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Estádio Nabi Abi Chedid (POI: 1259e7b9-77c1-3db0-b538-380218aebb77) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.006s
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 27 POIs, 101 TPs
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.011s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POICustomClusterRenderer] 🎨 renderClusters called: 1 clusters
[AudioCacheHelper] ✅ Found cached audio: poiId=29f4127f-0203-438a-9de4-680b8d9d3c2a, lang=pt-br, gender=male
[NativeMarkerManager] Update complete: 4 markers
[AudioPreloadService] ✅ Preload [3/5]: Completed for Prefeitura Municipal de Bragança Paulista (POI: 29f4127f-0203-438a-9de4-680b8d9d3c2a) - duration: 0.016s
[NativeMarkerManager] 🔍 Rendering 3 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0039)
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 27 visible POIs, 1 cached POIs, total: 28 POIs. TPs: 101 visible, 4 cached, total: 105
[GuideEngine] 🕒 Schedule check: 28 active POIs (out of 28 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[NativeMarkerManager] Update complete: 4 markers
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.023s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=1259e7b9-77c1-3db0-b538-380218aebb77, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Estádio Nabi Abi Chedid (POI: 1259e7b9-77c1-3db0-b538-380218aebb77) - duration: 0.026s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.030s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 1 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.979661', lng: '-46.528752' },
  last: { lat: '-22.968113', lng: '-46.531130' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[NativeMarkerManager] 🔍 Rendering 3 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0039)
[NativeMarkerManager] Update complete: 4 markers
[AiGuideService:PHASE2_TEXT_SUCCESS] ✅ Generated Text for 75e27b48-363f-36cf-998f-3bff9bfb4b7c: "E enquanto avançamos, olhem à frente! Chegamos ao Parque Natural Municipal Lago Dos Padres, um refúgio verde inaugurado em 2016, um verdadeiro santuário para a natureza. Este lugar, com seus 2,21 hectares, é o coração pulsante da mata nativa e dos nossos recursos hídricos, e sabem de uma coisa? Ele é um dos afluentes que dão vida ao nosso querido Lago do Taboão, que acabamos de deixar para trás. Aqui, a preservação anda de mãos dadas com a vida, um convite ao ecoturismo, à pesquisa e, claro, a momentos de puro lazer. E fiquem atentos, pois a beleza natural continua a nos guiar, com mais maravilhas aguardando logo adiante!"
[AudioCache] 📜 Contextual Text Saved only for 75e27b48-363f-36cf-998f-3bff9bfb4b7c (Hash: 75e27b48-363f-36cf-998f-3bff9bfb4b7c:tuggi:pt-br:drive:ahead:967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b:967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b:tuggi)
[AiGuideService:PHASE2_TEXT_SUCCESS] ✅ Generated Text for 75e27b48-363f-36cf-998f-3bff9bfb4b7c: "E enquanto avançamos, olhem à frente! Chegamos ao Parque Natural Municipal Lago Dos Padres, um refúgio verde inaugurado em 2016, um verdadeiro santuário para a natureza. Este lugar, com seus 2,21 hectares, é o coração pulsante da mata nativa e dos nossos recursos hídricos, e sabem de uma coisa? Ele é um dos afluentes que dão vida ao nosso querido Lago do Taboão, que acabamos de deixar para trás. Aqui, a preservação anda de mãos dadas com a vida, um convite ao ecoturismo, à pesquisa e, claro, a momentos de puro lazer. E fiquem atentos, pois a beleza natural continua a nos guiar, com mais maravilhas aguardando logo adiante!"
[AudioCache] 📜 Contextual Text Saved only for 75e27b48-363f-36cf-998f-3bff9bfb4b7c (Hash: 75e27b48-363f-36cf-998f-3bff9bfb4b7c:tuggi:pt-br:drive:ahead:967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b:967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b:tuggi)
[POICustomClusterRenderer] 🎨 renderClusters called: 1 clusters
[POILoadingService] 🔄 loadPOIsAndTriggerPoints() STARTED: lat=-22.9681, lng=-46.5311, radius=2.00km, context=viewport_change
[POICacheHelper] ✅ Found 28 POIs within 2.0km radius from cache (limited from 28 total)
[POILoadingService] ✅ Cache HIT: Found 28 POIs in cache
[AudioPreloadService] 🔍 Checking 28 POIs for audio preload
[POILoadingService] 🔄 Cache is fresh, but will sync anyway to ensure data is up-to-date
[POILoadingService] 🔄 Sync delay: 1.5s (context: viewport_change)
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 🔍   audio_descriptions is NSArray with 3 items
[AudioPreloadService] 📊 Audio preload summary: 28 total POIs, 28 with audio, 0 without audio
[AudioPreloadService] 📥 Preloading audio for 5 POIs
[AudioPreloadService] ⏳ Waiting for all 5 preload operations to complete...
[AudioPreloadService] 🔍 Preload [1/5]: Checking cache for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [2/5]: Checking cache for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [3/5]: Checking cache for Prefeitura Municipal de Bragança Paulista (POI: 29f4127f-0203-438a-9de4-680b8d9d3c2a) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [5/5]: Checking cache for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - BEFORE getCachedAudio
[AudioPreloadService] 🔍 Preload [4/5]: Checking cache for Estádio Nabi Abi Chedid (POI: 1259e7b9-77c1-3db0-b538-380218aebb77) - BEFORE getCachedAudio
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=12ebb46a-70b9-33f6-9b02-3cdb364a4600, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [1/5]: Completed for Lago dos Padres (POI: 12ebb46a-70b9-33f6-9b02-3cdb364a4600) - duration: 0.005s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 28 POIs, 105 TPs
[AudioCacheHelper] ✅ Found cached audio: poiId=75e27b48-363f-36cf-998f-3bff9bfb4b7c, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [2/5]: Completed for Parque Natural Municipal Lago Dos Padres (POI: 75e27b48-363f-36cf-998f-3bff9bfb4b7c) - duration: 0.009s
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
'[GuideEngine:JS] ✅ [DIAGNOSTIC] REPORTED TP in final merged array:', { id: '51550950-2e08-4638-9901-70458b079120',
  attractionId: '6ffe3373-505b-3dcd-adea-695010cda8ec' }
[GuideEngine] ✅ Merged viewport POIs: 28 visible POIs, 0 cached POIs, total: 28 POIs. TPs: 105 visible, 0 cached, total: 105
[GuideEngine] 🕒 Schedule check: 28 active POIs (out of 28 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[AudioCacheHelper] ✅ Found cached audio: poiId=29f4127f-0203-438a-9de4-680b8d9d3c2a, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [3/5]: Completed for Prefeitura Municipal de Bragança Paulista (POI: 29f4127f-0203-438a-9de4-680b8d9d3c2a) - duration: 0.014s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [5/5]: Completed for Lago do Taboão (POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b) - duration: 0.017s
[AudioCacheHelper] ✅ directional_audio_cache table already exists (created by JS)
[AudioCacheHelper] ✅ Found cached audio: poiId=1259e7b9-77c1-3db0-b538-380218aebb77, lang=pt-br, gender=male
[AudioPreloadService] ✅ Preload [4/5]: Completed for Estádio Nabi Abi Chedid (POI: 1259e7b9-77c1-3db0-b538-380218aebb77) - duration: 0.021s
[AudioPreloadService] ✅ All preload operations completed - total wait duration: 0.022s
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 1 clusters
[NativeMarkerManager] 🔍 Rendering 3 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0039)
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.979661', lng: '-46.528752' },
  last: { lat: '-22.968113', lng: '-46.531130' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[NativeMarkerManager] Update complete: 4 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 1 clusters
I1229 14:36:06.511778 1877471232 UIManagerBinding.cpp:135] instanceHandle is null, event of type topTouchEnd will be dropped
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[AiGuideService:PHASE2_TEXT_SUCCESS] ✅ Generated Text for 12ebb46a-70b9-33f6-9b02-3cdb364a4600: "E então, logo à nossa frente, surge o Lago dos Padres, um espelho d'água que abraça Bragança Paulista e se integra à vida cotidiana da cidade. Assim como o Lago do Taboão, que acabamos de deixar para trás – originalmente o Tanque do Padre Jacinto, um marco entre 1830 e 1850, que foi inteligentemente recriado por uma barragem, tornando-se nosso principal cartão-postal – o Lago dos Padres também compõe essa paisagem urbana única. E preparem-se, pois o nosso caminho ainda nos reserva mais surpresas do que esse icônico cartão-postal do Taboão tem a oferecer!"
[AudioCache] 📜 Contextual Text Saved only for 12ebb46a-70b9-33f6-9b02-3cdb364a4600 (Hash: 12ebb46a-70b9-33f6-9b02-3cdb364a4600:tuggi:pt-br:drive:ahead:967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b:967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b:tuggi)
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Baratella - Jardim São Miguel | ID: 3bbc0344-b7dd-410e-8781-a35a8211c635
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago Orfeu | ID: 5388cc1c-0f4b-3711-973f-36f787f126df
[GuideEngine] 🕒 Schedule check: 47 active POIs (out of 47 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 1 clusters
[NativeMarkerManager] 🔍 Rendering 3 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0039)
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.979661', lng: '-46.528752' },
  last: { lat: '-22.968113', lng: '-46.531130' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[NativeMarkerManager] Update complete: 4 markers
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 101 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 101 valid trigger points
[POICacheHelper] ✅ Saved 27 POIs to cache v4
[POILoadingService] ✅ Synced 27 POIs, 101 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 27 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 27 POIs, 101 TPs
🔍 [GuideEngine:IDENTIFY] Found POI: Parque Natural Municipal Lago Dos Padres | ID: 75e27b48-363f-36cf-998f-3bff9bfb4b7c
🔍 [GuideEngine:IDENTIFY] Found POI: Lago dos Padres | ID: 12ebb46a-70b9-33f6-9b02-3cdb364a4600
🔍 [GuideEngine:IDENTIFY] Found POI: Lago do Taboão | ID: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
[GuideEngine] 🕒 Schedule check: 27 active POIs (out of 27 total)
[GuideEngine:JS:SUCCESS] 📍 STEP 5: POI data processed and active POIs refreshed
[GuideEngine:JS:INFO] 📍 COMPLETE: POI loaded flow finished
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 1 clusters
'[RouteTrailMap] ✅ Processing 30 trail points:', { first: { lat: '-22.979661', lng: '-46.528752' },
  last: { lat: '-22.968113', lng: '-46.531130' } }
[RouteTrailMap] ✅ Converted to 30 coordinates for Polyline
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[POICustomClusterRenderer] 🎨 renderClusters called: 1 clusters
[NativeMarkerManager] 🔍 Rendering 3 TPs INDIVIDUALLY (Guide ACTIVE, latitudeDelta=0.0039)
[NativeMarkerManager] Update complete: 4 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 1 clusters
[NativeAudioService] ⏹️ Stopping playback
TuggiAudioPlayer: ⏹️ Stopping playback
TuggiAudioPlayer: ⏹️ Local playback stopped
AudioSessionManager: 📢 Notifying other apps to restore volume...
AudioSessionManager: 🤝 COEXISTENCE ACTIVE (Spotify volume restored)
[SimpleAudioService] Releasing audio system for other apps...
🎵 [SimpleAudioService] Removed POI 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b from queue after audio completion
[NativeAudioService] ⏹️ Stopping playback
TuggiAudioPlayer: ⏹️ Stopping playback
[StorageService] setItem called for key: cache_audio_state
[StorageService] setItem completed for key: cache_audio_state
AudioSessionManager: 📢 Notifying other apps to restore volume...
AudioSessionManager: 🤝 COEXISTENCE ACTIVE (Spotify volume restored)
TuggiAudioPlayer: ✅ Now Playing Info cleared
'🔄 [AudioPlaybackProvider] Audio state changed:', { isPlaying: false,
  currentPOI: null,
  currentDirection: null,
  playbackType: null,
  currentAudioUrl: null }
[StorageService] setItem called for key: cache_audio_state
[StorageService] setItem completed for key: cache_audio_state
[SimpleAudioService] ✅ Audio system released successfully - other apps should resume automatically
[SimpleAudioService] 🛑 Deactivating audio session explicitly
[NativeAudioService] 🛑 Deactivating session
TuggiAudioPlayer: 🛑 Deactivating session (End of Trip)
AudioSessionManager: 🔇 Deactivating audio session after Guide...
AudioSessionManager: ✅ Audio session deactivated successfully
AudioSessionManager: ℹ️ Other apps (Spotify, Waze) can resume now
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[RouteTrailHelper] ✅ Stopped recording trail for session: 4aa7345d-4965-416a-8c53-aa032db62a76
[RouteTrailBridge] ✅ Stopped recording trail: session=4aa7345d-4965-416a-8c53-aa032db62a76
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
'✅ [RouteTrailService] Trail recording stopped via native bridge:', { sessionId: '4aa7345d-4965-416a-8c53-aa032db62a76' }
[RouteTrailSyncService] ✅ Stopped periodic sync
✅ [GuideEngine] Route trail sync service stopped
[AiGuideService:PHASE2_TEXT_SUCCESS] ✅ Generated Text for 12ebb46a-70b9-33f6-9b02-3cdb364a4600: "E agora, à frente, contemplamos o Lago dos Padres, um espelho d'água que se integrou à alma urbana de Bragança Paulista. Este lago não é apenas uma paisagem; ele pulsa com a vida cotidiana do nosso município. Lembram-se do Lago do Taboão, nosso cartão-postal, recriado por uma barragem? Pois é, essa história de corpos d'água que moldam nossa cidade é antiga, remonta ao Tanque do Padre Jacinto, lá pelos anos 1830. Fiquem atentos, pois logo adiante teremos mais daquela beleza que faz Bragança ser Bragança!"
[AudioCache] 📜 Contextual Text Saved only for 12ebb46a-70b9-33f6-9b02-3cdb364a4600 (Hash: 12ebb46a-70b9-33f6-9b02-3cdb364a4600:tuggi:pt-br:drive:ahead:967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b:967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b:tuggi)
🌐 [NetworkSpeedLogger] Network: WIFI (FAST 🚀) - ✅ Network speed OK - ✅ CONNECTED - Guide Active
[GPS-IOS:NATIVE:INFO] ✅ GPS tracking stopped
[GuideLocationService] ✅ Native iOS GPS service stopped
[GuideLocationService] Already initialized - skipping
[GuideLocationService] 📍 Starting native iOS GPS service (enableBackground=false)...
nw_path_evaluator_call_update_handler [8E2501F8-30BC-4513-A991-3B8D866C4942] not delivering update, path=0x130f9b2c0, update_block=0x10842ef50, client_queue=0x0
[GPS-IOS:NATIVE:INFO] ✅ GPS tracking started (bg=NO)
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.968113, lng=-46.531130, speed=-1.00), dispatching to background thread
[GuideLocationService] ✅ Native iOS GPS service started successfully (background=false)
[TriggerDetectionService] ⏸️ Skipping processing: user stationary (speed=0.00 m/s < 0.5 m/s) and no nearby TPs
[GuideLocationService] 📍 Waiting for location updates from CLLocationManager...
[I] <MMKV_IO.cpp:545::writeActualSize> [tuggi_storage] increase sequence to 316, crc 3980153429, actualSize 31841
[I] <MMKV.cpp:1182::sync> MMKV::sync, SyncFlag = 1
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.968113',
  lng: '-46.531130',
  accuracy: '5.0',
  speed: '-1.0',
  bearing: '-1.0',
  timestamp: '2025-12-29T17:36:08.535Z',
  age: 378.555908203125 }
📍 [GuideLocationService] Processing location update through LocationManager...
'📍 [LocationWatcher] ✅ Processing location update:', { lat: '-22.968113',
  lng: '-46.531130',
  accuracy: '5.0',
  speed: '-1.0',
  source: 'native-gps',
  timestamp: '2025-12-29T17:36:08.535Z',
  age: 378.555908203125 }
📍 [LocationWatcher] ✅ Location update distributed to subscribers
📍 [GuideLocationService] ✅ Location update processed successfully
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
[GPS-IOS:NATIVE:INFO] ✅ GPS tracking stopped
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9681',
  lng: '-46.5311',
  source: 'native-gps',
  timestamp: '2025-12-29T17:36:08.535Z' }
'[LocationWatcher] ✅ First GPS location received - saved to MMKV:', { lat: '-22.9681', lng: '-46.5311', source: 'native-gps' }
[GuideLocationService] ✅ Native iOS GPS service stopped
[GuideIntegration] ✅ Native iOS GPS service stopped
[AiGuideService:PHASE1_CONE] 👁️ Detected 4 POIs in Cone (400m/45° at -3.6 km/h) [Filter: OFF]
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 12ebb46a-70b9-33f6-9b02-3cdb364a4600 | Dist: 265m | Angle: 0.0°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 12ebb46a-70b9-33f6-9b02-3cdb364a4600 | Dist: 379m | Angle: 0.0°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 75e27b48-363f-36cf-998f-3bff9bfb4b7c | Dist: 284m | Angle: 0.0°
[AiGuideService:PHASE1_CONE] 🎯 Candidate: 75e27b48-363f-36cf-998f-3bff9bfb4b7c | Dist: 131m | Angle: 0.0°
[GuideLocationService] Already initialized - skipping
[GuideLocationService] 📍 Starting native iOS GPS service (enableBackground=false)...
nw_path_evaluator_call_update_handler [0A3B3967-DE9C-4D0C-887C-B00106C7D525] not delivering update, path=0x134ea6750, update_block=0x10842ef50, client_queue=0x0
[RouteTrailMap] ✅ Rendering Polyline with 30 coordinates, key: -22.979661,-46.528752,30
[GPS-IOS:NATIVE:INFO] ✅ GPS tracking started (bg=NO)
[TriggerDetectionService] ✅ handleLocationUpdate: received location (lat=-22.968113, lng=-46.531130, speed=-1.00), dispatching to background thread
[TriggerDetectionService] ⏸️ Skipping processing: user stationary (speed=0.00 m/s < 0.5 m/s) and no nearby TPs
[GuideLocationService] ✅ Native iOS GPS service started successfully (background=false)
[GuideLocationService] 📍 Waiting for location updates from CLLocationManager...
🔍 [LocationWatcher] Checking if native GPS is active...
'🔍 [LocationWatcher] isNativeGPSActive() - Platform:', 'ios'
🔍 [LocationWatcher] Checking iOS native GPS service...
✅ [DirectionalAudioPreload] Preload stopped
[TriggerDetectionService] ✅ Cooldown registry cleared (business rule: guide finalized)
[TriggerDetectionService] ✅ LocationThrottler reset
'📍 [GuideLocationService] ✅ RECEIVED native GPS location update:', { lat: '-22.968113',
  lng: '-46.531130',
  accuracy: '5.0',
  speed: '-1.0',
  bearing: '-1.0',
  timestamp: '2025-12-29T17:36:08.535Z',
  age: 404.555908203125 }
[TriggerDetectionService] ✅ lastValidBearing reset to -1.0
📍 [GuideLocationService] Processing location update through LocationManager...
📍 [GuideLocationService] ✅ Location update processed successfully
'🔍 [LocationWatcher] iOS native GPS service status:', { active: true }
'🔍 [LocationWatcher] Native GPS check result:', { active: true, platform: 'ios' }
✅ [LocationWatcher] iOS: Native GPS is ACTIVE - using native GPS only
[StorageService] removeItem called for key: guide_background_session
[StorageService] removeItem completed for key: guide_background_session
[GuideEngine] ✅ Network monitoring stopped
[GuideEngine] ✅ Native trigger detected listener stopped
[GuideEngine] ✅ POI sync event listeners stopped
[GuideEngine] ✅ POI loaded listener stopped
[SimpleAudioService] Stopping keepalive service...
AudioSessionManager: ℹ️ Session already inactive
[StorageService] setItem called for key: last_gps_location
[StorageService] setItem completed for key: last_gps_location
'[LocationCacheService] ✅ Saved last GPS location:', { lat: '-22.9681',
  lng: '-46.5311',
  source: 'native-gps',
  timestamp: '2025-12-29T17:36:08.535Z' }
'[GuideEngine] ✅ Saved last location to MMKV when guide became inactive:', { lat: '-22.9681', lng: '-46.5311', source: 'native-gps' }
[CooldownContext] 🎯 Event: cooldown_cleared for POI: 50cd5835-70db-41be-9084-3adcae63c15e
[CooldownContext] 🎯 Event: cooldown_cleared for POI: 967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b
'[GuideMapScreen] Cooldown IDs updated: 0 POIs in cooldown', []
[RouteTrailMap] Trail is not visible, returning empty coordinates
[NativeMarkerManagerBridge] Stopped observing events
[NativeMarkerManagerBridge] Started observing events
[POICustomClusterRenderer] 🎨 renderClusters called: 1 clusters
[RouteTrailMap] Trail is not visible, returning empty coordinates
[NativeMarkerManager] 🔍 Rendering 3 TPs INDIVIDUALLY (Guide INACTIVE, latitudeDelta=0.0039 <= 0.0050)
[NativeMarkerManager] Update complete: 4 markers
[POICustomClusterRenderer] 🎨 renderClusters called: 1 clusters
quic_frame_process_STREAM [C18.1.1.1:2] [-01b57344fbd5749ceeb5124677d54448936bcd8c] [S508] unable to handle frame len 0, offset 33064 fin 0
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b68362d1-52cc-4480-8085-1c504fa17595","name":"Locomotiva Doutor Luiz Leme","description":null,"city":"Bragança Paulista","country":"Brazil","category":null,"type":null,"latitude":-22.9691974,"
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
nw_protocol_socket_set_no_wake_from_sleep [C26.1.1.1:3] setsockopt SO_NOWAKEFROMSLEEP failed [22: Invalid argument]
nw_protocol_socket_set_no_wake_from_sleep setsockopt SO_NOWAKEFROMSLEEP failed [22: Invalid argument]
nw_protocol_socket_set_no_wake_from_sleep [C26.1.1.1:3] setsockopt SO_NOWAKEFROMSLEEP failed [22: Invalid argument]
nw_protocol_socket_set_no_wake_from_sleep setsockopt SO_NOWAKEFROMSLEEP failed [22: Invalid argument]
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 105 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 105 valid trigger points
[POICacheHelper] ✅ Saved 28 POIs to cache v4
[POILoadingService] ✅ Synced 28 POIs, 105 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 28 POIs synced
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 28 POIs, 105 TPs
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POILoadingService] 🔍 [SYNC] Received 175 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 175 valid trigger points
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[POICacheHelper] ✅ Saved 47 POIs to cache v4
[POILoadingService] ✅ Synced 47 POIs, 175 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 47 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 47 POIs, 175 TPs
[SupabaseRPCClient] 📥 Raw response (first 200 chars): [{"id":"b7b97b35-6337-402a-a356-8708dd3ce750","name":"Trigger Point b7b97b35-6337-402a-a356-8708dd3ce750","attraction_id":"03d6b6be-e73e-3053-bda8-4cdb3297307e","attraction_name":"Praça da Poesia Poet
[POILoadingService] 🔍 [SYNC] Received 105 trigger points from RPC
[POILoadingService] ✅ [SYNC] Parsed 105 valid trigger points
[POICacheHelper] ✅ Saved 28 POIs to cache v4
[POILoadingService] ✅ Synced 28 POIs, 105 TPs for region and emitted POILoaded notification
[POILoadingService] ✅ Background sync completed: 28 POIs synced
[POI-LOAD-IOS:BRIDGE:SUCCESS] ✅ POILoaded event enqueued to JavaScript (dispatched to main): 28 POIs, 105 TPs