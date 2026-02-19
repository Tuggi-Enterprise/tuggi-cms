import { getSupabase } from './core/supabase-client'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { SupabaseClient } from '@supabase/supabase-js'

// Server-side Supabase client
export const supabase = new Proxy({} as SupabaseClient, {
  get: (target, prop) => {
    return (getSupabase('server') as any)[prop]
  }
})

// Client-side Supabase client for auth helpers
export const createClientComponent = () => createClientComponentClient()

// Database types
export interface CmsUser {
  id: string
  email: string
  full_name?: string
  role: 'admin' | 'client' | 'editor' | 'viewer'
  is_active: boolean
  created_at: string
  last_login_at?: string
  /** FK to clients table - only populated for users with role='client' */
  client_id?: string
  updated_at?: string

  /** Optional: populated by admin endpoints for UI */
  clients?: Array<{ id: string; name?: string; client_role?: string }>
  client_name?: string | null
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
  /** FK to clients table - indicates which client owns this POI */
  owner_id?: string
  /** FK to cms_users table - indicates who created this POI */
  created_by?: string
  /** User ID for backward compatibility - same as created_by */
  user_id?: string
  state?: string
  description?: string
  latitude?: number
  longitude?: number
  google_types?: string[]
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