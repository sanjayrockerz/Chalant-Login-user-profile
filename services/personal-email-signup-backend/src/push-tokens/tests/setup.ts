import 'reflect-metadata';

// Global test setup for push token tests
// Mock external dependencies and set up test environment

// Mock Redis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    keys: jest.fn(),
    pipeline: jest.fn().mockReturnValue({
      setex: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([])
    }),
    info: jest.fn().mockResolvedValue('used_memory_human:10MB')
  }));
});

// Mock Prometheus client
jest.mock('prom-client', () => ({
  Counter: jest.fn().mockImplementation(() => ({
    inc: jest.fn(),
    labels: jest.fn().mockReturnValue({ inc: jest.fn() })
  })),
  Histogram: jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    labels: jest.fn().mockReturnValue({ observe: jest.fn() })
  })),
  Gauge: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    labels: jest.fn().mockReturnValue({ set: jest.fn() })
  })),
  register: {
    metrics: jest.fn().mockResolvedValue(''),
    clear: jest.fn()
  }
}));

// Mock OpenTelemetry
jest.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: jest.fn().mockReturnValue({
      startSpan: jest.fn().mockReturnValue({
        setAttributes: jest.fn(),
        setStatus: jest.fn(),
        recordException: jest.fn(),
        end: jest.fn()
      })
    })
  }
}));

// Set up global test timeout
jest.setTimeout(30000);

// Global test environment variables
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});

export {};