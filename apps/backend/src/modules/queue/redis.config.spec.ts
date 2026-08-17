import { redisConnectionOptions } from './redis.config';

describe('redisConnectionOptions', () => {
  it('falls back to localhost defaults without a URL', () => {
    const options = redisConnectionOptions(undefined);
    expect(options.host).toBe('localhost');
    expect(options.port).toBe(6379);
    expect(typeof options.retryStrategy).toBe('function');
  });

  it('parses a plain redis URL', () => {
    const options = redisConnectionOptions('redis://localhost:6379');
    expect(options).toEqual({
      host: 'localhost',
      port: 6379,
      username: undefined,
      password: undefined,
      db: 0,
      retryStrategy: expect.any(Function),
    });
  });

  it('parses credentials and a database index (decoded)', () => {
    const options = redisConnectionOptions('redis://ops:p%40ss@redis.internal:6380/3');
    expect(options.host).toBe('redis.internal');
    expect(options.port).toBe(6380);
    expect(options.username).toBe('ops');
    expect(options.password).toBe('p@ss');
    expect(options.db).toBe(3);
  });

  it('applies url-safe fallbacks for missing parts', () => {
    const options = redisConnectionOptions('redis://:secret@redis.internal');
    expect(options.host).toBe('redis.internal');
    expect(options.port).toBe(6379);
    expect(options.username).toBeUndefined();
    expect(options.password).toBe('secret');
    expect(options.db).toBe(0);
  });
});

describe('bounded retry strategy', () => {
  it('retries with capped exponential backoff', () => {
    const strategy = redisConnectionOptions(undefined).retryStrategy;
    expect(strategy(1)).toBe(200);
    expect(strategy(5)).toBe(1000);
    expect(strategy(10)).toBe(2000);
    expect(strategy(15)).toBe(2000);
  });

  it('gives up after the retry window so shutdown cannot hang forever', () => {
    const strategy = redisConnectionOptions(undefined).retryStrategy;
    expect(strategy(15)).toBe(2000);
    expect(strategy(16)).toBeNull();
  });
});
