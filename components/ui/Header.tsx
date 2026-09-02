'use client'

/**
 * A barra de navegação do CMS.
 *
 * ELA NÃO DECIDE NADA. Quem monta a árvore é `lib/navigation/menu.ts`, e quem decide quem entra
 * onde é `lib/navigation/access.ts` — o mesmo módulo que `proxy.ts` consulta. Este arquivo
 * desenha, e desenha duas vezes (barra e gaveta do celular) a partir da MESMA árvore.
 *
 * Antes de 2026-09-01 ele fazia as três coisas: montava a lista, decidia visibilidade com
 * condições próprias (`isAdmin`, `!isCoordinator`, ...) e mantinha uma segunda árvore à mão para
 * o celular. As três davam problema ao mesmo tempo:
 *
 *  · o menu discordava do portão — um `editor` via "Dashboard", "Pontos de Interesse" e "Rotas
 *    Customizadas", e os três respondiam `/unauthorized`;
 *  · a árvore mobile já tinha apodrecido, com um ternário cujo primeiro ramo era inalcançável e
 *    o segundo era identidade — resíduo de uma versão anterior que ninguém tinha como notar;
 *  · o componente refazia o `useCmsUser` inteiro: próprio `useState`, próprio `fetch` de
 *    `/api/auth/check`, próprio cálculo de `isAdmin` (com `super_admin`, valor que
 *    `lib/hooks/useCmsUser.ts` documenta ser inalcançável no CHECK da tabela).
 *
 * O QUE SOBROU AQUI é o que de fato é desenho: estado de aberto/fechado, o "você está aqui", e
 * o comportamento de teclado dos painéis.
 */

