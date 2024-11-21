import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { IncomingHttpHeaders } from 'http2';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  logger = new Logger(ApiKeyAuthGuard.name);

  constructor(private readonly configService: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const request = context.switchToHttp().getRequest();
      const headers: IncomingHttpHeaders = request.headers;
      const authorization: string = headers.authorization;
      const bearerToken: string[] = authorization.split(' ');
      const token: string = bearerToken[1];
      const apiKey = this.configService.get<string>('API_KEY');
      return apiKey === token;
    } catch (error) {
      throw new UnauthorizedException();
    }
  }
}
