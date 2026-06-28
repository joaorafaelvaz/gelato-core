import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { ChecklistsService } from './checklists.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const Task = z.object({
  label: z.string().min(1),
  type: z.enum(['boolean', 'temperature', 'text']),
  valid_min: z.number().int().nullish(),
  valid_max: z.number().int().nullish(),
  required: z.boolean().optional(),
})
const CreateDto = z.object({ name: z.string().min(1), recurrence: z.string().optional(), tasks: z.array(Task).min(1) })
const UpdateDto = z.object({ name: z.string().min(1).optional(), recurrence: z.string().optional(), active: z.boolean().optional(), tasks: z.array(Task).min(1).optional() })

const RunResult = z.object({
  task_id: z.string().min(1),
  value_bool: z.boolean().nullish(),
  value_num: z.number().int().nullish(),
  value_text: z.string().nullish(),
  corrective_action: z.string().nullish(),
})
const RunDto = z.object({
  client_event_id: z.string().uuid(),
  template_id: z.string().min(1),
  kasse_id: z.string().min(1),
  results: z.array(RunResult).min(1),
})

@Controller('checklists')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChecklistsController {
  constructor(private readonly checklists: ChecklistsService) {}

  @Get('templates')
  @RequirePermission('checklist.view')
  async list(@Req() req: { user: JwtUser }) {
    return this.checklists.list(req.user.tenant_id)
  }

  @Post('templates')
  @RequirePermission('checklist.manage')
  async create(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.checklists.create(req.user.tenant_id, parseOrThrow(CreateDto, body))
  }

  @Put('templates/:id')
  @HttpCode(200)
  @RequirePermission('checklist.manage')
  async update(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: unknown) {
    return this.checklists.update(req.user.tenant_id, id, parseOrThrow(UpdateDto, body))
  }

  @Post('runs')
  @RequirePermission('checklist.execute')
  async submitRun(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.checklists.submitRun(req.user.tenant_id, parseOrThrow(RunDto, body), req.user.sub)
  }

  @Get('runs')
  @RequirePermission('checklist.view')
  async listRuns(@Req() req: { user: JwtUser }, @Query('template_id') templateId?: string) {
    return this.checklists.listRuns(req.user.tenant_id, templateId)
  }

  @Get('status')
  @RequirePermission('checklist.view')
  async status(@Req() req: { user: JwtUser }) {
    return this.checklists.status(req.user.tenant_id)
  }

  @Get('deviations')
  @RequirePermission('checklist.view')
  async deviations(@Req() req: { user: JwtUser }, @Query('from') from?: string, @Query('to') to?: string) {
    return this.checklists.deviations(req.user.tenant_id, from, to)
  }
}
