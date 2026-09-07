import { expect, test } from '@playwright/test';
import { SETTLE_MS, bootIntoConsole, collectPageErrors, openTab, queueIds } from '../helpers/console';

/**
 * Console shell regression: tab switching, state retention and reduced-motion.
 *
 * Switching tabs tears a panel down and rebuilds it, which is where persistent bindings (FLIP,
 * sortable, scroll, draggable, animatable) are most likely to break: they rebind on attach, so
 * a leak or a missing rebind only shows up after repeated switching rather than on first load.
 */

test.describe('tab switching', () => {
    test('each tab mounts its own panel and only that panel', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);

        const mounted = (): Promise<Record<string, boolean>> =>
            page.evaluate(() => ({
                queue: !!document.querySelector('#incident-queue'),
                topology: !!document.querySelector('#topology-body'),
                postmortem: !!document.querySelector('#postmortem-content'),
                warroom: !!document.querySelector('#war-room-board'),
            }));

        expect(await mounted(), 'the queue should be the default tab').toEqual({
            queue: true, topology: false, postmortem: false, warroom: false,
        });

        await openTab(page, 'topology');
        expect(await mounted()).toEqual({
            queue: false, topology: true, postmortem: false, warroom: false,
        });

        await openTab(page, 'postmortem');
        expect(await mounted()).toEqual({
            queue: false, topology: false, postmortem: true, warroom: false,
        });

        await openTab(page, 'warroom');
        expect(await mounted()).toEqual({
            queue: false, topology: false, postmortem: false, warroom: true,
        });

        await openTab(page, 'queue');
        expect(await mounted()).toEqual({
            queue: true, topology: false, postmortem: false, warroom: false,
        });

        expect(errors).toEqual([]);
    });

    test('switching is instant, with no entrance animation on the panel', async ({ page }) => {
        // Tab switching happens constantly during an incident; any delay would be felt. The
        // panel must be at full opacity as soon as it mounts.
        await bootIntoConsole(page);
        await page.locator('#tab-topology').click();
        await page.locator('#topology-body').waitFor({ state: 'attached' });

        const opacity = await page.evaluate(() => {
            const host = document.querySelector<HTMLElement>('#panel-host');
            return host ? Number(getComputedStyle(host).opacity) : 0;
        });
        expect(opacity, 'the panel should mount fully opaque, not fade in').toBe(1);
    });

    test('queue state survives switching away and back', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);

        await page.locator('#btn-simulate-page').click();
        await expect
            .poll(async () => (await queueIds(page)).length, { timeout: SETTLE_MS })
            .toBe(4);
        const before = await queueIds(page);

        await openTab(page, 'topology');
        await page.waitForTimeout(400);
        await openTab(page, 'queue');
        await page.waitForTimeout(600);

        expect(await queueIds(page), 'the queue must not reset when the tab is revisited').toEqual(
            before,
        );
        expect(errors).toEqual([]);
    });

    test('repeated switching leaks no errors and leaves the console usable', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);

        for (let i = 0; i < 5; i++) {
            await openTab(page, 'topology');
            await openTab(page, 'postmortem');
            await openTab(page, 'warroom');
            await openTab(page, 'queue');
        }

        // Still functional: the queue must accept a new page after all that rebinding.
        const before = await queueIds(page);
        await page.locator('#btn-simulate-page').click();
        await expect
            .poll(async () => (await queueIds(page)).length, {
                timeout: SETTLE_MS,
                message: 'the console lost functionality after repeated tab switching',
            })
            .toBe(before.length + 1);

        expect(errors, 'repeated switching should leak no uncaught errors').toEqual([]);
    });
});

test.describe('reduced motion', () => {
    test('every duration collapses while the behaviour stays identical', async ({ browser }) => {
        const context = await browser.newContext({ reducedMotion: 'reduce' });
        const page = await context.newPage();
        // Reduced motion must not become a separate code path: the business logic and callback
        // ordering stay the same, only the durations go to zero. Resolving a row still has to
        // remove it and update the metrics.
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);

        const before = await queueIds(page);
        await page
            .locator('#incident-queue > div')
            .first()
            .getByRole('button', { name: 'Resolve' })
            .click();

        await expect
            .poll(async () => (await queueIds(page)).length, {
                timeout: SETTLE_MS,
                message: 'resolving stopped working under reduced motion',
            })
            .toBe(before.length - 1);

        // Callbacks must still fire, so the metrics must still update.
        await expect
            .poll(() => page.evaluate(() => document.querySelector('#metric-closed')?.textContent ?? ''), {
                timeout: SETTLE_MS,
                message: 'the detach callback never ran under reduced motion',
            })
            .toBe('1');

        expect(errors).toEqual([]);
        await context.close();
    });
});
