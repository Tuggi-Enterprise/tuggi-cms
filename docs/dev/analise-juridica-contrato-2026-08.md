# Análise do contrato de parceria — v1-2026-08

**Pedido do operador, 2026-08-17:** análise jurídica do contrato contra cinco critérios.

**O que esta análise NÃO é.** Não é parecer de advogado, e o próprio template diz por quê:
*"a redação jurídica final é de advogado; nós construímos a máquina e a cláusula de aceite"*
(`lib/contract/template.ts`). O que está aqui é leitura crítica de quem conhece o código, as
regras `BR-*` e o que o sistema de fato executa — e é justamente esse cruzamento que produz os
dois achados mais graves, que nenhuma leitura só do texto encontraria.

**Medição** (`v1-2026-08`, faixa paga): 17 cláusulas, **1.587 palavras**. Faixa gratuita: 15
cláusulas (`price_and_payment` e `payment_default` são `appliesTo: 'paid'`).

---

## Achado A1 — o contrato promete o que a empresa não sabe executar — **crítico**

A cláusula `commission` **não tem `appliesTo`**: ela entra nos dois contratos, gratuito e pago.
Ela diz:

> O ESTABELECIMENTO faz jus a {x}% da receita líquida atribuída à origem identificada pelo QR
> Code que lhe for fornecido, **apurada na forma acordada entre as partes**.

Três fatos do próprio repositório, e os três já estão escritos:

1. **BR-B2B-018, item 4:** *"`drive.partner_ledger`, que não existe — a escrita da apuração
   falha hoje (BR-B2B-005, Divergência 3) e **nunca se pagou comissão nenhuma**"*.
2. `ContractManager` imprime, para o operador, antes de gerar: *"A cláusula de comissão cria uma
   obrigação que o sistema ainda não sabe apurar. Não prometa extrato de comissão a este
   parceiro."*
3. **"na forma acordada entre as partes" não existe em lugar nenhum** — não há periodicidade,
   data de pagamento, forma de pagamento, extrato, direito de auditoria nem valor mínimo.

O contrato cria uma obrigação de trato sucessivo, exigível, sem prestação definida e sem meio de
apuração. Numa disputa, "na forma acordada" contra um aderente é lida contra quem redigiu
(art. 423 CC), e a ausência de apuração não suspende a obrigação — só dificulta calculá-la.

**O agravante é a faixa gratuita.** Um estabelecimento que não paga nada assina um documento em
que a Tuggi promete repassar percentual de receita. É a promessa mais barata de assinar e a mais
cara de descumprir.

**Três saídas, e a escolha é de `produto` com o jurídico** — nenhuma é de agente:
- (a) definir a apuração no contrato (periodicidade, prazo, extrato, prescrição) e construir o
  ledger antes de assinar o próximo;
- (b) tornar a cláusula condicional e explícita: *"o repasse passa a ser devido a partir da
  disponibilização do extrato de apuração, prevista para {data}"*;
- (c) tirar a comissão da faixa gratuita e mantê-la só onde há relação financeira.

## Achado A2 — o percentual congelado no contrato conflita com a regra da apuração — **alto**

O contrato imprime o percentual no `snapshot` e o congela: *"faz jus a 20%"*.

**BR-MONETIZACAO-039, caso de borda:** *"A apuração usa o percentual vigente no dia em que apura,
e não o da data da compra."*

E a proteção do aditivo — *"a alteração do valor de contrato vigente depende de termo aditivo com
novo aceite"* — está na cláusula `price_and_payment`, que é `appliesTo: 'paid'` e trata do
**valor acima**, isto é, da mensalidade. **A comissão não tem essa proteção.**

Consequência concreta: o operador edita `core.clients.commission_rate` de 20% para 15%; a
apuração passa a usar 15%; o contrato assinado continua dizendo 20%. Duas réguas para o mesmo
número, que é a classe de defeito que CLAUDE.md §6 nomeia — só que aqui a divergência tem efeito
jurídico, não só técnico.

**Ou o contrato acompanha a regra** (*"o percentual vigente no cadastro na data da apuração"*, com
aviso prévio de alteração), **ou a regra acompanha o contrato** (apuração usa o percentual
congelado no contrato vigente). As duas são defensáveis; ter as duas ao mesmo tempo não é.

---

## Critério 1 — leitura por leigo

**Bom:** 1.587 palavras é curto para um contrato — 6 a 8 minutos. Os títulos das cláusulas
descrevem o assunto em português corrente (`Do preço, da forma de pagamento e do reajuste`,
`Da vigência e do início da cobrança`). `FAIXA GRATUITA` / `FAIXA PAGA` são nomes que o dono de
restaurante entende sem glossário. A cláusula do objeto explica o produto antes de obrigar.

