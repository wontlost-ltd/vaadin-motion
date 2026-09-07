import { expect, test } from '@playwright/test';
import { SETTLE_MS, bootIntoConsole, collectPageErrors, metrics } from '../helpers/console';

/**
 * Metrics regression: count-up, selective highlighting and colour parsing.
 *
 * Two product decisions are locked down here. Values **count** rather than snap, so a figure
 * that changed while the engineer was looking at the queue still leaves a trace. And only the
 * figures that actually moved are highlighted — flashing all four on every change would train
 * the engineer to ignore the highlight entirely.
 */

test.describe('count-up', () => {
    test('a changed figure counts through intermediate values instead of snapping', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);

        const text = (): Promise<string> =>
            page.evaluate(() => document.querySelector('#metric-users')?.textContent ?? '');

        const before = await text();
        await page.locator('#btn-simulate-page').click();

        // Sample densely through the count: the intermediate values are the whole point, and a
        // single read after a fixed sleep can land after the animation has settled.
        const samples = new Set<string>();
        const deadline = Date.now() + 2_500;
        while (Date.now() < deadline) {
            samples.add(await text().catch(() => ''));
            await page.waitForTimeout(50);
        }
        samples.delete('');

        expect(
            samples.size,
            'the figure jumped straight to its new value — no counting occurred',
        ).toBeGreaterThan(2);

        const end = await text();
        expect(end, 'the figure should have changed').not.toBe(before);
        expect(
            Number(end.replace(/,/g, '')),
            'the final value should be a valid number',
        ).toBeGreaterThan(0);
    });

    test('figures above a thousand carry thousands separators', async ({ page }) => {
        await bootIntoConsole(page);
        const users = await page.evaluate(
            () => document.querySelector('#metric-users')?.textContent ?? '',
        );
        expect(Number(users.replace(/,/g, '')), 'the seed should exceed a thousand').toBeGreaterThan(
            999,
        );
        expect(users, 'large figures should be grouped for readability').toMatch(/,/);
    });

    test('the first render does not animate', async ({ page }) => {
        // Everything counting up on arrival is noise: nothing has changed yet, so nothing should
        // draw the eye. The seeded values must be present the moment the console appears.
        await bootIntoConsole(page);
        const initial = await metrics(page);
        expect(initial.open, 'the open count should be seeded, not counted up from zero').toBe(3);
        expect(initial.sev1).toBe(1);
        expect(initial.users).toBeGreaterThan(0);
    });

    test('only the figures that actually changed are highlighted', async ({ page }) => {
        await bootIntoConsole(page);

        // Sort by severity mutates order but no figure, so nothing should highlight.
        const backgrounds = (): Promise<string[]> =>
            page.evaluate(() =>
                ['metric-open', 'metric-sev1', 'metric-users', 'metric-closed'].map(
                    (id) => getComputedStyle(document.querySelector(`#${id}`)!).backgroundColor,
                ),
            );

        const resting = await backgrounds();
        await page.locator('#btn-sort-severity').click();
        await page.waitForTimeout(250);
        expect(
            await backgrounds(),
            'reordering changes no figure, so nothing should flash',
        ).toEqual(resting);
    });
});

test.describe('highlight colour parsing', () => {
    test('highlighting changes the background and restores it, with no uncaught errors', async ({ page }) => {
        // Background: highlight used to hand `var(--lumo-primary-color-10pct, rgba(0,0,0,0.06))`
        // straight to anime.js. Its resolveCssVar extracts the fallback with
        // /var\(\s*(--[\w-]+)(?:\s*,\s*([^)]+))?\s*\)/, and `[^)]+` stops at the first `)` — so a
        // nested rgba(...) is truncated to "rgba(0,0,0,0.06" with no closing paren. That reaches
        // rgbToRgba, neither regex matches, it returns null, and reading null[4] throws:
        //
        //   TypeError: Cannot read properties of null (reading '4')
        //
        // The throw happens inside an anime.js promise, so the page does not crash but the
        // animation silently does nothing. Vaadin 25's Lumo does not define
        // --lumo-primary-color-10pct, so this path always triggered under the default theme.
        // Asserting "no errors" alone is insufficient: when parsing fails the animation does
        // nothing and the page is equally error-free. The background must be seen to move.
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);

        const bg = (): Promise<string> =>
            page.evaluate(
                () => getComputedStyle(document.querySelector('#metric-open')!).backgroundColor,
            );

        const before = await bg();
        await page.locator('#btn-simulate-page').click();

        await expect
            .poll(bg, {
                timeout: 4_000,
                message:
                    'highlight did not change the background — a preset may be passing var() or another unparsable colour again',
            })
            .not.toBe(before);

        // The preset's onComplete must restore the resting colour, otherwise the tint sticks.
        await expect
            .poll(bg, { timeout: SETTLE_MS, message: 'the background was not restored after highlight' })
            .toBe(before);

        expect(
            errors.filter((e) => /reading '4'|Cannot read properties of null/.test(e)),
            'anime.js colour parsing threw null[4]',
        ).toEqual([]);
        expect(errors).toEqual([]);
    });
});
