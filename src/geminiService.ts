import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface GenerationResult {
  knowledgePoint: string;
  variations: {
    question: string;
    answer: string;
    analysis: string;
  }[];
}

export const recognizeWrongQuestion = async (base64Image: string, mimeType: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType,
            },
          },
          {
            text: "请识别图片中的题目内容。提取出：1. 题目文本 2. 选项（如果有） 3. 用户回答（如果有） 4. 标准答案（如果有）。请以JSON格式返回，包含字段：questionText, options, userAnswer, correctAnswer。",
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questionText: { type: Type.STRING },
            options: { type: Type.ARRAY, items: { type: Type.STRING } },
            userAnswer: { type: Type.STRING },
            correctAnswer: { type: Type.STRING },
          },
          required: ["questionText"],
        },
      },
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("OCR Error:", error);
    throw error;
  }
};

export const generateVariations = async (originalText: string, knowledgePoint?: string) => {
  try {
    const prompt = `基于以下错题内容，请判断其核心知识点，并生成3道相同知识点的“举一反三”变式题。
    
    原题内容：
    ${originalText}
    
    ${knowledgePoint ? `指定知识点：${knowledgePoint}` : ""}
    
    要求：
    1. 覆盖同一知识点的不同角度或变换式。
    2. 难度与原题相当。
    3. 每道题附带正确答案和详细解析。
    4. 解析中必须包含“易错点分析”。
    
    请以JSON格式返回，包含字段：knowledgePoint, variations (数组，每个元素包含 question, answer, analysis)。`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            knowledgePoint: { type: Type.STRING, description: "核心知识点名称" },
            variations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING, description: "变式题题目" },
                  answer: { type: Type.STRING, description: "正确答案" },
                  analysis: { type: Type.STRING, description: "包含易错点分析的解析" },
                },
                required: ["question", "answer", "analysis"],
              },
            },
          },
          required: ["knowledgePoint", "variations"],
        },
      },
    });

    return JSON.parse(response.text || "{}") as GenerationResult;
  } catch (error) {
    console.error("Generation Error:", error);
    throw error;
  }
};