import { useState, useEffect, useRef, useId } from 'react'
import { Link, usePathname, useRouter } from '@/navigation'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { useTheme } from '@/app/[locale]/providers'
import { useTranslations } from 'next-intl'
import { LogOut, Menu, X, Moon, Sun, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { buildNavTree, type NavGroup, type NavItem } from '@/lib/navigation/menu'
import { TuggiLogo } from './TuggiLogo'
import { LanguageSwitcher } from './LanguageSwitcher'

/**
 * `pathname` está DENTRO de `href`?
 *
 * Compara por segmento, e não por prefixo de string: sem o `/`, `/pois` acenderia em
 * `/poi-importer`. Antes desta versão os itens de dropdown comparavam com `===`, então em
 * `/pois/abc123`, `/routes/new` ou na ficha de um parceiro NENHUM item acendia — o "você está
 * aqui" sumia justamente nas telas de detalhe, onde o operador passa mais tempo.
 */
function contains(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function Header({ className }: { className?: string }) {
  const t = useTranslations('Navigation')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const pathname = usePathname()
  const supabase = useSupabaseClient()
  const router = useRouter()
  const { theme, toggleTheme } = useTheme()

  const { role, enabledModules, isCoordinator, isLoading } = useCmsUser()

  // Enquanto a identidade não chegou, a árvore é vazia — e vazia é a resposta certa: renderizar
  // um palpite e corrigir depois é o que produzia o "Dashboard" quebrado para quem não é client.
  const tree = isLoading
    ? { primary: [], groups: [] }
    : buildNavTree({ role, enabledModules, isCoordinator })

  /**
   * O item aceso é o de href MAIS LONGO que contém o caminho atual.
   *
   * O desempate importa: `/dashboard/reports/users` e `/dashboard` casariam os dois, e sem a
   * regra do mais longo o grupo errado acenderia.
   */
  const everyHref = [
    ...tree.primary.map((i) => i.href),
    ...tree.groups.flatMap((g) => g.sections.flatMap((s) => s.items.map((i) => i.href))),
  ]
  const activeHref = everyHref
    .filter((href) => contains(pathname, href))
    .sort((a, b) => b.length - a.length)[0]

  const groupIsActive = (group: NavGroup) =>
    group.sections.some((s) => s.items.some((i) => i.href === activeHref))

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (openDropdown && !(event.target as Element).closest('.dropdown-container')) {
        setOpenDropdown(null)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [openDropdown])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const navLink = (item: NavItem, onClick?: () => void) => {
    // REALCE e ARIA-CURRENT nao sao a mesma pergunta. O realce segue o casamento mais LONGO,
    // para o item continuar aceso numa tela de detalhe (`/pois/abc`). Mas `aria-current="page"`
    // afirma que ESTA e a pagina, e em `/dashboard/my-clients` — pagina real, fora do menu — o
    // casamento mais longo e `/dashboard`, que nao e onde o usuario esta.
    const isActive = item.href === activeHref
    const isExactPage = pathname === item.href
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isExactPage ? 'page' : undefined}
        className={cn(
          'flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-all duration-300 relative group overflow-hidden',
          isActive
            ? 'bg-tuggi-blue/10 text-tuggi-blue shadow-sm ring-1 ring-tuggi-blue/20'
            : 'text-tuggi-text dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:text-tuggi-blue dark:hover:text-tuggi-blue hover:shadow-sm'
        )}
        onClick={onClick}
      >
        <item.icon
          className={cn(
            'h-4 w-4 mr-2 shrink-0 transition-all duration-300',
            isActive ? 'scale-110 text-tuggi-blue' : 'group-hover:scale-110 group-hover:text-tuggi-blue'
          )}
          aria-hidden="true"
        />
        <span className="relative z-10">{t(item.labelKey)}</span>
        {isActive && (
          <div className="absolute inset-0 bg-gradient-to-r from-tuggi-blue/5 to-transparent" aria-hidden="true" />
        )}
      </Link>
    )
  }

  return (
    <header
      className={cn(
        'bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-tuggi-border/50 dark:border-gray-700/50 shadow-sm sticky top-0 z-50 transition-all duration-300',
        className
      )}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex-shrink-0 flex items-center">
            <TuggiLogo size="sm" showText={true} />
            <div className="flex items-center ml-2 pl-2 border-l border-gray-200 dark:border-gray-700">
              <span className="text-lg md:text-xl font-bold text-gray-900 dark:text-white tracking-tight">
                Studio
              </span>
            </div>
          </div>

          <nav className="hidden lg:flex items-center space-x-1" aria-label={t('main_navigation')}>
            {tree.primary.map((item) => navLink(item))}
            {tree.primary.length > 0 && tree.groups.length > 0 && (
              <div className="h-6 w-px bg-gray-200 dark:bg-gray-800 mx-2" aria-hidden="true" />
            )}
            {tree.groups.map((group) => (
              <Dropdown
                key={group.id}
                group={group}
                label={t(group.labelKey)}
                isOpen={openDropdown === group.id}
                isActive={groupIsActive(group)}
                activeHref={activeHref}
                onToggle={() => setOpenDropdown(openDropdown === group.id ? null : group.id)}
                onClose={() => setOpenDropdown(null)}
                t={t}
              />
            ))}
          </nav>

          <div className="flex items-center space-x-1">
            <LanguageSwitcher />
            {/* Os três botões abaixo eram `<button>` com só um ícone dentro: sem `aria-label`,
                sem texto, sem `title`. Para leitor de tela, três botões chamados "botão" —
                falha de WCAG 2.1 SC 4.1.2. As chaves `logout` e `toggle_theme` já existiam
                traduzidas nos três idiomas e não eram usadas em lugar nenhum. */}
            <button
              onClick={toggleTheme}
              aria-label={t('toggle_theme')}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-all duration-300 hover:scale-105"
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4 text-gray-600 dark:text-gray-400" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4 text-gray-600 dark:text-gray-400" aria-hidden="true" />
              )}
            </button>
            <button
              onClick={handleLogout}
              aria-label={t('logout')}
              className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-300 hover:scale-105 text-gray-600 dark:text-gray-400 hover:text-red-600"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label={t('menu')}
              aria-expanded={isMobileMenuOpen}
              aria-controls="menu-mobile"
              className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-all duration-300"
            >
              {isMobileMenuOpen ? (
                <X className="h-4 w-4 text-gray-600 dark:text-gray-400" aria-hidden="true" />
              ) : (
                <Menu className="h-4 w-4 text-gray-600 dark:text-gray-400" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* A gaveta do celular desenha A MESMA ÁRVORE, achatada em seções. Não há segunda lista
            para manter em dia — era daí que vinha o código morto da versão anterior. */}
        {/* FICA no DOM e some por `hidden`, pelo mesmo motivo do painel do dropdown: o
            `aria-controls` do botão precisa apontar para um id que existe também quando está
            fechado — senão `aria-expanded={false}` promete um alvo que não está lá. */}
        <div
          id="menu-mobile"
          hidden={!isMobileMenuOpen}
          className="lg:hidden border-t border-tuggi-border/50 dark:border-gray-700/50 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm"
        >
          <nav className="px-2 pt-2 pb-3 space-y-4" aria-label={t('main_navigation')}>
              {tree.primary.length > 0 && (
                <div className="space-y-1">
                  {tree.primary.map((item) => navLink(item, () => setIsMobileMenuOpen(false)))}
                </div>
              )}
              {tree.groups.map((group) => (
                <div key={group.id}>
                  <h4 className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {t(group.labelKey)}
                  </h4>
                  {group.sections.map((section, index) => (
                    <div key={section.labelKey ?? index} className="space-y-1">
                      {section.labelKey && (
                        <p className="px-3 pt-2 text-[11px] font-medium text-gray-400 dark:text-gray-500">
                          {t(section.labelKey)}
                        </p>
                      )}
                      {section.items.map((item) =>
                        navLink(item, () => setIsMobileMenuOpen(false))
                      )}
                    </div>
                  ))}
                </div>
              ))}
          </nav>
        </div>
      </div>
    </header>
  )
}

