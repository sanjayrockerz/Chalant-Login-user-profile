module.exports = {
	moduleFileExtensions: ['js', 'json', 'ts'],
	rootDir: 'src',
	testRegex: '.*\\.spec\\.ts$',
	transform: {
		'^.+\\.(t|j)s$': 'ts-jest',
	},
	collectCoverageFrom: [
		'**/*.(t|j)s',
		'!**/*.spec.ts',
		'!**/*.interface.ts',
		'!**/*.dto.ts',
		'!**/main.ts',
		'!**/node_modules/**',
	],
	coverageDirectory: '../coverage',
	testEnvironment: 'node',
	coverageThreshold: {
		global: {
			branches: 80,
			functions: 80,
			lines: 80,
			statements: 80,
		},
		'./src/auth_cc/': {
			branches: 90,
			functions: 90,
			lines: 90,
			statements: 90,
		},
		'./src/user/': {
			branches: 90,
			functions: 90,
			lines: 90,
			statements: 90,
		},
		'./src/email/': {
			branches: 85,
			functions: 85,
			lines: 85,
			statements: 85,
		},
	},
	setupFilesAfterEnv: ['<rootDir>/../test/setup.ts'],
	moduleNameMapper: {
		'^src/(.*)$': '<rootDir>/$1',
	},
};
