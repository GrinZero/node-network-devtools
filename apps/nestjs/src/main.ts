import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { register } from 'node-network-devtools';

register();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
