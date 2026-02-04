# Quick Test Guide - Admin System

## ✅ Pre-Deployment Verification

### 1. Compile TypeScript
```bash
npm run build
# Or in VS Code: Ctrl+Shift+B → Select TypeScript
```
Should complete without errors.

### 2. Check File Structure
```bash
# Verify all new files exist
ls -la app/api/admin/clients/route.ts
ls -la app/api/admin/clients/[clientId]/route.ts
ls -la app/api/admin/users/route.ts
ls -la components/admin/ClientFormAdmin.tsx
ls -la app/dashboard/admin/clients/page.tsx
```

### 3. Verify Imports
All components should have:
- ✅ `'use client'` directive (client components)
- ✅ Correct relative imports
- ✅ No circular dependencies

---

## 🧪 Manual Test Scenarios

### Scenario 1: Create and List Clients

**Step 1:** Navigate to `/dashboard/admin/clients`
- Expected: Table with clients (may be empty)
- Expected: Search box visible
- Expected: Status filter visible
- Expected: "New Client" button visible

**Step 2:** Click "New Client" button
- Expected: Redirect to `/dashboard/admin/clients/new`
- Expected: Form with fields: name, email, phone, company_name, address, city, state, country, postal_code, industry, website, status, notes

**Step 3:** Fill form and submit
```json
{
  "name": "Test Company",
  "email": "test@company.com",
  "phone": "+1-555-0000",
  "company_name": "Test Corp",
  "city": "New York",
  "country": "USA",
  "status": "pending"
}
```
- Expected: Success toast
- Expected: Redirect to `/dashboard/admin/clients/[id]`

**Step 4:** Verify in list
- Navigate back to `/dashboard/admin/clients`
- Expected: New client appears in table
- Expected: User count = 0

---

### Scenario 2: Create User and Link to Client

**Step 1:** Navigate to `/dashboard/admin/users`
- Expected: Users table (may be empty initially)

**Step 2:** Click "New User"
- Expected: Redirect to `/dashboard/admin/users/new`

**Step 3:** Fill form with role='client'
```json
{
  "email": "manager@company.com",
  "full_name": "Manager Name",
  "password": "password123",
  "role": "client",
  "client_id": "[id-from-scenario-1]",
  "is_active": true
}
```
- Expected: Client dropdown loads when role='client' is selected
- Expected: Can select the test company

**Step 4:** Submit
- Expected: Success toast
- Expected: User created

**Step 5:** Link user to client
- Navigate to `/dashboard/admin/clients/[id]` (from scenario 1)
- Expected: "Add User" button visible
- Click "Add User"
- Expected: Form appears with user dropdown
- Select user from dropdown
- Select role: "manager"
- Click "Add"
- Expected: User appears in linked users table

---

### Scenario 3: Edit Client

**Step 1:** Go to `/dashboard/admin/clients`

**Step 2:** Click Edit button on a client

**Step 3:** Verify:
- Email field is DISABLED (immutable)
- Can change: name, phone, company_name, city, etc.
- Form has "Update Client" button instead of "Create"

**Step 4:** Change one field and submit
- Expected: Success toast
- Expected: Changes reflected in details page

---

### Scenario 4: Delete Client (Should Fail)

**Step 1:** Go to `/dashboard/admin/clients`

**Step 2:** Try to delete a client WITH linked users
- Click delete button
- Expected: Modal confirmation appears
- Click confirm
- Expected: ERROR message: "Cannot delete client with N linked user(s)"
- Expected: Client still in list

**Step 3:** Try to delete a client WITH NO users
- Go to `/dashboard/admin/clients/new`
- Create new client with unique email
- Go back to list
- Delete this new client (0 users)
- Expected: Success
- Expected: Client removed from list

---

### Scenario 5: Edit User (Immutable Fields)

**Step 1:** Go to `/dashboard/admin/users`

**Step 2:** Click Edit on any user

**Step 3:** Verify:
- Email field should be ENABLED (can change)
- Role field is DISABLED (immutable)
- client_id field is DISABLED (immutable)
- Can change: full_name, is_active, company_name, etc.

**Step 4:** Change one field and submit
- Expected: Success toast
- Expected: Changes reflected in list

---

### Scenario 6: Search and Filter

