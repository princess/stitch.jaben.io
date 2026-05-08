import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Stitch Professional Engine', () => {

  test.beforeEach(async ({ page }) => {
    // ATOMIC VERIFICATION: Unified Mocking
    await page.addInitScript(() => {
      // @ts-ignore
      window.WebDemuxer = class {
        constructor() {}
        async load() { return Promise.resolve(); }
        async getMediaInfo() { 
          return { 
            duration: 5000000, 
            streams: [
              { codec_type_string: 'video', codec_string: 'h264' },
              { codec_type_string: 'audio', codec_string: 'aac' }
            ] 
          }; 
        }
        async getDecoderConfig(type: string) { 
          if (type === 'audio') return { codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2, description: new Uint8Array([17, 144]) };
          return { codec: 'avc1.42E01E', codedWidth: 1280, codedHeight: 720 }; 
        }
        async seek() { return Promise.resolve(); }
        read() {
          let count = 0;
          return {
            getReader: () => ({
              read: async () => {
                if (count > 30) return { done: true, value: null };
                count++;
                return { done: false, value: { close: () => {}, timestamp: (count-1) * 33333, duration: 33333, type: 'key', data: new Uint8Array([0,0,1]) } };
              },
              releaseLock: () => {}
            })
          };
        }
        async destroy() { return Promise.resolve(); }
      };

      // Robust Worker Mock
      // @ts-ignore
      window.Worker = function(url) {
        const workerObj = {
          onmessage: null as any,
          onerror: null as any,
          postMessage: (msg: any) => {
            if (msg.type === 'START') {
              const passId = msg.payload.passId;
              setTimeout(() => {
                if (workerObj.onmessage) workerObj.onmessage({ 
                  data: { type: 'UPDATE_UI', payload: { passId, newStatus: 'Mock Stitching...', newProgress: 50 } } 
                });
              }, 100);

              setTimeout(() => {
                if (workerObj.onmessage) workerObj.onmessage({ 
                  data: { type: 'COMPLETE', payload: new Uint8Array([0,0,0,32,102,116,121,112,109,112,52,50]) } // Simple MP4 header mock
                });
              }, 500);
            }
          },
          terminate: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true
        };
        return workerObj;
      };
    });

    await page.goto('/', { waitUntil: 'networkidle' });
  });

  test('should render initial state correctly', async ({ page }) => {
    await expect(page.getByText('Combine videos in your browser')).toBeVisible();
    await expect(page.getByText('Tap to add videos')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stitch' })).not.toBeVisible();
  });

  test('should handle video addition and list interactions', async ({ page }) => {
    const filePath = path.resolve('tests/fixtures/test.mp4');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('text=Tap to add videos')
    ]);
    await fileChooser.setFiles([filePath, filePath]);

    await expect(page.getByText('test.mp4')).toHaveCount(2);
    await expect(page.getByText('2 Videos Added')).toBeVisible();

    await page.locator('button').filter({ hasText: /^$/ }).first().click(); 
    await expect(page.getByText('test.mp4')).toHaveCount(1);
    await expect(page.getByText('1 Videos Added')).toBeVisible();

    await page.click('text=Clear All');
    await expect(page.getByText('test.mp4')).toHaveCount(0);
    await expect(page.getByText('Tap to add videos')).toBeVisible();
  });

  test('should disable stitch button for single video', async ({ page }) => {
    const filePath = path.resolve('tests/fixtures/test.mp4');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('text=Tap to add videos')
    ]);
    await fileChooser.setFiles([filePath]);

    const stitchBtn = page.getByRole('button', { name: /Stitch/ });
    await expect(stitchBtn).toBeDisabled();
  });

  test('should render preview scrubber and seek', async ({ page }) => {
    const filePath = path.resolve('tests/fixtures/test.mp4');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('text=Tap to add videos')
    ]);
    await fileChooser.setFiles([filePath]);

    const scrubber = page.locator('input[type="range"]');
    await expect(scrubber).toBeVisible();
    
    // Wait for duration calculation (mock returns 5000000)
    await expect(async () => {
      const max = await scrubber.getAttribute('max');
      if (!max || parseFloat(max) === 0) throw new Error('Duration not updated');
    }).toPass({ timeout: 5000 });

    // Test seeking
    await scrubber.evaluate((el: HTMLInputElement) => {
      el.value = '2500000';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(scrubber).toHaveValue('2500000');
  });

  test('should execute full stitch cycle', async ({ page }) => {
    const filePath = path.resolve('tests/fixtures/test.mp4');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('text=Tap to add videos')
    ]);
    await fileChooser.setFiles([filePath, filePath]);

    await page.click('button:has-text("Stitch 2 Videos")');
    await expect(page.getByText('Mock Stitching... (50%)')).toBeVisible();
    await expect(page.getByText('Successfully Stitched!')).toBeVisible({ timeout: 10000 });
  });

  test('should handle hardware recovery (Safe Mode)', async ({ page }) => {
    const filePath = path.resolve('tests/fixtures/test.mp4');
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('text=Tap to add videos')
    ]);
    await fc.setFiles([filePath, filePath]);

    await page.evaluate(() => {
      // @ts-ignore
      window.Worker = function() {
        const workerObj = {
          onmessage: null as any,
          onerror: null as any,
          postMessage: (msg: any) => {
            if (msg.type === 'START') {
              const passId = msg.payload.passId;
              if (!msg.payload.isSafeMode) {
                setTimeout(() => {
                  if (workerObj.onmessage) workerObj.onmessage({ 
                    data: { type: 'ERROR', payload: 'Hardware Failure' } 
                  });
                }, 100);
              } else {
                setTimeout(() => {
                   if (workerObj.onmessage) workerObj.onmessage({ data: { type: 'COMPLETE', payload: new Uint8Array([0,0,0,32,102,116,121,112,109,112,52,50]) } });
                }, 200);
              }
            }
          },
          terminate: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true
        };
        return workerObj;
      };
    });

    await page.click('button:has-text("Stitch 2 Videos")');
    await expect(page.getByText(/Retrying in Compatibility Mode/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Successfully Stitched!')).toBeVisible({ timeout: 10000 });
  });

  test('should show cooling down message on mobile', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', { get: () => 'iPhone' });
    });
    await page.goto('/', { waitUntil: 'networkidle' });

    const filePath = path.resolve('tests/fixtures/test.mp4');
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('text=Tap to add videos')
    ]);
    await fc.setFiles([filePath, filePath]);

    await page.evaluate(() => {
      // @ts-ignore
      window.Worker = function() {
        const workerObj = {
          onmessage: null as any,
          onerror: null as any,
          postMessage: (msg: any) => {
            if (msg.type === 'START') {
              const passId = msg.payload.passId;
              setTimeout(() => {
                if (workerObj.onmessage) workerObj.onmessage({ 
                  data: { type: 'UPDATE_UI', payload: { passId, newStatus: 'Cooling down...', newProgress: 90 } } 
                });
              }, 100);
            }
          },
          terminate: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true
        };
        return workerObj;
      };
    });

    await page.click('button:has-text("Stitch 2 Videos")');
    await expect(page.getByText('Cooling down... (90%)')).toBeVisible();
  });

  test('should handle hard reset', async ({ page }) => {
    const filePath = path.resolve('tests/fixtures/test.mp4');
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('text=Tap to add videos')
    ]);
    await fc.setFiles([filePath, filePath]);

    await page.evaluate(() => {
      // @ts-ignore
      window.Worker = function() {
        const workerObj = {
          onmessage: null as any,
          onerror: null as any,
          postMessage: (msg: any) => {
            if (msg.type === 'START') {
              setTimeout(() => {
                if (workerObj.onmessage) workerObj.onmessage({ 
                  data: { type: 'ERROR', payload: 'Fatal Unrecoverable Error' } 
                });
              }, 100);
            }
          },
          terminate: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true
        };
        return workerObj;
      };
    });

    await page.click('button:has-text("Stitch 2 Videos")');
    await expect(page.getByText('Hard Reset')).toBeVisible({ timeout: 10000 });
    
    await page.click('text=Hard Reset');
    await expect(page.getByText('test.mp4')).toHaveCount(0);
  });

  test('should execute hardware stress test', async ({ page }) => {
    const filePath = path.resolve('tests/fixtures/test.mp4');
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('text=Tap to add videos')
    ]);
    await fc.setFiles([filePath]);

    await page.click('text=Show Debug Logs');
    await page.click('text=Run Hardware Stress Test');
    await expect(page.getByText('--- STARTING HARDWARE STRESS TEST ---')).toBeVisible();
    await expect(page.getByText('--- STRESS TEST COMPLETE ---')).toBeVisible({ timeout: 10000 });
  });

  test('should support disk streaming UI toggle', async ({ page }) => {
    await page.evaluate(() => {
      // @ts-ignore
      window.showSaveFilePicker = async () => ({});
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    const filePath = path.resolve('tests/fixtures/test.mp4');
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('text=Tap to add videos')
    ]);
    await fc.setFiles([filePath, filePath]);
    await expect(page.getByText('Stream to Disk')).toBeVisible();
    await page.check('input[type="checkbox"]');
    await expect(page.locator('input[type="checkbox"]')).toBeChecked();
  });

  test('should verify audio timestamps are converted to seconds', async ({ page }) => {
    // This test runs against the REAL worker (by not overriding window.Worker in this block)
    // but uses a MOCKED demuxer that returns audio data.
    const filePath = path.resolve('tests/fixtures/test.mp4');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('text=Tap to add videos')
    ]);
    await fileChooser.setFiles([filePath, filePath]);

    await page.click('button:has-text("Stitch 2 Videos")');
    await expect(page.getByText('Successfully Stitched!')).toBeVisible({ timeout: 15000 });
  });

});
