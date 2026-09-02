/**
 * O MENU, UMA VEZ SÓ — dados, sem React.
 *
 * Este módulo devolve a árvore de navegação para um usuário. Quem desenha é
 * `components/ui/Header.tsx`, e ele desenha DUAS vezes (barra e gaveta do celular) a partir
 * desta mesma árvore. Antes de 2026-09-01 as duas eram escritas à mão em paralelo, e a segunda
 * já tinha apodrecido: o bloco mobile carregava o ternário
 * `cat === 'dashboard' ? 'main' : cat === 'admin' ? 'admin' : cat`, cujo primeiro ramo era
 * inalcançável e o segundo era identidade. Resíduo de uma versão anterior que ninguém tinha
 * como notar, porque manter duas árvores à mão é exatamente isso.
 *
 * ─── O QUE DECIDE QUEM VÊ O QUÊ ───────────────────────────────────────────────────────────
 *
 * `canReach` de `lib/navigation/access.ts`, e nada mais. Nenhum item deste arquivo carrega
 * `isAdmin` ou `role === 'x'` na condição. A regra é uma frase:
 *
 *     item visível  ⇔  o proxy admite este usuário naquele caminho
 *
 * Isso não é elegância, é a correção de um defeito medido. O menu antigo decidia por conta
 * própria e discordava do portão em três lugares ao mesmo tempo: um `editor` via "Dashboard",
 * "Pontos de Interesse" e "Rotas Customizadas", e os três respondiam `/unauthorized` — porque
 * `proxy.ts` só consulta `ALLOWED_CLIENT_PATHS` dentro do bloco `isClient`, e editor não é
 * client. Um `viewer` via os mesmos três links quebrados. Perguntando ao mesmo módulo que o
 * proxy consulta, essa classe inteira de defeito deixa de ser possível — não porque alguém se
 * lembrou de sincronizar, mas porque não há duas respostas para sincronizar.
 *
 * ─── POR QUE OS GRUPOS SÃO ESTES ──────────────────────────────────────────────────────────
 *
 * Agrupamento por OBJETO de domínio, nunca por permissão. `Admin` era um dropdown de dez itens
 * de cinco naturezas — pipeline de ingestão, diagnóstico, conteúdo, comercial e operação da
 * ferramenta — reunidos pela única coisa que tinham em comum: quem podia vê-los. Categoria e
 * permissão são eixos ortogonais, e usar um como o outro produz uma gaveta que só cresce.
 * `Parcerias`, que é o objeto comercial de uso diário, estava a dois cliques dentro dela, entre
 * um importador de OSM e um log de auditoria.
 *
 * Permissão virou filtro aplicado DEPOIS (`canReach`), que é o lugar dela.
 *
 * ─── DECISÕES ANTERIORES QUE ESTE ARQUIVO PRESERVA ────────────────────────────────────────
 *
 * Cada uma custou um defeito ou uma decisão do operador, e continua valendo:
 *
 *  1. `Parcerias` é UMA entrada, e abre a lista inteira — sem `?state=in_progress`. Aquele
 *     filtro esvaziava as colunas de desfecho do quadro, e quem acabava de publicar um local
 *     não achava o card em lugar nenhum. Travado em `client-board-surface.test.ts`.
 *  2. `Material` é IRMÃ de `Parcerias`, nunca filha: o objeto da tela é o pedido, não o
 *     parceiro, e "quantos displays imprimir e para quais cidades" não tem resposta dentro de
 *     uma ficha. O grupo `partners` as põe lado a lado sem aninhar uma na outra.
 *  3. `Financeiro` é entrada de TOPO e não item de grupo, porque é gateado por MÓDULO enquanto
 *     os grupos administrativos são gateados por role. No dia em que um editor receber o
 *     módulo, ele precisa achar a tela.
 *  4. `Dashboard` some para o coordenador, que usa `Minha rede`.
 *  5. A Overview global (`/dashboard`) não é oferecida a `client`: ela é global por construção
 *     (10 das 14 chamadas não aceitam dono), e o item dele é `/clients/dashboard`, escrito
 *     como tal em vez de deixar o proxy redirecionar.
 */

