import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private redisClient: Redis;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.redisClient = new Redis({
      host: this.configService.get<string>('REDIS_HOST'),
      port: this.configService.get<number>('REDIS_PORT'),
      password: this.configService.get<string>('REDIS_PASSWORD'),
    });
  }

  onModuleDestroy() {
    this.redisClient.disconnect();
  }

  // Basic Key-Value
  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.redisClient.set(key, value, 'EX', ttl);
    } else {
      await this.redisClient.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.redisClient.get(key);
  }

  async del(key: string): Promise<void> {
    await this.redisClient.del(key);
  }

  // List Operations (For Session Queue)
  async rpush(key: string, value: string): Promise<number> {
    return this.redisClient.rpush(key, value);
  }

  async lpop(key: string): Promise<string | null> {
    return this.redisClient.lpop(key);
  }
  
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
      return this.redisClient.lrange(key, start, stop);
  }

  async llen(key: string): Promise<number> {
    return this.redisClient.llen(key);
  }

  async lrem(key: string, count: number, value: string): Promise<number> {
      return this.redisClient.lrem(key, count, value);
  }
}
