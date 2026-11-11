import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsUUID, Matches, Max, Min } from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty()
  @IsUUID()
  orderId!: string;

  @ApiProperty({ example: 50000, description: 'Копейки, не рубли' })
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

  @ApiProperty()
  @Matches(/^[\w-]{8,128}$/)
  idempotencyKey!: string;
}

export class MockResultDto {
  @ApiProperty({ enum: ['succeeded', 'failed'] })
  @IsIn(['succeeded', 'failed'])
  status!: 'succeeded' | 'failed';
}
