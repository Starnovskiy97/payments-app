import { randomUUID } from 'node:crypto';
import { connect, type ChannelModel, type ConfirmChannel, type Options } from 'amqplib';

export interface QueueNames {
  results: string;
  retry: string;
  dead: string;
}
export function queueNames(
  prefix = process.env.RABBITMQ_QUEUE_PREFIX ?? 'payments-lab',
): QueueNames {
  if (!/^[\w.-]{1,100}$/.test(prefix)) throw new Error('Некорректный RABBITMQ_QUEUE_PREFIX');
  const results = `${prefix}.orders.payment-results`;
  return { results, retry: `${results}.retry`, dead: `${results}.dead` };
}

export async function declareQueues(channel: ConfirmChannel, names: QueueNames): Promise<void> {
  const quorum = { 'x-queue-type': 'quorum', 'x-overflow': 'reject-publish' };
  await channel.assertQueue(names.dead, { durable: true, arguments: quorum });
  await channel.assertQueue(names.results, {
    durable: true,
    arguments: {
      ...quorum,
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': names.dead,
      'x-dead-letter-strategy': 'at-least-once',
      'x-delivery-limit': 20,
    },
  });
  await channel.assertQueue(names.retry, {
    durable: true,
    arguments: {
      ...quorum,
      'x-message-ttl': 2000,
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': names.results,
      'x-dead-letter-strategy': 'at-least-once',
    },
  });
}

interface PendingPublish {
  channel: ConfirmChannel;
  reject: (error: Error) => void;
}

/** Только транспорт. Не хранит публикации в памяти для последующей гарантированной отправки. */
export class RabbitConnection {
  readonly queues = queueNames();
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private connecting?: Promise<void>;
  private reconnectTimer?: NodeJS.Timeout;
  private stopped = false;
  private readonly pending = new Map<string, PendingPublish>();

  constructor(
    private readonly log: (message: string) => void,
    private readonly setup?: (channel: ConfirmChannel) => Promise<void>,
  ) {}

  get connected(): boolean {
    return this.channel !== undefined;
  }

  start(): void {
    void this.ensureConnected().catch(() => this.scheduleReconnect());
  }

  async publish(queue: string, content: Buffer, options: Options.Publish = {}): Promise<void> {
    await this.ensureConnected();
    const channel = this.channel;
    if (!channel) throw new Error('RabbitMQ не подключён');
    if (this.pending.size >= 100) throw new Error('Слишком много неподтверждённых публикаций');
    const correlationId = randomUUID();
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error | null) => {
        clearTimeout(timer);
        this.pending.delete(correlationId);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => finish(new Error('Истёк таймаут publisher confirm')), 2000);
      this.pending.set(correlationId, { channel, reject: finish });
      try {
        // false означает backpressure, а не отказ доставки. Результат определяет confirm callback.
        channel.sendToQueue(
          queue,
          content,
          {
            ...options,
            persistent: true,
            mandatory: true,
            correlationId,
            contentType: options.contentType ?? 'application/json',
          },
          (error) => finish(error),
        );
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Ошибка публикации'));
      }
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.stopped) throw new Error('AMQP-транспорт остановлен');
    if (this.connecting) return this.connecting;
    if (this.channel) return;
    this.connecting = this.open().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async open(): Promise<void> {
    let connection: ChannelModel | undefined;
    try {
      connection = await connect(
        process.env.RABBITMQ_URL ?? 'amqp://lab:lab_local@127.0.0.1:5672?heartbeat=5',
        { timeout: 1500 },
      );
      const owned = connection;
      let closed = false;
      connection.on('error', () => this.log('Ошибка соединения RabbitMQ'));
      connection.on('close', () => {
        closed = true;
        if (this.connection === owned) {
          this.connection = undefined;
          this.channel = undefined;
        }
        this.scheduleReconnect();
      });
      const channel = await connection.createConfirmChannel();
      channel.on('error', () => this.log('Ошибка AMQP-канала'));
      channel.on('return', (message) => {
        const id = message.properties.correlationId;
        if (id) this.pending.get(id)?.reject(new Error('mandatory: сообщение не маршрутизировано'));
      });
      channel.on('close', () => {
        for (const pending of this.pending.values()) {
          if (pending.channel === channel)
            pending.reject(new Error('Канал закрыт до подтверждения'));
        }
        if (this.channel === channel) this.channel = undefined;
        void owned.close().catch(() => undefined);
      });
      await declareQueues(channel, this.queues);
      await this.setup?.(channel);
      if (this.stopped || closed) throw new Error('Соединение закрыто во время подключения');
      this.connection = connection;
      this.channel = channel;
      this.log('RabbitMQ подключён; очереди объявлены');
    } catch (error) {
      if (connection) await connection.close().catch(() => undefined);
      this.log('RabbitMQ недоступен; будет повтор подключения');
      this.scheduleReconnect();
      throw error;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.start();
    }, 1000);
  }

  async close(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    const opening = this.connecting;
    if (opening) await opening.catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
    this.channel = undefined;
    this.connection = undefined;
  }
}
