/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/$1',
  },
  testEnvironment: 'node',
  // Run suites serially: the migration runner tests reset the public
  // schema, which would race against any other suite that talks to the
  // same database.
  maxWorkers: 1,
  forceExit: true,
};
