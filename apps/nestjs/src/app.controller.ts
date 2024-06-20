import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import axios from 'axios';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  async getHello() {
    return (await axios.get('https://jsonplaceholder.typicode.com/posts')).data;
  }

  @Get('/post')
  async getPost() {
    const res = await axios.post('https://jsonplaceholder.typicode.com/posts', {
      title: 'foo',
      body: 'bar',
      userId: 1,
    });
    return res.data;
  }

  @Get('/put')
  async putPost() {
    const res = await axios.put(
      'https://jsonplaceholder.typicode.com/posts/1',
      {
        title: 'foo',
        body: 'bar',
        userId: 101,
      },
    );
    return res.data;
  }
}
