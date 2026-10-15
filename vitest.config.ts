import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    // Run each test file in a child process: better-sqlite3 + worker_threads
    // teardown segfaults (exit 139) under the default "threads" pool.
    pool: "forks",
    exclude: [...configDefaults.exclude, ".worktrees/**"],
  },
});
