import { expect, test } from '@playwright/test';
import {
    SETTLE_MS,
    bootIntoConsole,
    collectPageErrors,
    dragRow,
    metrics,
    queueIds,
} from '../helpers/console';

/**
 * Incident queue regression: FLIP reordering, drag-to-sort, exit animations and the SEV1 guard.
 *
 * The queue is where the engineer works, so its motion carries meaning rather than decoration:
 * direction of exit says what happened to the row, and tweened reordering says the list was
 * rearranged rather than redrawn. Assertions accordingly check that the **transition** happened,
 * not just that the end state is correct — a correct end state reached by an instant jump is
 * precisely the failure these features exist to prevent.
 */

/** Rows currently carrying a non-identity inline transform, i.e. mid-tween. */
async function tweeningRows(page: import('@playwright/test').Page): Promise<number> {
    return page.evaluate(
        () =>
            [...document.querySelectorAll('#incident-queue > div')].filter((d) => {
                const tr = (d as HTMLElement).style.transform;
                // Firefox serialises translate(0px, 0px) as translate(0px), omitting the
                // duplicate second argument, while Chromium keeps both; the connector may also
                // park a row with translateY(0px). Accept every identity form.
                return (
                    tr &&
                    tr !== 'none' &&
                    !/^translate(Y)?\(0px(,\s*0px)?\)$/.test(tr.trim())
                );
            }).length,
    );
}

test.describe('FLIP reordering', () => {
    test('rows tween into place when sorting and settle in severity order', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);

        const before = await queueIds(page);
        expect(before, 'the queue should seed three incidents').toHaveLength(3);

        await page.locator('#btn-sort-severity').click();
        // Sample immediately: if nothing carries a transform the sort degraded into a jump.
        await page.waitForTimeout(100);
        expect(
            await tweeningRows(page),
            'FLIP produced no tween — sorting degraded into an instant jump',
        ).toBeGreaterThan(0);

        await page.waitForTimeout(900);
        const after = await queueIds(page);
        expect(after.slice().sort(), 'the same incidents should remain after sorting').toEqual(
            before.slice().sort(),
        );
        // Seeded as SEV1, SEV2, SEV3, so sorting by severity is already stable; assert the
        // severity badges are non-decreasing rather than assuming a fixed id order.
        const severities = await page.evaluate(() =>
            [...document.querySelectorAll('#incident-queue > div')].map((row) =>
                Number((row.textContent ?? '').match(/SEV(\d)/)?.[1] ?? 0),
            ),
        );
        expect(severities, 'should be ordered by severity').toEqual([...severities].sort());

        expect(
            await tweeningRows(page),
            'displacement still lingers after the animation — rows are resting at an offset',
        ).toBe(0);
        expect(errors).toEqual([]);
    });

    test('displacement is vertical only and does not compound across sorts', async ({ page }) => {
        // Two defects that really happened:
        // 1) every row shares the same left, so there should be no horizontal displacement, yet
        //    the first sort computed -24.7px because layout() ran on attach, before Vaadin had
        //    finished its first render;
        // 2) record() measured with getBoundingClientRect(), which includes transforms that had
        //    not settled; the leftover was written into the baseline and compounded each round
        //    (-124 -> -129 -> -130 -> -131), widening the animation every time.
        await bootIntoConsole(page);

        /**
         * Reads the largest displacement a row reaches during one sort.
         *
         * Samples repeatedly rather than reading once at a fixed delay: a single sample can
         * catch a row early or late in its tween, which varies the reading by more than the
         * compounding this test is looking for and makes it fail on timing alone.
         */
        const shiftDuringSort = async (): Promise<{ x: number; y: number }> => {
            await page.locator('#btn-sort-severity').click();
            let best = { x: 0, y: 0 };
            for (let i = 0; i < 8; i++) {
                await page.waitForTimeout(45);
                const sample = await readShift();
                if (Math.abs(sample.y) > Math.abs(best.y)) {
                    best = sample;
                }
            }
            await page.waitForTimeout(700);
            return best;
        };

        /** One reading of the first displaced row's transform. */
        const readShift = async (): Promise<{ x: number; y: number }> => {
            const tr = await page.evaluate(() => {
                const moved = [...document.querySelectorAll('#incident-queue > div')]
                    .map((d) => (d as HTMLElement).style.transform)
                    .filter(
                        (t) =>
                            t &&
                            t !== 'none' &&
                            !/^translate(Y)?\(0px(,\s*0px)?\)$/.test(t.trim()),
                    );
                return moved[0] ?? '';
            });
            const nums = (tr.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
            // translateY(n) reports one number, translate(x, y) two. With a single number the
            // displacement is vertical, so read it as y rather than mistaking it for x.
            if (nums.length === 1) {
                return { x: 0, y: nums[0] };
            }
            return { x: nums[0] ?? 0, y: nums[1] ?? 0 };
        };

        // Shuffle by dragging so successive sorts have something to undo, then measure.
        const magnitudes: number[] = [];
        for (let round = 1; round <= 3; round++) {
            await dragRow(page, 0, 2);
            const s = await shiftDuringSort();
            expect(
                Math.abs(s.x),
                `no horizontal displacement on round ${round} — all rows share the same left`,
            ).toBeLessThan(1);
            if (Math.abs(s.y) > 0) magnitudes.push(Math.abs(s.y));
        }

        expect(magnitudes.length, 'no vertical displacement was ever observed').toBeGreaterThan(0);
        const ratio = Math.max(...magnitudes) / Math.min(...magnitudes);
        expect(ratio, 'vertical displacement must not compound across rounds').toBeLessThan(2);
    });
});

