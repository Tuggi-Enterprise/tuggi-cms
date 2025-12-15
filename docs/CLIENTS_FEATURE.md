# Clients Feature - Documentation

## Overview

The Clients feature enables:
1. **Public Registration** - Businesses can register as clients through a public form
2. **Admin Approval** - Admins review and approve pending registrations
3. **Automatic CMS User Creation** - When approved, a CMS user with `client` role is automatically created
4. **User Management** - Client owners can link other CMS users to their client
5. **Driver Management** - Clients can link drivers (non-CMS users) to their operations

## Database Schema

### Tables Created

1. **`core.clients`** - Main client entity
   - `id` (UUID, PK)
   - `name` - Client business name
   - `email` - Contact email (unique)
   - `phone`, `company_name`, `address`, `city`, `state`, `country`, `postal_code`
   - `industry`, `website`
   - `status` - 'pending' | 'approved' | 'rejected'
   - `cms_user_id` - Reference to auto-created CMS user
   - `approved_by` - Reference to admin who approved
   - `approved_at`, `rejection_reason`
   - `created_at`, `updated_at`

2. **`core.client_cms_users`** - Junction table linking clients to CMS users
   - `id` (UUID, PK)
   - `client_id` - Reference to client
   - `cms_user_id` - Reference to CMS user
   - `client_role` - 'owner' | 'manager' | 'viewer'
   - `linked_by` - Reference to admin who created link
   - Unique constraint: `(client_id, cms_user_id)`

3. **`core.drivers`** - Non-CMS field users
   - `id` (UUID, PK)
   - `name`, `email`, `phone`
   - `license_number`, `license_type`
   - `current_location` (GEOGRAPHY)
   - `assigned_city`
   - `is_active` (boolean)
   - `created_at`, `updated_at`

4. **`core.client_drivers`** - Junction table linking clients to drivers
   - `id` (UUID, PK)
   - `client_id` - Reference to client
   - `driver_id` - Reference to driver
   - `status` - 'active' | 'inactive' | 'suspended'
   - `linked_by` - Reference to admin who created link

## API Endpoints

### Public Endpoints

#### `POST /api/clients/register`
Register a new client (no authentication required)

**Request:**
```json
{
  "name": "string (required)",
  "email": "string (required)",
  "phone": "string (optional)",
  "company_name": "string (optional)",
  "address": "string (optional)",
  "city": "string (optional)",
  "state": "string (optional)",
  "country": "string (optional)",
  "postal_code": "string (optional)",
  "industry": "string (optional)",
  "website": "string (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Client registration submitted successfully...",
  "client": {
    "id": "uuid",
    "name": "string",
    "email": "string",
    "status": "pending"
  }
}
```

### Admin Endpoints (role = 'admin')

#### `GET /api/clients/pending`
List pending client registrations

**Query Parameters:**
- `limit` (optional, default: 50)

**Response:**
```json
{
  "success": true,
  "clients": [Client[]],
  "total": number
}
```

#### `POST /api/clients/[clientId]/approve`
Approve a client registration and create associated CMS user

**Request:**
```json
{
  "cmsUserEmail": "string (required)",
  "cmsUserName": "string (required)"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Client approved successfully...",
  "client": {Client}
}
```

#### `POST /api/clients/[clientId]/reject`
Reject a client registration

**Request:**
```json
{
  "rejectionReason": "string (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Client registration rejected.",
  "client": {Client}
}
```

### Client/Admin Endpoints

#### `GET /api/clients/my-clients`
Get approved clients for the current user
- Admins can see all approved clients
- Clients can see only their own clients

**Response:**
```json
{
  "success": true,
  "clients": [Client[]],
  "total": number
}
```

#### `POST /api/clients/[clientId]/link-user`
Link a CMS user to a client (client owner or admin only)

**Request:**
```json
{
  "cmsUserId": "uuid (required)",
  "clientRole": "owner|manager|viewer (optional, default: viewer)"
}
```

**Response:**
```json
{
  "success": true,
  "message": "CMS user linked to client successfully",
  "link": {ClientCmsUser}
}
```

#### `POST /api/clients/[clientId]/link-driver`
Link a driver to a client - can create new or link existing

**Request (Option 1 - Create New):**
```json
{
  "driver": {
    "name": "string (required)",
    "email": "string (optional)",
    "phone": "string (optional)",
    "license_number": "string (optional)",
    "license_type": "string (optional)",
    "assigned_city": "string (optional)"
  }
}
```

**Request (Option 2 - Link Existing):**
```json
{
  "driverId": "uuid (required)"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Driver linked to client successfully",
  "link": {ClientDriver}
}
```

#### `GET /api/clients/[clientId]/users`
Get CMS users linked to a client

