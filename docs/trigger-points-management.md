# Trigger Points Management System

## Overview

The Trigger Points Management system is a sophisticated geofencing solution for the Tuggi CMS that allows administrators to define trigger points for POI (Points of Interest) narration activation. These trigger points are used by the Tuggi Drive app to determine when Text-to-Speech (TTS) narration should be activated during a drive.

## 🎯 Features

### Interactive Map Interface
- Real-time map visualization with Google Maps integration
- Click-to-place trigger points functionality
- Drag-and-drop point repositioning
- Visual radius circles with customizable colors
- Directional arrows for bearing-based triggers
- Auto-fit bounds to show all trigger points

### Comprehensive Management
- Create, edit, and delete trigger points
- Multiple trigger types: Primary, Fallback, Entry, Exit, Approach, Custom
- Priority-based activation system
- Radius configuration (5m - 1km)
- Optional directional constraints (bearing + threshold)
- Active/inactive status control

### Advanced Configuration
- **Radius Settings**: Visual slider with real-time circle preview (5-1000 meters)
- **Bearing Control**: Optional directional triggers with threshold tolerance
- **Priority System**: Numeric priority for activation order
- **Type Classification**: Six predefined trigger types with color coding
- **Custom Descriptions**: Link to specific audio content

### User Experience
- Tabbed interface integrated into POI Details Modal
- Real-time validation and error handling
- Bulk operations and filtering
- Responsive design with mobile support
- Dark mode compatibility

## 🗂️ File Structure

```
components/poi-management/
├── TriggerPointsManager.tsx    # Main management component
├── TriggerPointsMap.tsx        # Interactive map component
└── POIDetailsModal.tsx         # Enhanced with trigger points tab

types/
└── trigger-points.ts           # TypeScript definitions

docs/
└── trigger-points-management.md # This documentation

SQL/
└── create-trigger-points-table.sql # Database schema
```

## 🛠️ Database Schema

### Table: `core.attraction_trigger_points`

```sql
CREATE TABLE core.attraction_trigger_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attraction_id uuid NOT NULL REFERENCES core.attractions(id) ON DELETE CASCADE,
  location geography(Point, 4326) NOT NULL,
  radius_meters integer DEFAULT 30 CHECK (radius_meters > 0),
  expected_bearing real CHECK (expected_bearing >= 0 AND expected_bearing <= 360),
  bearing_threshold real DEFAULT 30 CHECK (bearing_threshold >= 0 AND bearing_threshold <= 180),
  type text DEFAULT 'primary' CHECK (type IN ('primary', 'fallback', 'entry', 'exit', 'approach', 'custom')),
  priority integer DEFAULT 1 CHECK (priority >= 1),
  custom_description_id uuid REFERENCES core.attraction_description(id),
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
```

### View: `core.trigger_points_with_coords`

```sql
CREATE VIEW core.trigger_points_with_coords AS
SELECT 
  tp.*,
  core.get_trigger_point_lat(tp.location) as latitude,
  core.get_trigger_point_lng(tp.location) as longitude,
  a.name as attraction_name,
  ad.description as custom_description
FROM core.attraction_trigger_points tp
JOIN core.attractions a ON tp.attraction_id = a.id
LEFT JOIN core.attraction_description ad ON tp.custom_description_id = ad.id
ORDER BY tp.attraction_id, tp.priority, tp.type;
```

## 📝 Data Model

### Trigger Point Properties

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `id` | UUID | Unique identifier | Primary key |
| `attraction_id` | UUID | Reference to POI | Foreign key |
| `location` | Geography Point | Lat/lng coordinates | PostGIS geography |
| `radius_meters` | Integer | Activation radius | 5-1000 meters |
| `expected_bearing` | Float | Expected direction | 0-360 degrees (optional) |
| `bearing_threshold` | Float | Bearing tolerance | 0-180 degrees |
| `type` | Enum | Trigger classification | See types below |
| `priority` | Integer | Activation priority | 1+ (1 = highest) |
| `custom_description_id` | UUID | Custom audio content | Optional foreign key |
| `is_active` | Boolean | Active status | Default: true |

### Trigger Types

| Type | Color | Description | Use Case |
|------|-------|-------------|----------|
| `primary` | #00A8E8 (Blue) | Main trigger point | Primary narration activation |
| `fallback` | #FF6F00 (Orange) | Backup trigger | Alternative activation point |
| `entry` | #10B981 (Green) | Entry point | Entering area/attraction |
| `exit` | #EF4444 (Red) | Exit point | Leaving area/attraction |
| `approach` | #8B5CF6 (Purple) | Approach trigger | Getting close to POI |
| `custom` | #F59E0B (Amber) | Custom trigger | Specialized use cases |

## 🚀 Usage Guide

### Accessing Trigger Points

1. Navigate to **POI Management** page (`/pois`)
2. Click on any POI to open the details modal
3. Select the **"Trigger Points"** tab
4. The interactive map and management interface will load

### Creating a Trigger Point

1. Click **"Add Trigger"** button to enter placement mode
2. Click anywhere on the map to place a new trigger point
3. Configure the trigger properties in the form:
   - **Location**: Auto-set by map click (can be manually adjusted)
   - **Type**: Select from dropdown (Primary, Fallback, Entry, etc.)
   - **Priority**: Set numeric priority (1 = highest)
   - **Radius**: Use slider to set activation radius (5-1000m)
   - **Bearing**: Optional directional constraint (0-360°)
   - **Bearing Threshold**: Tolerance for bearing matching (±degrees)
   - **Custom Description**: Link to specific audio content
   - **Active Status**: Enable/disable the trigger

