/**
 * Figma REST API integration
 * Token: figma.com → Settings → Security → Personal access tokens
 * Add to .env: FIGMA_TOKEN=your_token
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const FIGMA_API = 'https://api.figma.com/v1';
const TIMEOUT = 60000; // 60s — большие файлы Figma грузятся медленно

export type SlideData = {
  type: 'title' | 'problem' | 'solution' | 'benefits' | 'price' | 'cta'
  heading?: string
  subheading?: string
  text?: string
  points?: string[]
  items?: Array<{ icon: string; text: string }>
  plans?: Array<{ name: string; price: string; features: string[] }>
  contact?: string
}

export interface FigmaFileInfo {
  key: string;
  name: string;
  lastModified: string;
  thumbnailUrl: string;
  pages: Array<{ id: string; name: string }>;
  frameIds: string[];
}

export interface FigmaExportResult {
  fileKey: string;
  fileName: string;
  frameImages: Array<{ nodeId: string; name: string; url: string }>;
  thumbnailUrl: string;
}

function getToken(): string {
  const token = process.env.FIGMA_TOKEN;
  if (!token) throw new Error('FIGMA_TOKEN не задан в .env');
  return token;
}

function headers() {
  return { 'X-Figma-Token': getToken() };
}

/**
 * Extract file key from any Figma URL:
 * https://www.figma.com/file/XXXX/Title
 * https://www.figma.com/design/XXXX/Title
 * https://www.figma.com/proto/XXXX/Title
 * https://www.figma.com/board/XXXX/Title
 */
