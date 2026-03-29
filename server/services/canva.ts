/**
 * Canva Connect API integration
 * Keys: canva.com/developers → Create App
 * Add to .env:
 *   CANVA_CLIENT_ID=xxx
 *   CANVA_CLIENT_SECRET=xxx
 */

import axios from 'axios';
import dotenv from 'dotenv';
import type { SlideData } from './figma.js';

dotenv.config();

const CANVA_API = 'https://api.canva.com/rest/v1';
const CANVA_TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';
const TIMEOUT = 30000;

// Simple in-memory token cache
let cachedToken: { value: string; expiresAt: number } | null = null;

export interface CanvaDesign {
  id: string;
  title: string;
  urls: {
    edit_url: string;
    view_url: string;
  };
  thumbnail?: { url: string };
}

export interface CanvaExportResult {
  designId: string;
  title: string;
  editUrl: string;
  viewUrl: string;
  exportUrl?: string; // PNG/PDF export URL if requested
  thumbnailUrl?: string;
}

function hasCredentials(): boolean {
  const id = process.env.CANVA_CLIENT_ID;
  const secret = process.env.CANVA_CLIENT_SECRET;
  return !!(id && secret && !id.startsWith('TODO'));
}

/**
 * OAuth2 client_credentials — получить access token
 * Кэшируем до истечения срока
 */
export async function getCanvaToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }

  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'CANVA_CLIENT_ID / CANVA_CLIENT_SECRET не заданы в .env.\n' +
      'Получи ключи: canva.com/developers → Create App'
    );
  }

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await axios.post(
      CANVA_TOKEN_URL,
      new URLSearchParams({ grant_type: 'client_credentials' }),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: TIMEOUT,
      }
    );

    const { access_token, expires_in } = res.data;
    cachedToken = { value: access_token, expiresAt: now + expires_in * 1000 };
    console.log('[Canva] Token obtained, expires in', expires_in, 's');
    return access_token;
  } catch (err: any) {
    const status = err.response?.status;
    const body = JSON.stringify(err.response?.data);
    console.error(`[Canva] getCanvaToken — status: ${status}, body: ${body}`);
    throw new Error(`Canva auth error ${status}: ${body || err.message}`);
  }
}

/**
 * GET /v1/designs/:id — получить дизайн по ID
 */
export async function getDesignById(designId: string): Promise<CanvaDesign> {
  const token = await getCanvaToken();
  try {
    const res = await axios.get(`${CANVA_API}/designs/${designId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: TIMEOUT,
    });
    return res.data.design as CanvaDesign;
  } catch (err: any) {
    const status = err.response?.status;
    const body = JSON.stringify(err.response?.data);
    console.error(`[Canva] getDesignById(${designId}) — status: ${status}, body: ${body}`);
    throw new Error(`Canva API error ${status}: ${body || err.message}`);
  }
}

/**
 * POST /v1/designs — создать новый дизайн
 */
export async function createDesign(
  title: string,
  designType: 'presentation' | 'social_media' | 'poster' | 'doc' = 'presentation'
): Promise<CanvaDesign> {
  const token = await getCanvaToken();
  try {
    const res = await axios.post(
      `${CANVA_API}/designs`,
      { title, design_type: { type: designType } },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: TIMEOUT,
      }
    );
    const design = res.data.design as CanvaDesign;
    console.log('[Canva] Design created:', design.id);
    return design;
  } catch (err: any) {
    const status = err.response?.status;
    const body = JSON.stringify(err.response?.data);
    console.error(`[Canva] createDesign — status: ${status}, body: ${body}`);
    throw new Error(`Canva create error ${status}: ${body || err.message}`);
  }
}

/**
 * POST /v1/exports — экспортировать дизайн в PNG/PDF
 * Возвращает URL для скачивания
 */
export async function exportDesign(
  designId: string,
  format: 'png' | 'pdf' = 'png'
): Promise<string> {
  const token = await getCanvaToken();
  try {
    // Инициировать экспорт
    const startRes = await axios.post(
      `${CANVA_API}/exports`,
      { design_id: designId, format: { type: format } },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: TIMEOUT,
      }
    );

    const jobId = startRes.data.job?.id;
    if (!jobId) throw new Error('Canva export: нет job.id в ответе');

    // Polling результата (до 30 секунд)
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await axios.get(`${CANVA_API}/exports/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: TIMEOUT,
      });
      const job = pollRes.data.job;
      if (job.status === 'success') {
        const url = job.urls?.[0];
        if (!url) throw new Error('Canva export: нет URL в результате');
        console.log('[Canva] Export ready:', url);
        return url;
      }
      if (job.status === 'failed') {
        throw new Error(`Canva export failed: ${JSON.stringify(job.error)}`);
      }
    }
    throw new Error('Canva export: timeout exceeded');
  } catch (err: any) {
    const status = err.response?.status;
    const body = JSON.stringify(err.response?.data);
    console.error(`[Canva] exportDesign(${designId}) — status: ${status}, body: ${body}`);
    throw new Error(`Canva export error: ${body || err.message}`);
  }
}

