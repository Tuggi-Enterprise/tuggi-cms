/**
 * POST /api/clients/register
 * 
 * Public endpoint for client registration
 * Creates a pending client registration awaiting admin approval
 */

import { NextRequest, NextResponse } from 'next/server'
import { ClientService } from '@/lib/services/client-service'
import { RegisterClientRequest } from '@/types/clients'

export async function POST(request: NextRequest) {
  try {
    const body: RegisterClientRequest = await request.json()

    // Validate required fields
    if (!body.name || !body.email) {
      return NextResponse.json(
        { error: 'Name and email are required' },
        { status: 400 }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(body.email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    console.log('📝 Registering new client:', { name: body.name, email: body.email })

    // Create the client registration
    const client = await ClientService.registerClient(body)

    console.log('✅ Client registered successfully:', { clientId: client.id, email: client.email })

    return NextResponse.json({
      success: true,
      message: 'Client registration submitted successfully. Awaiting admin approval.',
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
        status: client.status
      }
    }, { status: 201 })

  } catch (error) {
    console.error('❌ Error registering client:', error)
    return NextResponse.json(
      {
        error: 'Failed to register client',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
