import { expect, test } from '@playwright/test';
import { SETTLE_MS, bootIntoConsole, collectPageErrors, openTab } from '../helpers/console';

/**
 * Topology regression: SVG stroke drawing, path motion, expand/collapse and icon morphing.
 *
 * The morph assertions are the strictest in the suite because path interpolation degrades
 * silently: with a truthy precision anime.js resamples both paths into N L-points by arc length,
 * the subpath separators disappear and coordinates decay into float noise. The result still
 * animates, so only inspecting the path data catches it.
 */

/** The icon path's `d` attribute, whitespace-normalised. */
function iconPath(page: import('@playwright/test').Page): Promise<string> {
    return page.evaluate(
        () =>
            (document.querySelector('#topology-toggle-path')?.getAttribute('d') ?? '')
                .replace(/\s+/g, ' ')
                .trim(),
    );
}

test.describe('SVG stroke drawing', () => {
    test('the graph draws itself rather than appearing complete', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);
        await openTab(page, 'topology');

        /** Reads the dasharray of the first graph edge, which advances as the stroke is drawn. */
        const dasharray = (): Promise<string> =>
            page.evaluate(() => {
                const p = document.querySelector('#topology-graph path');
                return p ? getComputedStyle(p).strokeDasharray : '';
            });

        // Redraw explicitly so the sampling window is known, rather than racing the draw that
        // runs on attach.
        await page.waitForTimeout(1600);
        await page.locator('#btn-redraw').click();
        await page.waitForTimeout(200);
        const mid = await dasharray();

        await page.waitForTimeout(1400);
        const end = await dasharray();

        expect(mid, 'a dasharray should be present while drawing').not.toBe('');
        expect(mid, 'mid and end states are identical — nothing was actually drawn').not.toBe(end);
        expect(errors.filter((e) => /null|undefined/.test(e))).toEqual([]);
    });
});

test.describe('request probe path motion', () => {
    test('the probe travels along the failing path', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);
        await openTab(page, 'topology');
        await page.waitForTimeout(1600);

        const transform = (): Promise<string> =>
            page.evaluate(
                () => document.querySelector<HTMLElement>('#topology-probe')?.style.transform ?? '',
            );

        await page.locator('#btn-trace').click();
        await page.waitForTimeout(500);
        const mid = await transform();

        expect(mid, 'the probe should be displaced while travelling').not.toBe('');
        const nums = (mid.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
        expect(
            Math.abs(nums[0] ?? 0),
            'there should be clear horizontal displacement along the path',
        ).toBeGreaterThan(10);
        expect(errors).toEqual([]);
    });
});

test.describe('expand / collapse', () => {
    test('the body collapses to zero and expands back, handing height back to auto', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);
        await openTab(page, 'topology');
        await page.waitForTimeout(1600);

        const height = (): Promise<number> =>
            page.evaluate(() =>
                Math.round(document.querySelector('#topology-body')?.getBoundingClientRect().height ?? -1),
            );

        const open = await height();
        expect(open, 'the panel should start expanded').toBeGreaterThan(50);

        await page.locator('#topology-toggle').click();
        await expect
            .poll(height, { timeout: SETTLE_MS, message: 'the body never collapsed' })
            .toBeLessThan(open / 2);

        await page.locator('#topology-toggle').click();
        await expect
            .poll(height, { timeout: SETTLE_MS, message: 'content height was not restored on expand' })
            .toBeGreaterThan(open * 0.8);

        // Height must be handed back to auto, otherwise it is frozen as the content changes.
        await page.waitForTimeout(500);
        const inline = await page.evaluate(
            () => document.querySelector<HTMLElement>('#topology-body')?.style.height ?? '',
        );
        expect(inline, 'height:auto should be handed back after expanding').toBe('auto');
        expect(errors).toEqual([]);
    });
});

test.describe('icon morphing', () => {
    test('the icon is the trigger, keyboard accessible, and its label tracks state', async ({ page }) => {
        // The icon carries the state, so it needs full button semantics: keyboard users need
        // Enter, and screen readers need the current state announced.
        await bootIntoConsole(page);
        await openTab(page, 'topology');
        await page.waitForTimeout(1600);

        const toggle = page.locator('#topology-toggle');
        expect(await toggle.getAttribute('role'), 'should have button semantics').toBe('button');
        expect(await toggle.getAttribute('tabindex'), 'should be focusable').toBe('0');
        expect(await toggle.getAttribute('aria-label'), 'the initial label should say Collapse').toBe(
            'Collapse topology',
        );

        const before = await iconPath(page);
        await toggle.focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(900);

        expect(await iconPath(page), 'the keyboard should trigger the morph').not.toBe(before);
        expect(await toggle.getAttribute('aria-label'), 'the label must track state').toBe(
            'Expand topology',
        );
    });

    test('morphing reproduces the target path exactly, keeping subpaths and avoiding float noise', async ({ page }) => {
        // With a truthy precision, morphTo resamples both paths into N L-points by arc length:
        // the subpath separator M disappears (the three strokes collapse into one) and values
        // degrade into noise such as 7.600000381469727. The connector defaults to precision=0,
        // which requires isomorphic paths but interpolates exactly — this test locks that in.
        //
        // It also guards a product regression: the chevron was once reduced to two strokes just
        // to force isomorphism with the cross. Both shapes must keep three subpaths, the third
        // being a degenerate point.
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);
        await openTab(page, 'topology');
        await page.waitForTimeout(1600);

        const chevron = 'M6 10 L12 16 M12 16 L18 10 M12 16 L12 16';
        const cross = 'M7 7 L17 17 M7 17 L17 7 M12 12 L12 12';

        expect(await iconPath(page), 'should start as the three-stroke chevron').toBe(chevron);

        await page.locator('#topology-toggle').click();

        // Inspect an intermediate frame too: the final state is written by a closing
        // setAttribute, so only mid-frames reveal whether arc-length resampling occurred.
        await page.waitForTimeout(150);
        const mid = await iconPath(page);
        expect(
            (mid.match(/M/g) ?? []).length,
            'mid-frames should keep three separate subpaths',
        ).toBe(3);
        expect(
            (mid.match(/[ML]/g) ?? []).length,
            'mid-frames should not be resampled into more points',
        ).toBe(6);

        await expect
            .poll(() => iconPath(page), {
                timeout: SETTLE_MS,
                message: 'the morph never reproduced the target path exactly',
            })
            .toBe(cross);

        const after = await iconPath(page);
        expect((after.match(/M/g) ?? []).length, 'the three strokes should stay separate').toBe(3);
        expect((after.match(/[ML]/g) ?? []).length, 'should not be resampled into more points').toBe(6);
        expect(after, 'no floating point noise should appear').not.toMatch(/\d+\.\d{5,}/);

        // Toggling back must be equally exact.
        await page.locator('#topology-toggle').click();
        await expect
            .poll(() => iconPath(page), {
                timeout: SETTLE_MS,
                message: 'toggling back did not reproduce the chevron exactly',
            })
            .toBe(chevron);

        expect(errors).toEqual([]);
    });
});