**Falta:**

1. **Nenhum resumo do que se está aceitando.** Para saber quanto paga, quando começa a pagar e
   como sai, o parceiro lê as cláusulas 8, 9 e 10 inteiras. Um quadro de 6 linhas antes do texto
   — valor, quando começa, forma de pagamento, prazo, aviso para sair, o que ele precisa fazer —
   resolve, e é a medida que mais serve aos critérios 1, 4 e 5 ao mesmo tempo.
2. **Registro ainda cartorial em pontos evitáveis:** *"doravante denominada"*, *"sem prejuízo do
   disposto na cláusula"*, *"por mais privilegiado que seja"*, *"faz jus a"*, *"não constitui
   brinde, kit ou contrapartida comercial de qualquer natureza"*. Nada disso é exigência legal.
3. **A cláusula mais longa é a mais técnica** — `electronic_acceptance`, 213 palavras, com SHA-256,
   MP 2.200-2 e art. 784 §4 do CPC. Ela precisa existir com esse rigor (é o que dá cobertura à
   assinatura), mas podia abrir com uma linha em português: *"Você assina digitando seu nome.
   Guardamos a prova de que foi você e de que o documento não mudou."*

## Critério 2 — cláusulas que protegem cada parte

**A Tuggi está bem protegida:** controle editorial total (`curation`), o parceiro garante a
veracidade e responde por ela (`content_accuracy`), não exclusividade nas duas direções,
regularidade como obrigação continuada e não retrato da assinatura, licença de marca limitada à
finalidade, e a declaração de que a parceria não dá vantagem no app.

**O parceiro está bem protegido em pontos que muitos contratos escondem:** sem multa, sem prazo
mínimo, 30 dias de aviso, valor congelado no aceite, **nada é cobrado antes da publicação**, o
ponto continua no app em qualquer hipótese, e a suspensão por inadimplência não alcança o QR nem
a participação na receita. Isso é acima da média do mercado e vale dizer.

**Falta nos dois lados — e é a lacuna mais séria depois de A1:**

| Ausente | Efeito |
| :-- | :-- |
| **Limitação de responsabilidade** | não existe teto para nenhuma das partes |
| **Caso fortuito / força maior** | queda de app, de loja ou de fornecedor não tem tratamento |
| **Disponibilidade do aplicativo** | nenhuma linha diz que não há SLA — e nenhuma promete um |
| **Confidencialidade** | ausente |

Sem limitação e sem cláusula de disponibilidade, um parceiro pago cujo ponto ficou fora do ar por
uma semana argumenta com o direito comum, sem nada no contrato que module o pedido.

**Falta de proteção só do parceiro:** `curation` dá à Tuggi a redação, a extensão, o tom e a
decisão de publicar; `content_accuracy` diz que a Tuggi *"narra o que o ESTABELECIMENTO afirma e
não apura"*. **Não há cláusula sobre erro da Tuggi.** Se o áudio que chega ao turista descreve o
estabelecimento errado, o parceiro não tem no contrato nem direito de revisão prévia, nem canal
de correção, nem prazo. Num contrato de adesão, é o tipo de assimetria que o art. 424 CC alcança.
Uma linha resolve: *"o ESTABELECIMENTO pode solicitar a correção de erro factual na descrição, e
a TUGGI corrige em até {x} dias"*.

**Falta de proteção só da Tuggi:** a inadimplência para na suspensão. Não há juros, não há multa
moratória e **não há caminho de rescisão por falta de pagamento** — no 60º dia o contrato segue
vigente, com o ponto no ar na faixa gratuita e a comissão correndo.

## Critério 3 — deveres claros, sem ambiguidade

Os furos, do mais caro ao menos:

1. **"apurada na forma acordada entre as partes"** — achado A1.
2. **O vencimento da mensalidade nunca é definido.** `payment_default` inteira se conta *"do
   vencimento"*, e nenhuma cláusula diz que dia é esse. Sabe-se quando a cobrança **começa** (a
   publicação) e não quando cada mês **vence**. Toda a régua de 10/1/7/11 dias pende de um marco
   que o documento não fixa.
3. **"mediante aviso à outra parte"**, na rescisão, *"contados do recebimento do aviso"* — sem
   canal e sem endereço. Aviso por WhatsApp ao vendedor conta? E-mail para qual endereço? É o
   ponto de disputa mais provável do contrato inteiro, e é o mais barato de fechar.
