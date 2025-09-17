# Trigger Points - Troubleshooting Guide

## 🚨 Common Issues & Solutions

This guide covers the most frequent problems encountered with the Trigger Points system and their solutions.

## 🔍 Generation Issues

### Issue: "Cannot extract elements from a scalar" Error

**Symptoms**:
```
❌ Error saving trigger points: {
  code: '22023',
  message: 'cannot extract elements from a scalar'
}
```

**Root Cause**: Database triggers trying to process JSONB data incorrectly

**Solution**:
1. **Check trigger status**:
   ```sql
   SELECT tgname, tgenabled FROM pg_trigger t
   JOIN pg_class c ON t.tgrelid = c.oid
   JOIN pg_namespace n ON c.relnamespace = n.oid
   WHERE c.relname = 'attraction_trigger_points' AND n.nspname = 'core';
   ```

2. **Disable problematic triggers**:
   ```sql
   ALTER TABLE core.attraction_trigger_points DISABLE TRIGGER trigger_auto_create_training_example;
   ```

3. **Verify data format**: Ensure `score_factors` field is properly formatted as JSONB

**Prevention**: Regular database trigger maintenance and proper JSONB handling

---

### Issue: No Trigger Points Generated

**Symptoms**:
- Process completes successfully but 0 trigger points saved
- Message: "Generated 0 trigger points"

**Possible Causes**:

#### 1. POI Not Found in OpenStreetMap
**Check**: Look for message "POI not found in OpenStreetMap"
**Solution**: System should automatically fall back to estimated boundary
**Fix**: Verify fallback logic is working

#### 2. No Accessible Streets Found
**Check**: Look for message "No streets found within search radius"
**Solution**: 
- Increase search radius in configuration
- Check if POI is in very remote location
- Verify Overpass API is responding

#### 3. All Trigger Points Below Confidence Threshold
**Check**: Look for message "All trigger points below minimum confidence"
**Solution**: 
- Lower confidence threshold temporarily
- Check POI location accuracy
- Verify street data quality

**Debugging Steps**:
```javascript
// Check POI coordinates
console.log('POI Location:', lat, lng);

// Check boundary detection
console.log('Boundary Source:', boundarySource);

// Check street analysis
console.log('Streets Found:', streets.length);

// Check trigger point generation
console.log('Raw Trigger Points:', rawTriggerPoints.length);
console.log('After Validation:', validatedTriggerPoints.length);
```

---

### Issue: Low Quality Trigger Points

**Symptoms**:
- Most trigger points marked as "review" or "rejected"
- Low confidence scores (<0.5)

**Solutions**:

#### 1. Improve Boundary Detection
- **Check OSM Data**: Verify POI exists in OpenStreetMap
- **Update POI Coordinates**: Ensure accurate lat/lng
- **Manual Boundary**: Consider manual boundary definition for important POIs

#### 2. Enhance Street Analysis
- **Verify Street Data**: Check if streets exist near POI
- **Adjust Search Radius**: Increase radius for rural areas
- **Road Type Priority**: Prefer main roads over service roads

#### 3. Optimize Trigger Placement
- **Distance Optimization**: Balance visibility and accessibility
- **Bearing Analysis**: Ensure good viewing angles
- **Duplicate Removal**: Prevent overlapping triggers

---

## 🌐 API Issues

### Issue: Rate Limiting Errors

**Symptoms**:
```
Error: 429 Too Many Requests
Rate limit exceeded for OpenStreetMap API
```

**Solutions**:

#### 1. Increase Delays
```javascript
// In processing settings
const delayBetweenCalls = 5000; // 5 seconds instead of 3
```

#### 2. Reduce Batch Size
```javascript
// Process fewer POIs at once
const batchSize = 25; // Instead of 50
```

#### 3. Implement Exponential Backoff
```javascript
const retryWithBackoff = async (fn, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429 && i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
        continue;
      }
      throw error;
    }
  }
};
```

---

### Issue: External API Failures

**Symptoms**:
- "OpenStreetMap API unavailable"
- "Overpass API timeout"
- "Elevation API error"

**Solutions**:

