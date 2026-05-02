import { test, expect } from '@playwright/test';
import path from 'path';

test('force slow path and check for stalls in transition', async ({ page }) => {
  // Set a long timeout for this test
  test.setTimeout(120000);

  await page.goto('/');

  // Force slow path via the flag we added and force backpressure
  await page.addInitScript(() => {
    (window as any).forceSlowPath = true;
    Object.defineProperty(VideoEncoder.prototype, 'encodeQueueSize', {
      get: () => 100
    });
  });

  const filePath = path.resolve('tests/fixtures/test.mp4');
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.click('text=Tap to add videos');
  const fileChooser = await fileChooserPromise;
  
  // Use 3 videos to ensure we have transitions between clips in slow path
  await fileChooser.setFiles([filePath, filePath, filePath]);

  await expect(page.locator('text=test.mp4')).toHaveCount(3);

  const stitchButton = page.locator('button:has-text("Stitch 3 Videos")');
  await stitchButton.click();

  // If it stalls, it will likely not reach "Successfully Stitched!" within timeout
  // Or it might throw an error if the canvas context is messed up
  await expect(page.locator('text=Successfully Stitched!')).toBeVisible({ timeout: 100000 });
});
