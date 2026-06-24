import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { AuthService } from './auth.service'
import { JwtAuthGuard, type JwtUser } from './jwt-auth.guard'
import { parseOrThrow } from '../common/zod'

const LoginDto = z.object({ email: z.string().email(), password: z.string().min(1) })
const PinDto = z.object({ kasse_id: z.string().min(1), pin: z.string().min(1) })
const EscalateDto = z.object({ password: z.string().min(1) })

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown) {
    const { email, password } = parseOrThrow(LoginDto, body)
    return this.auth.loginPassword(email, password)
  }

  @Post('pin')
  @HttpCode(200)
  async pin(@Body() body: unknown) {
    const { kasse_id, pin } = parseOrThrow(PinDto, body)
    return this.auth.loginPin(kasse_id, pin)
  }

  @Post('escalate')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async escalate(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    const { password } = parseOrThrow(EscalateDto, body)
    return this.auth.escalate(req.user.sub, password)
  }
}
