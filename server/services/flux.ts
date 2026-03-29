import { fal } from '@fal-ai/client';
import dotenv from 'dotenv';

dotenv.config();

// Configure fal client (Railway uses FAL_API_KEY, fal expects FAL_KEY)
fal.config({
  credentials: process.env.FAL_KEY || process.env.FAL_API_KEY,
});

const IMAGE_TIMEOUT_MS = 30000; // 30 seconds

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms)
    ),
  ]);
}

export async function generateImage(prompt: string, retries = 3): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      const result: any = await withTimeout(
        fal.subscribe('fal-ai/flux/schnell', {
          input: {
            prompt,
            image_size: 'landscape_4_3',
            num_inference_steps: 4,
            num_images: 1,
            enable_safety_checker: true,
          },
          logs: true,
          onQueueUpdate: (update: any) => {
            if (update.status === 'IN_PROGRESS' && update.logs) {
              update.logs.map((log: any) => log.message).forEach(console.log);
            }
          },
        }),
        IMAGE_TIMEOUT_MS,
        'fal.subscribe'
      );
      return result.images[0].url;
    } catch (error: any) {
      console.error(`[Flux] Error generating image (attempt ${i + 1}/${retries}):`, error.message || error);
      if (i === retries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error('Failed to generate image after retries');
}