import {
  Activity,
  BarChart3,
  Bell,
  CalendarDays,
  Coins,
  Database,
  Gift,
  Handshake,
  LayoutDashboard,
  Mail,
  Map,
  MapPin,
  Network,
  Package,
  Route,
  Smartphone,
  Store,
  Target,
  Upload,
  UserCog,
  Users,
  Volume2,
  type LucideIcon,
} from 'lucide-react'

import { CLIENT_DIRECTORY_PATH } from '@/lib/clients/directory-filter'
import { canReach, CLIENT_HOME, type AccessContext } from './access'

export interface NavItem {
  href: string
  /** Chave do namespace `Navigation`. Presente nos três idiomas — ver `navigation.test.ts`. */
  labelKey: string
  icon: LucideIcon
}

/** Uma fatia nomeada de um grupo. `labelKey` ausente = lista plana, sem cabeçalho. */
export interface NavSection {
  labelKey?: string
  items: NavItem[]
}

export interface NavGroup {
  id: string
  labelKey: string
  sections: NavSection[]
}

export interface NavTree {
  /** Links soltos na barra, antes dos grupos. */
  primary: NavItem[]
  groups: NavGroup[]
}

export interface NavContext extends AccessContext {
  isCoordinator?: boolean
}

const item = (href: string, labelKey: string, icon: LucideIcon): NavItem => ({ href, labelKey, icon })

/**
 * Todos os destinos que o menu conhece, antes de qualquer filtro.
 *
 * A árvore final é esta, podada por `canReach`. Manter o catálogo completo aqui — e não montá-lo
 * condicionalmente — é o que deixa `navigation.test.ts` provar, para cada role, o conjunto exato
 * que sobra: a prova precisa saber o que foi retirado, não só o que ficou.
 */
function catalogue(): { primary: NavItem[]; groups: NavGroup[] } {
  return {
    primary: [
      item('/dashboard', 'dashboard', LayoutDashboard),
      item(CLIENT_HOME, 'dashboard', LayoutDashboard),
      item('/clients/coordinator', 'my_network', Network),
      item('/finance', 'finance', Coins),
    ],
    groups: [
      {
        id: 'points',
        labelKey: 'points',
        sections: [
          {
            labelKey: 'section_publish',
            items: [
              item('/pois', 'pois', MapPin),
              item('/events', 'events', CalendarDays),
              item('/places', 'places', Store),
              item('/routes', 'custom_routes', Route),
              // Direções e avisos: os clipes que não pertencem a nenhum POI. Saiu de `Admin`
              // porque é conteúdo, não administração — o comentário antigo já dizia isso.
              item('/dashboard/system-audio', 'system_audio', Volume2),
            ],
          },
          {
            labelKey: 'section_ingest',
            items: [
              item('/osm-importer', 'osm_importer', Database),
              item('/poi-importer', 'poi_fetching', Upload),
              item('/poi-processing', 'poi_migration', Database),
            ],
          },
          {
            labelKey: 'section_diagnostics',
            items: [
              item('/admin/poi-trigger-map', 'poi_trigger_map', Map),
              item('/trail-visualization', 'trail_map', Route),
              item('/trigger-points-single', 'tp_single_test', Target),
            ],
          },
        ],
      },
      {
        id: 'partners',
        labelKey: 'partners',
        sections: [
          {
            items: [
              item(CLIENT_DIRECTORY_PATH, 'partnerships', Handshake),
              item('/admin/materials', 'materials', Package),
              item('/admin/coupons', 'coupons', Gift),
            ],
          },
        ],
      },
      {
        id: 'marketing',
        labelKey: 'marketing',
        sections: [
          {
            items: [
              item('/dashboard/marketing/newsletter', 'newsletter', Mail),
              item('/dashboard/marketing/notifications', 'notifications', Bell),
            ],
          },
        ],
      },
      {
        id: 'reports',
        labelKey: 'reports',
        sections: [
          {
            items: [
              item('/dashboard/realtime', 'realtime', Activity),
              item('/dashboard/reports/catalog', 'catalog', Database),
              item('/dashboard/reports/geography', 'geography', MapPin),
              item('/dashboard/reports/acquisition', 'acquisition', BarChart3),
              item('/dashboard/reports/engagement', 'engagement', Activity),
              // "Base de Usuários" e não "Usuários": é RELATÓRIO. O rótulo antigo era o mesmo
              // literal de outros dois destinos — o dropdown de topo e `/admin/users` — e a
              // barra não mostra o pai quando o painel está fechado.
              item('/dashboard/reports/users', 'user_base', Users),
            ],
          },
        ],
      },
      {
        id: 'system',
        labelKey: 'system',
        sections: [
          {
            items: [
              // `/admin/users` e NÃO `/users/cms`. As duas telas gerenciam `core.cms_users`, e
              // esta passa pela API (`/api/admin/users`, com `withAuth` e validação de
              // `enabled_modules`), enquanto a outra escreve na tabela direto do navegador —
              // inclusive `role`, que a API declara imutável. Oferecer uma só, e a que respeita
              // a regra do servidor. `/users/cms` segue alcançável por URL enquanto a
              // consolidação das duas não for decidida.
              item('/admin/users', 'cms_team', UserCog),
              item('/users/app', 'app_users', Smartphone),
              item('/admin/audit-logs', 'audit_logs', Activity),
            ],
          },
        ],
      },
    ],
  }
}

