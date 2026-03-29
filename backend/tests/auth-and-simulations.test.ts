import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

import { createMockPrisma } from './mock-prisma';

vi.mock('../src/database/client', () => {
  const mock = createMockPrisma();
  return {
    getPrismaClient: () => mock,
  };
});

// Avoid real Kubernetes calls during tests
vi.mock('../src/kubernetes/ops', () => {
  return {
    scaleDeployment: vi.fn(async () => {}),
    deletePodsBySelector: vi.fn(async () => 1),
    patchDeploymentTemplate: vi.fn(async () => {}),
    upsertNetworkPolicy: vi.fn(async () => {}),
    deleteNetworkPolicy: vi.fn(async () => {}),
  };
});

import { createApp } from '../src/app';

describe('auth + simulations', () => {
  const app = createApp();

  beforeEach(() => {
    // no-op; mocks persist per file
  });

  it('signup and me', async () => {
    const signup = await request(app).post('/api/auth/signup').send({ email: 'a@b.com', password: 'pw12345' });
    expect(signup.status).toBe(201);
    expect(signup.body.token).toBeTruthy();

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.authenticated).toBe(true);
    expect(me.body.user.email).toBe('a@b.com');
  });

  it('create simulation (dry-run) and fetch details', async () => {
    const signup = await request(app).post('/api/auth/signup').send({ email: 'e@b.com', password: 'pw12345' });
    const token = signup.body.token as string;

    const create = await request(app)
      .post('/api/simulations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        failureType: 'pod_crash',
        method: 'delete-pods',
        target: { namespace: 'simulator', labelSelector: 'app=backend' },
        durationSeconds: 5,
        dryRun: true,
      });

    expect(create.status).toBe(201);
    const id = create.body.simulation.id;

    const list = await request(app).get('/api/simulations').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.simulations.length).toBeGreaterThan(0);

    const detail = await request(app).get(`/api/simulations/${id}`).set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.simulation.id).toBe(id);
  });
});

