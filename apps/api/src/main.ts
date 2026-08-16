import { NestFactory } from '@nestjs/core';
import { loadServerConfig } from '@ai-learning-os/config';
import { AppModule } from './app.module';
import { requestObservabilityMiddleware } from './observability/request-observability.middleware';
import { CsrfMiddleware } from './identity/csrf.middleware';
async function bootstrap() {
  const config = loadServerConfig();
  const app = await NestFactory.create(AppModule);
  app.use(requestObservabilityMiddleware);
  const csrf = new CsrfMiddleware();
  app.use(csrf.use.bind(csrf));
  app.enableCors({
    origin: (requestOrigin, callback) => {
      if (!requestOrigin || requestOrigin === config.app.webOrigin)
        callback(null, true);
      else callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  });
  await app.listen(config.app.apiPort, process.env.API_HOST ?? '0.0.0.0');
}
bootstrap();
