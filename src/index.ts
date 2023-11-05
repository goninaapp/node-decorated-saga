import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  KinesisStreamBatchItemFailure,
  KinesisStreamEvent,
  SNSEvent,
  SQSEvent,
} from 'aws-lambda';
import {
  GetRecordsCommand,
  GetShardIteratorCommand,
  Kinesis,
  PutRecordCommand,
  PutRecordCommandInput,
} from '@aws-sdk/client-kinesis';
import {
  SendMessageBatchCommand,
  SendMessageBatchRequest,
  SendMessageBatchRequestEntry,
  SQS,
} from '@aws-sdk/client-sqs';
import { extract, RawPayload } from './payload';
import debugg from 'debug';

import { Decoration, FailedKinesisBatch, Payload, Result } from './types';
import { DecoratedSagaInfrastructure } from './cdk';
import { Database } from './database';
import { DecoratedSagaTransport } from './transport';

export {
  Payload,
  Decoration,
  Result,
  DecoratedSagaInfrastructure,
  Database,
  DecoratedSagaTransport,
};

const error = debugg('error');
const debug = debugg('debug');
debug.log = console.log.bind(console);

export type PayloadHandler = (
  payload: Payload,
  alreadyProcessed: boolean,
) => Promise<Result | undefined>;
export type ProviderHandler = (payload: Payload) => Promise<Object | undefined>;
export type RawHandler = (payload: any) => Promise<void>;

export type ApiGatewayHandler = (
  payload: APIGatewayProxyEventV2,
) => Promise<APIGatewayProxyResultV2>;

export class Handler {
  private readonly serviceName: string;
  private readonly kinesis: Kinesis;
  private readonly streamName: string;
  private readonly sqs: SQS;
  private handlers: Map<string, PayloadHandler>;
  private providers: Map<string, ProviderHandler>;
  private rawHandler?: RawHandler;
  private apiGatewayHandler?: ApiGatewayHandler;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.handlers = new Map<string, PayloadHandler>();
    this.providers = new Map<string, ProviderHandler>();

