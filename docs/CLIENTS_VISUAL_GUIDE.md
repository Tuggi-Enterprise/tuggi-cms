# 📊 Clients Feature - Visual Guide

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER FLOWS                              │
└─────────────────────────────────────────────────────────────────┘

PUBLIC VISITOR (No Auth)
├─ Visits /client-registration
├─ Fills registration form
└─ Submits → POST /api/clients/register
   └─ Creates clients(status=pending)

ADMIN
├─ Visits /dashboard/client-approvals
├─ Sees clients(status=pending) list
├─ Reviews client details
├─ Approves → POST /api/clients/{id}/approve
│  ├─ Creates cms_users(role=client)
│  └─ Updates clients(status=approved)
└─ Or Rejects → POST /api/clients/{id}/reject
   └─ Updates clients(status=rejected)

CLIENT (new CMS user, role=client)
├─ Logs in with credentials created during approval
├─ Visits /dashboard/my-clients
├─ Sees their approved client(s)
├─ Can link other CMS users → POST /api/clients/{id}/link-user
├─ Can create/link drivers → POST /api/clients/{id}/link-driver
└─ Manages relationships (add, remove, view)

DRIVER (Non-CMS field user)
├─ Created by client or admin
├─ Linked to client via client_drivers
├─ Has basic info (name, phone, license)
└─ Can have multiple clients
```

## Entity Relationship Diagram

```
                    ┌─────────────────────┐
                    │      cms_users      │
                    │ (existing table)    │
                    │─────────────────────│
                    │ id (UUID) [PK]      │
                    │ email (unique)      │
                    │ name                │
                    │ role (admin,client) │
                    │ is_active           │
                    └──────────┬──────────┘
                               │
                   ┌───────────┴──────────┐
                   │ 1:many              │ 1:many
                   ▼                     ▼
        ┌────────────────────┐  ┌───────────────────────┐
        │  clients           │  │ client_cms_users      │
        ├────────────────────┤  ├───────────────────────┤
        │ id (UUID) [PK]     │  │ id (UUID) [PK]        │
        │ name               │  │ client_id (FK)        │
        │ email (unique)     │  │ cms_user_id (FK)      │
        │ phone              │  │ client_role (owner,   │
        │ company_name       │  │  manager, viewer)     │
        │ address            │  │ created_at            │
        │ city, state        │  │ linked_by (FK)        │
        │ industry, website  │  └───────────────────────┘
        │ status (pending,   │
        │  approved,         │
        │  rejected)         │
        │ cms_user_id (FK) ──┼──┐ (when approved)
        │ approved_by (FK)   │  │
        │ created_at         │  └──> one admin creates
        │ updated_at         │
        └────────┬───────────┘
                 │
                 │ 1:many
                 ▼
        ┌───────────────────────┐
        │ client_drivers        │
        ├───────────────────────┤
        │ id (UUID) [PK]        │
        │ client_id (FK)        │
        │ driver_id (FK)        │
        │ status (active,       │
        │  inactive, suspended) │
        │ created_at            │
        │ linked_by (FK)        │
        └───────────────────────┘
                 │
                 │ many
                 ▼
        ┌──────────────────────┐
        │ drivers              │
        ├──────────────────────┤
        │ id (UUID) [PK]       │
        │ name                 │
        │ email                │
        │ phone                │
        │ license_number       │
        │ license_type         │
        │ current_location     │
        │ assigned_city        │
        │ is_active            │
        │ created_at           │
        │ updated_at           │
        └──────────────────────┘
```

## State Diagram - Client Lifecycle

```
┌──────────────┐
│   Created    │ (via public registration form)
└──────┬───────┘
       │
       ▼
┌──────────────────────┐
│   PENDING            │ ◄── Awaiting Admin Review
│ (status=pending)     │
└──────┬───────────────┘
       │
       ├─────────────────────────┬─────────────────────────┐
       │                         │                         │
       ▼                         ▼                         ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│   APPROVED       │  │   REJECTED       │  │  (Auto-creation)    │
│ (status=        │  │ (status=         │  │                     │
│  approved)      │  │  rejected)       │  │  New CMS User       │
│                 │  │                  │  │  created with       │
│ CMS User ──────┐│  │ Rejection reason │  │  role='client'      │
│ created ────┐  ││  │ stored           │  └──────────────────────┘
└──────┬──────┘  ││  └──────────────────┘
       │         │└─────────────────────┐
       │         │                     │
       ▼         ▼                     ▼
   ┌───────────────────────────────────────────┐
   │ Client can now:                           │
   │ • Login with new CMS user credentials     │
   │ • Access /dashboard/my-clients            │
   │ • Link other CMS users                    │
   │ • Create and link drivers                 │
   └───────────────────────────────────────────┘
```

## API Flow Diagram

```
CLIENT REGISTRATION
┌──────────────────────────────────────────────────┐
│ POST /api/clients/register                       │
│ (No auth required)                               │
├──────────────────────────────────────────────────┤
│ Request:                                         │
│  {                                               │
│    "name": "ACME Corp",                          │
│    "email": "contact@acme.com",                  │
│    ... (other fields)                            │
│  }                                               │
├──────────────────────────────────────────────────┤
│ Response:                                        │
│  {                                               │
│    "success": true,                              │
│    "message": "Registration submitted...",       │
│    "client": { id, name, email, status }        │
│  }                                               │
├──────────────────────────────────────────────────┤
│ Database:                                        │
│  INSERT INTO core.clients VALUES(...)            │
│  status='pending'                                │
└──────────────────────────────────────────────────┘