4. **"na forma acordada"**, nas obrigações do estabelecimento (QR e display visíveis) — acordada
   onde? O contrato não descreve o que é "visível ao público", e a penalidade da cláusula 12
   depende exatamente disso.
5. **Tributos e nota fiscal:** o valor mensal é bruto ou líquido? Quem emite NF, em que prazo?
   Ausente.
6. **A suspensão por inadimplência interrompe a cobrança?** Se a descrição sai do ar no 11º dia,
   a mensalidade continua correndo? O contrato não diz, e as duas leituras são defensáveis — que
   é a definição de ambiguidade.
7. **Buracos deliberados, e estão corretos como estão:** `[ÍNDICE A DEFINIR PELO JURÍDICO]` e
   `[FORO A DEFINIR PELO JURÍDICO]`. BR-B2B-023 item 2 proíbe nomear o índice antes de o advogado
   escolher, e um teste garante isso. **Mas nenhum contrato pode ser assinado com os colchetes
   no corpo** — hoje nada no software impede.

## Critério 4 — forma de prestação e cobrança

**O melhor pedaço do contrato.** A separação entre vigência e cobrança é explícita, tem uma
cláusula própria e usa as palavras certas:

> Vigência e cobrança são coisas distintas: a contraprestação mensal somente começa a correr na
> data da publicação (…). **Não há cobrança pela adesão, pelo envio de informações nem pelo
> período que anteceder a publicação.**

Isso é BR-B2B-018 item 2 respeitado à letra, e elimina a devolução — que nenhuma regra descreve.
A forma de pagamento é nomeada no documento (Pix ou boleto), e a cortesia sai escrita com motivo.

**Falta:** o dia do vencimento (item 3.2), se a cobrança é antecipada ou vencida, como se calcula
o primeiro mês quando a publicação cai no meio do mês (pro rata?), e se a suspensão interrompe a
cobrança (item 3.6). Do lado da comissão, **nada** sobre quando e como se paga.

## Critério 5 — layout para ler e aceitar

**Bom, e o mérito é da spec do `design` (§4.2), que o código cumpre:** o contrato é texto real no
DOM, um `<h2>` numerado por cláusula, índice ancorado, proibição de `max-height` +
`overflow-hidden` — a regra que impede "aceitou o que não podia ler". O aceite exige dois atos
afirmativos e a digitação do nome; rolar até o fim não libera nada. A leitura não depende de
baixar o PDF (art. 46 CDC como referência de transparência, ainda que o aderente aqui seja PJ).
Desde 2026-08-17 a página também imprime o documento sem a moldura.

**Falta:**

1. **Nenhum destaque nas cláusulas que restringem o parceiro.** Em contrato de adesão, o destaque
   é medida defensiva: art. 424 CC fulmina a renúncia antecipada a direito próprio da natureza do
   negócio, e a leitura favorável ao aderente é a do art. 423. As que pedem destaque são cinco:
   `curation` (sem direito de exigir publicação), `non_exclusivity`, `penalties` (suspensão),
   `payment_default` (suspensão) e `brand_license`. Hoje são visualmente iguais às demais.
2. **Nenhum quadro-resumo antes do texto** — o mesmo item do critério 1.
3. **O PDF é gerado, mas a composição impressa não foi desenhada:** sem `@page`, sem
   `break-inside: avoid` entre cláusulas, sem repetição de cabeçalho. Um contrato que quebra a
   cláusula de aceite ao meio entre duas páginas é ruim de arquivar.

---

## Estado em 2026-08-18, depois das decisões do operador

| Achado | Situação |
| :-- | :-- |
| A1 — comissão sem apuração | **mantido por decisão**: repasse é entregável à mão (fingerprint + RevenueCat). A cláusula deixou de apontar para um acordo inexistente e passou a dizê-lo: apuração mensal sobre o mês civil anterior, demonstrativo até o dia 10, pagamento até o último dia útil, por Pix ou transferência |
| A2 — duas réguas para o percentual | **corrigido**: o percentual do aceite é o devido, e alterar exige aditivo — mesma doutrina de BR-B2B-017 para a mensalidade |
| Vencimento indefinido | **corrigido**: dia 20, com dia útil seguinte em fim de semana ou feriado, e primeira fatura proporcional a partir da publicação |
| Resumo para leigo + destaque nas restritivas | **entregue**: quadro derivado do mesmo `snapshot`, com ressalva, e as cinco cláusulas limitativas marcadas em texto na tela e no PDF |