    this.kinesis = new Kinesis();
    this.streamName = process.env.KINESIS_STREAM_NAME || 'message-bus';
    this.sqs = new SQS();
  }

  public registerHandler(saga: string, handler: PayloadHandler) {
    debug('registerHandler', saga);
    this.handlers.set(saga, handler);
  }

  public registerProvider(provider: string, handler: ProviderHandler) {
    debug('registerProvider', provider);
    this.providers.set(provider, handler);
  }

  public registerApiGatewayHandler(handler: ApiGatewayHandler) {
    debug('registerApiGatewayHandler');
    this.apiGatewayHandler = handler;
  }

  public registerRawHandler(handler: RawHandler) {
    debug('registerRawHandler');
    this.rawHandler = handler;
  }

  public async handler(request: any): Promise<any> {
    debug('handler', JSON.stringify(request));

    if (!request.hasOwnProperty('Records')) {
      return this.handleApiGatewayRequest(request as APIGatewayProxyEventV2);
    }

    request = request as KinesisStreamEvent | SQSEvent | SNSEvent;
    const records = extract(request);

    const results = await Promise.all(
      records.map(this.handleRecord.bind(this)),
    );

    const filtered = results.filter((r) => r) as string[];
    const batchItemFailures: KinesisStreamBatchItemFailure[] = filtered.map(
      (itemIdentifier) => ({
        itemIdentifier,
      }),
    );

    debug('batchItemFailures', batchItemFailures);

    return { batchItemFailures };
  }

  private async handleApiGatewayRequest(
    request: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyResultV2> {
    debug('handleApiGatewayRequest', request);

    if (!this.apiGatewayHandler) {
      error('apiGatewayHandler not registered');
      return { statusCode: 500, body: 'not implemented' };
    }

    try {
      return await this.apiGatewayHandler(request as APIGatewayProxyEventV2);
    } catch (e: any) {
      error('apiGatewayHandler error', e);
      return { statusCode: 500, body: 'Internal Server Error' };
    }
  }

  private async handleRecord(raw: RawPayload): Promise<string | undefined> {
    debug('handleRecord', raw);

    const failedBatch = FailedKinesisBatch.fromJSON(raw.payload);
    if (failedBatch) {
      const res = await this.handleFailedBatch(failedBatch);
      return res ? raw.messageId : undefined;
    }

    const payload = Payload.fromJSON(raw.payload);
    if (payload) {
      const res = await this.handlePayload(payload);
      return res ? raw.messageId : undefined;
    }

    return this.handleRaw(raw);
  }

  private async handleRaw(raw: RawPayload): Promise<string | undefined> {
    debug('handleRaw', raw);

    if (!this.rawHandler) {
      debug('no handler found', raw);
      return;
    }

    try {
      await this.rawHandler(raw.payload);
      return;
    } catch (e: any) {
      error('rawHandler error caught', e);
      return raw.messageId;
    }
  }

  private async handleFailedBatch(
    failedBatch: FailedKinesisBatch,
  ): Promise<Error | undefined> {
    debug('handleFailedBatch', failedBatch);

    const { ShardIterator } = await this.kinesis.send(
      new GetShardIteratorCommand({
        ShardId: failedBatch.shardId,
        ShardIteratorType: 'AT_SEQUENCE_NUMBER',
        StreamARN: failedBatch.streamArn,
        StartingSequenceNumber: failedBatch.startSequenceNumber,
      }),
    );

    console.log('ShardIterator', ShardIterator);

    const records = await this.kinesis.send(
      new GetRecordsCommand({
        ShardIterator,
        Limit: failedBatch.batchSize,
      }),
    );

    debug('records', records);

    let batch: SendMessageBatchRequestEntry[] = [];
    for (const rec of records.Records || []) {
      if (!rec.Data) {
        continue;
      }

      if (!process.env.SQS_QUEUE_URL) {
        error('no SQS_QUEUE_URL env var');
        return new Error('no SQS_QUEUE_URL env var');
      }

      const decoder = new TextDecoder('utf-8');
      batch.push({
        Id: rec.SequenceNumber || '',
        MessageBody: decoder.decode(rec.Data),
      });

      if (rec.SequenceNumber == failedBatch.endSequenceNumber) {
        break;
      }
    }

    while (batch.length > 0) {
      const slice = batch.splice(0, 5);

      try {
        const cmd: SendMessageBatchRequest = {
          QueueUrl: process.env.SQS_QUEUE_URL || '',
          Entries: slice,
        };

        debug('sending batch', cmd);

        const res = await this.sqs.send(new SendMessageBatchCommand(cmd));
        if (res.Failed && res.Failed.length > 0) {
          error('failed to send message to SQS', res);
          return new Error('failed to send message to SQS');
        }
      } catch (e: any) {
        error('failed to send message to SQS', e);
        return new Error('failed to send message to SQS');
      }
    }

    return;
  }

  private async handlePayload(payload: Payload): Promise<Error | undefined> {
    debug('handlePayload', payload);

    const handler = this.handlers.get(payload.saga);
    if (handler) {
      try {
        const res = await handler(
          payload,
          payload.processedByService(this.serviceName),
        );
        if (res) {
          await this.decorate(payload, res);
        }

        return;
      } catch (e: any) {
        error('handler error', e);
        return new Error('handler failed');
      }
    }

    const next = payload.next() || '';
    const provider = this.providers.get(next);
    if (next === '' || !provider) {
      return;
    }

    try {
      const res = await provider(payload);
      if (res) {
        await this.decorate(payload, new Result(next, res));
      }

      return;
    } catch (e: any) {
      error('handler error', e);
      return new Error('handler failed');
    }
  }

  public async publish(saga: string, data: Object, requests?: string[]) {
    debug('publish', saga, data, requests);

    const payload = new Payload(saga, data);

    for (const req of requests || []) {
      payload.addRequest(req);
    }

    return this.publishInternal(payload);
  }

  private async decorate(payload: Payload, result: Result) {
    debug('decorate', payload, result);

    payload.decorations.push(
      new Decoration(result.type, this.serviceName, result.payload),
    );

    return this.publishInternal(payload);
  }

  private async publishInternal(payload: Payload) {
    debug('publishInternal', payload);

    const enc = new TextEncoder();

    const input: PutRecordCommandInput = {
      // PutRecordInput
      StreamName: this.streamName,
      Data: enc.encode(JSON.stringify(payload)),
      PartitionKey: payload.saga,
    };

    return this.kinesis.send(new PutRecordCommand(input));
  }
}
