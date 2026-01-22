/**
 * Integration Guide for Clients Feature
 * 
 * This file shows where to add links/buttons to your main navigation
 * and layout components
 */

/*
=== NAVIGATION UPDATES ===

Add these links to your main navigation/sidebar:

For ADMIN users:
- /dashboard/client-approvals (📋 Client Approvals)
  Shows pending client registrations for review

For CLIENT users:
- /dashboard/my-clients (👥 My Clients)
  Manage their client(s) and linked users/drivers

For PUBLIC (unauthenticated):
- /client-signup (📝 Register as Client)
  Public registration form


=== MIDDLEWARE/REDIRECT RULES ===

If you want to auto-route new client users after CMS user creation:
- Users with role='client' might land on /dashboard/my-clients
- Users with role='admin' might see /dashboard/client-approvals in their menu


=== EXAMPLE NAVIGATION IMPLEMENTATION ===

In your layout or nav component, check the user's CMS role:

```tsx
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

async function MainNav() {
  const supabase = createServerComponentClient({ cookies })
  const { data: { session } } = await supabase.auth.getSession()
  
  let cmsUserRole: string | null = null
  
  if (session) {
    const { data: user } = await supabase
      .schema('core')
      .from('cms_users')
      .select('role')
      .eq('email', session.user.email)
      .single()
    cmsUserRole = user?.role || null
  }

  return (
    <nav className="flex gap-4">
      {/* Existing links... */}
      
      {/* Client Feature Links */}
      {cmsUserRole === 'admin' && (
        <>
          <a href="/dashboard/client-approvals" className="nav-link">
            📋 Client Approvals
          </a>
          <a href="/dashboard/my-clients" className="nav-link">
            👥 All Clients
          </a>
        </>
      )}
      
      {cmsUserRole === 'client' && (
        <a href="/dashboard/my-clients" className="nav-link">
          👥 My Clients
        </a>
      )}
      
      {!session && (
        <a href="/client-registration" className="nav-link">
          📝 Register as Client
        </a>
      )}
    </nav>
  )
}
```


=== QUICK START CHECKLIST ===

1. ✅ Run migration to create tables:
   supabase db push

2. ✅ Import components where needed:
   - ClientRegistrationForm
   - ClientApprovalPanel
   - ClientDashboard

3. ✅ Add pages (already created):
   - /client-registration
   - /dashboard/client-approvals
   - /dashboard/my-clients

4. ✅ Update navigation menu with links above

5. ✅ Test workflow:
   - Register client via /client-registration
   - Approve from /dashboard/client-approvals
   - Verify CMS user was created
   - Login as new client user
   - Verify can see /dashboard/my-clients

6. ✅ Test linking users/drivers:
   - As admin: link other users to client
   - As client: view linked users
   - Add new drivers and link them


=== API TESTING (curl examples) ===

# Register new client
curl -X POST http://localhost:3000/api/clients/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ACME Corp",
    "email": "contact@acme.com",
    "phone": "+55 11 99999-9999",
    "company_name": "ACME Corporation",
    "city": "São Paulo",
    "state": "SP",
    "country": "Brazil"
  }'

# Get pending clients (admin auth required)
curl http://localhost:3000/api/clients/pending

# Approve client
curl -X POST http://localhost:3000/api/clients/{clientId}/approve \
  -H "Content-Type: application/json" \
  -d '{
    "cmsUserEmail": "newuser@acme.com",
    "cmsUserName": "John Doe"
  }'

# Link CMS user to client
curl -X POST http://localhost:3000/api/clients/{clientId}/link-user \
  -H "Content-Type: application/json" \
  -d '{
    "cmsUserId": "uuid-of-cms-user",
    "clientRole": "manager"
  }'

# Create and link driver
curl -X POST http://localhost:3000/api/clients/{clientId}/link-driver \
  -H "Content-Type: application/json" \
  -d '{
    "driver": {
      "name": "Carlos Silva",
      "email": "carlos@acme.com",
      "phone": "+55 11 98888-8888",
      "assigned_city": "São Paulo"
    }
  }'


=== FILE STRUCTURE CREATED ===

/supabase/migrations/20251204_create_clients_feature.sql
/types/clients.ts
/lib/services/client-service.ts
/app/api/clients/register/route.ts
/app/api/clients/pending/route.ts
/app/api/clients/[clientId]/approve/route.ts
/app/api/clients/[clientId]/reject/route.ts
/app/api/clients/my-clients/route.ts
/app/api/clients/[clientId]/link-user/route.ts
/app/api/clients/[clientId]/link-driver/route.ts
/app/api/clients/[clientId]/users/route.ts
/app/api/clients/[clientId]/drivers/route.ts
/components/clients/ClientRegistrationForm.tsx
/components/clients/ClientApprovalPanel.tsx
/components/clients/ClientDashboard.tsx
/app/client-registration/page.tsx
/app/dashboard/client-approvals/page.tsx
/app/dashboard/my-clients/page.tsx
/docs/CLIENTS_FEATURE.md


=== SUPPORT & DEBUGGING ===

If you encounter issues:

1. Check logs in /app/api/clients/*/route.ts (console.log statements)
2. Verify CMS user was created in Supabase core.cms_users table
3. Check RLS policies are properly applied
4. Ensure client role exists in cms_users_role_check constraint
5. Verify Supabase auth session is valid

Common issues:
- "cms_users_role_check" error → role 'client' not in constraint
  Solution: Run migration to add 'client' to CHECK constraint
- "RLS policy error" → User trying to access data they shouldn't
  Solution: Verify RLS policies are correctly set up
- "CMS user creation failed" → Email already exists
  Solution: Use unique email for CMS user creation
*/
