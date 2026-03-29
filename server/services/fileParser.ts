import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import axios from 'axios';

export async function parseFile(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase();

  if (ext === 'pdf') {
    try {
      const data = await pdfParse(buffer);
      return data.text;
    } catch (err: any) {
      console.error('[FileParser] PDF parse error:', err.message);
      throw new Error(`Ошибка разбора PDF: ${err.message}`);
    }
  }

  if (ext === 'docx') {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (err: any) {
      console.error('[FileParser] DOCX parse error:', err.message);
      throw new Error(`Ошибка разбора DOCX: ${err.message}`);
    }
  }

  if (ext === 'txt') {
    return buffer.toString('utf-8');
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

export async function parseUrl(url: string): Promise<string> {
  try {
    const response = await axios.get(url, { timeout: 30000 });
    // Basic HTML stripping
    const text = response.data.replace(/<[^>]*>?/gm, ' ');
    return text;
  } catch (error: any) {
    console.error('[FileParser] parseUrl error:', error.message || error);
    throw new Error(`Failed to parse URL: ${error.message}`);
  }
}
