/**
 * E2E tests — the API envelope, error contract, health, and OpenAPI
 * (API_SPEC §2.1, §9, §10). Runs against a real Nest application on an
 * ephemeral port (TESTING_SPEC §3).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { OpenApiService } from '../src/shared/openapi/openapi.service.js';
import { buildOpenApiDocument } from '../src/shared/openapi/openapi-document.js';

describe('API (e2e)', () => {
  let app: INestApplication;

  // Boot/shutdown with no infrastructure configured settles within the
  // bounded Redis retry window (~21s), so hooks get explicit timeouts.
  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );

    const openApi = app.get(OpenApiService);
    openApi.setDocument(buildOpenApiDocument(app));

    await app.init();
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  it('GET /api/health returns readiness inside the success envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.meta.requestId).toBeDefined();
    expect(res.body.data.dependencies).toBeInstanceOf(Array);
  });

  it('GET /api/health/live returns 200 with timestamp', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(res.body.data.status).toBe('ok');
    expect(new Date(res.body.data.timestamp).getTime()).not.toBeNaN();
  });

  it('echoes X-Request-Id on the response and binds it to the envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('X-Request-Id', 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7');
    expect(res.body.meta.requestId).toBe('a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7');
  });

  it('returns the standard error envelope for unknown routes (404)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.status).toBe(404);
    expect(res.body.error.path).toContain('/api/v1/does-not-exist');
    expect(res.body.error.requestId).toBeDefined();
    expect(res.body.error.timestamp).toBeDefined();
  });

  it('serves the OpenAPI 3.1 document at /api/openapi.json', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/openapi.json').expect(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths['/api/v1/health']).toBeDefined();
  });

  it('rejects unauthenticated hybrid search (401, error envelope)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/search')
      .send({ query: 'invoice total' })
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.status).toBe(401);
  });

  it('rejects unauthenticated chat (401, error envelope)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/chat')
      .send({ query: 'what is the return policy?' })
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.status).toBe(401);
  });
});