Tudo isso está na **v2-2026-08**. A v1 ficou congelada e defendida por hash — quatro linhas de
contrato existiam nela, todas do mesmo cliente (Hotel la plage), uma viva e aberta pelo parceiro.
Por decisão do operador, elas ficam como estão.

### Achado de dado, e é de `data` executar

`core.clients.commission_rate` mede **20% em 10 dos 11 clientes** — escrito pelo default
silencioso que saiu do código em 2026-08-18, não por decisão de ninguém. O único percentual
decidido é o de `Tasca das Tias Lda` (50%).

Se o padrão passa a ser 10%, as dez linhas precisam de um `UPDATE`, e ele não é meu:

```sql
-- Área do `data`. Confira a lista antes; `Tasca das Tias Lda` NÃO entra.
update core.clients set commission_rate = 0.100
 where commission_rate = 0.200;
```

`Hotel la plage` tem contrato enviado imprimindo 20%. Mudar a linha **não** muda o contrato — é
exatamente a v2 funcionando. Para valer 10% lá, é contrato novo.

---

## Minuta das quatro cláusulas que faltavam — para o advogado revisar

Escritas na **v2-2026-08** em 2026-08-18. São **minuta**, como o resto do template: a redação
final é do advogado, e o que o código garante é que cada número sai de uma constante nomeada, de
modo que a revisão seja uma linha e não uma caçada dentro de parágrafo.

| Onde | O que passou a dizer |
| :-- | :-- |
| `notices` (nova) | Aviso é por escrito e por e-mail, ao endereço do representante para quem o contrato foi enviado; cada parte mantém o seu atualizado; reputa-se recebido no primeiro dia útil seguinte ao envio. Mensagem de aplicativo de conversa e aviso verbal não produzem efeito |
| `liability` (nova) | Sem promessa de disponibilidade ininterrupta; crédito proporcional em interrupção contínua imputável à Tuggi; exclusão mútua de lucros cessantes e dano indireto; teto de responsabilidade direta; caso fortuito e força maior (CC, art. 393) |
| `payment_default` | Rescisão por inadimplência prolongada; multa **só** sobre o débito da rescisão; tolerância que não vira renúncia; e a ambiguidade fechada — a suspensão **não** interrompe a contraprestação |
| `curation` | O parceiro pode apontar erro factual sobre si e a Tuggi corrige em prazo certo. Alcança o **erro**, não a linha editorial |
| `price_and_payment` | O valor é bruto, a Tuggi emite documento fiscal por competência, e retenção legal é da fonte pagadora |

### Os seis números são proposta, não decisão

Todos em `lib/contract/template.ts`, cada um com o motivo ao lado:

| Constante | Proposto | De onde veio |
| :-- | --: | :-- |
| `LATE_FINE_PERCENT` | 2% | costume de mercado e teto do CDC, adotado por prudência — e **só sobre o débito da rescisão** |
| `ADJUSTMENT_INDEX` | IPCA, **como teto** | decisão do operador em 18/08; ver abaixo |
| `JURISDICTION_CITY/STATE` | São Paulo / SP | sede da Tuggi, decisão do operador em 18/08 |
| `TERMINATION_FOR_DEFAULT_DAYS` | 60 dias | usual em assinatura mensal |
| `FACTUAL_CORRECTION_BUSINESS_DAYS` | 5 dias úteis | proposta |
| `OUTAGE_CREDIT_DAYS` | 5 dias corridos | proposta |
| `LIABILITY_CAP_MONTHS` | 12 meses | usual em SaaS B2B |

### Por que não há encargo de mora correndo mês a mês

Decisão do operador em 2026-08-18: *"eu nao vou entrar em estresse com parceiro por cause de 1
real de juros"*. O remédio real é a suspensão da descrição, e cobrar centavos de mora numa
mensalidade de R$ 100 custa mais em trabalho do que arrecada.

Isso é juridicamente sólido, e não só operacional:

- **Juros de mora não precisam de cláusula.** Com vencimento certo — que agora existe, dia 20 —
  a mora é automática (Código Civil, arts. 397 e 406). Se um dia houver cobrança judicial, os
  juros correm de qualquer forma. Por isso o contrato diz *"juros legais"* e não um número que
  alguém teria de conferir contra a Selic; a constante do juro saiu.
- **A multa convencional é a única que precisa estar escrita** para existir (art. 408). Ela ficou,
  escopada ao débito que sobrevive à rescisão — que é quando de fato se cobra.
- **Cláusula que nunca se aplica é pior que cláusula ausente.** A tolerância repetida gera
  expectativa legítima (*supressio*), e o dia em que a Tuggi cobrasse, o parceiro alegaria que
  nunca foi assim. Por isso o último parágrafo diz que deixar de cobrar não importa novação nem
  renúncia — é ele que permite não cobrar sem perder o direito.

