-- Update user metadata to set admin role
-- Replace 'your-email@example.com' with the actual admin user email

UPDATE auth.users 
SET raw_user_meta_data = jsonb_set(
  COALESCE(raw_user_meta_data, '{}'),
  '{role}',
  '"admin"'
)
WHERE email = 'your-email@example.com';

-- Verify the update
SELECT email, raw_user_meta_data 
FROM auth.users 
WHERE email = 'your-email@example.com';