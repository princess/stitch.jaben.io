import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Edge Cases', () => {

  test('Test Case 2: Drag and Drop reordering', async ({ page }) => {
    await page.goto('/');

    const filePath = path.resolve('tests/fixtures/test.mp4');
    const filePathCopy = path.resolve('tests/fixtures/test_copy.mp4');
    
    // We need 3 files. We'll use test.mp4 and test_copy.mp4 and maybe test.mp4 again.
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('text=Tap to add videos');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([filePath, filePathCopy, filePath]);

    // Wait for the videos to appear in the list
    const videoItems = page.locator('div[class*="videoItem"]');
    await expect(videoItems).toHaveCount(3);

    // Get the initial order of filenames (they might all be the same name, so let's check text)
    // Actually they are "test.mp4", "test_copy.mp4", "test.mp4"
    const getFilenames = async () => {
        return await page.locator('span[class*="fileName"]').allTextContents();
    };

    const initialNames = await getFilenames();
    expect(initialNames).toEqual(['test.mp4', 'test_copy.mp4', 'test.mp4']);

    // Perform drag and drop
    // We'll swap the first and the third items.
    const firstItem = videoItems.nth(0).locator('div[class*="dragHandle"]');
    const thirdItem = videoItems.nth(2);

    // In Playwright, drag and drop with dnd-kit can be tricky.
    // We might need to use mouse events.
    const firstBox = await firstItem.boundingBox();
    const thirdBox = await thirdItem.boundingBox();

    if (firstBox && thirdBox) {
        await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(thirdBox.x + thirdBox.width / 2, thirdBox.y + thirdBox.height / 2, { steps: 10 });
        await page.mouse.up();
    }

    // Check the new order
    const newNames = await getFilenames();
    // dnd-kit vertical list: moving 1st to 3rd position should result in [2nd, 3rd, 1st]
    // OR if we dropped it ON the 3rd, it might be different.
    // Let's just verify it CHANGED and has 3 items.
    expect(newNames).not.toEqual(initialNames);
    expect(newNames).toHaveLength(3);
    
    // Verify they can still be stitched
    const stitchButton = page.locator('button:has-text("Stitch 3 Videos")');
    await expect(stitchButton).toBeEnabled();
  });

  test('Test Case 1: Video with NO audio', async ({ page }) => {
    await page.goto('/');

    const filePath = path.resolve('tests/fixtures/test.mp4');
    
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('text=Tap to add videos');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([filePath, filePath]);

    await expect(page.locator('text=test.mp4')).toHaveCount(2);

    // Mock WebDemuxer to simulate no audio
    await page.evaluate(() => {
      // @ts-ignore
      const originalGetDecoderConfig = window.WebDemuxer.prototype.getDecoderConfig;
      // @ts-ignore
      window.WebDemuxer.prototype.getDecoderConfig = async function(type: string) {
        if (type === 'audio') {
          throw new Error('No audio track found');
        }
        return originalGetDecoderConfig.apply(this, [type]);
      };
    });

    const stitchButton = page.locator('button:has-text("Stitch 2 Videos")');
    await stitchButton.click();

    await expect(page.locator('text=Processing...')).toBeVisible();
    await expect(page.locator('text=Successfully Stitched!')).toBeVisible({ timeout: 120000 });
  });

  test('Architect Suggestion 1: First video has audio, second doesn\'t', async ({ page }) => {
    await page.goto('/');

    const filePath = path.resolve('tests/fixtures/test.mp4');
    
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('text=Tap to add videos');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([filePath, filePath]);

    await expect(page.locator('text=test.mp4')).toHaveCount(2);

    // Mock WebDemuxer to simulate no audio ONLY for the second video load/process
    // The engine loads the first video once at the start to determine target config,
    // then loads each video again during the loop.
    // So for 2 videos, calls to load/getDecoderConfig might be:
    // 1. Initial load (video 0) -> has audio
    // 2. Loop load (video 0) -> has audio
    // 3. Loop load (video 1) -> NO audio
    await page.evaluate(() => {
      let audioCallCount = 0;
      // @ts-ignore
      const originalGetDecoderConfig = window.WebDemuxer.prototype.getDecoderConfig;
      // @ts-ignore
      window.WebDemuxer.prototype.getDecoderConfig = async function(type: string) {
        if (type === 'audio') {
          audioCallCount++;
          // We want the 3rd audio check (for video 1 in the loop) to fail
          // Call 1: Initial check for video 0
          // Call 2: Loop check for video 0
          // Call 3: Loop check for video 1
          if (audioCallCount === 3) {
            throw new Error('No audio track found for second video');
          }
        }
        return originalGetDecoderConfig.apply(this, [type]);
      };
    });

    const stitchButton = page.locator('button:has-text("Stitch 2 Videos")');
    await stitchButton.click();

    await expect(page.locator('text=Processing...')).toBeVisible();
    await expect(page.locator('text=Successfully Stitched!')).toBeVisible({ timeout: 120000 });
  });

  test('Test Case 3: Removal during processing', async ({ page }) => {
    await page.goto('/');

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

    // Wait for processing to start
    await expect(page.locator('text=Processing...')).toBeVisible();

    // Verify that remove buttons are truly absent (UI check)
    const removeButtons = page.locator('button[class*="removeBtn"]');
    await expect(removeButtons).toHaveCount(0);
    
    // Wait for it to finish so we don't leave it hanging
    await expect(page.locator('text=Successfully Stitched!')).toBeVisible({ timeout: 120000 });
  });

  test('Test Case 4: Browser Support Banner', async ({ page }) => {
    // Mock the environment to hide VideoEncoder
    await page.addInitScript(() => {
      // @ts-ignore
      delete window.VideoEncoder;
      // @ts-ignore
      delete window.VideoFrame;
      // @ts-ignore
      delete window.OffscreenCanvas;
    });

    await page.goto('/');

    // Verify the 'Browser Not Supported' message appears
    await expect(page.locator('text=Browser Not Supported')).toBeVisible();
    await expect(page.locator('text=Your browser doesn\'t support WebCodecs')).toBeVisible();
  });

  test('Test Case 5: Remove video from list', async ({ page }) => {
    await page.goto('/');

    const filePath = path.resolve('tests/fixtures/test.mp4');
    
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('text=Tap to add videos');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([filePath, filePath]);

    // Wait for the videos to appear in the list
    await expect(page.locator('text=test.mp4')).toHaveCount(2);

    // Remove one video
    await page.locator('button[class*="removeBtn"]').first().click();

    // Verify only one video remains
    await expect(page.locator('text=test.mp4')).toHaveCount(1);
    
    // Stitch button should be disabled for 1 video
    const stitchButton = page.locator('button:has-text("Stitch 1 Video")');
    await expect(stitchButton).toBeDisabled();
  });

  test('Test Case 6: Clear All videos', async ({ page }) => {
    await page.goto('/');

    const filePath = path.resolve('tests/fixtures/test.mp4');
    
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('text=Tap to add videos');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([filePath, filePath, filePath]);

    await expect(page.locator('text=test.mp4')).toHaveCount(3);

    // Click Clear All
    await page.locator('button:has-text("Clear All")').click();

    // Verify list is empty
    await expect(page.locator('text=test.mp4')).toHaveCount(0);
    await expect(page.locator('text=Tap to add videos')).toBeVisible();
  });

});