**Step 1:** Go to `/dashboard/admin/clients`

**Step 2:** Type in search box
- Type part of client name
- Expected: Table filters in real-time
- Expected: Only matching clients shown

**Step 3:** Filter by status
- Select "approved"
- Expected: Only approved clients shown
- Select "pending"
- Expected: Only pending clients shown

**Step 4:** Pagination
- If > 10 clients, pagination buttons appear
- Expected: Clicking next loads page 2
- Expected: Page indicator shows correct page

---

### Scenario 7: Error Scenarios

**Test 1: Duplicate Email**
- Create client with email: test@example.com
- Try to create another with same email
- Expected: Error: "Email already exists"

**Test 2: Missing Required Fields**
- Try to submit client form without name
- Expected: Error: "Name is required"

**Test 3: Invalid Email Format**
- Try to submit with email: "notanemail"
- Expected: Error: "Invalid email format"

**Test 4: User without Client (if role=client)**
- Try to create user with role=client but no client selected
- Expected: Error: "Client is required for client role"

---

### Scenario 8: Non-Admin Access

**Step 1:** Login with non-admin user (if available)

**Step 2:** Try to access `/dashboard/admin/clients`
- Expected: Redirect to `/unauthorized`

**Step 3:** Try to call API directly
```bash
curl -H "Authorization: Bearer [token]" \
  http://localhost:3000/api/admin/clients
```
- Expected: 403 Forbidden error

---

## 🔍 Database Verification

After testing, verify data in database:

```sql
-- Check clients were created
SELECT id, name, email, status FROM core.clients 
WHERE email LIKE 'test%' 
ORDER BY created_at DESC LIMIT 5;

-- Check users were created
SELECT id, email, role, client_id FROM core.cms_users 
WHERE email LIKE 'test%' OR email LIKE '%manager%'
ORDER BY created_at DESC LIMIT 5;

-- Check links were created
SELECT * FROM core.client_cms_users LIMIT 5;

-- Count by status
SELECT status, COUNT(*) FROM core.clients GROUP BY status;

-- Count by role
SELECT role, COUNT(*) FROM core.cms_users GROUP BY role;
```

---

## 📊 Expected Test Results

After completing all scenarios, you should have:
- ✅ 1-3 test clients created
- ✅ 1-3 test users created
- ✅ 1-2 user-to-client links
- ✅ All CRUD operations working
- ✅ Search and filters working
- ✅ Validations working
- ✅ Immutable fields protected
- ✅ Delete protection working

---

## 🐛 Troubleshooting

### "Cannot find module" errors
- Run `npm install`
- Check import paths are relative: `@/components/admin/...`

### "Admin only" 403 errors
- Verify logged-in user has role='admin'
- Check cms_user.is_active = true
- Verify email matches session.user.email

### Form not submitting
- Check browser console for JS errors
- Verify API endpoint URL is correct
- Check NEXT_PUBLIC_SUPABASE_URL env var

### Email already exists error
- Clear browser cache
- Use unique email for test
- Check database directly for duplicates

### Client_id immutable errors
- This is expected behavior
- Email field is also immutable (disabled)
- Cannot change role or client_id after creation

---

## ✅ Go/No-Go Checklist

Before marking as ready:

- [ ] TypeScript compiles without errors
- [ ] All 18 new files exist in file system
- [ ] Can access `/dashboard/admin/clients` without auth error
- [ ] Can create a new client
- [ ] Can edit a client (except email)
- [ ] Can create a new user
- [ ] Can link user to client
- [ ] Can unlink user from client
- [ ] Search functionality works
- [ ] Pagination works if applicable
- [ ] Delete with confirmation works
- [ ] Error messages display correctly
- [ ] Email uniqueness validation works
- [ ] Non-admin users cannot access
- [ ] No console errors or warnings

---

## 🚀 When Ready for Production

1. Run through all test scenarios
2. Verify database has clean test data
3. Test with real-world email addresses
4. Test with multiple admins simultaneously
5. Verify RLS policies work end-to-end
6. Load test with 100+ clients/users
7. Test on mobile/tablet
8. Deploy to staging environment
9. Run production smoke tests
10. Enable monitoring/logging

---

**Happy Testing! 🎉**
