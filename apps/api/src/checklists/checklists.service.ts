import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { isValidTaskDefinition, type ChecklistTaskType } from '@gelato/compliance'
import { PrismaService } from '../prisma/prisma.service'

interface TaskInput {
  label: string
  type: ChecklistTaskType
  valid_min?: number | null
  valid_max?: number | null
  required?: boolean
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
}
