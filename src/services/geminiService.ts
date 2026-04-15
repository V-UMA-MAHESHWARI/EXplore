import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn("GEMINI_API_KEY is not set. AI features will not work.");
}

const ai = new GoogleGenAI({ apiKey: apiKey || "" });

export interface GenerateOptions {
  location?: { latitude: number; longitude: number };
  image?: { data: string; mimeType: string };
  thinking?: boolean;
}

export const geminiService = {
  async generateResponseStream(prompt: string, options: GenerateOptions = {}) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing");
    
    const parts: any[] = [{ text: prompt }];
    if (options.image) {
      parts.push({
        inlineData: {
          data: options.image.data,
          mimeType: options.image.mimeType
        }
      });
    }

    const model = options.image || options.thinking ? "gemini-3.1-pro-preview" : "gemini-3-flash-preview";

    return ai.models.generateContentStream({
      model: model,
      contents: { parts },
      config: {
        tools: [{ googleMaps: {} }],
        toolConfig: options.location ? {
          retrievalConfig: {
            latLng: options.location
          }
        } : undefined,
        thinkingConfig: options.thinking ? {
          thinkingLevel: ThinkingLevel.HIGH
        } : undefined
      }
    });
  },

  async transcribeAudio(audioBase64: string, mimeType: string) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing");

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          inlineData: {
            data: audioBase64,
            mimeType: mimeType
          }
        },
        { text: "Transcribe this audio exactly as spoken." }
      ]
    });

    return response.text;
  },

  async generateSpeech(text: string) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  },
  
  async startChat() {
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing");
    
    return ai.chats.create({
      model: "gemini-3-flash-preview",
    });
  }
};
