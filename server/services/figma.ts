/**
 * Figma REST API integration
 * Token: figma.com → Settings → Security → Personal access tokens
 * Add to .env: FIGMA_TOKEN=your_token
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const FIGMA_API = 'https://api.figma.com/v1';
const TIMEOUT = 30000;

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
 */
export function parseFigmaUrl(url: string): string {
  const match = url.match(/figma\.com\/(?:file|design|proto)\/([a-zA-Z0-9]+)/);
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

  const info = await getFigmaFileInfo(figmaUrl);

  const maxFrames = 10; // Telegram не любит больше 10 медиа в группе
  const frameIds = info.frameIds.slice(0, maxFrames);

  let frameImages: Array<{ nodeId: string; name: string; url: string }> = [];

  if (frameIds.length > 0) {
    const exported = await exportFigmaFrames(info.key, frameIds, 'png', 1);

    // Получить имена фреймов из файла (для подписей)
    const fileRes = await axios.get(`${FIGMA_API}/files/${info.key}`, {
      headers: headers(),
      params: { depth: 2 },
      timeout: TIMEOUT,
    });
    const firstPage = fileRes.data.document?.children?.[0];
    const frameNameMap: Record<string, string> = {};
    if (firstPage) {
      for (const node of (firstPage.children || [])) {
        frameNameMap[node.id] = node.name;
      }
    }

    frameImages = exported.map(({ nodeId, url }) => ({
      nodeId,
      name: frameNameMap[nodeId] || nodeId,
      url,
    }));
  }

  console.log(`[Figma] Exported "${info.name}": ${frameImages.length} frames`);
  return {
    fileKey: info.key,
    fileName: info.name,
    frameImages,
    thumbnailUrl: info.thumbnailUrl,
  };
}

/**
 * Используется в /presentation wizard — AI генерирует слайды, выводим как текст.
 * Figma REST API не поддерживает создание файлов без плагина.
 */
export async function createPresentation(slides: SlideData[]): Promise<string> {
  const summary = slides.map((s, i) => {
    const lines = [`📌 Слайд ${i + 1} — ${s.type.toUpperCase()}`];
    if (s.heading) lines.push(`*${s.heading}*`);
    if (s.subheading) lines.push(`_${s.subheading}_`);
    if (s.text) lines.push(s.text);
    if (s.points?.length) lines.push(s.points.map(p => `• ${p}`).join('\n'));
    return lines.join('\n');
  }).join('\n\n');

  // Figma REST API не позволяет создавать файлы — отдаём текстовое описание
  // Для реального создания нужен Figma Plugin или Canva (см. canva.ts)
  console.log('[Figma] createPresentation: returning text summary (API limitation)');
  return summary;
}
