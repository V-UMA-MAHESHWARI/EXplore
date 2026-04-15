import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn("GEMINI_API_KEY is not set. AI features will not work.");
}

const ai = new GoogleGenAI({ apiKey: apiKey || "" });

export interface FileData {
  data: string;
  mimeType: string;
  name?: string;
}

export interface GenerateOptions {
  location?: { latitude: number; longitude: number };
  files?: FileData[];
  thinking?: boolean;
  tone?: 'professional' | 'creative' | 'concise';
}

export const geminiService = {
  async generateResponseStream(prompt: string, options: GenerateOptions = {}) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing");
    
    const parts: any[] = [{ text: prompt }];
    if (options.files && options.files.length > 0) {
      options.files.forEach(file => {
        parts.push({
          inlineData: {
            data: file.data,
            mimeType: file.mimeType
          }
        });
      });
    }

    const toneInstructions = {
      professional: "Maintain a highly professional, formal, and authoritative tone. Use precise language and structured reasoning.",
      creative: "Be expressive, imaginative, and engaging. Use vivid descriptions and a warm, conversational tone.",
      concise: "Be extremely brief and to the point. Provide only the essential information without fluff."
    };

    const systemInstruction = options.tone ? toneInstructions[options.tone] : "You are a helpful and sophisticated AI assistant for the EXplore AI Atelier. Use your research tools to provide accurate, up-to-date information.";

    const hasComplexFiles = options.files?.some(f => f.mimeType.includes('pdf') || f.mimeType.includes('application'));
    const model = options.thinking || hasComplexFiles ? "gemini-3.1-pro-preview" : "gemini-3-flash-preview";

    return ai.models.generateContentStream({
      model: model,
      contents: { parts },
      config: {
        systemInstruction,
        tools: [
          { googleMaps: {} },
          { googleSearch: {} }
        ],
        toolConfig: {
          includeServerSideToolInvocations: true,
          retrievalConfig: options.location ? {
            latLng: options.location
          } : undefined
        },
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
  },

  async generateImage(prompt: string) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing");

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: prompt,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
        },
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    
    return null;
  }
};
