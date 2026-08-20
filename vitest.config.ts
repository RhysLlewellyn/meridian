import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    // Node, not jsdom: what is under test here is domain logic and a database
    // constraint. Neither has a DOM.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The concurrency test fires simultaneous writes at one row. Running test
    // files in parallel against the same database would make its result mean
    // something other than what it claims.
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
