module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'router/**/*.ts',
    'spec/**/*.ts',
    'providers/**/*.ts',
    '!**/*.d.ts'
  ],
  // Fix timer leaks
  testTimeout: 30000,
  forceExit: true,
  detectOpenHandles: false,
  // Cleanup after each test
  setupFilesAfterEnv: [],
  // Run tests in band to avoid port conflicts
  maxWorkers: 1,
  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true
};
