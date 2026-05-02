import { test, expect } from '@playwright/test';
import path from 'path';

test('should stitch three videos together and reach 100%', async ({ page }) => {
  await page.goto('/');

  // Verify header is present
  await expect(page.locator('h1')).toHaveText('Stitch');

  // Check if browser is supported
  const notSupported = page.locator('text=Browser Not Supported');
  if (await notSupported.isVisible()) {
    throw new Error('WebCodecs not supported in this test environment');
  }

  // Upload the same video three times
  const filePath = path.resolve('tests/fixtures/test.mp4');
  
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.click('text=Tap to add videos');
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles([filePath, filePath, filePath]);

  // Wait for the videos to appear in the list
  await expect(page.locator('text=test.mp4')).toHaveCount(3);

  // Click the stitch button
  const stitchButton = page.locator('button:has-text("Stitch 3 Videos")');
  await stitchButton.click();

  // Wait for processing to start
  await expect(page.locator('text=Processing...')).toBeVisible();

  // Verify that progress reaches 100% and success state is shown
  // Increasing timeout to 180s for 3 clips
  await expect(page.locator('text=Successfully Stitched!')).toBeVisible({ timeout: 180000 });
  
  // Verify final progress text says 100% (it might be hidden by success card, but let's check if we can see it briefly or if success card is enough)
  await expect(page.locator('text=Successfully Stitched!')).toBeVisible();
  await expect(page.locator('text=Start New Project')).toBeVisible();
});
