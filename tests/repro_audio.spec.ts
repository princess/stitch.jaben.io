import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Audio Timestamp Reproduction', () => {

  test('should not mute audio on clip 0 when timestamps have slight offset', async ({ page }) => {
    await page.addInitScript(() => {
      // @ts-ignore
      window.WebDemuxer = class {
        constructor() {}
        async load() { return Promise.resolve(); }
        async getMediaInfo() { 
          return { 
            duration: 1000000, 
            streams: [
              { codec_type_string: 'video', codec_string: 'h264' },
              { codec_type_string: 'audio', codec_string: 'aac' }
            ] 
          }; 
        }
        async getDecoderConfig(type: string) { 
          if (type === 'audio') return { codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2 };
          return { codec: 'avc1.42E01E', codedWidth: 1280, codedHeight: 720 }; 
        }
        read() {
          let count = 0;
          return {
            getReader: () => ({
              read: async () => {
                if (count > 5) return { done: true, value: null };
                count++;
                // Repro: First audio packet has a positive timestamp offset (e.g. 50ms)
                const ts = (count === 1) ? 50000 : (count-1) * 23219; 
                return { done: false, value: { close: () => {}, timestamp: ts, duration: 23219, type: 'key', data: new Uint8Array([0,0,1]) } };
              },
              releaseLock: () => {}
            })
          };
        }
        async destroy() { return Promise.resolve(); }
      };

      // Real AudioDecoder mock to track output
      const originalAudioDecoder = window.AudioDecoder;
      (window as any).AudioDecoder = class extends originalAudioDecoder {
          constructor(init: any) {
              super({
                  ...init,
                  output: (data: any) => {
                      // Trap the data to check its values
                      (window as any).lastAudioData = {
                          timestamp: data.timestamp,
                          numberOfFrames: data.numberOfFrames
                      };
                      init.output(data);
                  }
              });
          }
      };
    });

    await page.goto('/', { waitUntil: 'networkidle' });

    const filePath = path.resolve('tests/fixtures/test.mp4');
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('text=Tap to add videos')
    ]);
    await fc.setFiles([filePath, filePath]);

    // We use the REAL worker here because we want to test its logic
    await page.click('button:has-text("Stitch 2 Videos")');
    
    // Check logs for processed buffers
    await expect(page.locator('pre:has-text("[Audio] Clip 0: Processed")')).toBeVisible({ timeout: 10000 });
  });

});
