/**
 * create-barcelona-rotas.ts
 *
 * Cria as rotas de Barcelona e região em core.custom_routes. UM script para as 12 rotas,
 * dirigido por tabela — a alternativa era clonar create-lisbon-tram28.ts doze vezes e
 * manter ~4.200 linhas quase idênticas.
 *
 * Cada parada é declarada pelo NOME do POI e resolvida no banco, não por coordenada
 * digitada aqui: assim todo waypoint é um POI que de fato narra, e a coordenada tem
 * um dono só (SSOT). Nome ambíguo — "La Rambla" tem 12 linhas na base — resolve pelo
 * candidato mais próximo da parada anterior.
 *
 * Geometria:
 *   - 'car' e 'bus' → OSRM (perfil driving, que é o certo para ambos).
 *   - 'foot'        → polilinha direta entre paradas. O OSRM público IGNORA o perfil:
 *                     /foot, /walking e /driving devolvem resposta idêntica, sempre de
 *                     carro. Traçar a pé com rota de carro mandaria o turista dar a volta
 *                     nos sentidos únicos do Eixample e sairia do Gòtic, que é pedestre.
 *                     Linha direta erra menos. Fica marcado em metadata.source='manual'.
 *                     Para geometria a pé de verdade: OSRM local com perfil foot.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/create-barcelona-rotas.ts --dry
 *   npx tsx --env-file=.env scripts/create-barcelona-rotas.ts [--only "Gòtic"] [--force]
 */
import { createClient } from '@supabase/supabase-js'
import { OSRMService, LatLng } from '../lib/services/routing/OSRMService'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'core' }, auth: { persistSession: false } },
)

const DRY = process.argv.includes('--dry')
const FORCE = process.argv.includes('--force')
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > -1 ? process.argv[i + 1] : null })()

type Mode = 'foot' | 'car' | 'bus'

interface Stop { poi: string; city?: string }

interface RouteDef {
  name: string
  description: string
  mode: Mode
  city: string                 // cidade padrão das paradas
  region: string
  scenic: string[]
  best_time: string[]
  accessibility: 'accessible' | 'partial' | 'not_accessible' | 'unknown'
  stops: Stop[]
  note?: string
}

const COUNTRY = 'Spain'
const REGION = 'Catalunya' // default region for the Barcelona block; Madrid routes set their own

// ─── As 12 rotas ──────────────────────────────────────────────────────────────