test.describe('drag to reorder', () => {
    test('a one-slot drag moves exactly one row without cascading', async ({ page }) => {
        // The defect this locks down: while reusing createDraggable, a swap moved the dragged
        // item's resting position by one slot and draggable rewrote the transform from its own
        // offset every frame, overriding the compensation. Measured, a 48px drag fired three
        // swaps and carried the row to the end of the queue.
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);

        const before = await queueIds(page);
        const after = await dragRow(page, 0, 1);

        expect(after, 'the first two rows should swap').toEqual([before[1], before[0], before[2]]);
        expect(errors).toEqual([]);
    });

    test('a multi-slot drag lands precisely and the server agrees with the DOM', async ({ page }) => {
        await bootIntoConsole(page);

        const before = await queueIds(page);
        const after = await dragRow(page, 0, 2);
        expect(after, 'the first row should land exactly in third place').toEqual([
            before[1],
            before[2],
            before[0],
        ]);

        // The client only reorders the DOM; the server syncs via the sort-changed callback. If
        // the two disagree the order is silently lost on the next rebuild.
        await page.locator('#btn-simulate-page').click();
        await expect
            .poll(async () => (await queueIds(page)).length, { timeout: SETTLE_MS })
            .toBe(4);
        const afterRebuild = await queueIds(page);
        expect(
            afterRebuild.slice(1),
            'the dragged order must survive a server-side rebuild',
        ).toEqual(after);
    });

    test('no inline transform lingers after a drag', async ({ page }) => {
        await bootIntoConsole(page);
        await dragRow(page, 0, 2);
        await page.waitForTimeout(600);

        const residual = await page.evaluate(
            () =>
                [...document.querySelectorAll('#incident-queue > div')].filter((c) => {
                    const el = c as HTMLElement;
                    const tr = el.style.transform.trim();
                    // An identity transform is fine — it is what the connector writes back on
                    // settle. Only a real offset means the row is resting out of place. Firefox
                    // serialises translate(0px, 0px) as translate(0px), so accept either form.
                    const parked =
                        tr === '' ||
                        tr === 'none' ||
                        /^translate(Y)?\(0px(,\s*0px)?\)$/.test(tr);
                    return el.style.zIndex !== '' || !parked;
                }).length,
        );
        expect(residual, 'a row is resting at an offset after the drag').toBe(0);
    });

    test('row buttons stay clickable while the row is draggable', async ({ page }) => {
        // Regression: the pointer handler called preventDefault() on every pointerdown, which
        // suppressed the click event entirely and left Acknowledge and Resolve dead. Dragging
        // and clicking have to coexist on the same row.
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);

        const before = await queueIds(page);
        const rows = page.locator('#incident-queue > div');
        // INC-1002 is SEV2, so Acknowledge is permitted and actually removes the row.
        const target = rows.filter({ hasText: 'INC-1002' });
        await target.getByRole('button', { name: 'Acknowledge' }).click();

        await expect
            .poll(queueIds.bind(null, page), {
                timeout: SETTLE_MS,
                message: 'clicking Acknowledge did nothing — the drag handler may be swallowing clicks',
            })
            .toEqual(before.filter((id) => id !== 'INC-1002'));

        expect(errors).toEqual([]);
    });
});

