import Link from 'next/link'
import { ArrowRight, Clock3, Mail, ShieldCheck, Sparkles } from 'lucide-react'
import { ClientRegistrationForm } from '@/components/clients/ClientRegistrationForm'

export default function ClientSignupPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="max-w-6xl mx-auto px-4 py-16">
        <div className="grid lg:grid-cols-5 gap-12 items-start">
          <div className="lg:col-span-2 space-y-6">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-xs uppercase tracking-[0.2em] text-slate-200">
              <Sparkles className="h-4 w-4" /> Novo cliente CMS
            </span>
            <div className="space-y-4">
              <h1 className="text-4xl font-semibold leading-tight">Crie sua conta de cliente</h1>
              <p className="text-slate-200 text-lg leading-relaxed">
                Envie seus dados para liberar o acesso ao CMS. A equipe valida rapidamente e devolve com as credenciais aprovadas para que você gerencie seus pontos de interesse com segurança.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 shadow-lg">
                <div className="flex items-center gap-3 mb-2 text-sm font-semibold">
                  <ShieldCheck className="h-4 w-4 text-emerald-300" />
                  Aprovação segura
                </div>
                <p className="text-slate-300 text-sm">
                  Revisamos manualmente para manter o acesso restrito apenas a equipes autorizadas.
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 shadow-lg">
                <div className="flex items-center gap-3 mb-2 text-sm font-semibold">
                  <Clock3 className="h-4 w-4 text-amber-300" />
                  Retorno rápido
                </div>
                <p className="text-slate-300 text-sm">
                  Você recebe a confirmação por e-mail assim que sua conta estiver pronta.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
              <Mail className="h-4 w-4 text-slate-200" />
              Precisa de ajuda? Fale com o suporte em <span className="font-medium text-white">support@tuggi.app</span>
            </div>

            <div className="text-sm text-slate-300">
              Já tem acesso?{' '}
              <Link href="/login" className="inline-flex items-center gap-1 font-semibold text-amber-300 hover:text-amber-200 transition">
                Ir para login <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="bg-white rounded-2xl shadow-2xl p-8 text-slate-900">
              <div className="mb-6">
                <h2 className="text-2xl font-semibold text-slate-900">Dados da empresa</h2>
                <p className="text-sm text-slate-600">Usaremos essas informações para validar e configurar sua conta de cliente.</p>
              </div>
              <ClientRegistrationForm />
              <p className="mt-4 text-xs text-slate-500">
                Ao enviar você declara ter permissão para representar a empresa e concorda com a política de uso seguro do CMS.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
