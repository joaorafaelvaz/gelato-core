import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../permissions/permissions.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';


@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('admin.users')
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('admin.users')
  findByTenant(@CurrentUser('tenantId') tenantId: string) {
    return this.usersService.findByTenant(tenantId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('admin.users')
  findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }
}
