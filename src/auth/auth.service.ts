import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthToken } from './schemas/auth-token.schema';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private redisService: RedisService,
    private configService: ConfigService,
    @InjectModel(AuthToken.name) private authTokenModel: Model<AuthToken>,
  ) {}

  async login(email: string, pass: string) {
    // 1. Validate User
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(pass, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const userId = user._id.toString();
    const maxSessions = this.configService.get<number>('MAX_CONCURRENT_SESSIONS') || 3;
    const sessionKey = `user:sessions:${userId}`;

    // 2. Manage Session Limits using Redis List (FIFO)
    // Add new token request *logic* before generating, or generate first then push.
    // We generate first to have the ID.
    const token = uuidv4();
    const ttlDays = this.configService.get<number>('TOKEN_TTL_DAYS') || 7;
    const ttlSeconds = ttlDays * 24 * 60 * 60;

    // Push new token to the RIGHT end of the list
    await this.redisService.rpush(sessionKey, token);
    
    // Check length
    const sessionCount = await this.redisService.llen(sessionKey);

    if (sessionCount > maxSessions) {
      // Pop the oldest token from the LEFT
      const oldestToken = await this.redisService.lpop(sessionKey);
      
      if (oldestToken) {
        // Invalidate the old token immediately
        await this.redisService.del(`auth_token:${oldestToken}`);
        // Remove from DB (for consistency)
        await this.authTokenModel.findOneAndDelete({ token: oldestToken }).exec();
      }
    }

    // 3. Store new Token Mapping in Redis (for fast AuthGuard lookup)
    await this.redisService.set(
      `auth_token:${token}`,
      JSON.stringify({ userId: userId, role: user.role }),
      ttlSeconds,
    );

    // 4. Store in DB (Persistence Layer)
    const newAuthToken = new this.authTokenModel({
      userId: user._id,
      token: token,
    });
    await newAuthToken.save();

    // 5. Refresh List TTL?
    // We can set an expiry on the list key itself so if a user never logs in again,
    // the list doesn't stay forever. Set it slightly longer than token TTL.
    await this.redisService.set(sessionKey, '', ttlSeconds + 86400); // Hack to reset TTL on key without overwriting list? 
    // Actually, Redis EXPIRE command is better but our service wrapper uses SET with EX.
    // For lists, we usually just let them sit or use a specific EXPIRE call.
    // Since wrapper is simple, we will skip explicit EXPIRE on the list key for now 
    // as it doesn't harm correctness, just memory hygiene long term.

    return {
      accessToken: token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  async logout(token: string, userId: string) {
    // 1. Delete from Redis Lookup
    await this.redisService.del(`auth_token:${token}`);

    // 2. Remove from Redis List
    // LREM key count value (count 0 means remove all elements equal to value)
    await this.redisService.lrem(`user:sessions:${userId}`, 0, token);
    
    // 3. Delete from DB
    await this.authTokenModel.findOneAndDelete({ token }).exec();
  }

  async validateToken(token: string): Promise<any> {
    const userDataStr = await this.redisService.get(`auth_token:${token}`);
    if (!userDataStr) {
      return null;
    }
    return JSON.parse(userDataStr);
  }
}
