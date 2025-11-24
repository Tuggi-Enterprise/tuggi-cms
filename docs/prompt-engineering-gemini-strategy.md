# Análise de Engenharia de Prompt para Gemini 2.5: Abordagem Algorítmica

## 1. Diagnóstico: Human-Centric vs. Model-Centric

O prompt atual sofre de **"Ruído Semântico"**. Ele utiliza linguagem natural excessiva para explicar regras que deveriam ser restrições lógicas rígidas.

| Característica | Prompt Atual (Human-Centric) | Prompt Ideal (Model-Centric) |
| :--- | :--- | :--- |
| **Instrução** | "Por favor, não invente datas, isso é muito importante." | `NO_HALLUCINATION: TRUE`<br>`STRICT_MODE: ON` |
| **Hierarquia** | "Tente usar primeiro o site oficial, depois..." | `SOURCE_PRIORITY: [Official > Reference > Gov > DB]` |
| **Tom** | "Fale com calor humano e confiança." | `TONE: Professional, Evocative, Factual.`<br>`STYLE: Concise, Direct.` |
| **Processo** | Descrição narrativa do que fazer. | Algoritmo passo-a-passo (Step-by-Step). |

## 2. Estratégia de Otimização para Gemini 2.5

Para extrair o máximo do Gemini 2.5 (que possui janela de contexto massiva e alto raciocínio), devemos mudar para uma estrutura de **Configuração de Sistema**.

### 2.1. Estrutura Proposta (Blueprint)

O novo prompt deve ser estruturado como um arquivo de configuração ou código pseudo-lógico:

```xml
<system_configuration>
  <role>Cultural Heritage Expert</role>
  <language>pt-BR</language>
  <output_format>Plain Text (Narrative)</output_format>
  <constraints>
    <constraint id="truth">STRICT_GROUNDING: Use ONLY provided context. NO EXTERNAL KNOWLEDGE.</constraint>
    <constraint id="dates">TEMPORAL_ACCURACY: IF date NOT in source THEN omit.</constraint>
    <constraint id="length">MAX_WORDS: 85</constraint>
  </constraints>
</system_configuration>

<input_context>
  {SOURCE_DATA}
</input_context>

<processing_logic>
  STEP 1: FACT EXTRACTION
  - Scan <input_context> for Reference Links (Priority 1).
  - Scan for Government Sources (Priority 2).
  - Extract: Founding Date, Architect, Curiosity.

  STEP 2: DATE RESOLUTION LOGIC
  - IF explicit_date exists in Reference Links -> USE IT.
  - ELSE IF "X years ago" -> CALCULATE (CurrentYear - X).
  - ELSE IF explicit_date exists in Other Sources -> USE IT.
  - ELSE -> OMIT DATE (Use "Present Tense").

  STEP 3: NARRATIVE CONSTRUCTION
  - Block 1: Context/Location (No repetition of directional cue).
  - Block 2: Historical Anchor (Only if date resolved).
  - Block 3: Unique Detail (Specific fact, not generic).
  - Block 4: Sensory Closing.
</processing_logic>
```

## 3. Melhorias Específicas por Seção

### 3.1. Eliminação de Viés de Exemplo
Ao remover exemplos de texto (como fizemos anteriormente), removemos o viés. Agora, devemos remover também adjetivos subjetivos que confundem a IA.
*   **Remover:** "memorable", "distinctive", "human warmth".
*   **Substituir por:** "fact-based", "specific", "culturally significant".

### 3.2. Priorização Rígida de Fontes
A IA entende melhor hierarquias numéricas do que listas descritivas.
*   **Estratégia:** Atribuir "Weights" (Pesos) virtuais às fontes.
    *   Reference Links: Peso 1.0
    *   Gov/Heritage: Peso 0.9
    *   Database: Peso 0.7
    *   Google/OSM: Peso 0.4

### 3.3. Otimização de Tokens (Densidade)
Reduzir palavras de ligação ("please", "make sure to", "following these instructions"). A IA não precisa de polidez, precisa de clareza.
Isso aumenta a **Densidade de Instrução**, fazendo com que o modelo preste mais atenção às regras do que à "conversa" do prompt.

## 4. Conclusão da Análise

Para obter uma descrição turística cultural de alta qualidade que funcione para locais conhecidos E desconhecidos:

1.  **Universalidade:** O prompt não deve assumir que o local é famoso. Ele deve assumir que **os dados fornecidos são a única verdade existente**.
2.  **Engajamento:** O engajamento virá da **especificidade dos fatos** extraídos, não de adjetivos vazios ("belíssimo", "incrível").
3.  **Veracidade:** A alucinação é combatida forçando a IA a seguir um algoritmo de resolução de datas e fatos antes de gerar o texto.

**Recomendação:** Reescrever o prompt utilizando tags XML estritas e lógica imperativa, removendo toda a prosa conversacional.