const ROUTES: RouteDef[] = [
  // ── Espinha HOHO: espelha as linhas oficiais do Barcelona Bus Turístic ──
  {
    name: 'Bus Turístic — Linha Vermelha',
    description: 'O percurso da linha vermelha do Bus Turístic, de Plaça de Catalunya ao Fòrum: o modernismo do Eixample, a Barcelona olímpica de Montjuïc e toda a orla até as praias do Poblenou.',
    mode: 'bus', city: 'Barcelona', region: REGION,
    scenic: ['urban', 'panoramic', 'coastal'], best_time: ['morning', 'afternoon'], accessibility: 'accessible',
    stops: [
      { poi: 'Casa Batlló' }, { poi: 'Museu Tàpies' }, { poi: 'Font Màgica de Montjuïc' },
      { poi: 'Poble Espanyol' }, { poi: "Museu Nacional d'Art de Catalunya" },
      { poi: 'Estadi Olímpic Lluís Companys' }, { poi: 'Fundació Joan Miró' },
      { poi: 'Telefèric de Montjuïc' }, { poi: 'Jardins de Mossèn Costa i Llobera' },
      { poi: 'Arc de Triomf' }, { poi: 'Basílica de la Sagrada Família' },
      { poi: 'Mirador Torre Glòries' }, { poi: 'Parc dels Auditoris - El Parc del Fòrum' },
      { poi: 'Platja de la Mar Bella' }, { poi: 'Platja del Bogatell' }, { poi: 'Port Olímpic' },
      { poi: "Museu d'Història de Catalunya" }, { poi: 'Monument a Colom' },
    ],
  },
  {
    name: 'Bus Turístic — Linha Azul',
    description: 'A linha azul do Bus Turístic, de Plaça de Catalunya à parte alta: Passeig de Gràcia, o recinto modernista de Sant Pau, o Park Güell, o Tibidabo e Pedralbes.',
    mode: 'bus', city: 'Barcelona', region: REGION,
    scenic: ['urban', 'panoramic', 'architectural'], best_time: ['morning', 'afternoon'], accessibility: 'accessible',
    stops: [
      { poi: 'Casa Batlló' }, { poi: 'Casa Milà' }, { poi: 'Hospital de la Santa Creu i Sant Pau' },
      { poi: 'Park Güell' }, { poi: 'Mirador del parc del Tibidabo' },
      { poi: 'Monument a Francesc Macià' }, { poi: 'Spotify Camp Nou' },
      { poi: 'Palau Reial de Pedralbes' }, { poi: 'Reial Monestir de Santa Maria de Pedralbes' },
    ],
  },

  // ── A pé ──
  {
    name: 'Gòtic e Born a Pé',
    description: 'A Barcelona de dois mil anos a pé: o templo romano escondido num pátio, a catedral, a Plaça del Rei, e o Born onde Santa Maria del Mar guarda o Fossar de les Moreres.',
    mode: 'foot', city: 'Barcelona', region: REGION,
    scenic: ['historical', 'urban'], best_time: ['morning', 'afternoon'], accessibility: 'partial',
    stops: [
      { poi: "Palau de la Generalitat de Catalunya" }, { poi: "Temple d'August" },
      { poi: 'Plaça del Rei' }, { poi: 'Capella de Santa Àgata' }, { poi: 'Palau del Lloctinent' },
      { poi: 'Catedral de la Santa Creu i Santa Eulàlia' }, { poi: 'Museu Frederic Marès' },
      { poi: 'Museu Picasso' }, { poi: 'Basílica de Santa Maria del Mar' },
      { poi: 'Fossar de les Moreres' }, { poi: "El Born: Museu d'Història de Barcelona" },
    ],
  },
  {
    name: 'Eixample Modernista a Pé',
    description: 'A Manzana de la Discordia e o Passeig de Gràcia: Casa Lleó Morera, Casa Amatller e Casa Batlló lado a lado, três arquitetos disputando o mesmo quarteirão, até a Pedrera.',
    mode: 'foot', city: 'Barcelona', region: REGION,
    scenic: ['architectural', 'urban'], best_time: ['morning', 'afternoon'], accessibility: 'accessible',
    stops: [
      { poi: 'Casa Calvet' }, { poi: 'Museu del Modernisme Català' }, { poi: 'Museu Tàpies' },
      { poi: 'Casa Lleó Morera' }, { poi: 'Casa Amatller' }, { poi: 'Casa Batlló' },
      { poi: 'Casa Milà' }, { poi: 'Casa Comalat' },
    ],
  },
  {
    name: 'Montjuïc a Pé',
    description: 'A montanha que foi Exposição de 1929 e Olimpíada de 1992: da Font Màgica ao MNAC, do pavilhão de Mies van der Rohe ao castelo, com a cidade inteira embaixo.',
    mode: 'foot', city: 'Barcelona', region: REGION,
    scenic: ['panoramic', 'architectural', 'historical'], best_time: ['afternoon', 'sunset'], accessibility: 'partial',
    stops: [
      { poi: 'Font Màgica de Montjuïc' }, { poi: 'Pavelló Mies van der Rohe' },
      { poi: "Museu Nacional d'Art de Catalunya" }, { poi: 'Poble Espanyol' },
      { poi: "Museu d'Arqueologia de Catalunya" }, { poi: 'Fundació Joan Miró' },
      { poi: 'Estadi Olímpic Lluís Companys' }, { poi: 'Castell de Montjuïc' },
      { poi: 'Mirador de Miramar' },
    ],
  },
  {
    name: 'Gràcia e Park Güell a Pé',
    description: 'A vila que virou bairro e nunca se rendeu: a primeira casa de Gaudí, as praças de Gràcia, e a subida ao Park Güell — com desvio ao Turó de la Rovira, onde ainda há baterias antiaéreas da Guerra Civil.',
    mode: 'foot', city: 'Barcelona', region: REGION,
    scenic: ['urban', 'panoramic', 'architectural'], best_time: ['morning', 'sunset'], accessibility: 'not_accessible',
    stops: [
      { poi: 'Casa Vicens' }, { poi: 'Park Güell' }, { poi: 'Casa Museu Gaudí' },
      { poi: 'El Turó de la Rovira' },
    ],
  },
  {
    name: 'Barceloneta e Vila Olímpica a Pé',
    description: 'A orla que a cidade só descobriu em 1992: do porto velho e do aquário à Barceloneta de pescadores, seguindo a praia até o Port Olímpic.',
    mode: 'foot', city: 'Barcelona', region: REGION,
    scenic: ['coastal', 'urban'], best_time: ['morning', 'sunset'], accessibility: 'accessible',
    stops: [
      { poi: 'Monument a Colom' }, { poi: 'Llotja de Mar' }, { poi: "l'Aquàrium Barcelona" },
      { poi: "Museu d'Història de Catalunya" }, { poi: 'Platja de la Barceloneta' },
      { poi: 'Port Olímpic' }, { poi: 'Platja del Bogatell' },
    ],
  },

  // ── Temáticas ──
  {
    name: 'Barcelona em 1 Dia',
    description: 'Se você só tem um dia: a Sagrada Família ainda em obras depois de 140 anos, o quarteirão onde três arquitetos brigaram de fachada em fachada, o mercado da Boqueria, a catedral gótica, e o fim de tarde no Park Güell.',
    mode: 'car', city: 'Barcelona', region: REGION,
    scenic: ['urban', 'architectural', 'panoramic'], best_time: ['morning', 'afternoon'], accessibility: 'partial',
    stops: [
      { poi: 'Basílica de la Sagrada Família' }, { poi: 'Casa Milà' }, { poi: 'Casa Batlló' },
      { poi: 'Mercat de Sant Josep - La Boqueria' },
      { poi: 'Catedral de la Santa Creu i Santa Eulàlia' }, { poi: 'Basílica de Santa Maria del Mar' },
      { poi: 'Park Güell' }, { poi: 'Font Màgica de Montjuïc' },
    ],
  },
  {
    name: 'Barcelona Religiosa',
    description: 'Mil anos de fé em pedra: da catedral gótica e das basílicas do Gòtic ao mosteiro de clarissas de Pedralbes, subindo até o Sagrat Cor no alto do Tibidabo — e terminando na basílica que ainda não ficou pronta.',
    mode: 'car', city: 'Barcelona', region: REGION,
    scenic: ['religious', 'historical', 'panoramic'], best_time: ['morning', 'afternoon'], accessibility: 'partial',
    stops: [
      { poi: 'Catedral de la Santa Creu i Santa Eulàlia' }, { poi: 'Santa Maria del Pi' },
      { poi: 'Basílica dels Sants Màrtirs Just i Pastor' }, { poi: 'Basílica de Santa Maria del Mar' },
      { poi: 'Reial Monestir de Santa Maria de Pedralbes' },
      { poi: 'Temple Expiatori del Sagrat Cor' }, { poi: 'Basílica de la Sagrada Família' },
    ],
    note: 'Falta Sant Pau del Camp (a igreja mais antiga da cidade) — POI ausente na base',
  },
  {
    name: 'Gaudí Essencial',
    description: 'Sete obras de Gaudí são Patrimônio da Humanidade, e seis estão em Barcelona. Da primeira casa que ele projetou, ainda quase mourisca, até a basílica onde trabalhou os últimos 43 anos e onde está enterrado.',
    mode: 'car', city: 'Barcelona', region: REGION,
    scenic: ['architectural', 'urban'], best_time: ['morning', 'afternoon'], accessibility: 'partial',
    stops: [
      { poi: 'Casa Vicens' }, { poi: 'Park Güell' }, { poi: 'Casa Museu Gaudí' },
      { poi: 'Casa Milà' }, { poi: 'Casa Batlló' }, { poi: 'Casa Calvet' },
      { poi: 'Palau Güell' }, { poi: 'Pavellons Güell' },
      { poi: 'Basílica de la Sagrada Família' },
    ],
  },
  {
    name: 'Barcelona da Guerra Civil',
    description: 'Barcelona foi das primeiras cidades do mundo bombardeadas sistematicamente do ar. Restam mais de mil abrigos antiaéreos, as baterias no alto do Turó de la Rovira, e uma praça onde a metralha na parede da igreja nunca foi tapada.',
    mode: 'car', city: 'Barcelona', region: REGION,
    scenic: ['historical', 'panoramic'], best_time: ['morning', 'afternoon'], accessibility: 'not_accessible',
    stops: [
      { poi: 'Plaça de Sant Felip Neri' }, { poi: 'Refugi 307' }, { poi: 'El Turó de la Rovira' },
    ],
    note: 'Falta o Fossar de la Pedrera (Montjuïc) — POI ausente na base',
  },
  {
    name: 'Els Emblemàtics — Lojas Centenárias',
    description: 'Barcelona protege por lei 389 estabelecimentos emblemáticos, porque aqui o patrimônio também é o comércio: a galeria onde Picasso expôs pela primeira vez, uma chocolateria de 1827, farmácias modernistas e uma loja de magia de 1881.',
    mode: 'foot', city: 'Barcelona', region: REGION,
    scenic: ['historical', 'urban'], best_time: ['morning', 'afternoon'], accessibility: 'partial',
    stops: [
      { poi: 'Farmàcia Nadal' }, { poi: 'Sala Parés' }, { poi: 'Xocolateria Fargas' },
      { poi: 'Llibreria Almirall' }, { poi: 'El Rey de la Magia' },
      { poi: 'Antigua Cereria Luis Codina' }, { poi: 'Llauneria Aquil-li Maggi' },
    ],
  },
  {
    name: 'Barcelona Olímpica 1992',
    description: 'Os Jogos que reviraram a cidade: o estádio de 1929 reformado para 1992, a cúpula de Isozaki, a torre de Calatrava — e a orla que só virou praia porque a Vila Olímpica derrubou a zona industrial.',
    mode: 'car', city: 'Barcelona', region: REGION,
    scenic: ['urban', 'coastal', 'panoramic'], best_time: ['morning', 'afternoon'], accessibility: 'partial',
    stops: [
      { poi: 'Estadi Olímpic Lluís Companys' }, { poi: 'Palau Sant Jordi' },
      { poi: "Museu Olímpic i de l'Esport Joan Antoni Samaranch" },
      { poi: 'Port Olímpic' }, { poi: 'Platja de la Barceloneta' }, { poi: 'Platja del Bogatell' },
    ],
  },

  // ── De carro: bate-volta SAINDO de Barcelona ──
  // A primeira parada é sempre em Barcelona: o trecho de estrada também narra, que é o
  // ponto do app. Substituem as versões que começavam no destino (desativadas).
  {
    name: 'De Barcelona a Montserrat e Colònia Güell',
    description: 'A montanha serrada que é santuário da Catalunha, e a cripta de Gaudí na Colònia Güell — o laboratório onde ele testou, de cabeça para baixo com pesos e barbantes, tudo o que faria na Sagrada Família.',
    mode: 'car', city: 'Monistrol de Montserrat', region: REGION,
    scenic: ['mountain', 'religious', 'panoramic'], best_time: ['morning'], accessibility: 'partial',
    stops: [
      { poi: 'Font Màgica de Montjuïc', city: 'Barcelona' },
      { poi: 'Cripta de la Colònia Güell', city: 'Santa Coloma de Cervelló' },
      { poi: 'Colònia Güell', city: 'Santa Coloma de Cervelló' },
      { poi: 'Monestir de Montserrat', city: 'Monistrol de Montserrat' },
    ],
  },
  {
    name: 'De Barcelona a Sitges e Penedès',
    description: 'Praia e cava no mesmo dia: as casas de indianos de Sitges, o Cau Ferrat de Rusiñol, e as adegas do Penedès onde nasceu o cava catalão.',
    mode: 'car', city: 'Sitges', region: REGION,
    scenic: ['coastal', 'gastronomic'], best_time: ['morning', 'afternoon'], accessibility: 'partial',
    stops: [
      { poi: 'Font Màgica de Montjuïc', city: 'Barcelona' },
      { poi: 'Museu del Cau Ferrat', city: 'Sitges' },
      { poi: 'Palau de Maricel', city: 'Sitges' },
      { poi: 'Museu Maricel de Mar', city: 'Sitges' },
      { poi: 'Sant Bartomeu i Santa Tecla', city: 'Sitges' },
      { poi: 'Museu Romàntic', city: 'Sitges' },
      { poi: 'Vinseum', city: 'Vilafranca del Penedès' },
      { poi: 'Basílica de Santa Maria', city: 'Vilafranca del Penedès' },
    ],
  },
  {
    name: 'De Barcelona a Girona e Costa Brava',
    description: 'O call judeu mais bem preservado da Europa e as casas coloridas do Onyar, depois a estrada até as calas da Costa Brava.',
    mode: 'car', city: 'Girona', region: REGION,
    scenic: ['historical', 'coastal', 'panoramic'], best_time: ['morning', 'afternoon'], accessibility: 'partial',
    stops: [
      { poi: 'Arc de Triomf', city: 'Barcelona' },
      { poi: 'Riu Onyar', city: 'Girona' },
      { poi: 'Portal de Sobreportes', city: 'Girona' },
      { poi: 'Basilica de Sant Feliu', city: 'Girona' },
      { poi: 'Banys Àrabs', city: 'Girona' },
      { poi: "Museu d'Història dels Jueus", city: 'Girona' },
      { poi: 'Muralles de Tossa de Mar', city: 'Tossa de Mar' },
      { poi: 'Far de Tossa', city: 'Tossa de Mar' },
      { poi: 'Cap de Begur', city: 'Begur' },
    ],
  },
  {
    name: 'De Barcelona a Tarragona Romana',
    description: 'Tarraco foi capital romana da Hispânia Citerior: o anfiteatro à beira-mar, o circo sob a cidade, a muralha do século II a.C. — tudo Patrimônio da Humanidade.',
    mode: 'car', city: 'Tarragona', region: REGION,
    scenic: ['historical', 'coastal'], best_time: ['morning', 'afternoon'], accessibility: 'partial',
    stops: [
      { poi: 'Font Màgica de Montjuïc', city: 'Barcelona' },
      { poi: 'Amfiteatre Romà', city: 'Tarragona' },
      { poi: 'Capçalera del Circ Romà', city: 'Tarragona' },
      { poi: 'Torre del Pretori', city: 'Tarragona' },
      { poi: 'Catedral de Tarragona', city: 'Tarragona' },
      { poi: 'Passeig Arqueològic', city: 'Tarragona' },
      { poi: 'Muralles romanes', city: 'Tarragona' },
      { poi: 'Teatre Romà', city: 'Tarragona' },
    ],
  },
  {
    name: 'De Barcelona a Figueres e Cadaqués',
    description: 'O Teatre-Museu que Dalí desenhou como sua própria obra e onde está enterrado, e depois a estrada de curvas até Cadaqués e a casa de Portlligat.',
    mode: 'car', city: 'Figueres', region: REGION,
    scenic: ['artistic', 'coastal', 'panoramic'], best_time: ['morning', 'afternoon'], accessibility: 'partial',
    stops: [
      { poi: 'Arc de Triomf', city: 'Barcelona' },
      { poi: 'Teatre-Museu Dalí', city: 'Figueres' },
      { poi: 'Castell de Sant Ferran', city: 'Figueres' },
      { poi: 'Santa Maria', city: 'Cadaqués' },
      { poi: 'Badia de Cadaqués', city: 'Cadaqués' },
      { poi: 'Casa-Museu Salvador Dalí', city: 'Cadaqués' },
      { poi: 'Badia de Portlligat', city: 'Cadaqués' },
      { poi: 'Cap de Creus', city: 'Cadaqués' },
    ],
  },

  // ═══ MADRID ═══

  {
    name: 'Madrid em 1 Dia',
    description: 'Se você só tem um dia: o palácio com mais cômodos da Europa ocidental, a Plaza Mayor, o relógio das doze uvas na Puerta del Sol, a Gran Vía, Cibeles e o Prado, terminando no Retiro.',
    mode: 'car', city: 'Madrid', region: 'Madrid',
    scenic: ['urban', 'historical', 'architectural'], best_time: ['morning', 'afternoon'], accessibility: 'partial',
    stops: [
      { poi: 'Palacio Real de Madrid' }, { poi: 'Catedral de la Almudena' },
      { poi: 'Plaza Mayor' }, { poi: 'Mercado de San Miguel' },
      { poi: 'Reloj de la Puerta del Sol' }, { poi: 'Gran Vía' },
      { poi: 'Fuente de Cibeles' }, { poi: 'Museo del Prado' }, { poi: 'Parque del Retiro' },
    ],
  },
  {
    name: 'Paseo del Arte a Pé',
    description: 'Um quilômetro de bulevar concentra três dos maiores museus do mundo: o Prado de Velázquez e Goya, o Thyssen que cobre oito séculos de pintura, e o Reina Sofía onde está a Guernica.',
    mode: 'foot', city: 'Madrid', region: 'Madrid',
    scenic: ['artistic', 'urban'], best_time: ['morning', 'afternoon'], accessibility: 'accessible',
    stops: [
      { poi: 'Fuente de Cibeles' }, { poi: 'Museo Nacional Thyssen-Bornemisza' },
      { poi: 'Fuente de Neptuno' }, { poi: 'Museo del Prado' },
      { poi: 'Museo Nacional Centro de Arte Reina Sofía' },
    ],
  },
  {
    name: 'Madrid dos Áustrias a Pé',
    description: 'O Madrid que os Habsburgo construíram quando a corte chegou, em 1561: a Plaza Mayor de autos de fé e touradas, a praça medieval da vila, e a vista das Vistillas no fim da tarde.',
    mode: 'foot', city: 'Madrid', region: 'Madrid',
    scenic: ['historical', 'urban'], best_time: ['morning', 'sunset'], accessibility: 'partial',
    stops: [
      { poi: 'Plaza Mayor' }, { poi: 'Mercado de San Miguel' },
      { poi: 'Plaza de la Villa' }, { poi: 'Casa de la Villa' },
      { poi: 'Real Basílica de San Francisco el Grande' }, { poi: 'Parque de las Vistillas' },
    ],
  },
  {
    name: 'Madrid dos Bourbons a Pé',
    description: 'O Madrid que os Bourbons quiseram versalhesco: o Palácio Real erguido depois do incêndio do alcázar, os jardins de Sabatini, a catedral que levou cem anos, e o templo egípcio que o Egito deu de presente.',
    mode: 'foot', city: 'Madrid', region: 'Madrid',
    scenic: ['architectural', 'panoramic'], best_time: ['morning', 'sunset'], accessibility: 'partial',
    stops: [
      { poi: 'Plaza de la Villa' }, { poi: 'Catedral de la Almudena' },
      { poi: 'Palacio Real de Madrid' }, { poi: 'Jardines de Sabatini' },
      { poi: 'Plaza de España' }, { poi: 'Templo de Debod' },
    ],
  },
  {
    name: 'Goya em Madrid',
    description: 'A obra de Goya espalhada pela cidade: as pinturas negras e os fuzilamentos no Prado, e a ermita de San Antonio de la Florida, que ele afrescou inteira e onde está enterrado — sem a cabeça.',
    mode: 'car', city: 'Madrid', region: 'Madrid',
    scenic: ['artistic', 'historical'], best_time: ['morning', 'afternoon'], accessibility: 'partial',
    stops: [
      { poi: 'Museo del Prado' }, { poi: 'Puerta del Sol' },
      { poi: 'Templo de Debod' }, { poi: 'Ermita de San Antonio de la Florida' },
    ],
  },

  // ── Bate-volta saindo de Madrid ──
  {
    name: 'De Madrid a Toledo',
    description: 'A cidade das três culturas, onde catedral, sinagoga e mesquita dividem o mesmo morro cercado pelo Tejo. Foi capital antes de Madrid e Patrimônio da Humanidade inteira.',
    mode: 'car', city: 'Toledo', region: 'Castilla-La Mancha',
    scenic: ['historical', 'panoramic'], best_time: ['morning', 'afternoon'], accessibility: 'partial',
    stops: [
      { poi: 'Puerta del Sol', city: 'Madrid' },
      { poi: 'Santa Iglesia Catedral Primada de Toledo', city: 'Toledo' },
      { poi: 'Alcázar de Toledo', city: 'Toledo' },
      { poi: 'Sinagoga del Tránsito', city: 'Toledo' },
      { poi: 'Monasterio de San Juan de los Reyes', city: 'Toledo' },
      { poi: 'Torre del Puente de San Martín', city: 'Toledo' },
    ],
  },
  {
    name: 'De Madrid a Segóvia',
    description: 'O aqueduto romano que atravessa a cidade sem uma gota de argamassa, o alcázar que inspirou o castelo da Disney, e a catedral gótica mais tardia da Espanha.',
    mode: 'car', city: 'Segovia', region: 'Castilla y León',
    scenic: ['historical', 'mountain', 'panoramic'], best_time: ['morning', 'afternoon'], accessibility: 'partial',
    stops: [
      { poi: 'Templo de Debod', city: 'Madrid' },
      { poi: 'Acueducto', city: 'Segovia' },
      { poi: 'Mirador del Alcázar', city: 'Segovia' },
      { poi: 'Catedral de Segovia', city: 'Segovia' },
      { poi: 'Alcázar de Segovia', city: 'Segovia' },
    ],
  },
  {
    name: 'De Madrid a Alcalá de Henares e Aranjuez',
    description: 'A cidade universitária onde Cervantes nasceu, e o palácio de verão dos Bourbons às margens do Tejo — duas Patrimônio da Humanidade no mesmo dia.',
    mode: 'car', city: 'Alcalá de Henares', region: 'Madrid',
    scenic: ['historical', 'artistic'], best_time: ['morning', 'afternoon'], accessibility: 'partial',
    stops: [
      { poi: 'Puerta de Alcalá', city: 'Madrid' },
      { poi: 'Plaza de Cervantes', city: 'Alcalá de Henares' },
      { poi: 'Catedral-Magistral Santos Niños Justo y Pastor', city: 'Alcalá de Henares' },
      { poi: 'Museo Casa Natal de Cervantes', city: 'Alcalá de Henares' },
      { poi: 'Palacio Real de Aranjuez', city: 'Aranjuez' },
      { poi: 'Jardín del Rey', city: 'Aranjuez' },
    ],
  },
  {
    name: 'De Madrid a El Escorial e Ávila',
    description: 'O mosteiro que Felipe II mandou erguer como panteão da dinastia, e depois a muralha medieval mais completa da Europa, com 88 torres em volta de Ávila.',
    mode: 'car', city: 'San Lorenzo de El Escorial', region: 'Madrid',
    scenic: ['historical', 'mountain'], best_time: ['morning', 'afternoon'], accessibility: 'partial',
    stops: [
      { poi: 'Plaza de España', city: 'Madrid' },
      { poi: 'Real Biblioteca del Monasterio de San Lorenzo de El Escorial', city: 'San Lorenzo de El Escorial' },
      { poi: 'Jardín de los Frailes', city: 'San Lorenzo de El Escorial' },
      { poi: 'Murallas de Ávila', city: 'Ávila' },
      { poi: 'Catedral de Ávila', city: 'Ávila' },
      { poi: 'Puerta del Alcázar', city: 'Ávila' },
    ],
  },
]

