
const GEMINI_API_KEY = "AIzaSyDC3uyVe5S7MNE2YQcLMSTXzGjcbXhNc-M"; // Usando a GOOGLE_GEMINI_API_KEY do seu .env
const MODEL = "gemini-2.5-flash-preview-tts";

async function testGeminiAudio() {
    console.log(`--- Iniciando Teste Gemini Audio Nativo ---`);
    console.log(`Modelo: ${MODEL}`);

    const payload = {
        contents: [
            {
                parts: [
                    { text: "Aja como um guia turístico brasileiro. Dê uma saudação rápida e animada sobre o Cristo Redentor em apenas uma frase." }
                ]
            }
        ],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: "Aoede"
                    }
                }
            }
        }
    };

    try {
        const start = Date.now();
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            }
        );

        const data = await response.json();
        const duration = Date.now() - start;

        if (!response.ok) {
            console.error("❌ Erro na API:", JSON.stringify(data, null, 2));
            return;
        }

        const parts = data.candidates?.[0]?.content?.parts || [];
        const audioPart = parts.find(p => p.inlineData);
        const textPart = parts.find(p => p.text);

        console.log(`✅ Sucesso em ${duration}ms!`);
        if (textPart) console.log(`Transcrição: "${textPart.text}"`);

        if (audioPart) {
            const base64Data = audioPart.inlineData.data;
            const mimeType = audioPart.inlineData.mimeType;
            console.log(`📦 Áudio recebido: ${base64Data.length} chars (Base64)`);
            console.log(`📄 MimeType: ${mimeType}`);

            // No Deno/Terminal não vamos salvar o arquivo, apenas validar a estrutura
            console.log(`\n--- Conclusão do Teste ---`);
            console.log(`A API está respondendo e gerando áudio corretamente.`);
        } else {
            console.warn("⚠️ A resposta não contém dados de áudio.");
            console.log("Resposta Completa:", JSON.stringify(data, null, 2));
        }

    } catch (error) {
        console.error("❌ Erro ao chamar a API:", error.message);
    }
}

testGeminiAudio();
