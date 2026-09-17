import { expect, test } from '@playwright/test';
import { SETTLE_MS, bootIntoConsole, openTab } from '../helpers/console';

/**
 * Phone viewport: the metrics strip wraps to two per row, the incident table scrolls sideways
 * inside its own container instead of widening the page, the postmortem timeline drops to two
 * columns, and no tab makes the document wider than the screen. Runs only in the mobile project.
 */
const pageOverflows = (page: import('@playwright/test').Page) =>
    page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

test.describe('phone viewport', () => {
    test('metrics wrap, queue scrolls in place, no tab overflows the page', async ({ page }) => {
        await bootIntoConsole(page);
        expect(await pageOverflows(page)).toBe(false);

        const cards = page.locator('.metric-card');
        await expect(cards).toHaveCount(4);
        // The cards slide in staggered; measure once the entrance has settled.
        await expect
            .poll(
                () => cards.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size),
                { timeout: SETTLE_MS, message: 'four cards should sit on two rows' },
            )
            .toBe(2);

        const table = page.locator('.queue-table');
        const scrollable = await table.evaluate((e) => e.scrollWidth > e.clientWidth);
        expect(scrollable, 'the seven-column table scrolls inside its container').toBe(true);

        for (const tab of ['topology', 'postmortem', 'warroom'] as const) {
            await openTab(page, tab);
            expect(await pageOverflows(page), `${tab} must not widen the page`).toBe(false);
        }
        const entry = page.locator('.pm-entry').first();
        await openTab(page, 'postmortem');
        await expect(entry).toBeVisible();
        const columns = await entry.evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
        expect(columns).toBe(2);
    });
});
