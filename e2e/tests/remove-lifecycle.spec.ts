import { expect, test } from '@playwright/test';
import { mainThreadAlive, rapidClick, readProbes, SETTLE_MS, SLOW_MS } from '../helpers/motion';

/**
 * End-to-end regression for the removal animation lifecycle.
 *
 * Covers two edges MotionDemoView never reaches:
 *  1. **Rapid repeated remove clicks** — several removals started inside the exit window;
 *  2. **Parent removeAll() mid-animation** — the element leaves the document while animating.
 *
 * The fixture (`/stress`, see MotionStressView) stretches the exit to 1500ms so that
 * "mid-animation" actions really land mid-flight rather than winning a race by luck.
 */

/** Collects uncaught page errors for each test to assert on. */
function collectPageErrors(page: import('@playwright/test').Page): string[] {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    return errors;
}

test.describe('rapid repeated remove clicks', () => {
    test('N rapid clicks fire the detach callback once and remove the element', async ({ page }) => {
        const errors = collectPageErrors(page);
        await page.goto('/stress');
        await page.locator('#btn-rapid-remove').waitFor();
        await page.waitForTimeout(SLOW_MS); // Let the entrance animation finish

        await rapidClick(page, '#btn-rapid-remove', 10, 30);

        await expect
            .poll(async () => (await readProbes(page)).targetInDom, {
                timeout: SETTLE_MS,
                message: 'the element was never removed after the burst of clicks',
            })
            .toBe(false);

        const probes = await readProbes(page);
        expect(probes.clicks, 'the button really was clicked 10 times').toBe(10);
        // Core deduplication assertion: Motion.removeThen uses an in-flight flag to block
        // repeat calls during the animation, so afterDetach must run exactly once even though
        // the caller clicked 10 times.
        expect(probes.detaches, 'afterDetach should run exactly once (in-flight dedup)').toBe(1);
        expect(probes.rapidHostChildren, 'the parent container should be empty').toBe(0);

        expect(await mainThreadAlive(page)).toBe('alive');
        expect(errors, 'no uncaught errors during the click burst').toEqual([]);
    });

    test('a single click is unaffected by deduplication', async ({ page }) => {
        // Guards against the dedup also blocking the normal path — the easiest thing to break.
        const errors = collectPageErrors(page);
        await page.goto('/stress');
        await page.locator('#btn-rapid-remove').waitFor();
        await page.waitForTimeout(SLOW_MS);

        await page.locator('#btn-rapid-remove').click();

        await expect
            .poll(async () => (await readProbes(page)).detaches, { timeout: SETTLE_MS })
            .toBe(1);

        const probes = await readProbes(page);
        expect(probes.targetInDom).toBe(false);
        expect(probes.rapidHostChildren).toBe(0);
        expect(errors).toEqual([]);
    });

    test('a component re-added after removal can be removed again (flag released)', async ({ page }) => {
        // If the in-flight flag is not cleared on settle, the component is locked forever.
        const errors = collectPageErrors(page);
        await page.goto('/stress');
        await page.locator('#btn-rapid-remove').waitFor();
        await page.waitForTimeout(SLOW_MS);

        await page.locator('#btn-rapid-remove').click();
        await expect.poll(async () => (await readProbes(page)).targetInDom, { timeout: SETTLE_MS }).toBe(false);

        // Reset inserts a fresh instance
        await page.locator('#btn-reset-rapid').click();
        await expect
            .poll(async () => (await readProbes(page)).rapidHostChildren, { timeout: SETTLE_MS })
            .toBe(1);

        // The second removal must work just as well
        await page.locator('#btn-rapid-remove').click();
        await expect
            .poll(async () => (await readProbes(page)).targetInDom, {
                timeout: SETTLE_MS,
                message: 'could not remove again after re-adding — the in-flight flag may not have been released',
            })
            .toBe(false);

        expect(errors).toEqual([]);
    });
});

