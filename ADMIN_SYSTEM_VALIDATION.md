# Admin System Validation Report

## ✅ Existing Infrastructure

### 1. Database Tables
- **`clients`** (core schema)
  - Columns: id, name, email, phone, company_name, address, city, state, country, postal_code, industry, website, status, rejection_reason, approved_by, cms_user_id, created_at, updated_at, approved_at, metadata, notes
  - Indexes: status, email, cms_user_id, created_at
  - RLS: Enabled (admin sees all, client sees own)

- **`cms_users`** (core schema)
  - Columns: id, email, full_name, role (admin|client|editor|viewer), is_active, created_at, last_login_at, client_id, updated_at, company_name, address, city, country
  - RLS: Enabled

- **`client_cms_users`** (junction table)
  - Columns: id, client_id, cms_user_id, client_role (owner|manager|viewer), created_at, linked_by
  - Unique constraint: (client_id, cms_user_id)
  - Indexes: client_id, cms_user_id, client_role
  - RLS: Enabled (admin sees all, client owner can see linked users, linked user can see link)

### 2. TypeScript Types
- **`Client`** - Full client entity with all fields
- **`CmsUser`** - Includes client_id for hierarchy
- **`ClientCmsUser`** - Link between client and cms_user
- **`ClientWithUsers`** - Extended client with cms_users array

All types in:
- `/types/clients.ts` - Client types
- `/lib/supabase.ts` - CmsUser, Attraction types

### 3. Service Layer
- **`ClientService`** (/lib/services/client-service.ts)
  - registerClient() - Public registration
  - getPendingClients() - Admin only
  - getClientsByUser() - Get user's clients
  - getClientById() - Get single client
  - approveClient() - Approval with CMS user creation
  - rejectClient() - Reject with reason
  - linkCmsUser() - Link CMS user to client
  - unlinkCmsUser() - Unlink
  - getClientCmsUsers() - Get linked users for client

### 4. API Routes (Existing)
**Client Management:**
- `GET /api/clients/pending` - List pending (admin only)
- `GET /api/clients/my-clients` - List user's clients (admin|client)
- `POST /api/clients/register` - Public registration
- `POST /api/clients/[clientId]/approve` - Approve and create CMS user (admin only)
- `POST /api/clients/[clientId]/reject` - Reject registration (admin only)
- `GET /api/clients/[clientId]/users` - Get linked users
- `POST /api/clients/[clientId]/link-user` - Link CMS user to client

**POI Management:**
- `GET|POST /api/clients/pois` - List/create POIs
- `PATCH|DELETE /api/clients/pois/[poiId]` - Update/delete POI

### 5. UI Components (Existing)
- **`ClientRegistrationForm`** - Public registration form
- **`ClientApprovalPanel`** - Admin approval interface for pending registrations
- **`ClientDashboard`** - Dashboard for managing clients and linked users

### 6. Pages (Existing)
- `/dashboard/client-approvals` - Admin panel for pending registrations
- `/dashboard/my-clients` - Dashboard for clients/admins
- `/client-signup` - Public registration

### 7. Roles & Authorization
- **`admin`** - Full access to all clients and users
- **`client`** - Can see only own clients and linked users
- **`editor`**, **`viewer`** - Other roles (not involved in client system)

All endpoints check role with:
```typescript
if (cmsUser.role !== 'admin') {
  return NextResponse.json({ error: 'Unauthorized - Admin only' }, { status: 403 })
}
```

## ❌ What's Missing (To Be Built)

### 1. Admin Management Routes
**NEW NEEDED:** `/dashboard/admin/clients` - CRUD interface for all clients
- List all clients (approved + pending) with search, pagination, filters
- Create new client (direct, not via registration)
- Edit existing client details
- Delete client (with validation: cannot delete if linked users exist)
- View client details with linked users list
- Quick actions: approve pending, reject, add user

### 2. Admin User Management Routes
**NEW NEEDED:** `/dashboard/admin/users` - CRUD interface for cms_users
- List all cms_users with role, status, client link
- Create new cms_user with email, password, role, client (for role='client')
- Edit cms_user fields (except client and role)
- Change password for user
- Activate/deactivate user
- Link/unlink user to client

### 3. API Endpoints for Admin
**NEW NEEDED:**
- `GET /api/admin/clients` - List all clients with pagination/search
- `POST /api/admin/clients` - Create client
- `PATCH /api/admin/clients/[clientId]` - Update client
- `DELETE /api/admin/clients/[clientId]` - Delete client (with linked users check)
- `GET /api/admin/users` - List all users with pagination/search
- `POST /api/admin/users` - Create cms_user
- `PATCH /api/admin/users/[userId]` - Update cms_user
- `DELETE /api/admin/users/[userId]` - Delete cms_user

### 4. Validations to Add
- Email uniqueness check before create/update
- Client immutability: Cannot change client_id after user creation
- Prevent deletion of client with linked users (use client_cms_users count)
- Password reset functionality for users
- Soft delete or archive for inactive users

### 5. UX Components
- Toast notifications (success, error, info)
- Confirmation dialogs (delete, important actions)
- Loading states for async operations
- Status badges (pending, approved, rejected, active, inactive)
- Breadcrumb navigation
- Search filters
- Pagination controls
- Empty states

### 6. UI Components to Create
- `AdminClientsList` - Table with clients, search, actions
- `ClientForm` - Create/edit client form
- `AdminUsersList` - Table with users, search, actions
- `UserForm` - Create/edit user form with client selector
- Breadcrumb component
- StatusBadge component (color-coded by status)

## Implementation Priority

1. **High Priority:** Admin clients CRUD page + API endpoints
2. **High Priority:** Admin users CRUD page + API endpoints with role validation
3. **Medium Priority:** Form validations and UX enhancements
4. **Medium Priority:** Toast and confirmation dialogs
5. **Low Priority:** Advanced filtering and export features

## Security Considerations

✅ **Already in place:**
- RLS policies on all tables
- Admin role check on all admin endpoints
- Service role key for privileged operations
- Email unique constraint on cms_users

⚠️ **To verify during implementation:**
- Email uniqueness validation before insert (catch constraint error)
- Client_id immutability check (prevent update of client_id)
- Deletion prevention (check client_cms_users count before delete)
- Password hashing if implementing password reset

## Database Validation Queries

```sql
-- Check clients table structure
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_schema = 'core' AND table_name = 'clients';

-- Check cms_users table structure
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_schema = 'core' AND table_name = 'cms_users';

-- Check client_cms_users junction table
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_schema = 'core' AND table_name = 'client_cms_users';

-- Check RLS policies
SELECT schemaname, tablename, policyname FROM pg_policies 
WHERE schemaname = 'core' AND tablename IN ('clients', 'cms_users', 'client_cms_users');
```