// ─── Resolução de parada → POI do banco ───────────────────────────────────────

interface Resolved { id: string; name: string; lat: number; lng: number }

function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/**
 * Resolve pelo nome, dentro da cidade. Empate — "La Rambla" tem 12 linhas — decide pela
 * proximidade da parada anterior, que é o que mantém o traçado coerente.
 */
async function resolve(stop: Stop, city: string, prev: LatLng | null): Promise<Resolved | null> {
  const { data, error } = await db
    .from('attractions')
    .select('id, name, priority_level, attraction_coordinate!inner(latitude, longitude)')
    .eq('country', COUNTRY).eq('city', stop.city || city).eq('entity_kind', 'poi')
    .ilike('name', stop.poi)
    .limit(30)
  if (error || !data?.length) return null

  const cands = data.map((r: any) => {
    const c = Array.isArray(r.attraction_coordinate) ? r.attraction_coordinate[0] : r.attraction_coordinate
    return { id: r.id as string, name: r.name as string, pri: r.priority_level ?? 9, lat: c.latitude as number, lng: c.longitude as number }
  })
  const best = cands.sort((a, b) =>
    a.pri !== b.pri ? a.pri - b.pri
      : prev ? haversine(prev, a) - haversine(prev, b) : 0,
  )[0]
  return { id: best.id, name: best.name, lat: best.lat, lng: best.lng }
}