test.describe('parent removeAll() mid-animation', () => {
    test('clearing the parent during exit removes every element and keeps the page responsive', async ({ page }) => {
        const errors = collectPageErrors(page);
        await page.goto('/stress');
        await page.locator('#btn-clear-mid-flight').waitFor();
        await page.waitForTimeout(SLOW_MS);

        await page.locator('#btn-refill').click();
        await expect
            .poll(async () => (await readProbes(page)).victimHostChildren, { timeout: SETTLE_MS })
            .toBe(3);

        // Clear immediately after starting the exit, so elements leave the document mid-flight.
        // The client's isConnected guard in exit() is evaluated once on entry and cannot catch
        // this; the real safety net is withTimeout plus the getParent() check in the detach
        // callback.
        await page.locator('#btn-clear-mid-flight').click();

        await expect
            .poll(async () => (await readProbes(page)).victimHostChildren, {
                timeout: SETTLE_MS,
                message: 'the parent container did not empty after clearing mid-animation',
            })
            .toBe(0);

        // Key: the main thread keeps running (animating detached elements must not freeze the page)
        await expect
            .poll(() => mainThreadAlive(page), {
                timeout: 10_000,
                message: 'main thread unresponsive: the animation may not settle once elements leave the document',
            })
            .toBe('alive');

        // None of the three victims may remain in the document
        const orphans = await page.evaluate(() =>
            [...document.querySelectorAll('[id^="victim-"]')].filter((e) => e.id !== 'victim-host').length,
        );
        expect(orphans, 'elements cleared mid-animation must not linger in the DOM').toBe(0);

        expect(errors).toEqual([]);
    });

    test('refilling and clearing again accumulates no leftovers', async ({ page }) => {
        const errors = collectPageErrors(page);
        await page.goto('/stress');
        await page.locator('#btn-refill').waitFor();
        await page.waitForTimeout(SLOW_MS);

        for (let round = 1; round <= 3; round++) {
            await page.locator('#btn-refill').click();
            await expect
                .poll(async () => (await readProbes(page)).victimHostChildren, {
                    timeout: SETTLE_MS,
                    message: `refill failed on round ${round}`,
                })
                .toBe(3);

            await page.locator('#btn-clear-mid-flight').click();
            await expect
                .poll(async () => (await readProbes(page)).victimHostChildren, {
                    timeout: SETTLE_MS,
                    message: `clear failed on round ${round}`,
                })
                .toBe(0);

            await expect.poll(() => mainThreadAlive(page), { timeout: 10_000 }).toBe('alive');
        }

        const orphans = await page.evaluate(() =>
            [...document.querySelectorAll('[id^="victim-"]')].filter((e) => e.id !== 'victim-host').length,
        );
        expect(orphans, 'no leftover elements may accumulate across rounds').toBe(0);
        expect(errors).toEqual([]);
    });
});

test.describe('both edges combined', () => {
    test('alternating rapid removes and mid-flight clears keeps the page usable', async ({ page }) => {
        const errors = collectPageErrors(page);
        await page.goto('/stress');
        await page.locator('#btn-rapid-remove').waitFor();
        await page.waitForTimeout(SLOW_MS);

        for (let i = 0; i < 5; i++) {
            // Deliberately not awaited so the two paths genuinely overlap
            void page.locator('#btn-rapid-remove').click({ force: true, timeout: 3_000 }).catch(() => undefined);
            void page.locator('#btn-clear-mid-flight').click({ force: true, timeout: 3_000 }).catch(() => undefined);
            await page.waitForTimeout(80);
        }

        await expect
            .poll(() => mainThreadAlive(page), {
                timeout: 15_000,
                message: 'main thread unresponsive after the combined operations',
            })
            .toBe('alive');

        await expect
            .poll(async () => (await readProbes(page)).victimHostChildren, { timeout: SETTLE_MS })
            .toBe(0);

        // The page still works: refilling should restore three children
        await page.locator('#btn-refill').click();
        await expect
            .poll(async () => (await readProbes(page)).victimHostChildren, {
                timeout: SETTLE_MS,
                message: 'the page lost functionality after the combined operations',
            })
            .toBe(3);

        expect(errors).toEqual([]);
    });
});
