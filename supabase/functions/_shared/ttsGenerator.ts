// _shared/ttsGenerator.ts

// Voice mapping for Google Cloud TTS
export const getVoiceConfig = (language: string, gender: 'male' | 'female') => {
  // Simplified voice mapping with more basic voices
  const voiceMap: Record<string, { male: string; female: string; languageCode: string }> = {
    'en': { male: 'en-US-Neural2-J', female: 'en-US-Neural2-F', languageCode: 'en-US' },
    'en-us': { male: 'en-US-Neural2-B', female: 'en-US-Neural2-A', languageCode: 'en-US' },
    'es': { male: 'es-ES-Neural2-B', female: 'es-ES-Neural2-A', languageCode: 'es-ES' },
    'es-es': { male: 'es-US-Neural2-B', female: 'es-US-Neural2-A', languageCode: 'es-US' },
    'pt': { male: 'pt-BR-Neural2-B', female: 'pt-BR-Neural2-A', languageCode: 'pt-BR' },
    'pt-br': { male: 'pt-BR-Neural2-B', female: 'pt-BR-Neural2-A', languageCode: 'pt-BR' },
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
  const sanitizedText = escapeSsml(text);

  // Use SSML for better control over the narration
  const requestBody = {
    input: {
      ssml: `<speak>${sanitizedText}</speak>`
    },
    voice: {
      languageCode: voiceConfig.languageCode,
      name: voiceConfig.name,
      ssmlGender: gender.toUpperCase(),
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: 1.15, // Slightly reduced from 1.2 for better clarity with the lower pitch
      pitch: voiceConfig.pitch,
      volumeGainDb: 0.0,
      // sampleRateHertz: 44100,
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