// ─── Geometria ────────────────────────────────────────────────────────────────

async function geometryFor(mode: Mode, pts: LatLng[]) {
  if (mode === 'foot') {
    let dist = 0
    for (let i = 1; i < pts.length; i++) dist += haversine(pts[i - 1], pts[i])
    return { ewkt: OSRMService.toWKT(pts), distance: dist, duration: (dist / 1.25), source: 'manual' as const }
  }
  try {
    const r = await OSRMService.getRoute(pts)
    return { ewkt: OSRMService.toWKT(r.coordinates), distance: r.distance, duration: r.duration, source: 'osrm' as const }
  } catch (e) {
    let dist = 0
    for (let i = 1; i < pts.length; i++) dist += haversine(pts[i - 1], pts[i])
    console.warn(`    ⚠ OSRM falhou (${(e as Error).message}); linha direta`)
    return { ewkt: OSRMService.toWKT(pts), distance: dist, duration: (dist / 1000 / 40) * 3600, source: 'manual' as const }
  }
}

// ─── Persistência ─────────────────────────────────────────────────────────────

async function adminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  if (data?.id) return data.id
  const { data: a } = await db.from('cms_users').select('id').eq('role', 'admin').eq('is_active', true).limit(1).maybeSingle()
  return a?.id ?? null
}