#### 1. Check API Status
- **OpenStreetMap**: https://status.openstreetmap.org/
- **Overpass API**: Try alternative servers
- **Elevation API**: Verify service availability

#### 2. Implement Fallbacks
```javascript
// Fallback chain for boundary detection
try {
  boundary = await getOSMBoundary(poi);
} catch (error) {
  try {
    boundary = await getOverpassBoundary(poi);
  } catch (error) {
    boundary = createEstimatedBoundary(poi);
  }
}
```

#### 3. Cache Responses
```javascript
// Cache expensive API calls
const cachedResponse = cache.get(cacheKey);
if (cachedResponse) {
  return cachedResponse;
}
```

---

## 💾 Database Issues

### Issue: Connection Timeouts

**Symptoms**:
- "Connection timeout"
- "Database unavailable"
- Long processing delays

**Solutions**:

#### 1. Check Connection Pool
```javascript
// Monitor active connections
const activeConnections = supabase.getActiveConnections();
console.log('Active DB connections:', activeConnections);
```

#### 2. Optimize Queries
```sql
-- Use indexes for better performance
EXPLAIN ANALYZE SELECT * FROM core.attraction_trigger_points 
WHERE attraction_id = 'uuid' AND is_active = true;
```

#### 3. Batch Operations
```javascript
// Insert multiple trigger points in one transaction
const { error } = await supabase
  .from('attraction_trigger_points')
  .insert(triggerPointsArray);
```

---

### Issue: Constraint Violations

**Symptoms**:
- "Check constraint violation"
- "Foreign key constraint violation"
- "Unique constraint violation"

**Common Violations**:

#### 1. Invalid Coordinates
```sql
-- Check: expected_bearing must be 0-360
-- Fix: Validate bearing before insert
expected_bearing = Math.max(0, Math.min(360, bearing));
```

#### 2. Invalid Radius
```sql
-- Check: radius_meters must be > 0 and <= 500
-- Fix: Validate radius
radius_meters = Math.max(1, Math.min(500, radius));
```

#### 3. Invalid Status Values
```sql
-- Check: status must be in allowed values
-- Fix: Validate status
const validStatuses = ['approved', 'review', 'rejected', 'pending'];
if (!validStatuses.includes(status)) {
  status = 'pending';
}
```

---

## 🖥️ UI Issues

### Issue: Filters Not Loading

**Symptoms**:
- Country dropdown empty
- State dropdown not populating
- City filter not working

**Solutions**:

#### 1. Check API Endpoints
```bash
# Test countries endpoint
curl "/api/locations/countries-cities"

# Test states endpoint  
curl "/api/states?country=Brazil"
```

#### 2. Verify Network Connectivity
```javascript
// Check if API is reachable
const response = await fetch('/api/locations/countries-cities');
console.log('API Status:', response.status);
```

#### 3. Clear Browser Cache
- Hard refresh (Ctrl+F5)
- Clear localStorage
- Disable browser cache during development

---

### Issue: Processing Gets Stuck

**Symptoms**:
- Processing indicator shows indefinitely
- No progress updates
- UI becomes unresponsive

**Solutions**:

#### 1. Check Browser Console
```javascript
// Look for JavaScript errors
console.log('Current processing state:', processingState);
```

#### 2. Verify WebSocket Connection
```javascript
// Check if real-time updates are working
console.log('WebSocket status:', websocket.readyState);
```

#### 3. Implement Timeout Handling
```javascript
// Add timeout to processing
const processingTimeout = setTimeout(() => {
  setError('Processing timeout - please refresh and try again');
  setIsProcessing(false);
}, 300000); // 5 minutes
```

---

## 🔧 Performance Issues

### Issue: Slow Generation Times

**Symptoms**:
- Each POI takes >30 seconds to process
- High memory usage
- Browser becomes sluggish

**Optimization Strategies**:

#### 1. Reduce API Calls
```javascript
// Use unified Overpass queries instead of multiple calls
const unifiedData = await queryUnifiedOverpassData(lat, lng, name);
```

#### 2. Optimize Database Queries
```sql
-- Use appropriate indexes
CREATE INDEX IF NOT EXISTS idx_trigger_points_spatial_optimized 
ON core.attraction_trigger_points USING GIST (location) 
WHERE is_active = true AND final_status = 'approved';
```

