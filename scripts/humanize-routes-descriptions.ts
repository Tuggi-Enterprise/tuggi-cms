/**
 * humanize-routes-descriptions.ts
 *
 * Reescreve nomes e descrições das rotas removendo vícios de IA (travessão no meio da
 * frase, abertura-fórmula "o roteiro definitivo/épico/perfeito", imperativo "mergulhe/
 * descubra", subtítulo com travessão nos nomes) e mantendo prosa natural. Fatos,
 * números e nomes próprios preservados. Atualiza core.custom_routes (name+description).
 *
 * ⚠️ As traduções (custom_route_descriptions) ficam desatualizadas — regenerar no front.
 *
 * Uso:  npx tsx --env-file=.env scripts/humanize-routes-descriptions.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')

interface R { id: string; name: string; description: string }

const ROUTES: R[] = [
  { id: 'dbcb939c-c55e-4723-b4b3-727421e8b827', name: 'Circuito dos Santuários de Aparecida',
    description: 'Uma caminhada devocional pela cidade dos romeiros. Começa na Paróquia São Benedito e na Basílica Histórica, segue pela Passarela da Fé até o Santuário Nacional e termina no Morro do Cruzeiro, de onde se vê todo o complexo religioso.' },
  { id: '80bcff34-6de7-4141-aebb-76150b202ebf', name: 'Trilha da Ponta do Pai Vitório',
    description: 'Trilha costeira do Búzios Eco Trail, na Rasa, que vai da Praia da Gorda até a Ponta do Pai Vitório.' },
  { id: 'c75d52eb-4d49-44c5-bda9-ff237b34ec86', name: 'Trilha do Canto, Amores e Tartaruga',
    description: 'Trilha do Búzios Eco Trail que liga a Praia do Canto, a Praia dos Amores e a Praia da Tartaruga.' },
  { id: 'e4eb4f61-60bd-42f5-bbaf-9a455e00a628', name: 'Trilha da Brava ao Forno',
    description: 'Trilha costeira do Búzios Eco Trail que liga a Praia Brava, a Praia Olho de Boi e a Praia do Forno pelo costão.' },
  { id: 'c44ba2c8-e387-48d6-afaf-91ab94091b66', name: 'Rota Religiosa de Búzios',
    description: 'Um circuito pelas igrejas históricas de Armação dos Búzios. Vai da Igreja de Sant’Anna, de 1740, onde começou a fé local, à Matriz de Santa Rita de Cássia e à Capela de Nossa Senhora Desatadora dos Nós, na Rasa, passando pela Igreja São José e pela histórica Igreja Metodista de Baía Formosa.' },
  { id: '027c5c82-c863-42ca-b602-06c088c2fd16', name: 'Rota Histórica e Cultural da Orla Bardot',
    description: 'Uma caminhada pelo centro histórico de Búzios, da Igreja de Sant’Anna (1740) ao Espaço Cultural Zanine, passando pelos casarões tombados, pelas esculturas da orla e pela Rua das Pedras.' },
  { id: '78266a7a-a234-4f2a-9019-43cb822e4c03', name: 'Rota do Patrimônio Tombado de Búzios',
    description: 'Um circuito de carro pelos bens tombados espalhados pela península de Búzios, da Igreja de Sant’Anna à Capela de Nossa Senhora Desatadora dos Nós, ao monumento Quilombola e à Igreja Metodista de Baía Formosa.' },
  { id: '9d02b516-866f-45e3-bb87-e97c68b8dbb2', name: 'Stone Mountain e os Parques de Atlanta',
    description: 'Um dia de carro pela natureza ao redor de Atlanta, bom para famílias. No Stone Mountain Park estão a maior escultura em granito do mundo, o teleférico com vista do alto, o lago, a vila histórica e uma trilha do século XIX. Nos arredores ficam a Arabia Mountain, com suas rochas rosadas, o zoológico da cidade e vários parques que fazem de Atlanta uma das cidades mais verdes do sul dos Estados Unidos.' },
  { id: 'c8a88a5e-b0f4-4245-a70e-d9097108bf4d', name: 'Atlanta Clássica',
    description: 'Um passeio de carro pelo centro histórico e cultural de Atlanta. Passa pelo legado dos Jogos Olímpicos de 1996, pela roda-gigante SkyView, pelo aquário de água doce mais visitado do mundo, pela fábrica da Coca-Cola, pelo CNN Center e pelos bairros mais movimentados da cidade que renasceu para virar a capital do sul dos Estados Unidos.' },
  { id: '4a7bfa40-a5de-4971-89bf-1ab439e33750', name: 'Passeio do Rio Preguiças',
    description: 'O passeio de lancha pelo Rio Preguiças, saindo de Barreirinhas. Para no oásis de Vassouras, no Farol de Preguiças em Mandacaru, com vista panorâmica dos Lençóis, e na vila de Caburé, entre o rio e o mar, chegando à foz em Atins, junto aos Pequenos Lençóis.' },
  { id: '10e37dee-3f92-44a4-9857-3d808fef6957', name: 'Lagoa Azul e Lagoa Bonita',
    description: 'O passeio de 4x4 mais procurado dos Lençóis, saindo de Barreirinhas. Sobe a duna gigante do Mirante da Lagoa Bonita e desce até a Lagoa Azul, de águas azul-esverdeadas entre as dunas.' },
  { id: 'bbb81c52-290b-4e22-9ea7-691293efcfae', name: 'Lagoas de Santo Amaro',
    description: 'O circuito de 4x4 a partir de Santo Amaro do Maranhão, a base mais rústica e tranquila dos Lençóis. Passa pela Lagoa da Gaivota, pela Lagoa Bela e pela Lagoa do Junco, e termina no mirante do Morro das Emendadas, com vista de 360° do mar de dunas.' },
  { id: '8c07b468-cd91-4574-990a-b36d4bd98c6e', name: 'Lisboa Histórica',
    description: 'Um passeio pelo centro histórico de Lisboa, do Marquês de Pombal ao Castelo de São Jorge, passando pelos pontos mais conhecidos da cidade: o Rossio, a Praça do Comércio e a Sé Catedral.' },
  { id: '05d3f043-300f-459b-ad7a-01b81356b951', name: 'Elétrico 28',
    description: 'O percurso do Elétrico 28, o bonde mais conhecido de Lisboa. De Martim Moniz ao Cemitério dos Prazeres, ele sobe e desce por Alfama, Sé, Bairro Alto, Chiado e Estrela, cruzando os principais miradouros e os morros mais bonitos da cidade.' },
  { id: '972b3a08-b4bc-49be-8228-d8583a33f307', name: 'Cristo Rei e o Outro Lado do Tejo',
    description: 'A vista de Lisboa que poucos turistas veem de perto. A rota cruza a Ponte 25 de Abril de carro, para ao pé do Cristo Rei e olha a cidade do outro lado do Tejo. Almada histórica, Cacilhas e a Costa da Caparica completam o passeio.' },
  { id: 'a2cc3567-0a18-41e5-97a5-4c7b69d4abe7', name: 'Grande Volta de Lisboa',
    description: 'Lisboa inteira num roteiro de carro, inspirado nos ônibus turísticos da cidade. Vai da modernidade do Parque das Nações a Alfama e ao Castelo, desce pela Baixa histórica até as margens do Tejo e chega a Belém.' },
  { id: 'aa683815-efc5-4b61-bf39-54477dbb9831', name: 'Cenas de Cinema em Nova York',
    description: 'Nova York já apareceu em centenas de filmes, e esta rota passa pelos cenários reais de vários deles. A Katz’s Deli tem a placa na mesa da cena de "Quando Harry Encontrou Sally". O quartel dos Ghostbusters continua funcionando como corpo de bombeiros. O Flatiron Building foi o Clarim Diário do Homem-Aranha. No Grand Central, os Vingadores e os Homens de Preto enfrentaram invasões alienígenas. No Central Park, os leões de "Madagascar" escaparam do zoológico. A Biblioteca Pública foi destruída em "O Dia Depois de Amanhã" e no Rockefeller o Tom Hanks dançou em "Quero Ser Grande". Termina no DUMBO, com o skyline que aparece em tanto cartaz.' },
  { id: 'fd8e1716-84ee-44e7-839a-cd1cf6d8c62d', name: 'Nova York dos Fãs de Friends',
    description: 'Para quem cresceu vendo Friends, Nova York é cheia de lugares familiares. A rota passa pelos cenários reais das gravações externas: o prédio de 90 Bedford Street, onde ficavam os apartamentos de Monica, Joey e Chandler, o prédio de Phoebe na Morton Street, o Museu de História Natural onde Ross trabalhava, a Bloomingdale’s de Rachel e o Central Park de várias cenas. Todos confirmados, sem invenção. É uma caminhada pelo Greenwich Village e pelo West Side.' },
  { id: 'fd2127ae-6d6e-46fd-af83-afccf15ece4b', name: 'Locações de Cinema em Nova York',
    description: 'Uma caminhada pelos cenários reais de filmes clássicos rodados em Nova York. A Katz’s Deli de "Quando Harry Encontrou Sally", com a placa na mesa famosa; o quartel dos Ghostbusters, na Tribeca, ainda em funcionamento; o Flatiron Building que foi o Clarim Diário do Homem-Aranha; o Grand Central de "Homens de Preto" e dos Vingadores; o Empire State de King Kong; a Washington Square Park de dezenas de filmes; e o DUMBO, no Brooklyn, com o skyline que estampa tantos cartazes.' },
  { id: '830d8c25-1c55-4850-ad41-f19c3909526e', name: 'Wall Street e o Financial District',
    description: 'Uma caminhada pelo bairro financeiro de Nova York. Passa pela Bolsa de Valores e pelo Touro de Wall Street, pelo memorial do 11 de setembro e pela torre One World Trade Center, com seu deck de observação, e pelo Federal Reserve, que guarda cerca de 6.000 toneladas de ouro. Inclui a St. Paul’s Chapel, que sobreviveu ao atentado, e termina na ponta de Manhattan, com a vista gratuita da Estátua da Liberdade a partir do terminal do Staten Island Ferry.' },
  { id: 'd01bf3fc-4a4c-42d6-8d3c-11bd2531a934', name: 'Brooklyn e Queens',
    description: 'Do outro lado do rio ficam algumas das vistas mais bonitas de Manhattan e alguns dos bairros mais autênticos de Nova York. A rota começa no DUMBO, com a foto clássica sob a Manhattan Bridge, segue pelo Brooklyn Bridge Park e pela Brooklyn Heights Promenade, passa por Williamsburg, com sua cena de arte e gastronomia, e termina em Long Island City, no Queens, onde o Gantry Plaza State Park emoldura todo o Midtown. Dá para fazer de metrô e a pé.' },
  { id: '6236448d-2159-4f6d-aefa-48e564d06082', name: 'Ícones de Midtown Manhattan',
    description: 'Uma caminhada pelos cartões-postais do Midtown, aqueles que aparecem em todo guia de Nova York. Do Empire State ao Chrysler Building, do Grand Central, com seu teto estrelado, ao Bryant Park; do Rockefeller Center e o Top of the Rock ao Carnegie Hall; do MoMA, com obras de Van Gogh, à Times Square e suas telas gigantes. São doze pontos, todos no coração da cidade.' },
  { id: '74c0bb47-6b9d-4230-bea8-5d8ba26f77f7', name: 'East River de Ferry',
    description: 'O NYC Ferry sai do cais da East 90th Street, no Upper East Side, e desce o East River passando por baixo de quatro das pontes mais conhecidas da cidade. A passagem custa US$ 2,75 e rende uma das vistas mais bonitas de Nova York: Manhattan de um lado, Brooklyn e Queens do outro. Depois do Pier 11, a rota segue a pé até o DUMBO e pela Brooklyn Bridge. É tudo de balsa e a pé, sem carro.' },
  { id: 'aac2630f-184e-461e-b2ed-c97a47fc5f40', name: 'Nova York dos Fãs de Friends (com os episódios)',
    description: 'A mesma volta pelos cenários de Friends, agora com o episódio em que cada lugar aparece. O prédio de 90 Bedford Street está em todos os 236 episódios. A rua de Phoebe aparece no episódio 15 da 7ª temporada; o museu de Ross e aquela data marcante, no 15 da 2ª; a estreia de Rachel na Bloomingdale’s, no 10 da 3ª; e o Central Park onde Phoebe corre do seu jeito, no 7 da 6ª. Todos os locais com fonte confirmada. É uma caminhada pelo Greenwich Village e pelo Upper West Side.' },
  { id: 'c397695f-7bb2-4d9b-b60f-2de66d3be4a2', name: 'Central Park, do Sul ao Norte',
    description: 'São 843 acres no meio de Manhattan, e o Central Park é um roteiro por si só. A rota vai da ponta sul à norte, passando pelo Carrossel, pela Bethesda Fountain e seu terraço, pela Bow Bridge (a ponte mais fotografada do parque), por Strawberry Fields (o memorial de John Lennon), pelo castelo Belvedere, pelo Reservatório Jacqueline Kennedy Onassis e pelo tranquilo Harlem Meer, ao norte. Dá para fazer a pé ou de bicicleta.' },
  { id: '24d30d46-a421-4d91-8978-4ee65e856bdd', name: 'Estátua da Liberdade e o Lado de Nova Jersey',
    description: 'De ferry até a Estátua da Liberdade e Ellis Island, por onde entraram 12 milhões de imigrantes nos Estados Unidos, muitos deles brasileiros. Depois a rota cruza para Nova Jersey, de onde se tem uma das vistas mais bonitas de Manhattan, do outro lado do rio Hudson: o waterfront de Hoboken, o Liberty State Park em Jersey City e os píeres com o skyline ao fundo. É tudo de balsa e a pé.' },
  { id: '6b5e5ad4-4f52-4942-b1b5-802e06305962', name: 'Nova York pelas Pontes',
    description: 'As pontes de Nova York vistas de dois ângulos: do rio, pelo NYC Ferry, e de terra, dos mirantes mais fotogênicos. A balsa do East River passa sob as pontes do Brooklyn, de Manhattan e de Williamsburg. A rota começa no Pier 11, em Wall Street, atravessa para o DUMBO, com o enquadramento famoso da Manhattan Bridge, segue pelo Brooklyn Bridge Park e vê a Queensboro Bridge a partir de Long Island City. É tudo de balsa e a pé, só com transporte público.' },
  { id: '796afeba-fa95-4338-acc6-8e276607e559', name: 'Kennesaw e Marietta',
    description: 'Uma viagem ao sul histórico dos Estados Unidos, a menos de 30 minutos de Atlanta. A rota passa pela praça charmosa de Marietta e seu museu de "…E o Vento Levou", sobe o Kennesaw Mountain, palco de uma batalha importante da Guerra Civil, e chega ao museu da Grande Perseguição da Locomotiva, o roubo de trem que virou lenda e inspirou filmes.' },
  { id: '6d553d22-21ea-4949-a370-204c815b6933', name: 'Compras em Orlando',
    description: 'Um dia de compras na International Drive, o corredor turístico onde a maioria dos brasileiros se hospeda em Orlando. Estão ali dois Premium Outlets, com mais de 300 lojas somadas, o shopping mais luxuoso da Flórida, além de Walmart, Costco, TJ Maxx, Ross, Marshalls e a Disney Springs. De grifes com desconto a produtos que só existem por lá, dá para passar o dia inteiro sem sair da região central.' },
  { id: 'eb7bb3b1-edb3-4a30-832c-f9fd2fc464d1', name: 'Disney de Graça, Sem Ingressos',
    description: 'Um dia de carro pelo que a Disney oferece sem cobrar ingresso. A Disney Springs tem lojas, restaurantes e shows; os hotéis temáticos abrem as portas para qualquer visitante; o BoardWalk tem vista para o EPCOT; e há resorts com savana africana, arquitetura de luxo e o monotrilho passando dentro do lobby. São mais de dez paradas gratuitas com a sensação de estar dentro do mundo Disney.' },
  { id: '54f54940-86b5-4011-a836-1dc7490c427b', name: 'Região dos Lagos em Um Dia',
    description: 'O circuito clássico da Costa do Sol de carro, em um dia. Começa em Cabo Frio, no Forte São Mateus e na Praia do Forte, desce a Arraial do Cabo (Praia Grande, Praia dos Anjos, de onde saem os barcos para a Gruta Azul, o mirante do Pontal do Atalaia e as Prainhas do Atalaia), volta pela Praia do Peró e termina em Búzios, em Geribá, na Ferradura e no pôr do sol da Orla Bardot e da Rua das Pedras.' },
  { id: 'a88afb45-3736-4e35-83da-bed71c3fd0c6', name: 'Rio Boêmio',
    description: 'Um roteiro pelos bairros onde o Rio pulsa longe dos cartões-postais. Começa na Urca, tranquila, sobe a Santa Teresa, bairro de artistas com bares e boas vistas, e desce para a Lapa dos Arcos, berço do samba e da noite carioca. Segue até a Pedra do Sal, onde o samba nasceu no século XIX, chega ao Porto Maravilha e termina na Praça Mauá. É um percurso seguro para quem quer conhecer o Rio de todo dia, tão bonito quanto o do postal.' },
  { id: '1c4d9892-326d-49fd-8b1b-e14d1cac845b', name: 'As Maravilhas do Rio em Um Dia',
    description: 'Um roteiro de carro pelos lugares que fazem a fama do Rio. Sobe ao Cristo Redentor, com a vista de 360°, e ao Pão de Açúcar, sobre a Baía de Guanabara, passa por Copacabana e Ipanema, pelo Jardim Botânico e pela Lagoa Rodrigo de Freitas, pelo Museu do Amanhã, no Porto Maravilha, e termina em Santa Teresa. Natureza, cultura e praia a cada esquina.' },
  { id: 'd731d1dc-4ee7-4847-9022-1fd10e0df060', name: 'Praias do Rio, de Botafogo a Grumari',
    description: 'Um passeio de carro pela orla carioca de ponta a ponta, da Enseada de Botafogo, com a vista do Pão de Açúcar, até Grumari, a praia mais preservada da cidade. No caminho ficam Copacabana, o Arpoador, do melhor pôr do sol do Rio, Ipanema, Leblon, Vidigal, São Conrado, Barra da Tijuca, Recreio e Prainha. Cada praia tem o seu clima.' },
  { id: '01370425-1390-48f2-b301-44572592039d', name: 'São Paulo à Noite',
    description: 'Um roteiro pela noite paulistana, dos lounges do Itaim Bibi e dos Jardins aos botecos do Pinheiros, dos bares de vinho da Rua Mourato Coelho às cervejarias da Vila Madalena, do Beco do Batman e sua arte de rua à Praça Benedito Calixto, com brechós e música ao vivo. É variado e seguro, e rende da tardinha até a madrugada.' },
  { id: 'd157a4fc-b40f-4844-acdc-160d1a92420b', name: 'São Paulo Esportiva',
    description: 'Um roteiro de carro pelos grandes palcos do esporte em São Paulo. Passa pelo Allianz Parque, do Palmeiras, pelo Morumbi, do São Paulo, pelo histórico Pacaembu, pelo Canindé, da Portuguesa, pelo Ginásio do Ibirapuera, casa do vôlei, pelo Autódromo de Interlagos, palco do GP do Brasil de Fórmula 1, e pela Neo Química Arena, do Corinthians, em Itaquera.' },
  { id: 'f8e9e86a-fddd-4aa4-a22a-860fd79e2361', name: 'Avenida Paulista e Arredores',
    description: 'Um dia de carro pela Avenida Paulista e pelo que ferve ao redor. Do MASP, de arquitetura suspensa, ao Mercadão e seus pastéis; da Liberdade, o maior bairro japonês fora do Japão, à Pinacoteca; do Parque Ibirapuera, com seus museus e o lago, ao Museu do Ipiranga, reaberto depois da reforma. É um retrato dos vários lados de São Paulo.' },
  { id: '9dd7dde9-d0fa-494c-9c7f-1a917d401ef0', name: 'São Paulo com Crianças',
    description: 'Um dia inteiro pensado para famílias com crianças. Tem ciência no Catavento e no Aquário de São Paulo, o maior zoológico da América do Sul e o Jardim Botânico ao lado, a história do Brasil no Museu do Ipiranga e os parques mais queridos da cidade, como o Ibirapuera, a Aclimação e o Villa-Lobos, terminando no verde do Horto Florestal.' },
  { id: 'ae788353-989a-4994-a02a-c1a6eba67378', name: 'Caminho da Fé',
    description: 'O trecho principal do Caminho da Fé, de Águas da Prata ao Santuário Nacional de Aparecida, cerca de 318 km cruzando a Serra da Mantiqueira. Passa pelas igrejas-matriz de Andradas, Ouro Fino, Inconfidentes, Borda da Mata, Tocos do Moji, Estiva, Consolação, Paraisópolis, São Bento do Sapucaí, Campos do Jordão, Pindamonhangaba e Potim. É a rota de peregrinação a pé mais tradicional à padroeira do Brasil.' },
  { id: 'a1e133bb-45a2-4bc3-ab45-47f16c5ca009', name: 'Sintra e seus Palácios',
    description: 'Um bate-volta de Lisboa a Sintra, a 30 minutos da capital. A vila serrana reúne palácios reais, o castelo mouro, jardins e a Quinta da Regaleira, num conjunto reconhecido como Patrimônio da Humanidade pela UNESCO.' },
  { id: '51bd3bb0-9ca1-4098-bc94-f318031d52d5', name: 'De Orlando à Space Coast',
    description: 'Um dia de carro de Orlando à Space Coast, onde o Atlântico encontra a história espacial americana. Passa por Titusville, com seu museu e um bom mirante de lançamentos, pela reserva de Merritt Island, pelo Kennedy Space Center, com foguetes de verdade e um ônibus espacial, pelo farol histórico de Cape Canaveral e pelo porto de cruzeiros, terminando em Cocoa Beach, onde os astronautas comemoravam antes de subir ao espaço.' },
  { id: '62ccbf38-553b-48dc-8fd7-16f1d7e508bf', name: 'Rota da Luz',
    description: 'Caminho de peregrinação de Mogi das Cruzes ao Santuário Nacional de Aparecida, cerca de 197 km. Passa pelas igrejas-matriz de Guararema, Santa Branca, Paraibuna, Redenção da Serra, Taubaté e Pindamonhangaba até chegar à padroeira do Brasil.' },
  { id: 'dd2eabcb-9088-4eb4-a77b-b3c4ac42f2ca', name: 'Sete Cidades e a Costa Oeste',
    description: 'Sete Cidades é um dos cartões-postais dos Açores e uma das Sete Maravilhas Naturais de Portugal: duas lagoas, uma azul e uma verde, separadas por uma ponte dentro de uma cratera vulcânica. A rota parte do Grand Hotel Açores Atlântico, em Ponta Delgada, e faz o anel oeste da ilha, pela Lagoa do Fogo, pela Caldeira Velha, pelas piscinas vulcânicas de Mosteiros e pela Vista do Rei, o panorama mais fotografado da ilha. É um passeio de dia inteiro por São Miguel, a Ilha Verde.' },
  { id: '22a356c6-25a5-419b-bfa6-725ae1cb587d', name: 'Ponta Delgada, a Capital Açoriana',
    description: 'Para quem está hospedado no Grand Hotel Açores Atlântico e quer conhecer Ponta Delgada, a capital cabe num raio de caminhada. A rota passa pelas Portas da Cidade, barrocas, do século XVIII, pela Igreja de São Sebastião e seus azulejos, pelo Forte de São Brás, que defendeu a ilha dos piratas, pela gruta de lava do Carvão, com 2.000 anos, pelos Jardins Botânicos de José do Canto e pelo Mercado da Graça, onde os açorianos compram ananás, alcatra e queijo da ilha. Dá para fazer a pé ou de carro, numa manhã ou tarde.' },
  { id: '1a67e8f6-650b-4f4a-8a21-c8fe59351760', name: 'Ponta Delgada a Pé',
    description: 'Uma caminhada pelo centro histórico de Ponta Delgada, tudo a menos de 2 km e sem carro. Parte do Grand Hotel Bensaude e passa pelas Portas da Cidade, barrocas, pela Igreja de São Sebastião, com azulejos do século XVI, pelo Convento de Nossa Senhora da Esperança, que guarda o Santo Cristo dos Milagres, pelo Mercado da Graça, com o ananás e o queijo da ilha, e pelo passeio marítimo, de frente para o Forte de São Brás. São cerca de 2 horas, com bom calçado e câmera na mão.' },
  { id: '56b12fcd-af0e-4a77-887b-5acdaf1709b7', name: 'Nordeste de São Miguel',
    description: 'O Nordeste é o lado mais remoto de São Miguel: falésias de 400 m cobertas de hortênsias azuis, o farol mais antigo dos Açores (1876), cascatas de água cor de ferrugem, parques com fetos gigantes e um dos melhores miradouros para o nascer do sol na ilha. A rota começa na Plantação de Chá Gorreana, a única da Europa continental, e sobe a costa até os penhascos da Ponta da Madrugada. É o lado bruto e sem multidões da ilha.' },
  { id: 'e4f70ae0-a8c1-4074-b817-331d599a57e5', name: 'Furnas, Termas e Vulcões',
    description: 'A rota das termas e dos vulcões das Furnas parte do Terra Nostra Garden Hotel, onde as caldeiras de ferro aquecem o chão desde 1935. Passa pelas caldeiras fumegantes, onde o Cozido das Furnas cozinha por horas enterrado na terra vulcânica, pela Lagoa das Furnas cercada de vapor, pelas piscinas termais da Poça da Dona Beija, entre 25 e 39 °C, e pela Caldeira Velha, com cascata e piscinas naturais na mata. Termina na vista da Lagoa do Fogo, a mais selvagem da ilha.' },
]

function tics(s: string): string[] {
  const t: string[] = []
  if (/—/.test(s)) t.push('travessão')
  if (/\b(definitiv[oa]|épic[oa]|perfeit[oa]|imperdível)\b/i.test(s)) t.push('superlativo-fórmula')
  if (/\b(mergulhe|descubra|explore|embarque)\b/i.test(s)) t.push('imperativo')
  return t
}

async function main() {
  console.log(`\n=== Humanizar rotas ${DRY ? '(DRY)' : '(EXECUTANDO)'} — ${ROUTES.length} rotas ===\n`)
  let ok = 0, resid = 0
  for (const r of ROUTES) {
    const t = tics(r.name + ' ' + r.description)
    if (t.length) { console.log(`  ⚠ RESÍDUO em ${r.name}: ${t.join(', ')}`); resid++ }
    if (DRY) { console.log(`  ~ ${r.name}`); continue }
    const { error } = await db.from('custom_routes').update({ name: r.name, description: r.description }).eq('id', r.id)
    if (error) { console.error(`  ✗ ${r.id}: ${error.message}`); continue }
    console.log(`  ✓ ${r.name}`)
    ok++
  }
  console.log(`\n=== atualizadas: ${ok} | com resíduo de vício: ${resid} ===`)
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
