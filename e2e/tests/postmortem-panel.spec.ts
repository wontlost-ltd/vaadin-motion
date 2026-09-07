import { expect, test } from '@playwright/test';
import { SETTLE_MS, bootIntoConsole, collectPageErrors, openTab } from '../helpers/console';

/**
 * Postmortem regression: scroll-linked reading progress, viewport reveal and skeleton handover.
 *
 * Scroll bindings register an IntersectionObserver and a scroll listener rather than running
 * once, so "the effect works" is only half the contract — the panel is torn down and rebuilt on
 * every tab switch, which would stack listeners if rebinding were not idempotent.
 */

/** Filled width of the reading-progress bar as a fraction of its track, or -1 if unmeasurable. */
function filled(page: import('@playwright/test').Page): Promise<number> {
    return page.evaluate(() => {
        const bar = document.querySelector<HTMLElement>('#reading-progress');
        const track = bar?.parentElement;
        if (!bar || !track) return -1;
        const w = track.getBoundingClientRect().width;
        return w > 0 ? bar.getBoundingClientRect().width / w : -1;
    });
}

/** Scrolls the window to a fraction of the document's scrollable range. */
function scrollTo(page: import('@playwright/test').Page, pct: number): Promise<void> {
    return page.evaluate((v) => {
        window.scrollTo(0, (document.body.scrollHeight - window.innerHeight) * v);
    }, pct);
}

test.describe('reading progress', () => {
    test('the bar reaches full at the end of the record', async ({ page }) => {
        // Three defects this locks down, in the order they were found:
        //  1. an entrance preset was used instead of PROGRESS, so the transform shifted a few
        //     pixels while the bar stayed full width;
        //  2. the track had no explicit width and collapsed inside its flex column, leaving the
        //     bar unmeasurable;
        //  3. the bar tracked itself travelling through the viewport, which cannot complete for
        //     content taller than the window — it stalled around half at the end of the text.
        // Asserting only "the bar advanced" would miss (3), so the end value is checked exactly.
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);
        await openTab(page, 'postmortem');
        await page.waitForTimeout(2200);

        expect(
            await filled(page),
            'the progress track has zero width — it has collapsed inside its flex column',
        ).toBeGreaterThanOrEqual(0);

        await scrollTo(page, 0);
        await page.waitForTimeout(700);
        const atTop = await filled(page);

        await scrollTo(page, 1);
        await expect
            .poll(() => filled(page), {
                timeout: SETTLE_MS,
                message: 'the bar did not reach full at the bottom of the record',
            })
            .toBeGreaterThan(0.99);

        expect(atTop, 'the bar should not already be full at the top').toBeLessThan(0.9);
    });

    test('progress increases monotonically while scrolling down', async ({ page }) => {
        // A bar that jumps around, or that advances and then falls back, is worse than none:
        // the reader cannot use it to judge how much is left.
        await bootIntoConsole(page);
        await openTab(page, 'postmortem');
        await page.waitForTimeout(2200);

        const samples: number[] = [];
        for (const pct of [0, 0.25, 0.5, 0.75, 1]) {
            await scrollTo(page, pct);
            await page.waitForTimeout(450);
            samples.push(await filled(page));
        }

        for (let i = 1; i < samples.length; i++) {
            expect(
                samples[i],
                `progress went backwards between step ${i - 1} and ${i}: ${samples.join(', ')}`,
            ).toBeGreaterThanOrEqual(samples[i - 1] - 0.01);
        }
        expect(samples[samples.length - 1], 'should end full').toBeGreaterThan(0.99);
    });

    test('the whole record can be scrolled to', async ({ page }) => {
        // Regression: the view was a full-height VerticalLayout, so it was pinned to exactly the
        // viewport height and the record was compressed to fit rather than extending the
        // document. With the page never taller than the window there was nothing to scroll, and
        // the last entries could not be reached at all.
        await bootIntoConsole(page);
        await openTab(page, 'postmortem');
        await page.waitForTimeout(2200);

        const range = await page.evaluate(
            () => document.documentElement.scrollHeight - window.innerHeight,
        );
        expect(range, 'the document does not scroll — the record is being compressed to fit').toBeGreaterThan(0);

        await scrollTo(page, 1);
        await page.waitForTimeout(600);
        const lastVisible = await page.evaluate(() => {
            const el = document.querySelector('#pm-entry-12');
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= window.innerHeight;
        });
        expect(lastVisible, 'the final entry cannot be reached by scrolling').toBe(true);
    });

    test('the progress binding survives a tab switch without stacking listeners', async ({ page }) => {
        // The panel is rebuilt on every tab switch. If rebinding were not idempotent the
        // listeners would accumulate silently and only surface as drift under load.
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);

        for (let i = 0; i < 3; i++) {
            await openTab(page, 'postmortem');
            await page.waitForTimeout(600);
            await openTab(page, 'queue');
            await page.waitForTimeout(300);
        }

        await openTab(page, 'postmortem');
        await page.waitForTimeout(1500);

        await scrollTo(page, 1);
        await expect
            .poll(() => filled(page), {
                timeout: SETTLE_MS,
                message: 'the progress bar stopped tracking scroll after repeated rebinding',
            })
            .toBeGreaterThan(0.99);

        expect(errors).toEqual([]);
    });
});

test.describe('viewport reveal', () => {
    test('entries scrolled into view are fully revealed', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);
        await openTab(page, 'postmortem');
        await page.waitForTimeout(2200);

        const last = page.locator('#pm-entry-12');
        await last.scrollIntoViewIfNeeded();

        await expect
            .poll(
                () =>
                    page.evaluate(() => {
                        const el = document.querySelector<HTMLElement>('#pm-entry-12');
                        return el ? Number(getComputedStyle(el).opacity) : 0;
                    }),
                { timeout: SETTLE_MS, message: 'an entry entering the viewport was never revealed' },
            )
            .toBeGreaterThan(0.9);

        expect(errors).toEqual([]);
    });
});

test.describe('skeleton handover', () => {
    test('the skeleton hides and the record is fully revealed', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);
        await openTab(page, 'postmortem');

        await expect
            .poll(
                () =>
                    page.evaluate(() => ({
                        skel: getComputedStyle(document.querySelector('#postmortem-skeleton')!).display,
                        content: getComputedStyle(document.querySelector('#postmortem-content')!).opacity,
                    })),
                {
                    timeout: SETTLE_MS,
                    message: 'the skeleton did not hide or the record never appeared',
                },
            )
            .toEqual({ skel: 'none', content: '1' });

        const entries = await page.locator('#postmortem-content > div').count();
        expect(entries, 'the full record should be rendered after handover').toBe(12);
        expect(errors).toEqual([]);
    });

    test('reloading the record replays the handover', async ({ page }) => {
        await bootIntoConsole(page);
        await openTab(page, 'postmortem');
        await page.waitForTimeout(2200);

        await page.locator('#btn-reload-postmortem').click();

        // The skeleton must come back, otherwise the reload gives no feedback at all.
        await expect
            .poll(
                () =>
                    page.evaluate(
                        () => getComputedStyle(document.querySelector('#postmortem-skeleton')!).display,
                    ),
                { timeout: 3_000, message: 'the skeleton never reappeared on reload' },
            )
            .not.toBe('none');

        await expect
            .poll(
                () =>
                    page.evaluate(
                        () => getComputedStyle(document.querySelector('#postmortem-content')!).opacity,
                    ),
                { timeout: SETTLE_MS, message: 'the record never came back after reload' },
            )
            .toBe('1');
    });
});
