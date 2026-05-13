-- Migration: Drop automatic premium trial for new users
-- Date: 2026-05-12
-- Description:
--   Phase 6 of the onboarding CRO redesign (in tuggi-drive-v2) made the
--   Premium trial an explicit, post-aha opt-in. The trigger that silently
--   granted a 24h Premium trial to every newly-inserted profile is now
--   incompatible with that design: net-new users would be born Premium and
--   our `useTrialOffer` modal (which gates on `tier_name === 'free'`) would
--   never fire for them.
--
--   This migration drops the trigger and its underlying function. The
--   welcome push that the function enqueued is removed as well; the
--   activation modal in-app replaces that touchpoint at a stronger
--   emotional moment.
--
--   See `tuggi-drive-v2/supabase/migrations/20260512110359_activate_trial_premium.sql`
--   and `20260512113757_fix_activate_trial_eligibility.sql` for the
--   counterpart RPC and the eligibility rule.

DROP TRIGGER IF EXISTS tr_on_user_created_premium_trial ON drive.profiles;
DROP FUNCTION IF EXISTS drive.apply_new_user_premium_trial();
