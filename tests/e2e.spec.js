import { test, expect } from '@playwright/test';

// Helper function to bypass the title screen and enter the lake UI
async function enterLakeUI(page) {
    await page.goto('/');
    await page.waitForTimeout(3000); // Wait for title screen intro
    await page.mouse.click(500, 300); // Click to bypass title
    await page.waitForTimeout(2000); // Wait for lake transition
}

// Helper to select a song in a human-realistic way (mimicking rotation and then selection)
async function selectSongHumanWay(page, title) {
    const label = page.locator('.song-label', { hasText: title });
    await label.evaluate(el => el.click()); // Click 1: Start rotation to front
    await page.waitForTimeout(1800);      // Wait for rotation transition to complete
    await label.evaluate(el => el.click()); // Click 2: Load song
}

// Helper to wait for loading screen to hide
async function waitForLoadComplete(page) {
    const errorScreen = page.locator('#error-screen');
    await page.waitForTimeout(2000);
    const isErrorVisible = await errorScreen.evaluate((node) => node.style.display !== 'none');
    if (isErrorVisible) {
        throw new Error('Error screen detected. Token may be missing or CORS issue.');
    }
    
    // Wait for glassmorphism loading overlay to fade out
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 45000 });
    await page.waitForTimeout(1000);
}

// Helper to trigger play and skip intro instrumental
async function startPlaybackAndSkipIntro(page, seekMs = 15000) {
    const playBtn = page.locator('#play-pause-btn');
    await expect(playBtn).toBeVisible();
    await playBtn.evaluate(b => b.click());
    await page.waitForTimeout(2000); // Let playback initialize
    
    // Seek forward to bypass initial long instrumental intros
    await page.evaluate((ms) => {
        if (window.app && window.app.playerManager && window.app.playerManager.player) {
            window.app.playerManager.player.requestMediaSeek(ms);
        }
    }, seekMs);
    await page.waitForTimeout(1500);
}

// Helper to go back to lake UI
async function goBackToLake(page) {
    const backBtn = page.locator('#back-to-lake');
    await expect(backBtn).toBeVisible();
    await backBtn.click({ force: true });
    await page.waitForTimeout(2000);
}

