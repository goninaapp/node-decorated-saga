import {
  KinesisStreamBatchItemFailure,
  KinesisStreamBatchResponse,
  KinesisStreamEvent,
  KinesisStreamRecord,
} from 'aws-lambda';
import {
  Kinesis,
  PutRecordCommand,
  PutRecordCommandInput,
} from '@aws-sdk/client-kinesis';
import { v4 as uuidv4 } from 'uuid';

export class Decoration {
  type: string;
  service: string;
  timestamp: number;
  payload: any;

  constructor(type?: string, service?: string, payload?: any) {
    this.type = type || '';
    this.service = service || '';
    this.timestamp = Date.now();
    this.payload = payload || {};
  }
}

export class Payload {
  version: string;
  correlationId: string;
  publishTime: number;
  saga: string;
  context: Decoration;
  decorations: Decoration[];
  private _service: string;

  constructor(saga?: string, context?: Decoration) {
    this.version = 'v1';
    this.correlationId = uuidv4();
    this.publishTime = Date.now();

    this.saga = saga || '';
    this.context = context || new Decoration();

    this.decorations = [];

    this._service = '';
  }

  static fromJSON(json: string): Payload {
    const payload = JSON.parse(json);
    const p = new Payload(payload.saga, payload.context);
    p.version = payload.version;
    p.correlationId = payload.correlationId;
    p.publishTime = payload.publishTime;
    p.decorations = payload.decorations;

    return p;
  }

  validateAndSet(service: string) {
    this._service = service;

    if (this.version !== 'v1') {
      return false;
    }

    if (this.context.service === service) {
      return false;
    }

    return !this.decorations.some((d) => d.service === service);
  }

  decorate(type: string, payload: any) {
    if (!this._service || this._service === '') {
      throw new Error('service name not set');
    }

    this.decorations = this.decorations || [];
    this.decorations.push(new Decoration(type, this._service, payload));
  }

  wasProcessedByService(service: string) {
    return (
      this.context.service == service ||
      (this.decorations || []).some((d) => d.service === service)
    );
  }

  getDecoration(type?: string) {
    if (this.context.type === type) {
      return this.context;
    }

    return (this.decorations || []).find((d) => d.type === type);
  }

  stringify(): string {
    return JSON.stringify(this, (key, value) => {
      if (key.startsWith('_')) {
        return undefined;
      }
      return value;
    });
  }
}

export type RecordHandler = (payload: Payload) => Promise<Error | undefined>;

class HandlerError extends Error {
  public readonly sequenceNumber: string;

  constructor(sequenceNumber: string, message: string) {
    super(message);
    this.sequenceNumber = sequenceNumber;
  }
}

export class Handler {
  private readonly serviceName: string;
  private readonly kinesis: Kinesis;
  private handlers: Map<string, RecordHandler>;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.handlers = new Map<string, RecordHandler>();

    this.kinesis = new Kinesis();
  }

  public registerHandler(saga: string, handler: RecordHandler) {
    this.handlers.set(saga, handler);
  }

  public async handler(
    request: KinesisStreamEvent,
  ): Promise<KinesisStreamBatchResponse> {
    const results = await Promise.all(
      request.Records.map(this.handleRecord.bind(this)),
    );

    const filtered = results.filter((r) => r) as HandlerError[];
    const batchItemFailures: KinesisStreamBatchItemFailure[] = filtered.map(
      (r) => ({
        itemIdentifier: r.sequenceNumber,
      }),
    );

    return { batchItemFailures };
  }

  async handleRecord(
    rec: KinesisStreamRecord,
  ): Promise<HandlerError | undefined> {
    const data = Buffer.from(rec.kinesis.data, 'base64').toString('utf-8');
    const payload = Payload.fromJSON(data);

    // We validate that the service has not processed this message before and that the version is correct.
    if (!payload.validateAndSet(this.serviceName)) {
      console.log('Message not processed by service', payload);
      return;
    }

    const handler = this.handlers.get(payload.saga);
    if (!handler) {
      console.log('No handler for message', payload);
      return;
    }

    const res = await handler(payload);
    if (res) {
      console.log('handler error', res);
      return new HandlerError(rec.kinesis.sequenceNumber, res.message);
    }

    return;
  }

  public async publish(payload: Payload) {
    const enc = new TextEncoder();

    const input: PutRecordCommandInput = {
      // PutRecordInput
      StreamName: 'message-bus',
      Data: enc.encode(payload.stringify()),
      PartitionKey: payload.saga,
    };

    return await this.kinesis.send(new PutRecordCommand(input));
  }
}
