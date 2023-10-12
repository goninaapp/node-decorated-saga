import { KinesisStreamRecord, SQSRecord } from 'aws-lambda';
import { extract, RawPayload } from './payload';

function createSqsRecord(messageId: string, payload: string): SQSRecord {
  return {
    messageId,
    body: payload,
    attributes: {
      ApproximateFirstReceiveTimestamp: '',
      ApproximateReceiveCount: '',
      SenderId: '',
      SentTimestamp: '',
    },
    awsRegion: '',
    eventSource: '',
    eventSourceARN: '',
    md5OfBody: '',
    messageAttributes: {},
    receiptHandle: '',
  };
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

describe('payload', () => {
  it('APIGatewayEventV2', () => {
    const data = JSON.stringify({
      headers: {},
      isBase64Encoded: false,
      rawPath: '/test',
      rawQueryString: '',
      body: 'Hello World',
      requestContext: {
        accountId: '',
        apiId: '',
        domainName: '',
        domainPrefix: '',
        requestId: '',
        routeKey: '',
        stage: '',
        time: '',
        timeEpoch: 0,
        http: {
          method: '',
          path: '',
          protocol: '',
          sourceIp: '',
          userAgent: '',
        },
      },
      routeKey: '',
      version: '',
    });

    expect(() => extract(JSON.parse(data))).toThrow('invalid event');
  });

  it('SQSRecord', () => {
    const payload1 = { hello: 'world' };
    const payload2 = 'hello world';

    const rec1 = createSqsRecord('1', JSON.stringify(payload1));
    const rec2 = createSqsRecord('2', payload2);

    expect(extract({ Records: [rec1, rec2] })).toEqual([
      new RawPayload('1', JSON.stringify(payload1)),
      new RawPayload('2', payload2),
    ]);
  });

  it('KinesisData', () => {
    const payload1 = { hello: 'world' };
    const payload2 = 'hello world';

    const rec1 = createKinesisRecord('1', JSON.stringify(payload1));
    const rec2 = createKinesisRecord('2', payload2);

    expect(extract({ Records: [rec1, rec2] })).toEqual([
      new RawPayload('1', JSON.stringify(payload1)),
      new RawPayload('2', payload2),
    ]);
  });

  it('Nested', () => {
    const payload1 = { hello: 'world' };
    const payload2 = 'hello world';

    const rec1 = createSqsRecord('10', JSON.stringify(payload1));
    const rec2 = createKinesisRecord('20', payload2);

    const upperRec1 = createKinesisRecord('1', JSON.stringify(rec1));
    const upperRec2 = createKinesisRecord('2', JSON.stringify(rec2));
    expect(extract({ Records: [upperRec1, upperRec2] })).toEqual([
      new RawPayload('1', JSON.stringify(payload1)),
      new RawPayload('2', payload2),
    ]);

    const upperRec3 = createSqsRecord('3', JSON.stringify(rec1));
    const upperRec4 = createSqsRecord('4', JSON.stringify(rec2));
    expect(extract({ Records: [upperRec3, upperRec4] })).toEqual([
      new RawPayload('3', JSON.stringify(payload1)),
      new RawPayload('4', payload2),
    ]);
  });
});
