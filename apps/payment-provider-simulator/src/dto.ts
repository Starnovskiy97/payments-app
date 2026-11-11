import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';

export class CreateInvoiceDto {
  @ApiProperty({ description: 'Наш ID платежа служит ключом идемпотентности у провайдера' })
  @IsUUID()
  merchantPaymentId!: string;

  @ApiProperty({ example: 50000 })
  @IsInt()
  @Min(1)
  @Max(100000000)
  amount!: number;

  @ApiProperty({ enum: ['RUB'] })
  @IsIn(['RUB'])
  currency!: 'RUB';

  @ApiProperty({ enum: ['card', 'sbp', 'crypto'] })
  @IsIn(['card', 'sbp', 'crypto'])
  method!: 'card' | 'sbp' | 'crypto';
}

export class CompleteInvoiceDto {
  @ApiProperty({ enum: ['succeeded', 'failed'] })
  @IsIn(['succeeded', 'failed'])
  status!: 'succeeded' | 'failed';

  @ApiPropertyOptional({ enum: ['send', 'skip'], default: 'send' })
  @IsIn(['send', 'skip'])
  delivery: 'send' | 'skip' = 'send';

  @ApiPropertyOptional({ default: 0, maximum: 2000 })
  @IsInt()
  @Min(0)
  @Max(2000)
  delayMs = 0;

  @ApiPropertyOptional({ default: 1, maximum: 3 })
  @IsInt()
  @Min(1)
  @Max(3)
  copies = 1;
}

export class NextCreateDto {
  @ApiProperty({ example: 2500, maximum: 6000 })
  @IsInt()
  @Min(0)
  @Max(6000)
  delayMs!: number;
}