test.describe('exit animations and the SEV1 guard', () => {
    test('resolving slides the row out and updates the metrics together', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);

        const startMetrics = await metrics(page);
        expect(startMetrics.open, 'three incidents should be open at the start').toBe(3);

        const rows = page.locator('#incident-queue > div');
        const target = rows.filter({ hasText: 'INC-1003' });
        await target.getByRole('button', { name: 'Resolve' }).click();

        // Mid-flight the row must be moving, otherwise it simply vanished.
        await page.waitForTimeout(100);
        const moving = await page.evaluate(() => {
            const row = [...document.querySelectorAll('#incident-queue > div')].find((d) =>
                (d.textContent ?? '').includes('INC-1003'),
            ) as HTMLElement | undefined;
            return row ? row.style.transform : '';
        });
        expect(moving, 'the row should slide out rather than disappear instantly').not.toBe('');

        await expect
            .poll(async () => (await metrics(page)).open, {
                timeout: SETTLE_MS,
                message: 'the queue never shrank after resolving',
            })
            .toBe(2);

        const end = await metrics(page);
        expect(end.closed, 'the closed count should rise by one').toBe(startMetrics.closed + 1);
        expect(end.users, 'affected users should drop with the incident').toBeLessThan(
            startMetrics.users,
        );
        expect(errors).toEqual([]);
    });

    test('a SEV1 cannot be acknowledged: the row shakes and stays in the queue', async ({ page }) => {
        // The animation supplements the message; it is never the only carrier. Both the shake
        // and the explanatory notification are asserted.
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);

        const before = await queueIds(page);
        const rows = page.locator('#incident-queue > div');
        const sev1 = rows.filter({ hasText: 'INC-1001' });
        await sev1.getByRole('button', { name: 'Acknowledge' }).click();

        // Shake writes a transform for the duration of the animation.
        await expect
            .poll(
                () =>
                    page.evaluate(() => {
                        const row = [...document.querySelectorAll('#incident-queue > div')].find(
                            (d) => (d.textContent ?? '').includes('INC-1001'),
                        ) as HTMLElement | undefined;
                        return row?.style.transform ?? '';
                    }),
                { timeout: 3_000, message: 'the SEV1 row never shook' },
            )
            .not.toBe('');

        // The notification renders inside a vaadin-notification-card in an overlay shadow root,
        // so body.innerText cannot see it — query the component itself.
        await expect
            .poll(
                () =>
                    page.evaluate(() =>
                        [...document.querySelectorAll('vaadin-notification-card')]
                            .map((c) => c.textContent ?? '')
                            .join(' '),
                    ),
                {
                    timeout: 4_000,
                    message: 'the reason must also be given in text, not by animation alone',
                },
            )
            .toContain('escalate');

        await page.waitForTimeout(800);
        expect(await queueIds(page), 'the SEV1 must remain in the queue').toEqual(before);
        expect(errors).toEqual([]);
    });

    test('a new page slides in at the head of the queue', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);

        const before = await queueIds(page);
        await page.locator('#btn-simulate-page').click();

        await expect
            .poll(async () => (await queueIds(page)).length, {
                timeout: SETTLE_MS,
                message: 'the simulated page never arrived',
            })
            .toBe(before.length + 1);

        const after = await queueIds(page);
        expect(after.slice(1), 'the new incident should be inserted at the head').toEqual(before);
        expect(errors).toEqual([]);
    });

    test('clearing the queue reveals the empty state', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);

        // Resolve is permitted for every severity, unlike Acknowledge.
        for (let i = 0; i < 3; i++) {
            await page
                .locator('#incident-queue > div')
                .first()
                .getByRole('button', { name: 'Resolve' })
                .click();
            await expect
                .poll(async () => (await queueIds(page)).length, { timeout: SETTLE_MS })
                .toBe(2 - i);
        }

        await expect(page.locator('#queue-empty')).toBeVisible();
        // Poll rather than read once: the figure counts down to zero, so an immediate read can
        // sample an intermediate frame.
        await expect
            .poll(async () => (await metrics(page)).open, {
                timeout: SETTLE_MS,
                message: 'the open count never reached zero',
            })
            .toBe(0);
        expect(errors).toEqual([]);
    });
});
