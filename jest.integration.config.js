/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/server/tests/integration'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  // Strapi compile + boot cycles can each take 10-20s on cold runs.
  testTimeout: 120000,
  maxWorkers: 1,
  // Strapi's internal services (cron, telemetry, etc.) sometimes leave
  // handles around even after destroy(); the test outcome is what matters.
  forceExit: true,
};
