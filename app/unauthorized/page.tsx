import { AlertCircle, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-tuggi-background dark:bg-gray-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="tuggi-card py-8 px-4 shadow-xl sm:px-10">
          <div className="flex flex-col items-center space-y-4">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/20">
              <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            
            <div className="text-center">
              <h1 className="text-2xl font-bold text-tuggi-text dark:text-white">
                Access Denied
              </h1>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                You don't have permission to access this resource.
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-500">
                Admin role is required to use this application.
              </p>
            </div>

            <div className="flex flex-col space-y-3 w-full">
              <Link
                href="/debug"
                className="tuggi-button-secondary w-full flex justify-center items-center px-4 py-2 rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors"
              >
                Debug User Info
              </Link>
              <Link
                href="/login"
                className="tuggi-button-primary w-full flex justify-center items-center px-4 py-2 rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 