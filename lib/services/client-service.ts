/**
 * Client Service - handles business logic for clients feature
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  Client,
  ClientStatus,
  RegisterClientRequest,
  ApproveClientRequest,
  LinkCmsUserRequest,
  ClientCmsUser
} from '@/types/clients'

const getSupabase = () => getSupabaseService()

export class ClientService {
  /**
   * Register a new client (public endpoint - no auth needed)
   */
  static async registerClient(data: RegisterClientRequest): Promise<Client> {
    // Map submitted data to cms_users fields (do NOT add new columns)
    const cmsUserPayload: any = {
      full_name: data.full_name || data.name,
      email: data.email,
      phone: data.phone || null,
      company_name: data.company_name || null,
      address: data.address || null,
      city: data.city || null,
      state: data.state || null,
      country: data.country || null,
      postal_code: data.postal_code || null,
      industry: data.industry || null,
      website: data.website || null,
      role: 'client',
      is_active: false
    }

    const res = await getSupabase()
      .schema('core')
      .from('cms_users')
      .insert([cmsUserPayload])
      .select()
      .single()

    // Log the raw response for debugging if something goes wrong
    // (helps identify RLS, validation or env issues)
    // eslint-disable-next-line no-console
    console.log('🔍 ClientService.registerClient (cms_users) response:', { res })

    const cmsUser = res.data
    const error = res.error

    if (error || !cmsUser) {
      const details = error ? (error.message || JSON.stringify(error)) : 'No cms_user returned from Supabase'
      if (res.status === 404) {
        throw new Error(`Failed to register client (cms_user): ${details}. Received 404 from Supabase - check NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and that the 'cms_users' table exists in the 'core' schema.`)
      }
      throw new Error(`Failed to register client (cms_user): ${details}`)
    }

    return cmsUser as any
  }

  /**
   * Get pending clients (admin only)
   */
  static async getPendingClients(limit = 50): Promise<Client[]> {
    const { data, error } = await getSupabase()
      .schema('partner')
      .from('clients')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      throw new Error(`Failed to fetch pending clients: ${error.message}`)
    }

    return (data || []) as Client[]
  }

  /**
   * Get all clients for a CMS user (client role)
   */
  static async getClientsByUser(userId: string): Promise<Client[]> {
    const supabase = getSupabase();

    // 1. Get clients where user is the direct owner/creator
    const { data: directClients, error: directError } = await supabase
      .schema('partner')
      .from('clients')
      .select('*')
      .eq('cms_user_id', userId);

    if (directError) {
      throw new Error(`Failed to fetch direct clients: ${directError.message}`);
    }

    // 2. Get client IDs where user is linked via client_cms_users
    const { data: linkedUserRecords, error: linkError } = await supabase
      .schema('partner')
      .from('client_cms_users')
      .select('client_id')
      .eq('cms_user_id', userId);

    if (linkError) {
      throw new Error(`Failed to fetch linked client records: ${linkError.message}`);
    }

    const linkedClientIds = linkedUserRecords?.map((r: { client_id: string }) => r.client_id) || [];

    if (linkedClientIds.length === 0) {
      return (directClients || []) as Client[];
    }

    // 3. Get the actual client records for the linked IDs
    const { data: linkedClients, error: linkedClientsError } = await supabase
      .schema('partner')
      .from('clients')
      .select('*')
      .in('id', linkedClientIds);

    if (linkedClientsError) {
      throw new Error(`Failed to fetch linked clients: ${linkedClientsError.message}`);
    }

    // 4. Merge and deduplicate
    const allClients = [...(directClients || []), ...(linkedClients || [])];
    const uniqueClients = Array.from(new Map(allClients.map(c => [c.id, c])).values());

    return uniqueClients as Client[];
  }

  /**
   * Get a single client by ID
   */
  static async getClientById(clientId: string): Promise<Client | null> {
    const { data, error } = await getSupabase()
      .schema('partner')
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to fetch client: ${error.message}`)
    }

    return (data || null) as Client | null
  }

  /**
   * Approve a client registration and create associated CMS user
   */
  static async approveClient(clientId: string, approverUserId: string, cmsUserEmail: string, cmsUserName: string): Promise<Client> {
    // RETRY-SAFE since #872: the portal approval calls this too, and a click that died halfway
    // must converge on the next one instead of failing on its own first write.
    const { data: current, error: readError } = await getSupabase()
      .schema('partner')
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single()
    if (readError || !current) {
      throw new Error(`Failed to read client: ${readError?.message ?? 'not found'}`)
    }
    if (current.status === 'approved' && current.cms_user_id) return current as Client

    // 1. CMS user with role 'client' — or the one an earlier attempt already created
    const cmsUserId = await ensureClientCmsUser(cmsUserEmail, cmsUserName)

    // 2. Update client with approval status and link to CMS user
    const { data: client, error: clientError } = await getSupabase()
      .schema('partner')
      .from('clients')
      .update({
        status: 'approved',
        cms_user_id: cmsUserId,
        approved_by: approverUserId,
        approved_at: new Date().toISOString()
      })
      .eq('id', clientId)
      .select()
      .single()

    if (clientError) {
      throw new Error(`Failed to approve client: ${clientError.message}`)
    }

    // 3. Link the CMS user as 'owner' of the client (UNIQUE (client_id, cms_user_id): a retry
    //    that finds the link already there is the same state)
    const { error: linkError } = await getSupabase()
      .schema('partner')
      .from('client_cms_users')
      .insert([
        {
          client_id: clientId,
          cms_user_id: cmsUserId,
          client_role: 'owner',
          linked_by: approverUserId
        }
      ])
    if (linkError && linkError.code !== '23505') {
      console.error('[clients] owner link not written', clientId, linkError.code)
    }

    return client as Client
  }

  /**
   * Reject a client registration
   */
  static async rejectClient(clientId: string, rejectionReason: string, rejecterUserId: string): Promise<Client> {
    const { data, error } = await getSupabase()
      .schema('partner')
      .from('clients')
      .update({
        status: 'rejected',
        rejection_reason: rejectionReason,
        approved_by: rejecterUserId,
        updated_at: new Date().toISOString()
      })
      .eq('id', clientId)
      .select()
      .single()

    if (error) {
      throw new Error(`Failed to reject client: ${error.message}`)
    }

    return data as Client
  }

  /**
   * Link a CMS user to a client
   */
  static async linkCmsUser(clientId: string, cmsUserId: string, userId: string, clientRole = 'viewer'): Promise<ClientCmsUser> {
    const { data, error } = await getSupabase()
      .schema('partner')
      .from('client_cms_users')
      .insert([
        {
          client_id: clientId,
          cms_user_id: cmsUserId,
          client_role: clientRole,
          linked_by: userId
        }
      ])
      .select()
      .single()

    if (error) {
      throw new Error(`Failed to link CMS user: ${error.message}`)
    }

    return data as ClientCmsUser
  }

  /**
   * Unlink a CMS user from a client
   */
  static async unlinkCmsUser(linkId: string): Promise<void> {
    const { error } = await getSupabase()
      .schema('partner')
      .from('client_cms_users')
      .delete()
      .eq('id', linkId)

    if (error) {
      throw new Error(`Failed to unlink CMS user: ${error.message}`)
    }
  }

  /**
   * Get CMS users linked to a client
   */
  static async getClientCmsUsers(clientId: string): Promise<(ClientCmsUser & { cms_user?: any })[]> {
    const { data, error } = await getSupabase()
      .schema('partner')
      .from('client_cms_users')
      .select('*, cms_users:cms_user_id(id, email, full_name, role)')
      .eq('client_id', clientId)

    if (error) {
      throw new Error(`Failed to fetch linked CMS users: ${error.message}`)
    }

    return (data || []) as any[]
  }
}

/**
 * The CMS user of an approved client. `core.cms_users.email` is UNIQUE: when the address already
 * has a `client` user (an earlier attempt of the same approval, or the same owner with a second
 * establishment) that user is reused; an address that belongs to staff is refused, never linked.
 */
async function ensureClientCmsUser(email: string, fullName: string): Promise<string> {
  const { data, error } = await getSupabase()
    .schema('core')
    .from('cms_users')
    .insert([{ email, full_name: fullName, role: 'client', is_active: true }])
    .select('id')
    .single()
  if (!error && data) return (data as { id: string }).id
  if (error?.code !== '23505') {
    throw new Error(`Failed to create CMS user: ${error?.message ?? 'no row'}`)
  }
  const { data: existing, error: lookupError } = await getSupabase()
    .schema('core')
    .from('cms_users')
    .select('id, role')
    .eq('email', email)
    .single()
  if (lookupError || !existing) {
    throw new Error(`Failed to read CMS user: ${lookupError?.message ?? 'not found'}`)
  }
  if ((existing as { role: string }).role !== 'client') {
    throw new Error('Failed to create CMS user: the e-mail belongs to a staff account')
  }
  return (existing as { id: string }).id
}
