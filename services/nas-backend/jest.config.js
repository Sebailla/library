/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  // Both ``.e2e-spec.ts`` (HTTP + repo contract) and ``.spec.ts``
  // (pure unit / processor tests like the BullMQ workers) are
  // picked up. The naming convention keeps the heavier suites
  // explicit (``e2e-spec``) while letting lightweight unit
  // specs share the same Jest runner.
  testRegex: '.*\\.(e2e-spec|spec)\\.ts$',
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