4. Click **"Create"** to save the trigger point

### Editing Trigger Points

1. Click on any existing trigger point on the map
2. The edit form will open with current values
3. Modify any properties as needed
4. Click **"Update"** to save changes

### Managing Multiple Triggers

- **Filter by Type**: Use the dropdown to show only specific trigger types
- **Visual Selection**: Selected triggers are highlighted with white borders
- **Drag to Reposition**: Drag any trigger point to a new location
- **Priority Order**: Triggers are displayed with priority numbers

### Validation Rules

- **Radius**: Must be between 5 and 1000 meters
- **Bearing**: Must be between 0 and 360 degrees
- **Bearing Threshold**: Must be between 0 and 180 degrees
- **Priority**: Must be 1 or higher
- **Location**: Must be valid latitude/longitude coordinates

## 🔧 Technical Implementation

### Component Architecture

```typescript
TriggerPointsManager (Main Component)
├── TriggerPointsMap (Interactive Map)
│   ├── Google Maps Integration
│   ├── Marker Management
│   ├── Circle Overlays
│   └── Bearing Lines
├── Trigger Points List (Sidebar)
├── Filter Controls
└── Edit Form Modal
```

### State Management

```typescript
interface TriggerPointsManagerState {
  triggerPoints: TriggerPoint[]
  selectedTriggerPoint: TriggerPoint | null
  isAddingMode: boolean
  isEditing: boolean
  showForm: boolean
  filterType: string
  formData: TriggerPointFormData
  availableDescriptions: AttractionDescription[]
}
```

### Map Features

- **Real-time Updates**: Changes reflect immediately on the map
- **Color Coding**: Each trigger type has a distinct color
- **Info Windows**: Hover to see trigger details
- **Bounds Fitting**: Automatically adjusts zoom to show all triggers
- **Click Handlers**: Separate handlers for map clicks and marker clicks

### API Integration

```typescript
// Load trigger points
const { data } = await supabase
  .from('trigger_points_with_coords')
  .select('*')
  .eq('attraction_id', attractionId)

// Create trigger point
const { error } = await supabase
  .from('attraction_trigger_points')
  .insert({
    attraction_id,
    location: `POINT(${lng} ${lat})`,
    radius_meters,
    expected_bearing,
    bearing_threshold,
    type,
    priority,
    custom_description_id,
    is_active
  })
```

## 🎨 UI/UX Design

### Tuggi Brand Integration

- **Primary Color**: #00A8E8 (Tuggi Blue) for selected states and primary triggers
- **Secondary Color**: #FF6F00 (Tuggi Orange) for add mode and fallback triggers
- **Background**: #F7F9FA for clean, professional appearance
- **Typography**: Consistent with Tuggi brand guidelines

### Visual Hierarchy

1. **Map**: Primary focus area for visualization
2. **Sidebar**: Secondary panel for list and filters
3. **Form Modal**: Overlay for detailed editing
4. **Header**: Clear navigation and action buttons

### Accessibility

- **Keyboard Navigation**: All interactive elements are keyboard accessible
- **Color Contrast**: WCAG AA compliant color combinations
- **Screen Readers**: Proper ARIA labels and semantic markup
- **Mobile Support**: Responsive design for touch interfaces

## 🔍 Troubleshooting

### Common Issues

**Map Not Loading**
- Verify `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set
- Check browser console for API errors
- Ensure Google Maps JavaScript API is enabled

**Trigger Points Not Saving**
- Check database connection and permissions
- Verify RLS policies are properly configured
- Check browser network tab for API errors

**Visual Issues**
- Clear browser cache and reload
- Check for JavaScript errors in console
- Verify all required dependencies are installed

### Performance Optimization

- **Lazy Loading**: Map components load only when needed
- **Debounced Updates**: Form changes are debounced to prevent excessive API calls
- **Efficient Rendering**: Only re-render components when data changes
- **Memory Management**: Proper cleanup of map resources

## 🚀 Future Enhancements

### Planned Features

1. **Bulk Operations**: Select and modify multiple trigger points
2. **Template System**: Save and reuse trigger point configurations
3. **Analytics**: Usage statistics and trigger effectiveness metrics
4. **Import/Export**: CSV/JSON import/export functionality
5. **Advanced Filtering**: Date ranges, user filters, status filters
6. **Collaboration**: Multi-user editing with conflict resolution

### Technical Improvements

1. **Offline Support**: Caching for offline trigger point management
2. **Real-time Sync**: WebSocket updates for collaborative editing
3. **Version History**: Track changes to trigger points over time
4. **A/B Testing**: Test different trigger configurations
5. **Performance Monitoring**: Track component performance metrics

## 📚 Related Documentation

- [POI Importer System](./poi-importer.md)
- [Database Schema](./database-improvements.md)
- [Google Maps Integration](../components/ui/GoogleMapComponent.tsx)
- [Supabase Configuration](../lib/supabase.ts)

## 🤝 Contributing

When contributing to the Trigger Points system:

1. **Follow TypeScript**: Use strict typing with proper interfaces
2. **Test Thoroughly**: Test all CRUD operations and edge cases
3. **Maintain Consistency**: Follow existing code patterns and conventions
4. **Document Changes**: Update this documentation for any feature changes
5. **Performance**: Consider performance impact of map operations

## 📄 License

This trigger points management system is part of the Tuggi CMS and is subject to the same licensing terms as the parent project. 