import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY || '',
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://telegram-channel-manager.railway.app',
    'X-Title': 'Telegram Channel Manager',
  },
});

// Default model
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5';

export async function generatePost(channel: any, sourceContent: string, model?: string): Promise<string> {
  const prompt = `Ты опытный контент-менеджер Telegram-канала.

== ПРОФИЛЬ КАНАЛА ==
Канал: ${channel.name}
Ниша: ${channel.niche}
Аудитория: ${channel.targetAudience}
Продукт: ${channel.productDescription}
Тон: ${channel.tone}

== ПРИМЕР ХОРОШЕГО ПОСТА ==
${channel.exampleGoodPost}

== ИСХОДНЫЙ МАТЕРИАЛ ==
${sourceContent.slice(0, 3000)}

== ЗАДАЧА ==
Напиши один Telegram-пост (200-800 символов).
Цель: продать или прогреть к покупке.
Верни ТОЛЬКО текст поста, без объяснений.`;

  const response = await openai.chat.completions.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.choices[0].message.content || '';
}

export async function generateImagePrompt(postText: string, model?: string): Promise<string> {
  const prompt = `Напиши промпт на английском языке для генерации картинки к этому посту.
Промпт должен быть коротким, описывать визуальные детали, стиль и атмосферу.
Верни ТОЛЬКО текст промпта, без объяснений.

Пост:
${postText}`;

  const response = await openai.chat.completions.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.choices[0].message.content || '';
}

export async function regeneratePost(channel: any, oldPostText: string, feedback: string, model?: string): Promise<string> {
  const prompt = `Ты опытный контент-менеджер Telegram-канала.

== ПРОФИЛЬ КАНАЛА ==
Канал: ${channel.name}
Ниша: ${channel.niche}
Аудитория: ${channel.targetAudience}
Продукт: ${channel.productDescription}
Тон: ${channel.tone}

== СТАРЫЙ ПОСТ ==
${oldPostText}

== ЗАМЕЧАНИЯ (ФИДБЕК) ==
${feedback}

== ЗАДАЧА ==
Перепиши пост с учетом замечаний.
Верни ТОЛЬКО текст поста, без объяснений.`;

  const response = await openai.chat.completions.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.choices[0].message.content || '';
}

export async function generateSlidesStructure(productData: string, model?: string): Promise<any[]> {
  const prompt = `Создай структуру презентации для продукта.
Данные: ${productData}
Верни ТОЛЬКО валидный JSON массив объектов SlideData.
Формат SlideData:
{
  "type": "title" | "problem" | "solution" | "benefits" | "price" | "cta",
  "heading": "string",
  "subheading": "string",
  "text": "string",
  "points": ["string"],
  "items": [{"icon": "string", "text": "string"}],
  "plans": [{"name": "string", "price": "string", "features": ["string"]}],
  "contact": "string"
}`;

  const response = await openai.chat.completions.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const jsonStr = response.choices[0].message.content || '[]';
  return JSON.parse(jsonStr.replace(/```json\n?|\n?```/g, ''));
}
