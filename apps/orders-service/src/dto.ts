import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, Min } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ example: 'backend-course' })
  @IsString()
  productId!: string;

  @ApiProperty({ example: 1, minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  quantity!: number;
}

export class PayOrderDto {
  @ApiProperty({ enum: ['card', 'sbp', 'crypto'] })
  @IsIn(['card', 'sbp', 'crypto'])
  method!: 'card' | 'sbp' | 'crypto';
}