const rid = () => Math.random().toString(36).slice(2, 9)

async function buildRoute(r: RouteDef, admin: string | null) {
  console.log(`\n── ${r.name}  [${r.mode}]`)

  const { data: dup } = await db.from('custom_routes').select('id').eq('name', r.name).eq('is_active', true).maybeSingle()
  if (dup && !FORCE) { console.log(`   ↷ SKIP (já existe ${dup.id}) — use --force`); return }

  const wps: any[] = []
  let prev: LatLng | null = null
  const missing: string[] = []
  for (const s of r.stops) {
    const hit = await resolve(s, r.city, prev)
    if (!hit) { missing.push(s.poi); console.log(`   ✗ ${s.poi}  — não encontrado em ${s.city || r.city}`); continue }
    console.log(`   ✓ ${s.poi.padEnd(46)} → ${hit.name}`)
    prev = { lat: hit.lat, lng: hit.lng }
    wps.push({
      id: rid(), lat: hit.lat, lng: hit.lng,
      metadata: {
        name: hit.name, attraction_id: hit.id, is_generic: false,
        wheelchair_access: 'unknown', parking: 'unknown', restrooms: 'unknown',
        rest_areas: 'unknown', photogenic_rating: 'unknown',
      },
    })
  }

  if (wps.length < 2) { console.log(`   ⚠ menos de 2 paradas resolvidas — rota NÃO criada`); return }

  const pts: LatLng[] = wps.map(w => ({ lat: w.lat, lng: w.lng }))
  const geo = await geometryFor(r.mode, pts)
  console.log(`   ${(geo.distance / 1000).toFixed(1)} km · ~${Math.round(geo.duration / 60)} min · ${geo.source} · ${wps.length}/${r.stops.length} paradas`)
  if (DRY) return

  if (dup && FORCE) await db.from('custom_routes').update({ is_active: false }).eq('id', dup.id)

  const { data, error } = await db.from('custom_routes').insert({
    name: r.name, description: r.description, client_id: null,
    geometry: geo.ewkt, waypoints: wps,
    metadata: {
      source: geo.source, mode: r.mode, distance: geo.distance, duration: geo.duration,
      script: 'create-barcelona-rotas', generated_at: new Date().toISOString(),
      linked_pois: wps.length, generic_stops: 0, missing_stops: missing,
      ...(r.mode === 'foot' ? { geometry_caveat: 'linha direta: OSRM público não tem perfil foot' } : {}),
      ...(r.note ? { note: r.note } : {}),
    },
    is_active: true,
    accessibility: r.accessibility,
    // 'drivability' não tem valor para rota a pé; o CHECK só aceita easy/moderate/demanding/unknown
    drivability: r.mode === 'foot' ? 'unknown' : 'moderate',
    scenic_profile: r.scenic, best_time: r.best_time,
    road_conditions: r.mode === 'foot' ? ['paved'] : ['paved', 'curves'],
    resources: { parking: 'unknown', restrooms: 'unknown', rest_areas: 'unknown' },
    photogenic_rating: 'high', stops_count: wps.length, visibility: 'public',
    country: COUNTRY, region: r.region,
    created_by: admin, updated_by: admin,
  }).select('id').single()

  if (error) { console.error(`   ✗ insert: ${error.message}`); return }
  console.log(`   ✓ id=${data.id}`)
}

async function main() {
  const list = ONLY ? ROUTES.filter(r => r.name.toLowerCase().includes(ONLY.toLowerCase())) : ROUTES
  console.log(`\n=== Rotas de Barcelona ${DRY ? '(DRY RUN)' : '(EXECUTANDO)'} — ${list.length} rotas ===`)
  const admin = await adminId()
  for (const r of list) await buildRoute(r, admin)
  console.log('\n=== fim ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
