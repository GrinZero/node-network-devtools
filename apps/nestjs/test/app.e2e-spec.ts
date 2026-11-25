import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import axios from 'axios';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app?.close();
  });

  it('GET / returns the upstream posts as JSON', () => {
    const posts = [
      { id: 1, userId: 1, title: 'First post', body: 'Post body' },
    ];
    jest.spyOn(axios, 'get').mockResolvedValue({ data: posts });

    return request(app.getHttpServer())
      .get('/')
      .expect('Content-Type', /json/)
      .expect(200, posts);
  });
});
