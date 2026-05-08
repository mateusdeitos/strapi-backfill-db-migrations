/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/server/tests'],
  testMatch: ['**/*.test.ts'],
  // Integration tests live under server/tests/integration and use a dedicated
  // jest config (jest.integration.config.js) — they boot real Strapi against
  // Postgres, which the unit suite has no business doing.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/server/tests/integration/'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
