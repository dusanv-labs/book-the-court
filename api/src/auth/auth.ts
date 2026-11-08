import {
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  HttpCode,
  Injectable,
  Module,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword, verifyPassword } from './password.js';

const loginSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
});
type LoginDto = z.infer<typeof loginSchema>;

export interface AdminTokenPayload {
  sub: string;
  email: string;
  role: 'admin';
}

@Injectable()
export class AuthService {
  // Used when the email is unknown, so the response time does not reveal which emails exist.
  private readonly dummyHash = hashPassword('dummy-password-for-timing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login({ email, password }: LoginDto): Promise<{ accessToken: string }> {
    const user = await this.prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    const valid = await verifyPassword(password, user?.passwordHash ?? (await this.dummyHash));
    if (!user || !valid) throw new UnauthorizedException('Invalid email or password.');
    const payload: AdminTokenPayload = { sub: user.id, email: user.email, role: 'admin' };
    return { accessToken: await this.jwt.signAsync(payload) };
  }
}

/** Protects admin routes: requires a valid "Authorization: Bearer <token>" header. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; admin?: unknown }>();
    const [scheme, token] = (req.headers['authorization'] ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Missing access token.');
    try {
      const payload = await this.jwt.verifyAsync<AdminTokenPayload>(token);
      if (payload.role !== 'admin') throw new Error('Not an admin token');
      req.admin = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }
  }
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Admin login. Returns a JWT access token.' })
  login(@Body({ schema: loginSchema }) body: LoginDto) {
    return this.auth.login(body);
  }
}

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.JWT_SECRET,
        // Only HS256 is accepted, so a token can never choose its own algorithm (e.g. "none").
        signOptions: { algorithm: 'HS256', expiresIn: config.JWT_EXPIRES_IN_SECONDS },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AdminGuard],
  exports: [AdminGuard],
})
export class AuthModule {}
