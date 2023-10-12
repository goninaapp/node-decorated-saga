import { v4 as uuidv4 } from 'uuid';

export class Result {
  type: string;
  payload: Object;

  constructor(type: string, payload: Object) {
    this.type = type;
    this.payload = payload;
  }
}

export class Decoration {
  type: string;
  service: string;
  timestamp: number;
  payload: Object;

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
  context: Object;
  requests: string[];
  decorations: Decoration[];

  constructor(saga?: string, context?: Object) {
    this.version = 'decorated.saga.v1';

    this.correlationId = uuidv4();
    this.publishTime = Date.now();

    this.saga = saga || '';
    this.context = context || {};

    this.requests = [];
    this.decorations = [];
  }

  static fromJSON(json: string): Payload | undefined {
    try {
      const payload = JSON.parse(json);

      if (payload?.version !== 'decorated.saga.v1') {
        return;
      }

      const p = new Payload(payload.saga, payload.context);
      p.version = payload.version;
      p.correlationId = payload.correlationId || uuidv4();
      p.publishTime = payload.publishTime || Date.now();
      p.requests = payload.requests || [];
      p.decorations = payload.decorations || [];

      return p;
    } catch (e: any) {
      return;
    }
  }

  public addRequest(type: string) {
    if (!this.requests.includes(type)) {
      this.requests.push(type);
    }
  }

  hasDecoration(type: string) {
    return this.decorations.some((d) => d.type === type);
  }

  processedByService(service: string) {
    return (this.decorations || []).some((d) => d.service === service);
  }

  getDecoration(type?: string) {
    return (this.decorations || []).find((d) => d.type === type);
  }

  next(): string | undefined {
    return this.requests.find((r) => !this.hasDecoration(r));
  }
}

export class FailedKinesisBatch {
  shardId: string;
  startSequenceNumber: string;
  endSequenceNumber: string;
  approximateArrivalOfFirstRecord: string;
  approximateArrivalOfLastRecord: string;
  batchSize: number;
  streamArn: string;

  constructor(
    shardId: string,
    startSequenceNumber: string,
    endSequenceNumber: string,
    approximateArrivalOfFirstRecord: string,
    approximateArrivalOfLastRecord: string,
    batchSize: number,
    streamArn: string,
  ) {
    this.shardId = shardId;
    this.startSequenceNumber = startSequenceNumber;
    this.endSequenceNumber = endSequenceNumber;
    this.approximateArrivalOfFirstRecord = approximateArrivalOfFirstRecord;
    this.approximateArrivalOfLastRecord = approximateArrivalOfLastRecord;
    this.batchSize = batchSize;
    this.streamArn = streamArn;
  }

  static fromJSON(json: string): FailedKinesisBatch | undefined {
    try {
      const payload = JSON.parse(json);

      if (!payload || !payload.KinesisBatchInfo) {
        return;
      }

      // {
      //       requestContext: {
      //         requestId: 'bbb29733-7a04-4371-88d8-4d3dc3b9e58c',
      //         functionArn: 'arn:aws:lambda:eu-central-1:492980254409:function:DecoratedSagaTestStack-TestLambda2F70C45E-o9g0Ba5nIxzp',
      //         condition: 'RetryAttemptsExhausted',
      //         approximateInvokeCount: 2
      //       },
      //       responseContext: { statusCode: 200, executedVersion: '$LATEST', functionError: null },
      //       version: '1.0',
      //       timestamp: '2023-10-12T06:15:32.294Z',
      //       KinesisBatchInfo: {
      //         shardId: 'shardId-000000000000',
      //         startSequenceNumber: '49645398595737222647302921394607831293360529904391684098',
      //         endSequenceNumber: '49645398595737222647302921394607831293360529904391684098',
      //         approximateArrivalOfFirstRecord: '2023-10-12T06:15:31.669Z',
      //         approximateArrivalOfLastRecord: '2023-10-12T06:15:31.669Z',
      //         batchSize: 1,
      //         streamArn: 'arn:aws:kinesis:eu-central-1:492980254409:stream/DecoratedSagaTestStack-MessageBus4A6FF7C2-BzjK08huNxzT'
      //       }
      //     }

      return new FailedKinesisBatch(
        payload.KinesisBatchInfo.shardId,
        payload.KinesisBatchInfo.startSequenceNumber,
        payload.KinesisBatchInfo.endSequenceNumber,
        payload.KinesisBatchInfo.approximateArrivalOfFirstRecord,
        payload.KinesisBatchInfo.approximateArrivalOfLastRecord,
        payload.KinesisBatchInfo.batchSize,
        payload.KinesisBatchInfo.streamArn,
      );
    } catch (e: any) {
      return;
    }
  }
}
