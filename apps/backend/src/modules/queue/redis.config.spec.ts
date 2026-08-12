import { redisConnectionOptions } from './redis.config';

describe('redisConnectionOptions', () => {
  it('falls back to localhost defaults without a URL', () => {
    expect(redisConnectionOptions(undefined)).toEqual({ host: 'localhost', port: 6379 });
  });

  it('parses a plain redis URL', () => {
    expect(redisConnectionOptions('redis://localhost:6379')).toEqual({
      host: 'localhost',
      port: 6379,
      username: undefined,
      password: undefined,
      db: 0,
    });
  });

  it('parses credentials and a database index (decoded)', () => {
    expect(redisConnectionOptions('redis://ops:p%40ss@redis.internal:6380/3')).toEqual({
      host: 'redis.internal',
      port: 6380,
      username: 'ops',
      password: 'p@ss',
      db: 3,
    });
  });

  it('applies url-safe fallbacks for missing parts', () => {
    expect(redisConnectionOptions('redis://:secret@redis.internal')).toEqual({
      host: 'redis.internal',
      port: 6379,
      username: undefined,
      password: 'secret',
      db: 0,
    });
  });
});
