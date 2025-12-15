/**
 * Client Service - handles business logic for clients feature
 */

import { createClient } from '@supabase/supabase-js'
import {
  Client,
  ClientStatus,
  RegisterClientRequest,
  ApproveClientRequest,
  LinkCmsUserRequest,
  ClientCmsUser
} from '@/types/clients'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

export class ClientService {
  /**
   * Register a new client (public endpoint - no auth needed)
   */
  static async registerClient(data: RegisterClientRequest): Promise<Client> {
    const { data: client, error } = await supabase
      .schema('core')
      .from('clients')
      .insert([
        {
          ...data,
          status: 'pending'
        }
      ])
      .select()
      .single()

    if (error) {
      throw new Error(`Failed to register client: ${error.message}`)
    }

    return client as Client
  }

  /**
   * Get pending clients (admin only)
   */
  static async getPendingClients(limit = 50): Promise<Client[]> {
    const { data, error } = await supabase
      .schema('core')
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
    const { data, error } = await supabase
      .schema('core')
      .from('clients')
      .select('*')
      .or(`cms_user_id.eq.${userId},id.in(select client_id from client_cms_users where cms_user_id=${userId})`)

    if (error) {
      throw new Error(`Failed to fetch clients: ${error.message}`)
    }

    return (data || []) as Client[]
  }

  /**
   * Get a single client by ID
   */
  static async getClientById(clientId: string): Promise<Client | null> {
    const { data, error } = await supabase
      .schema('core')
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
    // 1. Create CMS user with role 'client'
    const { data: cmsUser, error: cmsError } = await supabase
      .schema('core')
      .from('cms_users')
      .insert([
        {
          email: cmsUserEmail,
          name: cmsUserName,
          role: 'client',
          is_active: true
        }
      ])
      .select()
      .single()

    if (cmsError) {
      throw new Error(`Failed to create CMS user: ${cmsError.message}`)
    }

    // 2. Update client with approval status and link to CMS user
    const { data: client, error: clientError } = await supabase
      .schema('core')
      .from('clients')
      .update({
        status: 'approved',
        cms_user_id: cmsUser.id,
        approved_by: approverUserId,
        approved_at: new Date().toISOString()
      })
      .eq('id', clientId)
      .select()
      .single()

    if (clientError) {
      throw new Error(`Failed to approve client: ${clientError.message}`)
    }

    // 3. Link the CMS user as 'owner' of the client
    await supabase
      .schema('core')
      .from('client_cms_users')
      .insert([
        {
          client_id: clientId,
          cms_user_id: cmsUser.id,
          client_role: 'owner',
          linked_by: approverUserId
        }
      ])

    return client as Client
  }

  /**
   * Reject a client registration
   */
  static async rejectClient(clientId: string, rejectionReason: string, rejecterUserId: string): Promise<Client> {
    const { data, error } = await supabase
      .schema('core')
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
    const { data, error } = await supabase
      .schema('core')
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
    const { error } = await supabase
      .schema('core')
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
    const { data, error } = await supabase
      .schema('core')
      .from('client_cms_users')
      .select('*, cms_users:cms_user_id(id, email, name, role)')
      .eq('client_id', clientId)

    if (error) {
      throw new Error(`Failed to fetch linked CMS users: ${error.message}`)
    }

    return (data || []) as any[]
  }
}