/**
 * Извлечь design ID из ссылки Canva:
 * https://www.canva.com/design/DAFxxx.../view
 * https://www.canva.com/design/DAFxxx.../edit
 */
export function parseCanvaUrl(url: string): string {
  const match = url.match(/canva\.com\/design\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error(`Не удалось извлечь ID дизайна из ссылки: ${url}`);
  return match[1];
}

/**
 * Загрузить дизайн по ссылке Canva и экспортировать PNG
 * Используется для команды /canva [url]
 */
export async function exportByUrl(canvaUrl: string): Promise<CanvaExportResult> {
  if (!hasCredentials()) {
    throw new Error(
      'CANVA_CLIENT_ID / CANVA_CLIENT_SECRET не заданы в .env.\n' +
      'Получи ключи: canva.com/developers → Create App'
    );
  }

  const designId = parseCanvaUrl(canvaUrl);
  const design = await getDesignById(designId);

  let exportUrl: string | undefined;
  try {
    exportUrl = await exportDesign(designId, 'png');
  } catch (exportErr: any) {
    console.warn('[Canva] Export failed, returning view URL only:', exportErr.message);
  }

  return {
    designId: design.id,
    title: design.title,
    editUrl: design.urls.edit_url,
    viewUrl: design.urls.view_url,
    exportUrl,
    thumbnailUrl: design.thumbnail?.url,
  };
}

/**
 * Создать презентацию в Canva из слайдов (fallback от Figma)
 */
export async function createPresentationInCanva(slides: SlideData[]): Promise<string> {
  if (!hasCredentials()) {
    const summary = slides
      .map((s, i) => {
        const parts = [`Слайд ${i + 1} [${s.type}]`];
        if (s.heading) parts.push(s.heading);
        if (s.text) parts.push(s.text);
        return parts.join(': ');
      })
      .join('\n');
    console.warn('[Canva] Ключи не заданы — возвращаем текстовое описание');
    return `⚠️ Canva ключи не заданы. Структура презентации:\n\n${summary}`;
  }

  const title = `Презентация ${new Date().toLocaleDateString('ru-RU')}`;
  const design = await createDesign(title, 'presentation');
  console.log('[Canva] Presentation design created:', design.urls.edit_url);
  return design.urls.edit_url;
}

/**
 * Загрузить медиа (буфер изображения) в библиотеку Canva
 */
export async function uploadMedia(
  mediaBuffer: Buffer,
  filename: string,
  mimeType = 'image/jpeg'
): Promise<string> {
  const token = await getCanvaToken();
  try {
    const res = await axios.post(
      `${CANVA_API}/asset-uploads`,
      mediaBuffer,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': mimeType,
          'Asset-Upload-Metadata': JSON.stringify({
            name_base64: Buffer.from(filename).toString('base64'),
          }),
        },
        timeout: TIMEOUT,
      }
    );
    const assetId = res.data?.job?.id || res.data?.asset?.id;
    console.log('[Canva] Media uploaded, asset id:', assetId);
    return assetId;
  } catch (err: any) {
    const status = err.response?.status;
    const body = JSON.stringify(err.response?.data);
    console.error(`[Canva] uploadMedia — status: ${status}, body: ${body}`);
    throw new Error(`Canva upload error ${status}: ${body || err.message}`);
  }
}