**Response:**
```json
{
  "success": true,
  "users": [
    {
      "id": "uuid",
      "client_id": "uuid",
      "cms_user_id": "uuid",
      "client_role": "owner|manager|viewer",
      "created_at": "timestamp",
      "cms_users": {
        "id": "uuid",
        "email": "string",
        "name": "string"
      }
    }
  ]
}
```

#### `GET /api/clients/[clientId]/drivers`
Get drivers linked to a client

**Response:**
```json
{
  "success": true,
  "drivers": [
    {
      "id": "uuid",
      "client_id": "uuid",
      "driver_id": "uuid",
      "status": "active|inactive|suspended",
      "created_at": "timestamp",
      "drivers": {Driver}
    }
  ]
}
```

## UI Pages

### Public Pages

#### `/client-registration`
Public client registration form
- No authentication required
- Simple form to register as a client
- Shows success message after submission

### Dashboard Pages

#### `/dashboard/client-approvals`
Admin-only panel to review and approve client registrations
- List of pending registrations
- Detailed view of each application
- Buttons to approve or reject
- When approving, specify CMS user email and name

#### `/dashboard/my-clients`
Client/Admin dashboard to manage clients and linked users/drivers
- List of approved clients
- View linked CMS users for each client
- View linked drivers for each client
- Add/remove linked users and drivers

## Components

### `ClientRegistrationForm`
Public registration form component
- Props: `onSuccess`, `onError`
- Collects all client information
- Validates email format
- Handles form submission

### `ClientApprovalPanel`
Admin approval management component
- Props: `onApprove`, `onReject`
- Lists pending clients
- Shows detailed client information
- Allows approval with CMS user creation
- Allows rejection with reason

### `ClientDashboard`
Client dashboard component
- Props: `clientId` (optional)
- Shows linked users with roles
- Shows linked drivers with status
- Allows removing links

## Workflow

### 1. Client Registration Flow
```
1. User fills public registration form (/client-registration)
2. Submission creates record in clients table with status='pending'
3. User sees success message
4. Admin reviews on /dashboard/client-approvals
5. Admin approves:
   - CMS user created with role='client'
   - clients.status updated to 'approved'
   - clients.cms_user_id linked to new CMS user
   - client_cms_users entry created with client_role='owner'
6. Admin can reject with reason
```

### 2. User Linking Flow
```
1. Client owner visits /dashboard/my-clients
2. Selects their client
3. Clicks "Link User"
4. Searches for CMS user by email
5. Selects user and role (owner/manager/viewer)
6. Entry created in client_cms_users
```

### 3. Driver Linking Flow
```
1. Client owner visits /dashboard/my-clients
2. Selects their client
3. Clicks "Link Driver"
4. Option A: Enter driver details to create new driver
5. Option B: Search and select existing driver
6. Entry created in client_drivers with status='active'
```

## Security

### Row Level Security (RLS)
All tables have RLS enabled with policies:

- **clients**: 
  - Admins can see all
  - Users can see only pending (for form) or their own approved
  - Public can insert (registration)

- **client_cms_users**: 
  - Admins can see all
  - Client owners can see linked users
  - Linked users can see the link

- **drivers**: 
  - Admins can see all
  - Clients can see linked drivers

- **client_drivers**: 
  - Admins can see all
  - Clients can see their linked drivers

## Types

All TypeScript types are defined in `/types/clients.ts`:
- `Client`
- `ClientStatus`
- `ClientRole`
- `ClientCmsUser`
- `Driver`
- `DriverStatus`
- `ClientDriver`
- Request/Response DTOs
- Component props interfaces

## Service

The `ClientService` class in `/lib/services/client-service.ts` provides:
- `registerClient()`
- `getPendingClients()`
- `getClientsByUser()`
- `getClientById()`
- `approveClient()` - Creates CMS user automatically
- `rejectClient()`
- `linkCmsUser()`
- `unlinkCmsUser()`
- `getClientCmsUsers()`
- `createDriver()`
- `linkDriver()`
- `unlinkDriver()`
- `getClientDrivers()`
- `searchDrivers()`

## Next Steps / Future Enhancements

1. **Email Notifications**
   - Send approval/rejection emails to client email
   - Notify client when users are added/removed

2. **Advanced Search**
   - Search drivers by license number
   - Filter clients by status, city, industry

3. **Bulk Operations**
   - Bulk approve/reject clients
   - Bulk link drivers

4. **Activity Logging**
   - Audit trail of approvals/rejections
   - Log of user/driver linkages

5. **Client Analytics**
   - Dashboard stats (total clients, active drivers, etc)
   - Client activity metrics

6. **Integration**
   - Link clients to existing POIs/Attractions
   - Assign driver routes/assignments
