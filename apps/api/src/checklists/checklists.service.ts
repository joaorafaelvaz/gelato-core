import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { isValidTaskDefinition, evaluateResult, type ChecklistTaskType } from '@gelato/compliance'
import { PrismaService } from '../prisma/prisma.service'

interface TaskInput {
  label: string
  type: ChecklistTaskType
  valid_min?: number | null
  valid_max?: number | null
  required?: boolean
}

interface ResultInput {
  task_id: string
  value_bool?: boolean | null
  value_num?: number | null
  value_text?: string | null
  corrective_action?: string | null
}

@Injectable()
export class ChecklistsService {
  constructor(private readonly prisma: PrismaService) {}

  private validateTasks(tasks: TaskInput[]): void {
    if (tasks.length === 0) throw new BadRequestException('at least one task')
    for (const t of tasks) {
      if (!isValidTaskDefinition(t.type, t.valid_min ?? null, t.valid_max ?? null)) {
        throw new BadRequestException(`invalid task definition: ${t.label}`)
      }
    }
  }

  private taskData(tasks: TaskInput[]) {
    return tasks.map((t, i) => ({
      label: t.label,
      type: t.type,
      validMin: t.type === 'temperature' ? (t.valid_min ?? null) : null,
      validMax: t.type === 'temperature' ? (t.valid_max ?? null) : null,
      required: t.required ?? true,
      sortOrder: i + 1,
    }))
  }

  async list(tenantId: string) {
    return this.prisma.checklistTemplate.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      include: { tasks: { orderBy: { sortOrder: 'asc' } } },
    })
  }

  async create(tenantId: string, dto: { name: string; recurrence?: string; tasks: TaskInput[] }) {
    this.validateTasks(dto.tasks)
    const tpl = await this.prisma.checklistTemplate.create({
      data: { tenantId, name: dto.name, recurrence: dto.recurrence ?? 'daily', tasks: { create: this.taskData(dto.tasks) } },
    })
    return { id: tpl.id }
  }

  async update(tenantId: string, id: string, dto: { name?: string; recurrence?: string; active?: boolean; tasks?: TaskInput[] }) {
    const tpl = await this.prisma.checklistTemplate.findFirst({ where: { id, tenantId } })
    if (!tpl) throw new NotFoundException('template')
    if (dto.tasks) {
      this.validateTasks(dto.tasks)
      await this.prisma.$transaction([
        this.prisma.checklistTask.deleteMany({ where: { templateId: id } }),
        this.prisma.checklistTask.createMany({ data: this.taskData(dto.tasks).map((t) => ({ ...t, templateId: id })) }),
      ])
    }
    const data: { name?: string; recurrence?: string; active?: boolean } = {}
    if (dto.name !== undefined) data.name = dto.name
    if (dto.recurrence !== undefined) data.recurrence = dto.recurrence
    if (dto.active !== undefined) data.active = dto.active
    if (Object.keys(data).length > 0) await this.prisma.checklistTemplate.update({ where: { id }, data })
    return { id }
  }

  async listRuns(tenantId: string, templateId?: string) {
    return this.prisma.checklistRun.findMany({
      where: { tenantId, ...(templateId ? { templateId } : {}) },
      orderBy: { completedAt: 'desc' },
      include: { results: true },
    })
  }

  async submitRun(
    tenantId: string,
    dto: { client_event_id: string; template_id: string; kasse_id: string; results: ResultInput[] },
    userId?: string,
  ): Promise<{ id: string; status: string; duplicate: boolean }> {
    const seen = await this.prisma.checklistRun.findUnique({ where: { clientEventId: dto.client_event_id } })
    if (seen) return { id: seen.id, status: seen.status, duplicate: true }

    const tpl = await this.prisma.checklistTemplate.findFirst({
      where: { id: dto.template_id, tenantId },
      include: { tasks: { where: { active: true }, orderBy: { sortOrder: 'asc' } } },
    })
    if (!tpl) throw new NotFoundException('template')

    const byTaskId = new Map(dto.results.map((r) => [r.task_id, r]))
    const resultsData: {
      taskId: string; label: string; type: string; validMin: number | null; validMax: number | null
      valueBool: boolean | null; valueNum: number | null; valueText: string | null; ok: boolean; reading: string | null; correctiveAction: string | null
    }[] = []
    let hasDeviation = false

    for (const task of tpl.tasks) {
      const r = byTaskId.get(task.id)
      if (task.required) {
        if (!r) throw new BadRequestException(`missing result for required task: ${task.label}`)
        if (task.type === 'temperature' && r.value_num == null) throw new BadRequestException(`missing value for: ${task.label}`)
        if (task.type === 'boolean' && r.value_bool == null) throw new BadRequestException(`missing value for: ${task.label}`)
      }
      if (!r) continue
      const { ok, reading } = evaluateResult({
        type: task.type as ChecklistTaskType,
        valueBool: r.value_bool ?? null,
        valueNum: r.value_num ?? null,
        valueText: r.value_text ?? null,
        validMin: task.validMin,
        validMax: task.validMax,
      })
      if (task.required && !ok && !r.corrective_action) {
        throw new BadRequestException(`corrective action required for: ${task.label}`)
      }
      if (task.required && !ok) hasDeviation = true
      resultsData.push({
        taskId: task.id, label: task.label, type: task.type, validMin: task.validMin, validMax: task.validMax,
        valueBool: r.value_bool ?? null, valueNum: r.value_num ?? null, valueText: r.value_text ?? null,
        ok, reading, correctiveAction: r.corrective_action ?? null,
      })
    }

    const run = await this.prisma.checklistRun.create({
      data: {
        tenantId, templateId: tpl.id, kasseId: dto.kasse_id, executedBy: userId,
        clientEventId: dto.client_event_id, status: hasDeviation ? 'deviations' : 'ok',
        completedAt: new Date(), results: { create: resultsData },
      },
    })
    return { id: run.id, status: run.status, duplicate: false }
  }
}