/**
 * A árvore que este usuário pode ver.
 *
 * Poda em três passos, nesta ordem: item que o portão recusa sai; seção que ficou vazia sai;
 * grupo que ficou sem seção sai. Um grupo vazio na barra é pior que a ausência dele — ele abre
 * um painel em branco e o operador conclui que a ferramenta quebrou.
 */
export function buildNavTree(ctx: NavContext): NavTree {
  const all = catalogue()
  const reachable = (i: NavItem) => canReach(i.href, ctx)

  // A barra tem UM lugar para "a minha home", e três candidatos disputam ele. As regras abaixo
  // são as vigentes desde antes desta refatoração, escritas uma a uma em vez de deduzidas: uma
  // condição esperta aqui trocaria o comportamento de um admin que também é coordenador, que é
  // raro o bastante para ninguém notar e real o bastante para acontecer.
  const seesGlobalOverview = canReach('/dashboard', ctx) // na prática, admin
  const primary = all.primary.filter((i) => {
    if (!reachable(i)) return false
    switch (i.href) {
      // A Overview global é de quem o portão deixa entrar nela, coordenador ou não.
      case '/dashboard':
        return seesGlobalOverview
      // O painel do cliente aparece só para quem NÃO tem a Overview e não é coordenador — o
      // coordenador usa `Minha rede`, decisão do operador.
      case CLIENT_HOME:
        return !seesGlobalOverview && !ctx.isCoordinator
      // `Minha rede` é do coordenador; o admin também a vê, para dar suporte a qualquer guarda-chuva.
      case '/clients/coordinator':
        return Boolean(ctx.isCoordinator) || seesGlobalOverview
      default:
        return true
    }
  })

  const groups = all.groups
    // O COORDENADOR NÃO GERENCIA PONTOS, e isso é decisão de produto, não consequência do
    // portão: `canReach` deixaria ele entrar em `/pois` e `/routes` como qualquer `client`.
    // `lib/hooks/useCmsUser.ts` diz a mesma coisa do outro lado — `canManagePois` é
    // `canEdit && !isCoordinator`, ou seja, ele chegaria numa tela onde não pode criar nem
    // editar nada. Oferecer a porta de uma sala onde ele não age é pior que não oferecer.
    .filter((group) => group.id !== 'points' || !ctx.isCoordinator)
    .map((group) => ({
      ...group,
      sections: group.sections
        .map((section) => ({ ...section, items: section.items.filter(reachable) }))
        .filter((section) => section.items.length > 0),
    }))
    .filter((group) => group.sections.length > 0)
    .map((group) => {
      // Cabeçalho de seção só serve quando há mais de uma seção para separar. Para um `client`,
      // `Pontos` colapsa em dois itens e um título acima deles seria mobília sem função.
      if (group.sections.length === 1) {
        return { ...group, sections: [{ items: group.sections[0].items }] }
      }
      return group
    })

  return { primary, groups }
}
