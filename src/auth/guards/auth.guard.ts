import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { UsersService } from '../../users/users.service';
import { forwardRef, Inject } from '@nestjs/common';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('No token provided');
    }

    const [bearer, token] = authHeader.split(' ');

    if (bearer !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid token format');
    }

    // Validate via Redis (through AuthService)
    const redisData = await this.authService.validateToken(token);

    if (!redisData || !redisData.userId) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Optional: Fetch full user object if needed for the request context
    // This adds a DB call, but ensures user wasn't deleted in the meantime
    const user = await this.usersService.findById(redisData.userId);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    request.user = user; // Attach user to request
    return true;
  }
}
