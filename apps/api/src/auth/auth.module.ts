import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';

/** Sign-in for the hosted app (off locally). */
@Module({ controllers: [AuthController] })
export class AuthModule {}
