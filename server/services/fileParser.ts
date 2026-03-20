import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import axios from 'axios';

export async function parseFile(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase();

  if (ext === 'pdf') {
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (ext === 'txt') {
    return buffer.toString('utf-8');
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

export async function parseUrl(url: string): Promise<string> {
  try {
    const response = await axios.get(url);
    // Basic HTML stripping, in a real app use cheerio or similar
    const text = response.data.replace(/<[^>]*>?/gm, ' ');
    return text;
  } catch (error) {
    console.error('Error parsing URL:', error);
    throw new Error('Failed to parse URL');
  }
}
