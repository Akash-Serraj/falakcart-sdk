import { defineConfig } from 'vitest/config';

/**
 * Tests for the storefront SDK and web components.
 *
 * These exist because this code had none, and that is where the user-visible
 * failures came from: two rounds of the same checkout bug — an order placed
 * with no district, then a form demanding a district it had not drawn — reached
 * a real shopper rather than a test run.
 *
 * No jsdom: everything under test here is pure. The capability readers and the
 * field-state machine take a payload and return an answer, which is the whole
 * reason they were extracted from the render path — logic reachable without a
 * DOM is logic that can be tested.
 */
export default defineConfig({
    test: {
        include: ['packages/**/*.test.js'],
        environment: 'node',
        exclude: ['**/node_modules/**', '**/dist/**'],
    },
});