### O reajuste é teto, não obrigação — e é a escolha mais incomum do contrato

O operador decidiu em 2026-08-18: *"vamos colocar o IPCA como referencia e nao como indice
absoluto, reajusta de 37% mata o contrato, mas poderemos aplicar 10"*.

**A escolha do IPCA** é a convencional: o IGP-M mede atacado, é puxado por commodity e câmbio, e
acumulou mais de 37% em doze meses em 2021 contra inflação ao consumidor perto de 10%. Depois
daquele salto, o IPCA virou o padrão de contrato de serviço no país.

**Usá-lo como teto é o que muda o contrato de lado.** Índice obrigatório reajusta sozinho e, num
ano ruim, reajusta contra a vontade das duas partes. Como limite, ele só pode ser aplicado para
baixo — e cláusula que apenas beneficia quem aderiu não esbarra no art. 424 do Código Civil. É
das poucas cláusulas deste instrumento que são melhores para o parceiro do que o padrão de
mercado, e vale dizer isso a ele na conversa comercial.

**A lacuna que um teto abre está fechada**: não reajustar num aniversário não acumula o
percentual não aplicado nem renuncia aos períodos seguintes. Sem essa linha, a tolerância vira
crédito guardado na cabeça de um e expectativa legítima na do outro — a mesma defesa contra a
*supressio* que a cláusula de inadimplência recebeu.

**O foro é São Paulo**, sede da Tuggi. Válido entre empresas (CPC, art. 63), e a eleição que
acompanha a sede de quem redige é a defensável num contrato de adesão — comarca sem relação com
ninguém é a que o juiz reputa abusiva de ofício (§3º).

**Pendência de `produto`:** BR-B2B-023, item 2, ainda diz que o índice é escolha do advogado. A
decisão foi do operador, e o item precisa ser reescrito.

### Duas escolhas que o advogado deve olhar primeiro

**O teto não se aplica à faixa gratuita.** Doze mensalidades de um contrato sem mensalidade é
teto zero, e teto zero é renúncia antecipada disfarçada de número — o art. 424 do Código Civil
alcança isso num contrato de adesão. Na gratuita, a cláusula diz que as partes respondem nos
termos da lei, mantida só a exclusão de dano indireto.

**O teto tem quatro exceções**: dolo, culpa grave, violação de direito de terceiro e LGPD. Sem
elas, um teto num contrato de adesão é frágil, e obrigação de LGPD não se limita por contrato de
qualquer forma.

### O que continua fora, e é decisão de negócio

Confidencialidade e cláusula anticorrupção não entraram. Nenhuma das duas é exigível neste tipo
de relação e ambas alongam um documento que o parceiro lê no celular — 19 cláusulas e ~2.240
palavras já é o dobro do que era. Se o jurídico quiser, entram na próxima versão.

---

## Ordem de ataque

| # | Achado | Dono | Custo |
| :-- | :-- | :-- | :-- |
| 1 | A1 — comissão sem apuração, e na faixa gratuita | `produto` + jurídico | decisão, depois ledger |
| 2 | A2 — percentual congelado × BR-MONETIZACAO-039 | `produto` | uma linha, dos dois lados |
| 3 | Vencimento da mensalidade não definido | `produto` | uma linha |
| 4 | Canal do aviso de rescisão | jurídico | uma linha |
| 5 | Limitação de responsabilidade + força maior + disponibilidade | jurídico | três cláusulas |
| 6 | Correção de erro factual na descrição | `produto` + jurídico | uma linha |
| 7 | Rescisão por inadimplência, juros e multa | `produto` + jurídico | um parágrafo |
| 8 | Tributos e nota fiscal | jurídico | uma linha |
| 9 | Quadro-resumo + destaque nas cláusulas restritivas | `design` | tela |
| 10 | Bloquear geração com `[A DEFINIR]` no corpo | `dev` | item de checklist |

**Os itens 1 a 8 são texto de contrato e nenhum é de agente.** CLAUDE.md §4 os classifica como
"específico do Tuggi — risco legal": param, se registram e escalam. O caminho é
`docs/business-rules/_perguntas-abertas.md`, que é de `produto` — não escrevi lá.

**O item 10 é o único que posso fechar sozinho**, e vale: `contractChecklist` já recusa a geração
por campo faltando, e um contrato com `[ÍNDICE A DEFINIR PELO JURÍDICO]` impresso no corpo é um
buraco maior que qualquer campo vazio.
