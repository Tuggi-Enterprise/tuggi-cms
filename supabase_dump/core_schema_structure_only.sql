-- TuggiDrive Core Schema Structure
-- Generated from core schema dump - Tables and relationships only
-- Date: 2025-06-30

-- ===========================================
-- SCHEMA ORGANIZATION
-- ===========================================

CREATE SCHEMA IF NOT EXISTS "core";
COMMENT ON SCHEMA "core" IS 'Shared data between TuggiDrive and TuggiWalk applications (POIs, attractions, city boundaries)';

CREATE SCHEMA IF NOT EXISTS "drive";
COMMENT ON SCHEMA "drive" IS 'TuggiDrive specific data (profiles, trips, subscriptions, user preferences)';

CREATE SCHEMA IF NOT EXISTS "walk";
COMMENT ON SCHEMA "walk" IS 'Future TuggiWalk specific data';

-- ===========================================
-- CORE SCHEMA TABLES (Shared Data)
-- ===========================================

-- City and Geographic Data
CREATE TABLE IF NOT EXISTS "core"."city_boundaries" (
    "osm_id" bigint NOT NULL,
    "name" text,
    "name_en" text,
    "boundary" text,
    "admin_level" integer,
    "admin_centre_node_id" bigint,
    "admin_centre_node_lat" double precision,
    "admin_centre_node_lng" double precision,
    "label_node_id" bigint,
    "label_node_lat" double precision,
    "label_node_lng" double precision,
    "geom" geometry(Geometry,4326),
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

-- Attractions (Points of Interest)
CREATE TABLE IF NOT EXISTS "core"."attractions" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "place_id" text,
    "approved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "city" text,
    "country" text,
    "image_url" text,
    "is_premium" boolean DEFAULT false,
    "label" text,
    "rating" numeric(3,2),
    "audio_guides_count" integer DEFAULT 0,
    "visits_count" bigint DEFAULT 0
);

-- Attraction Coordinates (Separate for optimization)
CREATE TABLE IF NOT EXISTS "core"."attraction_coordinate" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "attraction_id" uuid NOT NULL,
    "latitude" double precision NOT NULL,
    "longitude" double precision NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

-- Attraction Descriptions (Audio content)
CREATE TABLE IF NOT EXISTS "core"."attraction_description" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "attraction_id" uuid NOT NULL,
    "description" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "play_count" integer DEFAULT 0,
    "last_played_at" timestamp with time zone
);

-- Attraction Images
CREATE TABLE IF NOT EXISTS "core"."attraction_image" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "attraction_id" uuid NOT NULL,
    "image_url" text NOT NULL,
    "alt_text" text,
    "created_at" timestamp with time zone DEFAULT now()
);

-- Analytics for Attractions
CREATE TABLE IF NOT EXISTS "core"."attraction_analytics" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "attraction_id" uuid NOT NULL,
    "user_id" uuid,
    "event_type" text NOT NULL,
    "latitude" double precision,
    "longitude" double precision,
    "distance_km" double precision,
    "listen_source" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "session_id" uuid,
    "device_os" text,
    "device_model" text,
    "app_version" text
);

-- Saved Geographic Polygons
CREATE TABLE IF NOT EXISTS "core"."saved_polygons" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "geom" geometry(Polygon,4326) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now()
);

-- Schema Configuration
CREATE TABLE IF NOT EXISTS "core"."schema_config" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "key" text NOT NULL,
    "value" text,
    "description" text,
    "created_at" timestamp with time zone DEFAULT now()
);

-- ===========================================
-- DRIVE SCHEMA TABLES (TuggiDrive Specific)
-- ===========================================

-- User Profiles
CREATE TABLE IF NOT EXISTS "drive"."profiles" (
    "id" uuid NOT NULL,
    "email" text,
    "full_name" text,
    "avatar_url" text,
    "nickname" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "subscription_tier_id" uuid,
    "subscription_start_date" timestamp with time zone,
    "subscription_end_date" timestamp with time zone,
    "onboarding_completed" boolean DEFAULT false,
    "tutorial_completed" boolean DEFAULT false,
    "language_preference" text DEFAULT 'en'::text,
    "last_login_at" timestamp with time zone,
    "login_count" integer DEFAULT 0
);

-- User Preferences
CREATE TABLE IF NOT EXISTS "drive"."user_preferences" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "background_audio_enabled" boolean DEFAULT true,
    "notification_sound_enabled" boolean DEFAULT true,
    "auto_play_descriptions" boolean DEFAULT false,
    "preferred_audio_language" text DEFAULT 'en'::text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

-- Trip Sessions (User journeys)
CREATE TABLE IF NOT EXISTS "drive"."trip_sessions" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone,
    "start_latitude" double precision,
    "start_longitude" double precision,
    "end_latitude" double precision,
    "end_longitude" double precision,
    "created_at" timestamp with time zone DEFAULT now()
);