/**
 * Um grupo da barra e o painel dele.
 *
 * TECLADO E ARIA, que não existiam: o botão não anunciava estado (o único sinal de aberto era a
 * rotação do chevron, puramente visual), `Escape` não fechava nada, e sair por `Tab` deixava um
 * painel `z-50` aberto por cima do conteúdo.
 *
 * NÃO usa `role="menu"`/`role="menuitem"` de propósito. Aquele papel promete navegação por setas
 * ↑/↓, Home/End e foco gerenciado; prometer isso sem implementar é pior para quem usa leitor de
 * tela do que uma lista de links honesta, que é o que este painel é.
 */
function Dropdown({
  group,
  label,
  isOpen,
  isActive,
  activeHref,
  onToggle,
  onClose,
  t,
}: {
  group: NavGroup
  label: string
  isOpen: boolean
  isActive: boolean
  activeHref?: string
  onToggle: () => void
  onClose: () => void
  t: (key: string) => string
}) {
  const panelId = useId()
  const buttonId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)

  return (
    <div
      className="relative dropdown-container"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen) {
          event.stopPropagation()
          onClose()
          buttonRef.current?.focus()
        }
      }}
      onBlur={(event) => {
        // O foco saiu do grupo inteiro (e não apenas pulou entre os links de dentro).
        // `relatedTarget` nulo e troca de JANELA (alt-tab, clique na barra do navegador), nao
        // saida do grupo: fechar ali faria o painel sumir sozinho quando o operador voltasse.
        const movedTo = event.relatedTarget as Node | null
        if (isOpen && movedTo && !event.currentTarget.contains(movedTo)) {
          onClose()
        }
      }}
    >
      <button
        ref={buttonRef}
        id={buttonId}
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className={cn(
          'flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-all duration-300 relative',
          isActive
            ? 'bg-tuggi-blue/10 text-tuggi-blue shadow-sm ring-1 ring-tuggi-blue/20'
            : 'text-tuggi-text dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:text-tuggi-blue dark:hover:text-tuggi-blue'
        )}
      >
        <span className="relative z-10 whitespace-nowrap">{label}</span>
        <ChevronDown
          className={cn('h-4 w-4 ml-1.5 transition-transform duration-300', isOpen && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {/* O painel FICA no DOM e some por `hidden`, em vez de ser desmontado: `aria-controls`
          precisa apontar para um id que existe também quando está fechado.
          CUIDADO AO MEXER NAS CLASSES: quem esconde é a regra `[hidden] { display: none }` do
          navegador, e ela tem a mesma especificidade de uma classe. Uma utility de display
          aqui (`flex`, `grid`, `block`) vem depois na folha e vence — o painel passaria a ficar
          sempre aberto, sem erro nenhum aparecer. */}
      <div
        id={panelId}
        aria-labelledby={buttonId}
        hidden={!isOpen}
        className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-2 z-50"
      >
        {group.sections.map((section, index) => (
          <div key={section.labelKey ?? index}>
            {/* Um separador entre seções só faz sentido a partir da segunda. */}
            {index > 0 && (
              <div className="my-2 border-t border-gray-100 dark:border-gray-800" aria-hidden="true" />
            )}
            {section.labelKey && (
              <p className="px-4 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {t(section.labelKey)}
              </p>
            )}
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.href === activeHref ? 'page' : undefined}
                className={cn(
                  'flex items-center px-4 py-2 text-sm transition-colors duration-200',
                  item.href === activeHref
                    ? 'bg-tuggi-blue/10 text-tuggi-blue'
                    : 'text-tuggi-text dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:text-tuggi-blue dark:hover:text-tuggi-blue'
                )}
                onClick={onClose}
              >
                <item.icon className="h-4 w-4 mr-3 shrink-0" aria-hidden="true" />
                <span>{t(item.labelKey)}</span>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
