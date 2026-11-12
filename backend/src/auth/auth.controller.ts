import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/auth';
import { AuthService } from './auth.service';

class RegisterDto {
  @IsString() orgName: string;
  @IsString() branchName: string;
  @IsString() @Matches(/^[A-Za-z0-9]{2,8}$/, { message: 'branchCode must be 2-8 letters/digits' }) branchCode: string;
  @IsString() name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
}
class LoginDto {
  @IsEmail() email: string;
  @IsString() password: string;
}
class RefreshDto {
  @IsString() refreshToken: string;
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register') register(@Body() dto: RegisterDto) {
    return this.auth.registerOrg({ ...dto, branchCode: dto.branchCode.toUpperCase() });
  }
  @Post('login') login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }
  @Post('refresh') refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }
  @Post('logout') @UseGuards(JwtAuthGuard) logout(@CurrentUser() u: AuthUser) {
    return this.auth.logout(u.sub);
  }
  @Get('me') @UseGuards(JwtAuthGuard) me(@CurrentUser() u: AuthUser) {
    return this.auth.me(u.sub);
  }
}
