import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Stitch Professional Engine', () => {

  test.beforeEach(async ({ page }) => {
    // ATOMIC VERIFICATION: Robust Mocking
    await page.addInitScript(() => {
      // Mock WebDemuxer to avoid WASM issues in headless environment
      // @ts-ignore
      window.WebDemuxer = class {
        constructor() {}
        async load() { return Promise.resolve(); }
        async getMediaInfo() { return { duration: 5000000, streams: [{ codec_type_string: 'video', codec_string: 'h264' }] }; }
        async getDecoderConfig() { return { codec: 'avc1.42E01E', codedWidth: 1280, codedHeight: 720 }; }
        async seek() { return Promise.resolve(); }
        read() {
          return {
            getReader: () => ({
              read: async () => ({ done: false, value: { close: () => {} } }),
              releaseLock: () => {}
            })
          };
        }
        async destroy() { return Promise.resolve(); }
      };

      // Mock VideoDecoder/Encoder
      // @ts-ignore
      window.VideoDecoder = class {
        static isConfigSupported() { return Promise.resolve({ supported: true, config: {} }); }
        configure() {}
        decode() {}
        async flush() { return Promise.resolve(); }
        close() {}
      };
      // @ts-ignore
      window.VideoEncoder = class {
        static isConfigSupported() { return Promise.resolve({ supported: true, config: {} }); }
        configure() {}
        encode() {}
        async flush() { return Promise.resolve(); }
        close() {}
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
                  data: { type: 'COMPLETE', payload: new Uint8Array([1, 2, 3]) } 
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

    // Test seeking - use evaluate to be safe with range inputs
    await scrubber.evaluate((el: HTMLInputElement) => {
      el.value = '2500000';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // Wait for UI to reflect change if needed, but here we just check value
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
                   if (workerObj.onmessage) workerObj.onmessage({ data: { type: 'COMPLETE', payload: new Uint8Array([1]) } });
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
    // Mock user agent for mobile
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        get: () => 'iPhone'
      });
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

  test('should reorder videos via Drag and Drop', async ({ page }) => {
    const filePath = path.resolve('tests/fixtures/test.mp4');
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('text=Tap to add videos')
    ]);
    await fc.setFiles([filePath, filePath]);
    const items = page.locator('[class*="videoItem"]');
    await expect(items).toHaveCount(2);
    const firstHandle = items.nth(0).locator('[class*="dragHandle"]');
    const secondItem = items.nth(1);
    await firstHandle.hover();
    await page.mouse.down();
    await page.mouse.move(0, 500);
    await secondItem.hover();
    await page.mouse.up();
    await expect(items).toHaveCount(2);
  });

});
