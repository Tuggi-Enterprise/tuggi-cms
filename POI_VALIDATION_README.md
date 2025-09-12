# 🏷️ POI Name Validation System - Quick Start Guide

## 📋 Overview

This system validates and enhances POI names using Google Gemini AI. It processes **only Brazilian POIs** (country = 'BR') and suggests improvements based on OSM tags, POI type classification, and contextual descriptors - **only when clear evidence exists**.

## 🚀 Quick Start

### 1. Setup and Verification

First, verify your system is ready:

```bash
# Check system setup and run tests
npm run poi-validation:setup
```

This will:
- ✅ Check environment variables
- ✅ Test Supabase connection
- ✅ Test Gemini API connection
- ✅ Verify database schema
- ✅ Run a validation test

### 2. Run Database Migration

Apply the database migration to create validation tables:

```bash
# Run the migration in your Supabase dashboard or CLI
supabase db push
```

Or manually execute: `supabase/migrations/20241215000001_create_poi_name_validation_tables.sql`

### 3. Test Run (Recommended)

Before processing all POIs, run a test with a small batch:

```bash
# Test with 10 POIs (dry run - no changes made)
npm run poi-validation:test
```

### 4. Full Processing

Process all POIs in your database:

```bash
# Process all POIs with default settings
npm run poi-validation

# Or with custom settings
npm run poi-validation -- --threshold=80 --batch-size=25
```

## 🛠️ Available Commands

| Command | Description |
|---------|-------------|
| `npm run poi-validation:setup` | Verify system setup and run tests |
| `npm run poi-validation:test` | Test run with 10 POIs (dry run) |
| `npm run poi-validation` | Process all POIs with default settings |
| `npm run poi-validation:resume` | Resume from previous interrupted session |
| `npm run poi-validation:high-threshold` | Use higher confidence threshold (85%) |

## ⚙️ Configuration Options

You can customize the validation process with these options:

```bash
# Batch processing
--batch-size=50             # POIs per batch (default: 50)

# Auto-approval threshold
--threshold=70              # Confidence % for auto-approval (default: 70)

# Testing options
--dry-run                   # Test without making changes
--max-pois=100              # Limit number of POIs for testing

# Resume option
--resume                    # Resume from previous session

# Model: Always uses Gemini 1.5 Flash (optimized for cost and speed)
```

## 📊 What the System Does

### 🔍 POI Analysis
- Analyzes POI names for accuracy and descriptiveness
- Classifies POI types (placa, estátua, pico, mirante, igreja, etc.)
- Uses OSM tags for context and evidence
- **Never invents information** - only suggests when evidence exists

### 🤖 Smart Processing
- **Auto-approval**: High confidence suggestions (≥70%) are applied automatically
- **Manual review**: Lower confidence suggestions go to review queue
- **Evidence-based**: Only suggests changes when clear evidence is found in OSM tags

### 📈 Example Transformations

**When evidence exists:**
- "Eu amo Itapevi" → "Placa 'Eu amo Itapevi'" (if OSM tags indicate it's a sign)
- "Estátua" → "Estátua do Cristo Redentor" (if OSM tags have `name:pt="Cristo Redentor"`)
- "Mirante" → "Mirante da Vista Panorâmica" (if OSM tags provide specific name)

**When no evidence found:**
- "Estátua" → "Estátua" (keeps original - no invention)
- "Mirante" → "Mirante" (keeps original - no invention)

## 📋 Required Environment Variables

Add these to your `.env` file:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GEMINI_API_KEY=your_gemini_api_key
```

## 💰 Cost Estimates

**Gemini 1.5 Flash (único modelo usado):**
- **Custo**: ~$2-3 para todos os POIs brasileiros
- **Tempo de processamento**: 2-3 horas
- **Rate limit**: 15 requests/minuto, cooldown de 4 segundos
- **Escopo**: Apenas POIs com country = 'BR'
- **Ideal para**: Custo-benefício otimizado

## 📊 Monitoring Progress

The script provides real-time progress updates:

```
📊 Progress Report
────────────────────────────────────────
├─ Total POIs: 21,000
├─ Processed: 5,250 (25.0%)
├─ Auto-approved: 3,675 (70.0%)
├─ Manual review: 1,575 (30.0%)
├─ Failed: 0
├─ Elapsed: 1h 15m
└─ ETA: 3h 45m
```

## 🔄 Resume Functionality

If the process is interrupted, you can resume:

```bash
npm run poi-validation:resume
```

Progress is automatically saved to `poi-validation-progress.json`.

## 🔍 Manual Review Interface

POIs requiring manual review can be accessed through:

1. **Database views**:
   - `core.poi_review_queue` - Prioritized review queue
   - `core.poi_validation_stats` - Overall statistics
   - `core.poi_type_distribution` - POI type breakdown

2. **API endpoints** (if implemented):
   - `GET /api/poi-validation/review` - Get review queue
   - `POST /api/poi-validation/review/approve` - Approve changes
   - `POST /api/poi-validation/review/reject` - Reject changes

## 🎯 Success Metrics

Expected outcomes for Brazilian POIs:
- **Auto-approval rate**: ~60-70%
- **Manual review**: ~30-40%
- **POI type classification**: ~90% accuracy
- **Evidence-based suggestions**: ~95%
- **Processing time**: 2-3 hours
- **Scope**: Only POIs with country = 'BR'
- **Total cost**: ~$2-3

## ⚠️ Important Notes

### Critical Rules
1. **Never invents information** - Only suggests when evidence exists
2. **Conservative approach** - Better to keep original than suggest incorrectly
3. **Evidence tracking** - All suggestions include evidence source
4. **Audit trail** - Complete record of all changes

### Rate Limiting
- **Gemini Flash**: 15 requests/minute, 4s cooldown
- Automatic retry with exponential backoff
- Efficient batch processing

### Data Safety
- Complete audit trail of all changes
- Rollback capability through database records
- Dry run mode for testing
- Progress saving for interruption recovery

## 🆘 Troubleshooting

### Common Issues

**Environment variables missing:**
```bash
npm run poi-validation:setup  # Check setup
```

**Database connection failed:**
- Verify Supabase credentials
- Check if migration was applied
- Ensure service role key has correct permissions

**Gemini API errors:**
- Verify API key is correct
- Check API quota limits
- Monitor rate limiting

**Out of memory:**
- Reduce batch size: `--batch-size=25`
- Process in smaller chunks: `--max-pois=5000`

### Getting Help

1. Run setup script: `npm run poi-validation:setup`
2. Check logs in console output
3. Review `poi-validation-progress.json` for state
4. Check database tables for results

## 📁 Project Structure

```
├── scripts/
│   ├── poi-name-validation.ts      # Main validation script
│   └── setup-poi-validation.ts     # Setup and verification
├── lib/services/
│   └── poi-validation-service.ts   # Core validation service
├── supabase/migrations/
│   └── 20241215000001_create_poi_name_validation_tables.sql
├── projects/poi-name-validation/
│   ├── README.md                   # Detailed project documentation
│   └── docs/
│       └── technical-specifications.md
└── poi-validation-progress.json    # Progress tracking (auto-generated)
```

## 🎉 After Completion

Once processing is complete:

1. **Review statistics** in the console output
2. **Check auto-approved changes** in the database
3. **Process manual review queue** for remaining POIs
4. **Monitor POI name quality** in your application
5. **Generate reports** using database views

---

**Ready to start?** Run `npm run poi-validation:setup` to begin! 🚀