test.describe('Magical Mirai 2026 E2E App Behavior - Full 6 Song Suite', () => {

    test('1. こたえて (kotaete) - 3D grid, answer prompt selection & ripple', async ({ page }) => {
        test.setTimeout(180000);
        page.on('console', msg => console.log(`[Kotaete] ${msg.type()}: ${msg.text()}`));
        
        await enterLakeUI(page);
        
        // Select Kotaete (default focused, click 1 is selection)
        await selectSongHumanWay(page, 'こたえて');
        
        await waitForLoadComplete(page);
        await startPlaybackAndSkipIntro(page, 45000); // Seek near chorus for selection UI
        
        // Interaction: Click multiple times on canvas to trigger interactive ripples
        for (let i = 0; i < 5; i++) {
            await page.mouse.click(200 + i * 100, 300 + (i % 2) * 50);
            await page.waitForTimeout(200);
        }
        
        // Verify time update progresses
        await page.waitForFunction(() => {
            const scene = window.app && window.app.currentSongScene;
            return scene && scene.currentTime > 1000;
        }, { timeout: 20000 });
        
        await page.screenshot({ path: 'test-results/kotaete-full-proof.png' });
        
        await goBackToLake(page);
    });

    test('2. アフター・ザ・カーテン (after) - Spotlight steering parallax & curtain', async ({ page }) => {
        test.setTimeout(180000);
        page.on('console', msg => console.log(`[After] ${msg.type()}: ${msg.text()}`));
        
        await enterLakeUI(page);
        
        // Select After the Curtain
        await selectSongHumanWay(page, 'アフター・ザ・カーテン');
        
        await waitForLoadComplete(page);
        await startPlaybackAndSkipIntro(page, 20000);
        
        // Interaction: Steer the spotlight by dragging / moving the mouse around the scene
        await page.mouse.move(100, 200);
        await page.waitForTimeout(200);
        await page.mouse.move(700, 500);
        await page.waitForTimeout(200);
        await page.mouse.move(400, 300);
        
        await page.waitForFunction(() => {
            const scene = window.app && window.app.currentSongScene;
            return scene && scene.currentTime > 500;
        }, { timeout: 20000 });
        
        await page.screenshot({ path: 'test-results/after-full-proof.png' });
        
        await goBackToLake(page);
    });

    test('3. シャッターチャンス (shutter) - Click to capture polaroid lyrics', async ({ page }) => {
        test.setTimeout(180000);
        page.on('console', msg => console.log(`[Shutter] ${msg.type()}: ${msg.text()}`));
        page.on('pageerror', error => console.error(`[Shutter ERROR] ${error.stack || error.message}`));
        page.on('requestfailed', request => console.error(`[Request Failed] ${request.url()}: ${request.failure() ? request.failure().errorText : 'unknown'}`));
        page.on('response', response => {
            console.log(`[Response] ${response.status()} ${response.url()}`);
        });
        
        await enterLakeUI(page);
        
        // Select Shutter Chance
        await selectSongHumanWay(page, 'シャッターチャンス');
        
        await waitForLoadComplete(page);
        
        // Click the tutorial start button which triggers the cast selector
        const startBtn = page.locator('.song-tutorial-btn');
        await expect(startBtn).toBeVisible();
        await startBtn.click();
        
        // Wait for the cast selector to appear and click Miku
        const mikuBtn = page.locator('.shutter-cast-btn[data-key="miku"]');
        await mikuBtn.waitFor({ state: 'visible', timeout: 15000 });
        await mikuBtn.click();
        await page.waitForTimeout(1000);
        
        // Skip intro to lyrics
        await page.evaluate((ms) => {
            if (window.app && window.app.playerManager && window.app.playerManager.player) {
                window.app.playerManager.player.requestMediaSeek(ms);
            }
        }, 28000);
        await page.waitForTimeout(1500);
        
        // Interaction: Trigger polaroid capture clicks
        // This takes a "snapshot" of current lyrics and spawns dropping photo sprites
        await page.mouse.click(500, 250);
        await page.waitForTimeout(300);
        await page.mouse.click(500, 350);
        await page.waitForTimeout(300);
        
        await page.waitForFunction(() => {
            const scene = window.app && window.app.currentSongScene;
            return scene && scene.currentTime > 1000;
        }, { timeout: 20000 });
        
        await page.screenshot({ path: 'test-results/shutter-full-proof.png' });
        
        await goBackToLake(page);
    });

    test('4. 世界最後の音楽隊 (orchestra) - Drag to draw 3D ribbons & click fireworks', async ({ page }) => {
        test.setTimeout(180000);
        page.on('console', msg => console.log(`[Orchestra] ${msg.type()}: ${msg.text()}`));
        
        await enterLakeUI(page);
        
        // Select Orchestra
        await selectSongHumanWay(page, '世界最後の音楽隊');
        
        await waitForLoadComplete(page);
        await startPlaybackAndSkipIntro(page, 15000);
        
        // Interaction: Drag mouse to draw dynamic 3D ribbons in the sky
        await page.mouse.move(300, 300);
        await page.mouse.down();
        await page.mouse.move(500, 200);
        await page.mouse.move(700, 400);
        await page.mouse.up();
        await page.waitForTimeout(300);
        
        // Click to launch musical note fireworks
        await page.mouse.click(500, 150);
        await page.waitForTimeout(200);
        await page.mouse.click(600, 200);
        
        await page.waitForFunction(() => {
            const scene = window.app && window.app.currentSongScene;
            return scene && scene.currentTime > 1000;
        }, { timeout: 20000 });
        
        await page.screenshot({ path: 'test-results/orchestra-full-proof.png' });
        
        await goBackToLake(page);
    });

    test('5. トリツクロジー (tricktology) - Drag to ripple & distort inverted world', async ({ page }) => {
        test.setTimeout(180000);
        page.on('console', msg => console.log(`[Tricktology] ${msg.type()}: ${msg.text()}`));
        
        await enterLakeUI(page);
        
        // Select Tricktology
        await selectSongHumanWay(page, 'トリツクロジー');
        
        await waitForLoadComplete(page);
        await startPlaybackAndSkipIntro(page, 32000); // Seek close to chorus
        
        // Interaction: Distort inverted reflection by dragging mouse across screen
        await page.mouse.move(200, 400);
        await page.mouse.down();
        await page.mouse.move(600, 400);
        await page.mouse.up();
        
        await page.waitForFunction(() => {
            const scene = window.app && window.app.currentSongScene;
            return scene && scene.currentTime > 1000;
        }, { timeout: 20000 });
        
        await page.screenshot({ path: 'test-results/tricktology-full-proof.png' });
        
        await goBackToLake(page);
    });

    test('6. TAKEOVER (takeover) - Click/smash block particles & glitch chorus', async ({ page }) => {
        test.setTimeout(180000);
        page.on('console', msg => console.log(`[Takeover] ${msg.type()}: ${msg.text()}`));
        
        await enterLakeUI(page);
        
        // Select Takeover
        await selectSongHumanWay(page, 'TAKEOVER');
        
        await waitForLoadComplete(page);
        await startPlaybackAndSkipIntro(page, 26000);
        
        // Interaction: Click around to smash noisy pixel block grids
        await page.mouse.click(400, 300);
        await page.waitForTimeout(200);
        await page.mouse.click(600, 400);
        await page.waitForTimeout(200);
        
        await page.waitForFunction(() => {
            const scene = window.app && window.app.currentSongScene;
            return scene && scene.currentTime > 500;
        }, { timeout: 20000 });
        
        await page.screenshot({ path: 'test-results/takeover-full-proof.png' });
        
        await goBackToLake(page);
    });
    test('7. Window Resize and Mobile Responsiveness', async ({ page }) => {
        test.setTimeout(90000);
        await enterLakeUI(page);
        
        // Change viewport size to simulate arbitrary user resize on Lake UI
        await page.setViewportSize({ width: 1200, height: 800 });
        await page.waitForTimeout(1000);
        
        await page.setViewportSize({ width: 375, height: 667 });
        await page.waitForTimeout(1000);
        
        // Select a song to ensure scene resize also works
        await selectSongHumanWay(page, 'こたえて');
        
        await waitForLoadComplete(page);
        await startPlaybackAndSkipIntro(page, 15000);
        
        // Resize during playback
        await page.setViewportSize({ width: 800, height: 600 });
        await page.waitForTimeout(1000);
        await page.setViewportSize({ width: 414, height: 896 });
        await page.waitForTimeout(1000);
        
        // Check if player is still running and didn't crash
        await page.waitForFunction(() => {
            const scene = window.app && window.app.currentSongScene;
            return scene && scene.currentTime > 500;
        }, { timeout: 20000 });
        
        await page.screenshot({ path: 'test-results/resize-full-proof.png' });
        
        await goBackToLake(page);
    });
});
