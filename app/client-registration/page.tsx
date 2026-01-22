import { redirect } from 'next/navigation'

export default function Page() {
  // Consolidated: redirect legacy /client-registration to /client-signup
  redirect('/client-signup')
} 