#### 3. Implement Caching
```javascript
// Cache expensive calculations
const cacheKey = `boundary_${poiId}`;
const cachedBoundary = cache.get(cacheKey);
if (cachedBoundary) {
  return cachedBoundary;
}
```

---

### Issue: High Memory Usage

**Symptoms**:
- Browser tab crashes
- System becomes slow
- "Out of memory" errors

**Solutions**:

#### 1. Process in Smaller Batches
```javascript
// Reduce batch size for large operations
const batchSize = Math.min(25, totalPOIs);
```

#### 2. Clean Up Resources
```javascript
// Clear large objects after processing
delete largeDataStructure;
if (global.gc) global.gc(); // Force garbage collection
```

#### 3. Stream Processing
```javascript
// Process POIs one at a time instead of loading all
for (const poi of poisStream) {
  await processPOI(poi);
  // Clean up after each POI
}
```

---

## 📊 Monitoring & Debugging

### Debug Logging

**Enable Debug Mode**:
```javascript
// Add to environment variables
DEBUG_TRIGGER_POINTS=true

// In code
if (process.env.DEBUG_TRIGGER_POINTS) {
  console.log('🔍 Debug:', debugInfo);
}
```

**Useful Debug Information**:
```javascript
const debugInfo = {
  poiId: poi.id,
  poiName: poi.name,
  coordinates: [poi.lat, poi.lng],
  boundarySource: boundary.source,
  streetsFound: streets.length,
  triggerPointsGenerated: triggerPoints.length,
  processingTime: Date.now() - startTime
};
```

### Health Checks

**System Health Monitoring**:
```javascript
// Check external APIs
const healthCheck = {
  osm_nominatim: await checkOSMHealth(),
  overpass_api: await checkOverpassHealth(),
  elevation_api: await checkElevationHealth(),
  database: await checkDatabaseHealth()
};
```

**Performance Metrics**:
```javascript
// Track key metrics
const metrics = {
  avgProcessingTime: calculateAvgProcessingTime(),
  successRate: calculateSuccessRate(),
  apiResponseTimes: getAPIResponseTimes(),
  errorRate: calculateErrorRate()
};
```

---

## 🆘 Emergency Procedures

### System Recovery

**If Generation System is Down**:
1. **Check Database Connection**: Verify Supabase status
2. **Disable Problematic Triggers**: Use emergency SQL scripts
3. **Switch to Manual Mode**: Use individual trigger point creation
4. **Contact Support**: Escalate if system-wide issues

**Emergency SQL Commands**:
```sql
-- Disable all trigger point triggers
ALTER TABLE core.attraction_trigger_points DISABLE TRIGGER ALL;

-- Re-enable essential triggers only
ALTER TABLE core.attraction_trigger_points ENABLE TRIGGER handle_updated_at;
ALTER TABLE core.attraction_trigger_points ENABLE TRIGGER trigger_update_status;
```

### Data Recovery

**If Trigger Points Lost**:
1. **Check Database Backups**: Restore from recent backup
2. **Verify RLS Policies**: Ensure proper access permissions
3. **Regenerate from Source**: Use batch generation to recreate
4. **Manual Recreation**: For critical POIs, create manually

---

## 📞 Getting Help

### Support Channels

1. **Documentation**: Check related docs first
2. **System Logs**: Review application and database logs
3. **Development Team**: Contact with specific error details
4. **Emergency Contact**: For production issues

### Information to Provide

When reporting issues, include:
- **Error Messages**: Exact text of errors
- **Steps to Reproduce**: How to trigger the issue
- **Environment**: Browser, OS, network conditions
- **POI Details**: Specific POIs that fail
- **Timestamps**: When the issue occurred
- **Screenshots**: Visual evidence of problems

---

## 🔗 Related Documentation

- [Generation Process](./02-generation-process.md) - Technical process details
- [Database Schema](./03-database-schema.md) - Database structure
- [API Documentation](./04-api-documentation.md) - API reference
- [Configuration](./08-configuration.md) - System settings
