import { getSupabase } from './core/supabase-client'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Server-side Supabase client
export const supabase = getSupabase('server')

// Client-side Supabase client for auth helpers
export const createClientComponent = () => createClientComponentClient()

// Database types
export interface CmsUser {
  id: string
  email: string
  full_name?: string
  role: 'admin' | 'editor' | 'viewer'
  is_active: boolean
  created_at: string
  last_login_at?: string
}

export interface Attraction {
  id: string
  name: string
  city: string
  country: string
  approved: boolean
  audio_guides_count: number
  created_at: string
  updated_at: string
}

export interface AttractionCoordinate {
  id: string
  attraction_id: string
  latitude: number
  longitude: number
  created_at: string
}

export interface AttractionDescription {
  id: string
  attraction_id: string
  language: string
  title: string
  description: string
  created_at: string
  updated_at: string
}

export interface AttractionImage {
  id: string
  attraction_id: string
  image_url: string
  alt_text?: string
  is_primary: boolean
  created_at: string
}

export interface SavedPolygon {
  id: string
  name: string
  paths: any // GeoJSON
  user_id: string
  created_at: string
  country_name?: string
}

export interface AttractionAnalytics {
  id: string
  attraction_id: string
  latitude: number
  longitude: number
  event_type: string
  listen_source: string
  created_at: string
}

export interface AttractionStats {
  attraction_id: string
  total_listens: number
  unique_listeners: number
  avg_completion_rate: number
  last_interaction: string
} 