import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function generatePost(channel: any, sourceContent: string): Promise<string> {
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

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  return (response.content[0] as any).text;
}

export async function generateImagePrompt(postText: string): Promise<string> {
  const prompt = `Напиши промпт на английском языке для генерации картинки к этому посту.
Промпт должен быть коротким, описывать визуальные детали, стиль и атмосферу.
Верни ТОЛЬКО текст промпта, без объяснений.

Пост:
${postText}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  return (response.content[0] as any).text;
}

export async function regeneratePost(channel: any, oldPostText: string, feedback: string): Promise<string> {
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

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  return (response.content[0] as any).text;
}
