import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Audio Timestamp Reproduction', () => {

  test('should complete stitching when preview timestamps have slight offset', async ({ page }) => {
    await page.addInitScript(() => {
      (window as typeof window & { WebDemuxer: unknown }).WebDemuxer = class {
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
        async seek() { return Promise.resolve(); }
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

      // Page-level preview decoder wrapper; the real worker owns its own decoder scope.
      const originalAudioDecoder = window.AudioDecoder;
      (window as typeof window & {
        AudioDecoder: typeof AudioDecoder;
        lastAudioData?: { timestamp: number; numberOfFrames: number };
      }).AudioDecoder = class extends originalAudioDecoder {
          constructor(init: AudioDecoderInit) {
              super({
                  ...init,
                  output: (data: AudioData) => {
                      (window as typeof window & {
                        lastAudioData?: { timestamp: number; numberOfFrames: number };
                      }).lastAudioData = {
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

    await page.click('button:has-text("Stitch 2 Videos")');
    
    await expect(page.getByText('Successfully Stitched!')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Show Debug Logs' }).click();
    await expect(page.getByText('[Pass 1] Status: Finished!', { exact: false })).toBeVisible();
  });

});
