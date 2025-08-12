-- Test Feedback Data Access
-- This script tests if we can access feedback data from the dashboard

-- Check if the attraction_feedback table exists
SELECT 
  schemaname,
  tablename,
  tableowner
FROM pg_tables 
WHERE schemaname = 'drive' 
  AND tablename = 'attraction_feedback';

-- Check RLS status on attraction_feedback
SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables 
WHERE schemaname = 'drive' 
  AND tablename = 'attraction_feedback';

-- Check existing policies on attraction_feedback
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE schemaname = 'drive' 
  AND tablename = 'attraction_feedback';

-- Test direct count of feedbacks
SELECT COUNT(*) as total_feedbacks 
FROM drive.attraction_feedback;

-- Test feedback data from last 30 days
SELECT COUNT(*) as recent_feedbacks
FROM drive.attraction_feedback 
WHERE created_at >= NOW() - INTERVAL '30 days';

-- Test feedback types distribution
SELECT 
  feedback_type,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM drive.attraction_feedback), 2) as percentage
FROM drive.attraction_feedback 
GROUP BY feedback_type 
ORDER BY count DESC;

-- Test rating distribution
SELECT 
  rating,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM drive.attraction_feedback WHERE rating IS NOT NULL), 2) as percentage
FROM drive.attraction_feedback 
WHERE rating IS NOT NULL
GROUP BY rating 
ORDER BY rating;

-- Test audio quality rating distribution
SELECT 
  audio_quality_rating,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM drive.attraction_feedback WHERE audio_quality_rating IS NOT NULL), 2) as percentage
FROM drive.attraction_feedback 
WHERE audio_quality_rating IS NOT NULL
GROUP BY audio_quality_rating 
ORDER BY audio_quality_rating;

-- Test recent feedbacks with details
SELECT 
  af.id,
  af.feedback_type,
  af.rating,
  af.feedback_details,
  af.created_at,
  a.name as attraction_name,
  p.full_name as user_name
FROM drive.attraction_feedback af
LEFT JOIN core.attractions a ON af.attraction_id = a.id
LEFT JOIN drive.profiles p ON af.user_id = p.id
ORDER BY af.created_at DESC
LIMIT 10;

-- Test average rating
SELECT 
  AVG(rating) as avg_rating,
  COUNT(rating) as total_ratings
FROM drive.attraction_feedback 
WHERE rating IS NOT NULL;

-- Test feedback by attraction
SELECT 
  a.name as attraction_name,
  COUNT(af.id) as feedback_count,
  AVG(af.rating) as avg_rating
FROM drive.attraction_feedback af
LEFT JOIN core.attractions a ON af.attraction_id = a.id
GROUP BY a.id, a.name
ORDER BY feedback_count DESC
LIMIT 10;
