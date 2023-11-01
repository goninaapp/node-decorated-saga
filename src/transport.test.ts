import {
  Controller,
  INestMicroservice,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import {
  EventPattern,
  MessagePattern,
  MicroserviceOptions,
} from '@nestjs/microservices';
import { NestFactory } from '@nestjs/core';
import { DecoratedSagaTransport } from './transport';
import { KinesisStreamRecord } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { Payload, Result } from './types';
import { Handler } from './index';
import SpyInstance = jest.SpyInstance;

describe('transport', () => {
  let controller: TestController;
  let service: INestMicroservice;
  let transport: DecoratedSagaTransport;

  beforeEach(async () => {
    process.env.DEBUG = '*';

    transport = new DecoratedSagaTransport('test');

    service = await NestFactory.createMicroservice<MicroserviceOptions>(
      TestModule,
      {
        strategy: transport,
      },
    );

    controller = service.get<TestController>(TestController);

    service.listen();

    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it('should echo back', () => {
    expect(controller.message(new Payload('saga', '123'))).toBe('123');
    expect(controller.event(new Payload('saga', '123'))).toStrictEqual({
      type: 'event.response',
      payload: '123',
    });
  });

  it('test event processing', async () => {
    const id = uuidv4();
    const payload = createKinesisRecord(
      id,
      JSON.stringify(new Payload('event', '123')),
    );

    const mock = jest
      .spyOn(Handler.prototype as any, 'publishInternal')
      .mockImplementation((payload: any) => {
        expect(payload.saga).toBe('event');
        expect(payload.context).toBe('123');
        expect(payload.decorations.length).toBe(1);
        expect(payload.decorations[0].type).toBe('event.response');
        expect(payload.decorations[0].payload).toBe('123');
        expect(payload.decorations[0].service).toBe('test');
      });

    const result = await transport.handler.handler({
      Records: [payload],
    });

    expect(result).toStrictEqual({ batchItemFailures: [] });
    expect(mock).toHaveBeenCalled();
  });

  it('test message processing', async () => {
    const id = uuidv4();
    const payload = new Payload('saga', '123');
    payload.addRequest('sum');

    const data = createKinesisRecord(id, JSON.stringify(payload));

    const mock = jest
      .spyOn(Handler.prototype as any, 'publishInternal')
      .mockImplementation((payload: any) => {
        console.log(payload);
        expect(payload.saga).toBe('saga');
        expect(payload.context).toBe('123');
        expect(payload.decorations.length).toBe(1);
        expect(payload.decorations[0].type).toBe('sum');
        expect(payload.decorations[0].payload).toBe('123');
        expect(payload.decorations[0].service).toBe('test');
      });

    const result = await transport.handler.handler({
      Records: [data],
    });

    expect(result).toStrictEqual({ batchItemFailures: [] });
    expect(mock).toHaveBeenCalled();
  });
});

@Controller()
class TestController {
  constructor() {}

  @MessagePattern('sum')
  message(data: Payload): string {
    console.log(data);
    return data.context as unknown as string;
  }

  @EventPattern('event')
  event(data: Payload): Result {
    console.log(data);

    return {
      type: 'event.response',
      payload: data.context,
    };
  }
}

@Module({ controllers: [TestController] })
export class TestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {}
}

function createKinesisRecord(
  messageId: string,
  payload: string,
): KinesisStreamRecord {
  return {
    awsRegion: '',
    eventSource: '',
    eventSourceARN: '',
    eventVersion: '',
    eventID: '',
    invokeIdentityArn: '',
    eventName: '',
    kinesis: {
      approximateArrivalTimestamp: 0,
      data: Buffer.from(payload).toString('base64'),
      kinesisSchemaVersion: '',
      partitionKey: '',
      sequenceNumber: messageId,
    },
  };
}
