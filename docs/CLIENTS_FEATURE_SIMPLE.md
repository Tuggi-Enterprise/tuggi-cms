# Clients Feature - Documentation

## Overview

The Clients feature enables:
1. **Public Registration** - Businesses can register as clients through a public form
2. **Admin Approval** - Admins review and approve pending registrations
3. **Automatic CMS User Creation** - When approved, a CMS user with `client` role is automatically created
4. **User Management** - Client owners can link other CMS users to their client

## Database Schema

### Tables Created

1. **`core.clients`** - Main client entity
   - Stores client information and registration status
   - Statuses: pending, approved, rejected
   - Links to the auto-created CMS user via `cms_user_id`

2. **`core.client_cms_users`** - Junction table linking clients to CMS users
   - Enables multiple CMS users to be associated with a client
   - Client roles: owner, manager, viewer
   - Tracks who linked the user and when

## API Endpoints

### 1. Public Registration

#### `POST /api/clients/register`
**No authentication required**

Register a new client (public endpoint)

```json
{
  "name": "ACME Corporation",
  "email": "contact@acme.com",
  "phone": "+1-555-0123",
  "company_name": "ACME Corp",
  "address": "123 Business St",
  "city": "New York",
  "state": "NY",
  "country": "USA",
  "postal_code": "10001",
  "industry": "Technology",
  "website": "https://acme.com"
}
```

Response:
```json
{
  "success": true,
  "message": "Registration submitted. Awaiting admin approval.",
  "client": {
    "id": "uuid",
    "name": "ACME Corporation",
    "email": "contact@acme.com",
    "status": "pending",
    "created_at": "2025-12-04T10:00:00Z"
  }
}
```

### 2. Admin Approval Workflow

#### `GET /api/clients/pending`
**Admin only**

Get list of pending client registrations

Response:
```json
{
  "success": true,
  "clients": [
    {
      "id": "uuid",
      "name": "ACME Corporation",
      "email": "contact@acme.com",
      "phone": "+1-555-0123",
      "company_name": "ACME Corp",
      "status": "pending",
      "created_at": "2025-12-04T10:00:00Z"
    }
  ]
}
```

#### `POST /api/clients/[clientId]/approve`
**Admin only**

Approve a client registration and create associated CMS user

```json
{
  "cmsUserEmail": "admin@acme.com",
  "cmsUserName": "Admin User"
}
```

Response:
```json
{
  "success": true,
  "message": "Client approved successfully. CMS user created.",
  "client": {
    "id": "uuid",
    "status": "approved",
    "cms_user_id": "uuid (new CMS user)",
    "approved_at": "2025-12-04T10:05:00Z"
  }
}
```

#### `POST /api/clients/[clientId]/reject`
**Admin only**

Reject a client registration with reason

```json
{
  "reason": "Incomplete company information"
}
```

Response:
```json
{
  "success": true,
  "message": "Client rejected",
  "client": {
    "id": "uuid",
    "status": "rejected",
    "rejection_reason": "Incomplete company information"
  }
}
```

### 3. Client Management

#### `GET /api/clients/my-clients`
**Authentication required (client or admin)**

Get clients owned or managed by current user

Response:
```json
{
  "success": true,
  "clients": [
    {
      "id": "uuid",
      "name": "ACME Corporation",
      "email": "contact@acme.com",
      "status": "approved",
      "cms_user_id": "uuid"
    }
  ]
}
```

#### `POST /api/clients/[clientId]/link-user`
**Client owner or Admin**

Link a CMS user to a client

```json
{
  "cmsUserId": "uuid",
  "clientRole": "manager"
}
```

Client roles:
- `owner` - Full access, can link/unlink users
- `manager` - Can view and manage operations
- `viewer` - Read-only access

Response:
```json
{
  "success": true,
  "message": "User linked to client successfully",
  "link": {
    "id": "uuid",
    "client_id": "uuid",
    "cms_user_id": "uuid",
    "client_role": "manager",
    "created_at": "2025-12-04T10:10:00Z"
  }
}
```

#### `GET /api/clients/[clientId]/users`
**Client owner or Admin**

Get CMS users linked to a client

Response:
```json
{
  "success": true,
  "users": [
    {
      "id": "uuid",
      "client_id": "uuid",
      "cms_user_id": "uuid",
      "client_role": "owner",
      "cms_users": {
        "id": "uuid",
        "email": "admin@acme.com",
        "name": "Admin User",
        "role": "client"
      },
      "created_at": "2025-12-04T10:05:00Z"
    }
  ]
}
```

