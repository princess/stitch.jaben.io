import { test, expect } from '@playwright/test';
import path from 'path';

test('should support 1080p resolution in Compatibility Mode', async ({ page }) => {
  await page.goto('/');

  // Mock a 1080p failure on the first pass
  await page.addInitScript(() => {
    let globalPassCount = 0;
    const OriginalWebDemuxer = (window as any).WebDemuxer;
    (window as any).WebDemuxer = class extends OriginalWebDemuxer {
      async getDecoderConfig(type: string) {
        const config = await super.getDecoderConfig(type);
        if (type === 'video') {
          return { ...config, codedWidth: 1920, codedHeight: 1080 };
        }
        return config;
      }
    };

    const OriginalVideoEncoder = window.VideoEncoder;
    (window as any).VideoEncoder = class extends OriginalVideoEncoder {
      configure(config: any) {
        globalPassCount++;
        // Fail the first pass to trigger retry
        if (globalPassCount === 1) throw new Error('Simulated HW Failure');
        return super.configure(config);
      }
    };
  });

  const filePath = path.resolve('tests/fixtures/test.mp4');
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.click('text=Tap to add videos');
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles([filePath, filePath]);

  const stitchButton = page.locator('button:has-text("Stitch 2 Videos")');
  await stitchButton.click();

  // Wait for it to finish (which proves the 1080p config was accepted)
  await expect(page.locator('text=Successfully Stitched!')).toBeVisible({ timeout: 120000 });
});

test('should stitch two videos together', async ({ page }) => {
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.error('PAGE ERROR:', error.message));

  await page.goto('/');

  // Verify header is present
  await expect(page.locator('h1')).toHaveText('Stitch');

  // Check if browser is supported
  const notSupported = page.locator('text=Browser Not Supported');
  if (await notSupported.isVisible()) {
    throw new Error('WebCodecs not supported in this test environment');
  }

  // Upload the same video twice
  const filePath = path.resolve('tests/fixtures/test.mp4');
  
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.click('text=Tap to add videos');
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles([filePath, filePath]);

  // Wait for the videos to appear in the list
  await expect(page.locator('text=test.mp4')).toHaveCount(2);

  // Click the stitch button
  const stitchButton = page.locator('button:has-text("Stitch 2 Videos")');
  await stitchButton.click();

  // Wait for success message
  await expect(page.locator('text=Successfully Stitched!')).toBeVisible({ timeout: 120000 });

  // Verify that the "Start New Project" button is visible
  await expect(page.locator('text=Start New Project')).toBeVisible();
});
