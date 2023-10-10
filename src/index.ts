import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  KinesisStreamBatchItemFailure,
  KinesisStreamBatchResponse,
  KinesisStreamEvent,
  KinesisStreamRecord,
  SQSBatchItemFailure,
  SQSEvent,
  SQSRecord,
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
  requested: string[];
  decorations: Decoration[];
  private _service: string;

  constructor(saga?: string, context?: Decoration) {
    this.version = 'v1';
    this.correlationId = uuidv4();
    this.publishTime = Date.now();

    this.saga = saga || '';
    this.context = context || new Decoration();

    this.requested = [];
    this.decorations = [];

    this._service = '';
  }

  public addRequest(type: string) {
    if (!this.requested.includes(type)) {
      this.requested.push(type);
    }
  }

  static fromJSON(json: string): Payload {
    const payload = JSON.parse(json);
    const p = new Payload(payload.saga, payload.context);
    p.version = payload.version || 'v0';
    p.correlationId = payload.correlationId || uuidv4();
    p.publishTime = payload.publishTime || Date.now();
    p.requested = payload.requested || [];
    p.decorations = payload.decorations || [];

    return p;
  }

  validateAndSet(service: string) {
    this._service = service;

    if (this.version !== 'v1') {
      return false;
    }

    if (this.context.service === service && this.nextRequest() !== undefined) {
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

  hasDecoration(type: string) {
    return this.decorations.some((d) => d.type === type);
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

  nextRequest(): string | undefined {
    return this.requested.find((r) => !this.hasDecoration(r));
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
export type SQSHandler = (payload: SQSRecord) => Promise<Error | undefined>;
export type ProviderHandler = (payload: Payload) => Promise<any>;
export type ApiGatewayHandler = (
  payload: APIGatewayProxyEventV2,
) => Promise<APIGatewayProxyResultV2>;

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
  private providers: Map<string, ProviderHandler>;
  private sqsHandler?: SQSHandler;
  private apiGatewayHandler?: ApiGatewayHandler;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.handlers = new Map<string, RecordHandler>();
    this.providers = new Map<string, ProviderHandler>();

    this.kinesis = new Kinesis();
  }

  public registerHandler(saga: string, handler: RecordHandler) {
    this.handlers.set(saga, handler);
  }

  public registerProvider(provider: string, handler: ProviderHandler) {
    this.providers.set(provider, handler);
  }

  public registerApiGatewayHandler(handler: ApiGatewayHandler) {
    this.apiGatewayHandler = handler;
  }

  public registerSQSHandler(handler: SQSHandler) {
    this.sqsHandler = handler;
  }

  public async handler(
    request: KinesisStreamEvent | SQSEvent | APIGatewayProxyEventV2,
  ): Promise<
    KinesisStreamBatchResponse | SQSBatchItemFailure | APIGatewayProxyResultV2
  > {
    if (!request.hasOwnProperty('Records')) {
      if (!this.apiGatewayHandler) {
        throw new Error('No ApiGateway handler registered');
      }

      return await this.apiGatewayHandler(request as APIGatewayProxyEventV2);
    }

    request = request as KinesisStreamEvent | SQSEvent;
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
    rec: KinesisStreamRecord | SQSRecord,
  ): Promise<HandlerError | undefined> {
    if (rec.hasOwnProperty('messageId')) {
      rec = rec as SQSRecord;

      if (!this.sqsHandler) {
        return new HandlerError(rec.messageId, 'No SQS handler registered');
      }

      const res = await this.sqsHandler(JSON.parse(rec.body));
      if (res) {
        console.log('handler error', res);
        return new HandlerError(rec.messageId, res.message);
      }

      return;
    }

    rec = rec as KinesisStreamRecord;

    const data = Buffer.from(rec.kinesis.data, 'base64').toString('utf-8');
    const payload = Payload.fromJSON(data);

    // We validate that the service has not processed this message before and that the version is correct.
    if (!payload.validateAndSet(this.serviceName)) {
      return;
    }

    const handler = this.handlers.get(payload.saga);
    if (handler) {
      const res = await handler(payload);
      if (res) {
        console.log('handler error', res);
        return new HandlerError(rec.kinesis.sequenceNumber, res.message);
      }

      return;
    }

    const next = payload.nextRequest();
    if (!next) {
      return;
    }

    const provider = this.providers.get(next);
    if (!provider) {
      return;
    }

    const res = await provider(payload);
    if (res instanceof Error) {
      console.log('provider error', res);
      return new HandlerError(rec.kinesis.sequenceNumber, res.message);
    }

    payload.decorate(next, res);
    await this.publish(payload);

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