## UI Components

### 1. ClientRegistrationForm
**File**: `components/clients/ClientRegistrationForm.tsx`

Public registration form component

Features:
- Email validation
- Form with 11 input fields
- Real-time error handling
- Success message on submission
- Loading state during submission

### 2. ClientApprovalPanel
**File**: `components/clients/ClientApprovalPanel.tsx`

Admin approval panel for pending clients

Features:
- Lists all pending clients
- Detailed client information display
- Approve workflow with CMS user creation
- Reject workflow with reason field
- Real-time state updates

### 3. ClientDashboard
**File**: `components/clients/ClientDashboard.tsx`

Client/Admin dashboard for managing clients and linked users

Features:
- Client selector dropdown
- List of linked CMS users
- Add/remove users
- Role management (owner, manager, viewer)

## Pages

### 1. Public Registration Page
**Route**: `/client-registration`

Public-facing registration page with hero section and registration form

### 2. Admin Approval Page
**Route**: `/dashboard/client-approvals`

Admin dashboard for reviewing and approving pending client registrations

### 3. Client Dashboard Page
**Route**: `/dashboard/my-clients`

Client/Admin dashboard for managing clients and linked users

## RLS (Row Level Security) Policies

The feature implements comprehensive RLS policies:

| Table | Policy | Access |
|-------|--------|--------|
| `clients` | Select | Admin (all) + Owner (own) |
| `clients` | Insert | Public (all) |
| `clients` | Update | Admin (all) + Owner (own) |
| `client_cms_users` | Select | Admin (all) + Owner + Linked user |
| `client_cms_users` | Insert | Admin (all) + Owner |

## Service Class

**File**: `lib/services/client-service.ts`

Centralized business logic for client operations

Methods:
- `registerClient(data)` - Public registration
- `getPendingClients(limit)` - Admin pending list
- `getClientsByUser(userId)` - User's clients
- `getClientById(clientId)` - Single client
- `approveClient(...)` - Creates CMS user
- `rejectClient(...)` - Rejects registration
- `linkCmsUser(...)` - Links CMS user
- `unlinkCmsUser(linkId)` - Unlinks CMS user
- `getClientCmsUsers(clientId)` - Fetch linked users

## Security Features

✅ RLS policies on all tables
✅ Authentication checks on protected endpoints
✅ Admin-only approval workflow
✅ Automatic role-based access control
✅ Email validation on registration
✅ Rejection reason tracking

## Workflow Example

### Client Registration to Access

```
1. Public visitor goes to /client-registration
2. Fills registration form → POST /api/clients/register
3. Client created with status='pending'
4. Admin receives notification (optional: implement later)
5. Admin visits /dashboard/client-approvals
6. Reviews client details
7. Enters CMS user email/name
8. Clicks "Approve" → POST /api/clients/{id}/approve
9. Database creates:
   - New cms_users record (role='client')
   - Updates client (status='approved', cms_user_id=<new-user>)
   - Creates client_cms_users (link with role='owner')
10. Email sent to new CMS user (optional: implement later)
11. Client logs in with new credentials
12. Can access /dashboard/my-clients
13. Can view and manage linked users
```

## Future Enhancements

- Email notifications on approval/rejection
- Bulk operations (approve multiple clients)
- Client activity audit logging
- Advanced filtering and search
- Client-specific settings and customization
- Analytics dashboard for clients

## Deployment

### Run Migration
```bash
cd /path/to/tuggi-cms
supabase db push
```

### Add Navigation Links
In your main navigation component, add:

```typescript
// For public
<a href="/client-registration">Register as Client</a>

// For admin
{isAdmin && <a href="/dashboard/client-approvals">Client Approvals</a>}

// For client/admin
<a href="/dashboard/my-clients">My Clients</a>
```

### Test the Feature

1. **Test public registration**
   - Go to `/client-registration`
   - Fill and submit form
   - Verify client appears in pending list

2. **Test admin approval**
   - Go to `/dashboard/client-approvals`
   - Select pending client
   - Enter CMS user email/name
   - Click "Approve"
   - Verify CMS user was created

3. **Test client login**
   - Use new CMS user credentials
   - Verify access to `/dashboard/my-clients`
   - Verify can see approved client

4. **Test user linking**
   - Link another CMS user to client
   - Verify appears in dashboard
   - Verify RLS controls access