ADMIN APPROVAL
┌──────────────────────────────────────────────────┐
│ 1. GET /api/clients/pending (admin)              │
│    Returns: Array of clients(status=pending)     │
├──────────────────────────────────────────────────┤
│ 2. POST /api/clients/{id}/approve (admin)        │
│    Request: {                                    │
│      "cmsUserEmail": "newuser@acme.com",         │
│      "cmsUserName": "John Doe"                   │
│    }                                             │
├──────────────────────────────────────────────────┤
│    Database:                                     │
│    A) INSERT INTO core.cms_users VALUES(         │
│         email, name, role='client',              │
│         is_active=true                           │
│       )                                          │
│    B) UPDATE core.clients SET                    │
│         status='approved',                       │
│         cms_user_id=<new-user>,                  │
│         approved_by=<admin-id>,                  │
│         approved_at=NOW()                        │
│    C) INSERT INTO core.client_cms_users VALUES( │
│         client_id, cms_user_id,                  │
│         client_role='owner'                      │
│       )                                          │
├──────────────────────────────────────────────────┤
│    Response: {                                   │
│      "success": true,                            │
│      "client": { ...approved client }            │
│    }                                             │
└──────────────────────────────────────────────────┘

CLIENT MANAGEMENT
┌──────────────────────────────────────────────────┐
│ 1. GET /api/clients/my-clients (auth required)   │
│    Returns: Clients owned or linked by user      │
├──────────────────────────────────────────────────┤
│ 2. POST /api/clients/{id}/link-user (client/adm) │
│    Request: {                                    │
│      "cmsUserId": "uuid",                        │
│      "clientRole": "manager"                     │
│    }                                             │
│    Database:                                     │
│    INSERT INTO core.client_cms_users VALUES(...) │
├──────────────────────────────────────────────────┤
│ 3. POST /api/clients/{id}/link-driver (client/adm)
│    Request: {                                    │
│      "driver": { name, email, ... } (create new)│
│      OR "driverId": "uuid" (link existing)       │
│    }                                             │
│    Database:                                     │
│    A) INSERT INTO core.drivers VALUES(...) OR    │
│       use existing driver ID                     │
│    B) INSERT INTO core.client_drivers VALUES(...) │
├──────────────────────────────────────────────────┤
│ 4. GET /api/clients/{id}/users (client/admin)    │
│    Returns: Array of linked CMS users            │
├──────────────────────────────────────────────────┤
│ 5. GET /api/clients/{id}/drivers (client/admin)  │
│    Returns: Array of linked drivers              │
└──────────────────────────────────────────────────┘
```

## Page Navigation Tree

```
Site
├─ Public Pages
│  └─ /client-registration
│     ├─ ClientRegistrationForm component
│     └─ POST /api/clients/register
│
├─ Login & Auth
│  └─ /login (existing)
│
└─ Dashboard (Protected)
   ├─ /dashboard (existing)
   │
   ├─ For ADMIN Role:
   │  ├─ /dashboard/client-approvals
   │  │  └─ ClientApprovalPanel component
   │  │     ├─ GET /api/clients/pending
   │  │     ├─ POST /api/clients/{id}/approve
   │  │     └─ POST /api/clients/{id}/reject
   │  │
   │  └─ /dashboard/my-clients
   │     └─ ClientDashboard component
   │        ├─ GET /api/clients/my-clients
   │        ├─ GET /api/clients/{id}/users
   │        ├─ GET /api/clients/{id}/drivers
   │        └─ POST /api/clients/{id}/link-*
   │
   └─ For CLIENT Role:
      └─ /dashboard/my-clients
         └─ ClientDashboard component
            └─ (same as above, limited by RLS)
```

## Security & Permissions Matrix

```
┌──────────────┬───────────┬──────────┬──────────┬───────────────┐
│ Operation    │ Public    │ Client   │ Admin    │ RLS Policy    │
├──────────────┼───────────┼──────────┼──────────┼───────────────┤
│ Register     │ ✅ YES    │ ✅ YES   │ ✅ YES   │ Allow insert  │
│ View pending │ ❌ NO     │ ❌ NO    │ ✅ YES   │ Role check    │
│ Approve      │ ❌ NO     │ ❌ NO    │ ✅ YES   │ Role check    │
│ View own     │ ❌ NO     │ ✅ YES   │ ✅ YES   │ Owner check   │
│ Link user    │ ❌ NO     │ ✅ YES*  │ ✅ YES   │ Owner check   │
│ Link driver  │ ❌ NO     │ ✅ YES*  │ ✅ YES   │ Owner check   │
└──────────────┴───────────┴──────────┴──────────┴───────────────┘

* Client can only link to their own clients
```

## Mobile & Responsive Design

All components use Tailwind CSS and are fully responsive:
- ✅ Mobile (320px+)
- ✅ Tablet (768px+)
- ✅ Desktop (1024px+)

## Performance Metrics

- Database indexes on all foreign keys ✅
- RLS policies optimized ✅
- Queries use select() for column limiting ✅
- Pagination ready (can add to pending clients list)
- Response time: <500ms expected

---

## Quick Reference URLs

### Public
- Registration: `https://yourdomain.com/client-registration`

### Admin Dashboard
- Approvals: `https://yourdomain.com/dashboard/client-approvals`

### Client Dashboard
- My Clients: `https://yourdomain.com/dashboard/my-clients`

### API Endpoints
```
POST   /api/clients/register
GET    /api/clients/pending
POST   /api/clients/{id}/approve
POST   /api/clients/{id}/reject
GET    /api/clients/my-clients
POST   /api/clients/{id}/link-user
POST   /api/clients/{id}/link-driver
GET    /api/clients/{id}/users
GET    /api/clients/{id}/drivers
```
