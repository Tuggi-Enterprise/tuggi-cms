# Tuggi CMS

A comprehensive Content Management System for managing Points of Interest (POIs) used in TuggiWalk and TuggiDrive applications.

## Features

- 🗺️ **POI Management**: Create, edit, and manage points of interest with multi-language support
- 🌍 **Interactive Maps**: Leaflet-based mapping with point and polygon drawing capabilities
- 📊 **Analytics Dashboard**: KPIs, charts, and performance metrics
- 🖼️ **Image Management**: Upload and manage POI images with Supabase storage
- 🔐 **Secure Authentication**: Supabase Auth with admin role protection
- 🌙 **Dark Mode**: Full dark mode support
- 📱 **Responsive Design**: Mobile-friendly interface
- 🎯 **Region Editor**: Draw and manage geographic polygons
- ✅ **Content Approval**: Workflow for approving/rejecting POIs
- 🤖 **AI-Powered Descriptions**: Generate rich cultural and historical descriptions using Google Gemini 1.5 Pro
- 🎧 **Audio Narration**: Generate optimized TTS audio narration with voice selection, speed control, and Portuguese text preprocessing

## Tech Stack

- **Framework**: Next.js 14 with App Router
- **Authentication**: Supabase Auth
- **Database**: Supabase (PostgreSQL)
- **Styling**: Tailwind CSS
- **Maps**: Leaflet with React-Leaflet
- **Charts**: Recharts
- **UI Components**: Headless UI + Custom components
- **Icons**: Lucide React
- **Language**: TypeScript

## Prerequisites

Before you begin, ensure you have:

- Node.js 18+ installed
- A Supabase project
- Admin users with `role: 'admin'` in user metadata

## Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd tuggi-cms
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   Create a `.env.local` file in the root directory:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET=tuggi-cms-images
   GEMINI_API_KEY=your_google_gemini_api_key
   OPENAI_API_KEY=your_openai_api_key
   ```

4. **Set up Supabase**:
   - Create the required database tables (see Database Schema below)
   - Set up Row Level Security (RLS) policies
   - Create a storage bucket named `tuggi-cms-images`
   - Configure user roles in authentication

5. **Run the development server**:
   ```bash
   npm run dev
   ```

6. **Open your browser**:
   Navigate to [http://localhost:3000](http://localhost:3000)

## Database Schema

The application expects the following Supabase tables:

### Core Tables

1. **core.attractions**
   ```sql
   CREATE TABLE core.attractions (
     id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
     name TEXT NOT NULL,
     city TEXT,
     country TEXT,
     approved BOOLEAN DEFAULT false,
     audio_guides_count INTEGER DEFAULT 0,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
     updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
   );
   ```

2. **core.attraction_coordinate**
   ```sql
   CREATE TABLE core.attraction_coordinate (
     id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
     attraction_id UUID REFERENCES core.attractions(id) ON DELETE CASCADE,
     latitude DOUBLE PRECISION NOT NULL,
     longitude DOUBLE PRECISION NOT NULL,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
   );
   ```

3. **core.attraction_description**
   ```sql
   CREATE TABLE core.attraction_description (
     id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
     attraction_id UUID REFERENCES core.attractions(id) ON DELETE CASCADE,
     description TEXT,
     play_count INTEGER DEFAULT 0,
     last_played_at TIMESTAMP WITH TIME ZONE,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
     updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
   );
   ```

4. **core.attraction_image**
   ```sql
   CREATE TABLE core.attraction_image (
     id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
     attraction_id UUID REFERENCES core.attractions(id) ON DELETE CASCADE,
     image_url TEXT NOT NULL,
     alt_text TEXT,
     is_primary BOOLEAN DEFAULT false,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
   );
   ```

5. **core.saved_polygons**
   ```sql
   CREATE TABLE core.saved_polygons (
     id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
     name TEXT NOT NULL,
     polygon_data JSONB NOT NULL,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
     updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
   );
   ```

6. **core.attraction_analytics**
   ```sql
   CREATE TABLE core.attraction_analytics (
     id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
     attraction_id UUID REFERENCES core.attractions(id),
     latitude DOUBLE PRECISION,
     longitude DOUBLE PRECISION,
     event_type TEXT,
     listen_source TEXT,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
   );
   ```

### Materialized Views

1. **core.mv_attraction_stats**
   ```sql
   CREATE MATERIALIZED VIEW core.mv_attraction_stats AS
   SELECT 
     attraction_id,
     COUNT(*) as total_listens,
     COUNT(DISTINCT user_id) as unique_listeners,
     AVG(completion_rate) as avg_completion_rate,
     MAX(created_at) as last_interaction
   FROM core.attraction_analytics
   GROUP BY attraction_id;
   ```

## Authentication Setup

1. **Configure Supabase Auth**:
   - Enable email authentication in your Supabase project
   - Set up redirect URLs in authentication settings

2. **Set up admin users**:
   - Create users through Supabase Auth
   - Add `role: 'admin'` to user metadata in the auth.users table

3. **Row Level Security**:
   Set up RLS policies to protect your data:
   ```sql
   -- Enable RLS on all tables
   ALTER TABLE core.attractions ENABLE ROW LEVEL SECURITY;
   
   -- Create policy for authenticated admin users
   CREATE POLICY "Admin access" ON core.attractions
   FOR ALL USING (
     auth.jwt() ->> 'role' = 'admin'
   );
   ```

## Project Structure

```
tuggi-cms/
├── app/                    # Next.js App Router
│   ├── dashboard/         # Dashboard page
│   ├── login/            # Authentication
│   ├── pois/             # POI management
│   ├── regions/          # Region editor
│   ├── analytics/        # Analytics dashboard
│   └── globals.css       # Global styles
├── components/           # Reusable components
│   └── ui/              # UI components
├── lib/                 # Utilities and configurations
│   ├── supabase.ts      # Supabase client
│   └── utils.ts         # Helper functions
└── middleware.ts        # Authentication middleware
```

## Key Features

### 1. Dashboard
- Real-time KPIs (Total POIs, Approved POIs, Descriptions)
- Interactive charts showing POI distribution by city
- Approval rate visualization
- Quick action buttons

### 2. POI Management
- List view with search and filtering
- Bulk approval/rejection actions
- Individual POI editing
- Status toggles

### 3. POI Editor (To be implemented)
- Multi-language description support
- Interactive map for coordinate selection
- Image upload and management
- AI-powered description generation

### 4. Region Editor (To be implemented)
- Interactive polygon drawing
- Save and manage geographic regions
- Integration with city boundaries

### 5. Analytics (To be implemented)
- Detailed performance metrics
- User interaction data
- Listening statistics

## Environment Configuration

The application requires several environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key for admin operations
- `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET`: Storage bucket name for images

## Development

- `npm run dev`: Start development server
- `npm run build`: Build for production
- `npm run start`: Start production server
- `npm run lint`: Run ESLint

## Deployment

The application can be deployed to any platform that supports Next.js:

1. **Vercel** (Recommended):
   - Connect your repository to Vercel
   - Add environment variables
   - Deploy automatically

2. **Netlify**:
   - Build command: `npm run build`
   - Publish directory: `.next`

3. **Self-hosted**:
   - Build the application
   - Serve the `.next` directory

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is proprietary and confidential.

## Support

For support, please contact the development team or create an issue in the repository. 