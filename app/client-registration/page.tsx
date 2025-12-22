import { ClientRegistrationForm } from '@/components/clients/ClientRegistrationForm'
import ClientRegistrationWrapper from './client-registration-wrapper'

export default function ClientRegistrationPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Client Registration</h1>
          <p className="text-xl text-gray-600">
            Join our platform and manage your operations with ease
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8">
          <ClientRegistrationWrapper />
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg p-6 shadow">
            <h3 className="font-bold text-lg mb-2">📝 Easy Registration</h3>
            <p className="text-gray-600 text-sm">
              Simple and quick registration process
            </p>
          </div>
          <div className="bg-white rounded-lg p-6 shadow">
            <h3 className="font-bold text-lg mb-2">⚡ Fast Approval</h3>
            <p className="text-gray-600 text-sm">
              We review applications quickly
            </p>
          </div>
          <div className="bg-white rounded-lg p-6 shadow">
            <h3 className="font-bold text-lg mb-2">🔒 Secure</h3>
            <p className="text-gray-600 text-sm">
              Your data is safe with us
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