export function parseFigmaUrl(url: string): string {
  const match = url.match(/figma\.com\/(?:file|design|proto|board)\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error(`Не удалось извлечь ключ файла из ссылки: ${url}`);
  return match[1];
}

/**
 * GET /v1/files/:key — получить метаданные файла и список фреймов
 */
export async function getFigmaFileInfo(fileKeyOrUrl: string): Promise<FigmaFileInfo> {
  const fileKey = fileKeyOrUrl.includes('figma.com')
    ? parseFigmaUrl(fileKeyOrUrl)
    : fileKeyOrUrl;

  try {
    const res = await axios.get(`${FIGMA_API}/files/${fileKey}`, {
      headers: headers(),
      params: { depth: 2 },
      timeout: TIMEOUT,
    });

    const doc = res.data.document;
    const pages = (doc.children || []).map((p: any) => ({ id: p.id, name: p.name }));

    // Collect all top-level frame IDs from the first page
    const firstPage = doc.children?.[0];
    const frameIds: string[] = firstPage
      ? (firstPage.children || [])
          .filter((n: any) => n.type === 'FRAME' || n.type === 'COMPONENT')
          .map((n: any) => n.id)
      : [];

    return {
      key: fileKey,
      name: res.data.name,
      lastModified: res.data.lastModified,
      thumbnailUrl: res.data.thumbnailUrl || '',
      pages,
      frameIds,
    };
  } catch (err: any) {
    const status = err.response?.status;
    const body = JSON.stringify(err.response?.data);
    console.error(`[Figma] getFigmaFileInfo(${fileKey}) — status: ${status}, body: ${body}`);
    throw new Error(`Figma API error ${status}: ${body || err.message}`);
  }
}

/**
 * GET /v1/images/:key — экспортировать фреймы как PNG
 * Возвращает массив { nodeId, name, url }
 */
export async function exportFigmaFrames(
  fileKey: string,
  nodeIds: string[],
  format: 'png' | 'pdf' | 'svg' = 'png',
  scale = 1
): Promise<Array<{ nodeId: string; url: string }>> {
  if (!nodeIds.length) return [];

  try {
    const res = await axios.get(`${FIGMA_API}/images/${fileKey}`, {
      headers: headers(),
      params: { ids: nodeIds.join(','), format, scale },
      timeout: TIMEOUT,
    });

    if (res.data.err) {
      throw new Error(`Figma export error: ${res.data.err}`);
    }

    const images: Record<string, string> = res.data.images || {};
    return Object.entries(images).map(([nodeId, url]) => ({ nodeId, url }));
  } catch (err: any) {
    const status = err.response?.status;
    const body = JSON.stringify(err.response?.data);
    console.error(`[Figma] exportFigmaFrames(${fileKey}) — status: ${status}, body: ${body}`);
    throw new Error(`Figma export error ${status}: ${body || err.message}`);
  }
}

/**
 * Полный экспорт по ссылке: получить файл → найти фреймы → экспортировать PNG
 * Используется для команды /figma [url]
 */
export async function exportByUrl(figmaUrl: string): Promise<FigmaExportResult> {
  const token = process.env.FIGMA_TOKEN;
  if (!token) throw new Error('FIGMA_TOKEN не задан в .env. Получи на figma.com → Settings → Security → Personal access tokens');

  const fileKey = figmaUrl.includes('figma.com') ? parseFigmaUrl(figmaUrl) : figmaUrl;
  console.log(`[Figma] exportByUrl: fileKey=${fileKey}`);

  try {
    const res = await axios.get(`${FIGMA_API}/files/${fileKey}`, {
      headers: headers(),
      params: { depth: 2 },
      timeout: TIMEOUT,
    });

    const doc = res.data.document;
    const firstPage = doc.children?.[0];

    // Собираем фреймы с именами за один проход
    // Включаем также SECTION и GROUP для FigJam/board файлов
    const frames: Array<{ id: string; name: string }> = firstPage
      ? (firstPage.children || [])
          .filter((n: any) => ['FRAME', 'COMPONENT', 'SECTION', 'GROUP'].includes(n.type))
          .map((n: any) => ({ id: n.id, name: n.name }))
      : [];

    console.log(`[Figma] Found ${frames.length} frames in "${res.data.name}"`);

    const maxFrames = 10;
    const selectedFrames = frames.slice(0, maxFrames);

    let frameImages: Array<{ nodeId: string; name: string; url: string }> = [];

    if (selectedFrames.length > 0) {
      const exported = await exportFigmaFrames(fileKey, selectedFrames.map(f => f.id), 'png', 2);
      const nameMap = Object.fromEntries(selectedFrames.map(f => [f.id, f.name]));

      frameImages = exported.map(({ nodeId, url }) => ({
        nodeId,
        name: nameMap[nodeId] || nodeId,
        url,
      }));
    }

    console.log(`[Figma] Exported "${res.data.name}": ${frameImages.length} frames`);
    return {
      fileKey,
      fileName: res.data.name,
      frameImages,
      thumbnailUrl: res.data.thumbnailUrl || '',
    };
  } catch (err: any) {
    const status = err.response?.status;
    const body = err.response?.data;
    console.error(`[Figma] exportByUrl(${fileKey}) — status: ${status}, body:`, body);

    if (status === 403) {
      throw new Error('FIGMA_TOKEN неверный или просрочен. Обнови токен: figma.com → Settings → Security → Personal access tokens');
    }
    if (status === 404) {
      throw new Error('Файл не найден в Figma. Проверь ссылку и доступ к файлу.');
    }
    throw new Error(`Figma API error ${status}: ${JSON.stringify(body) || err.message}`);
  }
}

/**
 * Проверить подключение к Figma API при старте
 */
export async function testFigmaConnection(): Promise<{ ok: boolean; message: string }> {
  const token = process.env.FIGMA_TOKEN;
  if (!token) {
    console.warn('[Figma] ⚠️ FIGMA_TOKEN не задан — команда /figma не будет работать');
    return { ok: false, message: 'FIGMA_TOKEN не задан' };
  }

  try {
    const res = await axios.get('https://api.figma.com/v1/me', {
      headers: { 'X-Figma-Token': token },
      timeout: 10000,
    });
    console.log(`[Figma] ✅ Подключение OK! Пользователь: ${res.data.email || res.data.handle}`);
    return { ok: true, message: `Пользователь: ${res.data.email || res.data.handle}` };
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 403) {
      console.error('[Figma] ❌ Токен неверный или просрочен (403)');
      return { ok: false, message: 'Токен неверный или просрочен' };
    }
    console.error('[Figma] ❌ Ошибка подключения:', err.message);
    return { ok: false, message: err.message };
  }
}

/**
 * Figma REST API НЕ поддерживает создание файлов.
 * Эта функция форматирует слайды как текстовое описание для Telegram.
 * Для реального создания используй Canva (см. canva.ts).
 */
export async function createPresentation(slides: SlideData[]): Promise<string> {
  // Всегда бросаем ошибку, чтобы сработал fallback на Canva
  // Figma REST API не позволяет создавать файлы программно
  throw new Error('Figma REST API не поддерживает создание файлов. Используем Canva.');
}

/**
 * Форматирует слайды как текстовое описание (fallback если ни Figma ни Canva недоступны)
 */
export function formatSlidesAsText(slides: SlideData[]): string {
  return slides.map((s, i) => {
    const lines = [`📌 Слайд ${i + 1} — ${s.type.toUpperCase()}`];
    if (s.heading) lines.push(`*${s.heading}*`);
    if (s.subheading) lines.push(`_${s.subheading}_`);
    if (s.text) lines.push(s.text);
    if (s.points?.length) lines.push(s.points.map(p => `• ${p}`).join('\n'));
    return lines.join('\n');
  }).join('\n\n');
}
