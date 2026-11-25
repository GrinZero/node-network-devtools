import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  let testingModule: TestingModule;

  beforeEach(async () => {
    testingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = testingModule.get<AppController>(AppController);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await testingModule?.close();
  });

  describe('root', () => {
    it('returns the data from the upstream posts endpoint', async () => {
      const posts = [
        { id: 1, userId: 1, title: 'First post', body: 'Post body' },
      ];
      const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: posts });

      await expect(appController.getHello()).resolves.toEqual(posts);
      expect(get).toHaveBeenCalledWith(
        'https://jsonplaceholder.typicode.com/posts',
      );
    });
  });
});
