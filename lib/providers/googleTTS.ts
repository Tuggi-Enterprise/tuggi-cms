interface GoogleTTSOptions {
  text: string;
  voice?: string;
  speed?: number;
}

interface GoogleTTSResult {
  audioBuffer: Buffer;
  mimeType?: string;
}

export async function generateAudioWithGoogleTTS({ text, voice, speed }: GoogleTTSOptions): Promise<GoogleTTSResult> {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  const projectId = process.env.GOOGLE_TTS_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error('Google TTS API key or project ID not configured');
  }

  const endpoint = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;

  const requestBody = {
    input: { text },
    voice: {
      languageCode: 'pt-BR',
      name: voice || 'pt-BR-Wavenet-A',
      ssmlGender: 'FEMALE',
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: speed || 1.2,
      sampleRateHertz: 24000,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Google TTS API error: ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  if (!data.audioContent) {
    throw new Error('No audio content returned from Google TTS');
  }

  const audioBuffer = Buffer.from(data.audioContent, 'base64');
  return { audioBuffer, mimeType: 'audio/mpeg' };
} 