-- User Favorites
CREATE TABLE IF NOT EXISTS "drive"."user_favorites" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "attraction_id" uuid NOT NULL,
    "created_at" timestamp with time zone DEFAULT now()
);

-- Subscription Tiers
CREATE TABLE IF NOT EXISTS "drive"."subscription_tiers" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "price_monthly" numeric(10,2),
    "price_yearly" numeric(10,2),
    "duration_days" integer DEFAULT 30,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now()
);

-- User Subscriptions
CREATE TABLE IF NOT EXISTS "drive"."user_subscriptions" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "tier_id" uuid NOT NULL,
    "stripe_subscription_id" text,
    "is_active" boolean DEFAULT false,
    "starts_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

-- Stripe Pricing
CREATE TABLE IF NOT EXISTS "drive"."stripe_prices" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "stripe_price_id" text NOT NULL,
    "tier_id" uuid NOT NULL,
    "amount" integer NOT NULL,
    "currency" text DEFAULT 'usd'::text,
    "interval" text NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now()
);

-- Feature Limits per Tier
CREATE TABLE IF NOT EXISTS "drive"."feature_limits" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "tier_id" uuid NOT NULL,
    "feature_name" text NOT NULL,
    "is_enabled" boolean DEFAULT true,
    "monthly_limit" integer,
    "created_at" timestamp with time zone DEFAULT now()
);

-- User Feedback
CREATE TABLE IF NOT EXISTS "drive"."feedback" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid,
    "category" text NOT NULL,
    "subject" text,
    "message" text NOT NULL,
    "rating" integer,
    "status" text DEFAULT 'pending'::text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "user_email" text,
    "user_name" text,
    "device_info" jsonb,
    "app_version" text
);

-- Description Feedback
CREATE TABLE IF NOT EXISTS "drive"."description_feedback" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "description_id" uuid NOT NULL,
    "feedback_type" text NOT NULL,
    "comment" text,
    "created_at" timestamp with time zone DEFAULT now()
);

-- ===========================================
-- MATERIALIZED VIEWS (Performance)
-- ===========================================

-- Attraction Statistics (Cached)
CREATE MATERIALIZED VIEW "core"."mv_attraction_stats" AS
 SELECT a.id,
    a.name,
    a.city,
    a.country,
    count(aa.id) AS total_interactions,
    count(DISTINCT aa.user_id) AS unique_visitors,
    avg(aa.distance_km) AS avg_distance_km
   FROM (core.attractions a
     LEFT JOIN core.attraction_analytics aa ON (a.id = aa.attraction_id))
  GROUP BY a.id, a.name, a.city, a.country;

-- User Trip Summary (Cached)
CREATE MATERIALIZED VIEW "drive"."mv_user_trip_summary" AS
 SELECT ts.user_id,
    count(*) AS total_trips,
    min(ts.start_time) AS first_trip_date,
    max(ts.start_time) AS last_trip_date,
    avg(EXTRACT(epoch FROM (ts.end_time - ts.start_time))) AS avg_trip_duration_seconds
   FROM drive.trip_sessions ts
  WHERE (ts.end_time IS NOT NULL)
  GROUP BY ts.user_id;

-- ===========================================
-- PUBLIC VIEWS (Legacy Compatibility)
-- ===========================================

-- Public views maintain compatibility with existing code
CREATE OR REPLACE VIEW "public"."attractions" AS SELECT * FROM "core"."attractions";
CREATE OR REPLACE VIEW "public"."profiles" AS SELECT * FROM "drive"."profiles";
CREATE OR REPLACE VIEW "public"."trip_sessions" AS SELECT * FROM "drive"."trip_sessions";
CREATE OR REPLACE VIEW "public"."attraction_description" AS SELECT * FROM "core"."attraction_description";

-- ===========================================
-- KEY RELATIONSHIPS
-- ===========================================

-- Core Schema Relationships:
-- attractions → attraction_coordinate (1:1)
-- attractions → attraction_description (1:1) 
-- attractions → attraction_image (1:many)
-- attractions → attraction_analytics (1:many)

-- Drive Schema Relationships:
-- profiles → user_preferences (1:1)
-- profiles → user_subscriptions (1:many)
-- profiles → trip_sessions (1:many)
-- profiles → user_favorites (1:many)
-- subscription_tiers → user_subscriptions (1:many)
-- subscription_tiers → feature_limits (1:many)
-- subscription_tiers → stripe_prices (1:many)

-- Cross-Schema Relationships:
-- drive.profiles → core.attraction_analytics (user_id)
-- drive.user_favorites → core.attractions (attraction_id)
-- core.attraction_analytics → core.attractions (attraction_id) 