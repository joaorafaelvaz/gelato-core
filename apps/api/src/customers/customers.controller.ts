import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { CustomersService } from './customers.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const ContactDto = z.object({ name: z.string().min(1).optional(), email: z.string().email().optional(), phone: z.string().min(1).optional() })
const ConsentDto = z.object({ purpose: z.string().min(1), action: z.enum(['granted', 'withdrawn']), source: z.string().optional() })

@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('marketing.view')
  async list(@Req() req: { user: JwtUser }) {
    return this.customers.list(req.user.tenant_id)
  }

  @Get(':id')
  @RequirePermission('marketing.view')
  async get(@Req() req: { user: JwtUser }, @Param('id') id: string) {
    return this.customers.get(req.user.tenant_id, id)
  }

  @Post()
  @RequirePermission('customer.manage')
  async create(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.customers.create(req.user.tenant_id, parseOrThrow(ContactDto, body))
  }

  @Patch(':id')
  @RequirePermission('customer.manage')
  async update(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: unknown) {
    return this.customers.update(req.user.tenant_id, id, parseOrThrow(ContactDto, body))
  }

  @Post(':id/consent')
  @RequirePermission('customer.manage')
  async consent(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: unknown) {
    return this.customers.recordConsent(req.user.tenant_id, id, parseOrThrow(ConsentDto, body))
  }

  @Post(':id/anonymize')
  @RequirePermission('customer.manage')
  async anonymize(@Req() req: { user: JwtUser }, @Param('id') id: string) {
    return this.customers.anonymize(req.user.tenant_id, id)
  }
}
