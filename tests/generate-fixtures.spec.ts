import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.setTimeout(300000); // 5 minutes

test('generate 30s and 50s test videos', async ({ page }) => {
  await page.goto('about:blank');

  const generateVideo = async (durationSeconds: number, fileName: string) => {
    console.log(`Generating ${durationSeconds}s video: ${fileName}`);
    
    const videoBlob: Blob = await page.evaluate(async (duration) => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      document.body.appendChild(canvas);
      const ctx = canvas.getContext('2d')!;
      
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks: Blob[] = [];
      
      recorder.ondataavailable = (e) => chunks.push(e.data);
      const promise = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      });
      
      recorder.start();
      
      const totalFrames = duration * 30;
      for (let i = 0; i < totalFrames; i++) {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = 'white';
        ctx.font = '48px monospace';
        ctx.fillText(`${Math.floor(i / 30)}s / ${duration}s`, 50, 100);
        ctx.fillText(`Frame: ${i}`, 50, 200);
        
        // Wait 10ms between frames to allow MediaRecorder to process
        await new Promise(r => setTimeout(r, 10));
      }
      
      recorder.stop();
      const blob = await promise;
      document.body.removeChild(canvas);
      return blob;
    }, durationSeconds);

    const buffer = Buffer.from(await (videoBlob as any).arrayBuffer());
    const filePath = path.resolve('tests/fixtures', fileName);
    fs.writeFileSync(filePath, buffer);
    console.log(`Saved ${filePath}`);
  };

  // Create fixtures directory if it doesn't exist
  const fixturesDir = path.resolve('tests/fixtures');
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  await generateVideo(30, '30s.webm');
  await generateVideo(50, '50s.webm');
});
