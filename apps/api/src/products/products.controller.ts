import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { extname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { z } from 'zod'
import { ProductsService } from './products.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const ProductDto = z.object({
  name: z.string().min(1),
  netCents: z.number().int().nonnegative(),
  mwstCodeImHaus: z.string().min(1),
  mwstCodeAusserHaus: z.string().min(1),
  type: z.enum(['vendavel', 'insumo', 'semi_acabado']).optional(),
  imageUrl: z.string().optional(),
})

const ProductUpdateDto = ProductDto.partial()

const UPLOADS_DIR = join(process.cwd(), 'uploads', 'products')
mkdirSync(UPLOADS_DIR, { recursive: true })

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('products')
  @RequirePermission('product.view')
  list(@Req() req: { user: JwtUser }) {
    return this.products.list(req.user.tenant_id)
  }

  @Post('products')
  @RequirePermission('product.manage')
  create(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.products.create(req.user.tenant_id, parseOrThrow(ProductDto, body))
  }

  @Patch('products/:id')
  @RequirePermission('product.manage')
  async patch(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: unknown) {
    const updated = await this.products.update(req.user.tenant_id, id, parseOrThrow(ProductUpdateDto, body))
    if (!updated) throw new NotFoundException()
    return updated
  }

  @Post('products/upload-image')
  @RequirePermission('product.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOADS_DIR,
        filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extname(file.originalname)}`),
      }),
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp']
        cb(null, allowed.includes(file.mimetype))
      },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    return { url: `/uploads/products/${file.filename}` }
  }

  @Get('tax-rates')
  @RequirePermission('product.view')
  taxRates(@Req() req: { user: JwtUser }) {
    return this.products.taxRates(req.user.tenant_id)
  }

  @Get('product-categories')
  @RequirePermission('product.view')
  categories(@Req() req: { user: JwtUser }) {
    return this.products.categories(req.user.tenant_id)
  }
}
