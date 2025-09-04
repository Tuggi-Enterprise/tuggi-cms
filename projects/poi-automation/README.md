# 🚀 POI AUTOMATION - MODULAR ARCHITECTURE

## 📋 **PROJECT OVERVIEW**

**POI Automation** is a modular system for processing Points of Interest (POIs) that implements a serverless architecture using Supabase Edge Functions. The system allows each stage (description, trigger points, audio, publication) to work independently OR as a unified flow, without code duplication.

---

## 🎯 **MAIN OBJECTIVES**

### **✅ COMPLETED**
- **DescriptionService**: 100% functional as Edge Function
- **Quality audit system**: Automatic quality score
- **Smart Pro/Flash selection**: Based on google_types
- **Sources-only RAG**: Optimized without problematic scraping
- **OSM integration**: Data enrichment working
- **JWT authentication**: Working in Edge Function

### **🎯 IN DEVELOPMENT**
- **TriggerPointsService**: Next modular service
- **AudioService**: Modular audio generation
- **PublicationService**: Publication system
- **OrchestratorService**: Unified flow

---

## 🏗️ **ARCHITECTURE**

### **📦 MODULAR SERVICES**
```
lib/services/poi-processing/
├── description.service.ts      ✅ COMPLETED
├── trigger-points.service.ts   🎯 NEXT
├── audio.service.ts           ⏳ PENDING
├── publication.service.ts     ⏳ PENDING
├── orchestrator.service.ts    ⏳ PENDING
└── status.service.ts         ⏳ PENDING
```

### **⚡ EDGE FUNCTIONS**
```
supabase/functions/
├── generate-description/      ✅ DEPLOYED
├── process-trigger-points/    🎯 NEXT
├── process-audio/            ⏳ PENDING
├── process-complete/         ⏳ PENDING
└── process-batch/            ⏳ PENDING
```

---

## 🚀 **HOW TO USE**

### **1. Description Generation (INDIVIDUAL)**
```bash
curl -X POST 'https://tysnkzmljlmmqpbotkxv.supabase.co/functions/v1/generate-description' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "poi_data": {
      "id": "POI_ID",
      "name": "POI Name",
      "city": "City",
      "country": "Country"
    },
    "options": {
      "language": "pt-br",
      "gender": "male"
    }
  }'
```

### **2. Complete Flow (SEQUENTIAL)**
*In development - will be implemented via OrchestratorService*

---

## 📊 **CURRENT STATUS**

| Component | Status | Progress |
|-----------|--------|----------|
| **DescriptionService** | ✅ **COMPLETED** | 100% |
| **Edge Function** | ✅ **DEPLOYED** | 100% |
| **TriggerPointsService** | 🎯 **NEXT** | 0% |
| **AudioService** | ⏳ **PENDING** | 0% |
| **PublicationService** | ⏳ **PENDING** | 0% |
| **OrchestratorService** | ⏳ **PENDING** | 0% |

**Overall Progress**: 31% (6h30min of 21h30min)

---

## 🔧 **TECHNOLOGIES**

- **Backend**: Supabase Edge Functions (Deno)
- **Database**: PostgreSQL (Supabase)
- **AI**: Google Gemini API (Pro + Flash)
- **TTS**: Google Cloud Text-to-Speech
- **Language**: TypeScript
- **Authentication**: JWT

---

## 📚 **DOCUMENTATION**

- **[📚 Documentation Index](./DOCUMENTATION_INDEX.md)** - Quick navigation
- **[🏗️ Technical Architecture](./TECHNICAL_ARCHITECTURE.md)** - Detailed architecture
- **[🗺️ Implementation Roadmap](./IMPLEMENTATION_ROADMAP.md)** - Complete roadmap

---

## 🎯 **NEXT STEP**

**Implement modular TriggerPointsService** - Analysis of existing code and creation of reusable service.

**Estimated time**: 2h  
**Risk**: Medium  
**Impact**: High

---

## 📞 **SUPPORT**

- **Issues**: GitHub Issues of the project
- **Documentation**: Pull Request with corrections
- **Development**: Technical team

---

**🚀 ACTIVE PROJECT IN DEVELOPMENT!**  
**DescriptionService working perfectly as Edge Function**
