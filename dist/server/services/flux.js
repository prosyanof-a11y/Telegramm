import { fal } from '@fal-ai/client';
import dotenv from 'dotenv';
dotenv.config();
export async function generateImage(prompt, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const result = await fal.subscribe('fal-ai/flux/schnell', {
                input: {
                    prompt,
                    image_size: 'landscape_4_3',
                    num_inference_steps: 4,
                    num_images: 1,
                    enable_safety_checker: true,
                },
                logs: true,
                onQueueUpdate: (update) => {
                    if (update.status === 'IN_PROGRESS' && update.logs) {
                        update.logs.map((log) => log.message).forEach(console.log);
                    }
                },
            });
            return result.images[0].url;
        }
        catch (error) {
            console.error(`Error generating image (attempt ${i + 1}):`, error);
            if (i === retries - 1)
                throw error;
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
    throw new Error('Failed to generate image after retries');
}
