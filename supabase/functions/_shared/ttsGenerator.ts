// _shared/ttsGenerator.ts

// Voice mapping for Google Cloud TTS
export const getVoiceConfig = (language: string, gender: 'male' | 'female') => {
  // Comprehensive voice mapping for 13 supported languages
  const voiceMap: Record<string, { male: string; female: string; languageCode: string }> = {
    // English
    // English
    'en': { male: 'en-US-Neural2-J', female: 'en-US-Neural2-F', languageCode: 'en-US' },
    'en-us': { male: 'en-US-Neural2-J', female: 'en-US-Neural2-F', languageCode: 'en-US' },
    'en-gb': { male: 'en-GB-Neural2-D', female: 'en-GB-Neural2-A', languageCode: 'en-GB' },
    
    // Portuguese
    'pt': { male: 'pt-BR-Neural2-B', female: 'pt-BR-Neural2-A', languageCode: 'pt-BR' },
    'pt-br': { male: 'pt-BR-Neural2-B', female: 'pt-BR-Neural2-A', languageCode: 'pt-BR' },
    'pt-pt': { male: 'pt-PT-Wavenet-B', female: 'pt-PT-Wavenet-A', languageCode: 'pt-PT' },
    
    // Spanish
    'es': { male: 'es-ES-Neural2-B', female: 'es-ES-Neural2-A', languageCode: 'es-ES' },
    'es-es': { male: 'es-ES-Neural2-B', female: 'es-ES-Neural2-A', languageCode: 'es-ES' },
    'es-us': { male: 'es-US-Neural2-B', female: 'es-US-Neural2-A', languageCode: 'es-US' },
    
    // German
    'de': { male: 'de-DE-Neural2-B', female: 'de-DE-Neural2-A', languageCode: 'de-DE' },
    'de-de': { male: 'de-DE-Neural2-B', female: 'de-DE-Neural2-A', languageCode: 'de-DE' },
    
    // French
    'fr': { male: 'fr-FR-Neural2-B', female: 'fr-FR-Neural2-A', languageCode: 'fr-FR' },
    'fr-fr': { male: 'fr-FR-Neural2-B', female: 'fr-FR-Neural2-A', languageCode: 'fr-FR' },
    
    // Italian
    'it': { male: 'it-IT-Neural2-C', female: 'it-IT-Neural2-A', languageCode: 'it-IT' },
    'it-it': { male: 'it-IT-Neural2-C', female: 'it-IT-Neural2-A', languageCode: 'it-IT' },
    
    // Japanese
    'ja': { male: 'ja-JP-Neural2-C', female: 'ja-JP-Neural2-B', languageCode: 'ja-JP' },
    'ja-jp': { male: 'ja-JP-Neural2-C', female: 'ja-JP-Neural2-B', languageCode: 'ja-JP' },
    
    // Chinese (Mandarin) — Simplified (cmn-CN, Neural2)
    'zh': { male: 'cmn-CN-Neural2-C', female: 'cmn-CN-Neural2-A', languageCode: 'cmn-CN' },
    'cmn-cn': { male: 'cmn-CN-Neural2-C', female: 'cmn-CN-Neural2-A', languageCode: 'cmn-CN' },
    'zh-cn': { male: 'cmn-CN-Neural2-C', female: 'cmn-CN-Neural2-A', languageCode: 'cmn-CN' },
    // Chinese (Mandarin) — Traditional / Taiwan (cmn-TW só tem Standard/WaveNet, sem
    // Neural2). WaveNet aceita SSML, entra no caminho atual. Antes caía em voz inglesa.
    'zh-tw': { male: 'cmn-TW-Wavenet-B', female: 'cmn-TW-Wavenet-A', languageCode: 'cmn-TW' },
    'cmn-tw': { male: 'cmn-TW-Wavenet-B', female: 'cmn-TW-Wavenet-A', languageCode: 'cmn-TW' },
    
    // Korean
    'ko': { male: 'ko-KR-Neural2-C', female: 'ko-KR-Neural2-A', languageCode: 'ko-KR' },
    'ko-kr': { male: 'ko-KR-Neural2-C', female: 'ko-KR-Neural2-A', languageCode: 'ko-KR' },
    
    // Russian
    'ru': { male: 'ru-RU-Wavenet-B', female: 'ru-RU-Wavenet-A', languageCode: 'ru-RU' },
    'ru-ru': { male: 'ru-RU-Wavenet-B', female: 'ru-RU-Wavenet-A', languageCode: 'ru-RU' },
  };

  const normalizedLang = language.toLowerCase();
  const voices = voiceMap[normalizedLang];

  if (!voices) {
    // Fallback to English Neural voices
    console.log(`[Voice Config] Language ${language} not found, using English fallback`);
    return {
      name: gender === 'male' ? 'en-US-Neural2-J' : 'en-US-Neural2-F',
      languageCode: 'en-US',
      pitch: gender === 'male' ? -1.5 : -1.0
    };
  }

  return {
    name: voices[gender],
    languageCode: voices.languageCode,
    pitch: gender === 'male' ? -1.5 : -1.0 // Lower pitch for more "authority" and less "robot"
  };
};

/**
 * Sanitores text for SSML to avoid XML errors
 */
const escapeSsml = (text: string) => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

// Generate audio using Google Cloud TTS
export const generateAudioWithTTS = async (
  text: string,
  language: string,
  gender: 'male' | 'female',
  apiKey: string
): Promise<ArrayBuffer> => {
  console.log(`[TTS] Starting audio generation for language: ${language}, gender: ${gender}`);

  const voiceConfig = getVoiceConfig(language, gender);
  let sanitizedText = escapeSsml(text);

  // Dynamic Prosody: Inject a dramatic pause after the first phrase (POI Name)
  // This looks for the first comma, period, or hyphen, provided it's within the first 80 characters.
  const firstPunctuationMatch = sanitizedText.match(/^(.{5,80}?)([,.\-])/);
  if (firstPunctuationMatch && firstPunctuationMatch.index === 0) {
      const matchLength = firstPunctuationMatch[0].length;
      // Reconstruct text with a 300ms break inserted right after the punctuation
      sanitizedText = sanitizedText.substring(0, matchLength) + 
                      `<break time="300ms"/>` + 
                      sanitizedText.substring(matchLength);
  }

  // Use SSML for better control over the narration
  // Adding a short 500ms break at the beginning helps with Bluetooth devices that might clip the start
  const requestBody = {
    input: {
      ssml: `<speak><break time="500ms"/>${sanitizedText}</speak>`
    },
    voice: {
      languageCode: voiceConfig.languageCode,
      name: voiceConfig.name,
      ssmlGender: gender.toUpperCase(),
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: 1.2,
      volumeGainDb: 4.0,
      // Leaving sampleRateHertz empty allows Google to use the highest native rate 
      // supported by the voice and output format (max 24k for MP3 Neural2)
    },
  };

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    }
  );

  console.log(`[TTS] Response status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[TTS] Error response:`, errorText);
    throw new Error(`Google TTS API error: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  // console.log(`[TTS] Response data keys:`, Object.keys(data));

  if (!data.audioContent) {
    console.error(`[TTS] No audio content in response:`, data);
    throw new Error('No audio content received from Google TTS');
  }

  console.log(`[TTS] Audio content length: ${data.audioContent.length} characters`);

  // Convert base64 to ArrayBuffer
  const audioBuffer = Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0));
  console.log(`[TTS] Audio buffer size: ${audioBuffer.byteLength} bytes`);

  return audioBuffer.buffer;
};
