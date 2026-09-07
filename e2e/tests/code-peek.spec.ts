import { expect, test } from '@playwright/test';
import { SETTLE_MS, bootIntoConsole, collectPageErrors, openTab } from '../helpers/console';

/**
 * Regression for the per-panel code snippets.
 *
 * The snippets are extracted from the demo's own `.java` files at runtime rather than copied
 * into string constants, so the thing to protect is that the extraction still works — a broken
 * resource path or a renamed marker degrades to a placeholder comment, which looks like a
 * snippet at a glance but documents nothing.
 */

/** Panels that expose a snippet, with the tab they live under and a call each must contain. */
const PANELS = [
    { tab: 'queue', region: 'queue', mustContain: 'Motion.sortable(' },
    { tab: 'queue', region: 'metrics', mustContain: 'Motion.count(' },
    { tab: 'topology', region: 'topology', mustContain: 'Motion.morph(' },
    { tab: 'postmortem', region: 'postmortem', mustContain: 'Motion.reveal(' },
    { tab: 'warroom', region: 'warroom', mustContain: 'Motion.draggable(' },
] as const;

test.describe('code snippets', () => {
    test('every panel shows real Motion source, not a placeholder', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);

        for (const panel of PANELS) {
            await openTab(page, panel.tab);
            await page.locator(`#btn-code-${panel.region}`).click();

            const code = page.locator(`#code-${panel.region}`);
            await expect
                .poll(() => code.evaluate((el) => el.textContent?.trim() ?? ''), {
                    timeout: SETTLE_MS,
                    message: `the ${panel.region} snippet never appeared`,
                })
                .not.toBe('');

            const text = (await code.textContent()) ?? '';
            // The extractor falls back to these when the source is missing or the markers were
            // renamed. They are the actual failure mode, so they are asserted against directly.
            expect(text, `the ${panel.region} source was not bundled`).not.toContain(
                'source not bundled',
            );
            expect(text, `the ${panel.region} markers no longer match`).not.toContain('no region');
            expect(text, `the ${panel.region} source could not be read`).not.toContain(
                'could not read',
            );
            expect(text, `the ${panel.region} snippet lost its Motion calls`).toContain(
                panel.mustContain,
            );

            // Collapse again so the next panel starts from a known state.
            await page.locator(`#btn-code-${panel.region}`).click();
            await page.waitForTimeout(300);
        }

        expect(errors).toEqual([]);
    });

    test('the snippet is collapsed until asked for, and toggles back', async ({ page }) => {
        // The console is a working surface first: code that is permanently open turns every
        // panel into documentation.
        await bootIntoConsole(page);

        const height = (): Promise<number> =>
            page.evaluate(
                () => document.querySelector('#code-queue')?.getBoundingClientRect().height ?? -1,
            );

        expect(await height(), 'the snippet should start collapsed').toBe(0);

        await page.locator('#btn-code-queue').click();
        await expect
            .poll(height, { timeout: SETTLE_MS, message: 'the snippet never expanded' })
            .toBeGreaterThan(20);

        await page.locator('#btn-code-queue').click();
        await expect
            .poll(height, { timeout: SETTLE_MS, message: 'the snippet never collapsed again' })
            .toBeLessThan(5);
    });

    test('the toggle reports its state to assistive technology', async ({ page }) => {
        await bootIntoConsole(page);
        const toggle = page.locator('#btn-code-queue');

        expect(await toggle.getAttribute('aria-expanded')).toBe('false');
        expect(
            await toggle.getAttribute('aria-controls'),
            'the toggle should point at the region it controls',
        ).toBe('code-queue');

        await toggle.click();
        await expect
            .poll(() => toggle.getAttribute('aria-expanded'), {
                timeout: SETTLE_MS,
                message: 'aria-expanded did not track the open state',
            })
            .toBe('true');
    });

    test('snippets are balanced Java rather than a truncated fragment', async ({ page }) => {
        // Regions are cut where the Motion call stops being interesting, which can leave an
        // open lambda behind. Showing unbalanced code makes the reader wonder what is missing.
        await bootIntoConsole(page);
        await page.locator('#btn-code-queue').click();
        await page.waitForTimeout(700);

        const text = (await page.locator('#code-queue').textContent()) ?? '';
        const opens = (text.match(/\{/g) ?? []).length;
        const closes = (text.match(/\}/g) ?? []).length;
        expect(opens, `braces do not balance: ${opens} open, ${closes} close`).toBe(closes);
    });
});
