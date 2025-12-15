/**
 * Types for the Clients feature
 */

export type ClientStatus = 'pending' | 'approved' | 'rejected'
export type ClientRole = 'owner' | 'manager' | 'viewer'

/**
 * Client entity - represents a business/organization client
 */
export interface Client {
  id: string
  name: string
  email: string
  phone?: string
  company_name?: string
  address?: string
  city?: string
  state?: string
  country?: string
  postal_code?: string
  industry?: string
  website?: string
  status: ClientStatus
  rejection_reason?: string
  approved_by?: string
  cms_user_id?: string
  created_at: string
  updated_at: string
  approved_at?: string
  metadata?: Record<string, any>
  notes?: string
}

/**
 * Link between a Client and a CMS User
 */
export interface ClientCmsUser {
  id: string
  client_id: string
  cms_user_id: string
  client_role: ClientRole
  created_at: string
  linked_by?: string
}



/**
 * Request/Response DTOs
 */

export interface RegisterClientRequest {
  name: string
  email: string
  phone?: string
  company_name?: string
  address?: string
  city?: string
  state?: string
  country?: string
  postal_code?: string
  industry?: string
  website?: string
}

export interface ApproveClientRequest {
  clientId: string
  cmsUserEmail: string
  cmsUserName: string
}

export interface LinkCmsUserRequest {
  clientId: string
  cmsUserId: string
  clientRole?: ClientRole
}



/**
 * UI Component Props
 */

export interface ClientRegistrationFormProps {
  onSuccess?: (clientId: string) => void
  onError?: (error: string) => void
}

export interface ClientApprovalPanelProps {
  onApprove?: (clientId: string) => void
  onReject?: (clientId: string) => void
}

export interface ClientDashboardProps {
  clientId?: string
}
