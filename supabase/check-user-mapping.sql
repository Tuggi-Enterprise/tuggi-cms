-- Check the relationship between auth.users and core.cms_users
-- to understand how to map the IDs correctly

-- 1. Check if there's a relationship between auth.users and cms_users
SELECT 
    'Auth to CMS User Mapping' as check_type,
    au.id as auth_user_id,
    au.email as auth_email,
    cu.id as cms_user_id,
    cu.email as cms_email,
    cu.name as cms_name
FROM auth.users au
LEFT JOIN core.cms_users cu ON au.email = cu.email
WHERE au.id = '7f6a0516-4867-44c7-964a-2fd99fbdbb0f'
   OR cu.id = '4294eb5d-bbb6-4344-a6a7-5375532ffeaf';

-- 2. Check if there's a direct foreign key relationship
SELECT 
    'CMS Users Structure' as check_type,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_schema = 'core' 
  AND table_name = 'cms_users'
ORDER BY ordinal_position;

-- 3. Look for any auth_user_id or similar field in cms_users
SELECT 
    'CMS User with Auth ID' as check_type,
    *
FROM core.cms_users 
WHERE id = '4294eb5d-bbb6-4344-a6a7-5375532ffeaf';

-- 4. Check if there are any other users in cms_users that might match
SELECT 
    'All CMS Users' as check_type,
    id,
    email,
    name,
    created_at
FROM core.cms_users 
ORDER BY created_at DESC
LIMIT 5;
