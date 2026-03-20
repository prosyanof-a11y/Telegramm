import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

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

export async function createPresentation(slides: SlideData[]): Promise<string> {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) throw new Error('FIGMA_ACCESS_TOKEN is not set');

  // In a real implementation, this would use the Figma REST API to create a file
  // and populate it with the slides data.
  // Since Figma REST API doesn't easily allow creating files from scratch with full layout
  // without a plugin, we'll mock the URL return for this example.
  
  console.log('Creating presentation with slides:', JSON.stringify(slides, null, 2));
  
  // Mock API call
  await new Promise(resolve => setTimeout(resolve, 2000));

  return 'https://www.figma.com/file/mock_presentation_id/Generated-Presentation';
}
