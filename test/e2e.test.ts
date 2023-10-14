import { fromIni } from '@aws-sdk/credential-providers';
import {
  FunctionConfiguration,
  GetFunctionUrlConfigCommand,
  LambdaClient,
  ListFunctionsCommand,
} from '@aws-sdk/client-lambda';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { Payload } from '../src';
import {
  GetRecordsCommand,
  GetShardIteratorCommand,
  KinesisClient,
  ListStreamsCommand,
  PutRecordCommand,
  PutRecordCommandInput,
} from '@aws-sdk/client-kinesis';
import {
  DeleteMessageCommand,
  ListQueuesCommand,
  ReceiveMessageCommand, SendMessageCommand,
  SQS,
  SQSClient
} from "@aws-sdk/client-sqs";

describe('e2e', () => {
  let kinesis: KinesisClient;
  let kinesisStreamName: string;
  let lambda: LambdaClient;
  let func: FunctionConfiguration;
  let funcUrl: string;
  let sqs: SQSClient;
  let sqsUrl: string;
  let queueUrl: string;
  let responseQueueUrl: string;
  let requestDlqUrl: string;

  beforeAll(async () => {
    const credentials = fromIni({ profile: 'playground' });

    kinesis = new KinesisClient({ region: 'eu-central-1', credentials });

    const kinesisList = await kinesis.send(new ListStreamsCommand({}));
    const streams = kinesisList.StreamNames?.filter((f) =>
      f.startsWith('DecoratedSagaTestStack-'),
    );
    if (!streams || streams.length === 0) {
      throw new Error('no functions found');
    }

    kinesisStreamName = streams[0] || '';

    lambda = new LambdaClient({ region: 'eu-central-1', credentials });

    const res = await lambda.send(new ListFunctionsCommand({}));
    const funcs = res.Functions?.filter(
      (f) => f.FunctionName?.startsWith('DecoratedSagaTestStack-'),
    );
    if (!funcs || funcs.length === 0) {
      throw new Error('no functions found');
    }

    func = funcs[0];

    const u = await lambda.send(
      new GetFunctionUrlConfigCommand({
        FunctionName: func.FunctionName || '',
      }),
    );

    funcUrl = u.FunctionUrl || '';

    sqs = new SQS({ region: 'eu-central-1', credentials });

    const sqsList = await sqs.send(new ListQueuesCommand({
      // ListQueuesRequest
      QueueNamePrefix: 'DecoratedSagaTestStack-DecoratedSagaDlq',
      MaxResults: 1,
    }));

    if (!sqsList.QueueUrls || sqsList.QueueUrls.length !== 1) {
      throw new Error('no queues or too many queues found');
    }

    sqsUrl = sqsList.QueueUrls[0] || '';

    const sqsList2 = await sqs.send(new ListQueuesCommand({
      // ListQueuesRequest
      QueueNamePrefix: 'DecoratedSagaTestStack-Queue',
      MaxResults: 1,
    }));

    if (!sqsList2.QueueUrls || sqsList2.QueueUrls.length !== 1) {
      throw new Error('no queues or too many queues found');
    }

    queueUrl = sqsList2.QueueUrls[0] || '';

    const sqsList3 = await sqs.send(new ListQueuesCommand({
      // ListQueuesRequest
      QueueNamePrefix: 'DecoratedSagaTestStack-ResponseQueue',
      MaxResults: 1,
    }));

    if (!sqsList3.QueueUrls || sqsList3.QueueUrls.length !== 1) {
      throw new Error('no queues or too many queues found');
    }

    responseQueueUrl = sqsList3.QueueUrls[0] || '';

    const sqsList4 = await sqs.send(new ListQueuesCommand({
      // ListQueuesRequest
      QueueNamePrefix: 'DecoratedSagaTestStack-RequestDlq',
      MaxResults: 1,
    }));

    if (!sqsList4.QueueUrls || sqsList4.QueueUrls.length !== 1) {
      throw new Error('no queues or too many queues found');
    }

    requestDlqUrl = sqsList4.QueueUrls[0] || '';
  });

  it('should be defined', () => {
    expect(kinesis).toBeDefined();
    expect(kinesisStreamName).toBeDefined();

    expect(lambda).toBeDefined();
    expect(func).toBeDefined();
    expect(funcUrl).toBeDefined();

    expect(sqs).toBeDefined();
    expect(sqsUrl).toBeDefined();
    expect(queueUrl).toBeDefined();
    expect(responseQueueUrl).toBeDefined();
  });

  it('should process provider requests successfully', async () => {
    const id = uuidv4();
    const payload = new Payload('test', { id });
    payload.addRequest('provider.success');

    const { SequenceNumber, ShardId } = await publishKinesis(
      kinesis,
      kinesisStreamName,
      payload,
    );

    const record = await getKinesisRecord(
      kinesis,
      kinesisStreamName,
      ShardId || '',
      SequenceNumber || '',
    );

    expect(record).toBeDefined();

    const parsed = JSON.parse(record);
    expect(parsed.context).toStrictEqual({ id });
    expect(parsed.requests).toStrictEqual(['provider.success']);
    expect(parsed.decorations[0].type).toBe('provider.success');
    expect(parsed.decorations[0].service).toBe('test');
    expect(parsed.decorations[0].payload).toStrictEqual({ success: true });
  }, 30000);

  it('should process provider requests with error', async () => {
    const id = uuidv4();
    const payload = new Payload('test', { id });
    payload.addRequest('provider.error');

    const { SequenceNumber, ShardId } = await publishKinesis(
      kinesis,
      kinesisStreamName,
      payload,
    );

    const res = await getSqsRecord(sqs, sqsUrl, 50000);

    expect(res).toBeDefined();

    const parsed = JSON.parse(res);
    expect(parsed.context).toStrictEqual({ id });
    expect(parsed.requests).toStrictEqual(['provider.error']);
    expect(parsed.decorations.length).toBe(0);
  }, 60000);

  it('should process sagas successfully', async () => {
    const id = uuidv4();
    const payload = new Payload('saga.success', { id });

    const { SequenceNumber, ShardId } = await publishKinesis(
      kinesis,
      kinesisStreamName,
      payload,
    );

    const record = await getKinesisRecord(
      kinesis,
      kinesisStreamName,
      ShardId || '',
      SequenceNumber || '',
    );

    expect(record).toBeDefined();

    const parsed = JSON.parse(record);
    expect(parsed.context).toStrictEqual({ id });
    expect(parsed.requests).toStrictEqual([]);
    expect(parsed.decorations[0].type).toBe('saga.object');
    expect(parsed.decorations[0].service).toBe('test');
    expect(parsed.decorations[0].payload).toStrictEqual({ success: true });
  }, 30000);

  it('should process sagas with error', async () => {
    const id = uuidv4();
    const payload = new Payload('saga.error', { id });

    const { SequenceNumber, ShardId } = await publishKinesis(
      kinesis,
      kinesisStreamName,
      payload,
    );

    const res = await getSqsRecord(sqs, sqsUrl, 50000);

    expect(res).toBeDefined();

    const parsed = JSON.parse(res);
    expect(parsed.context).toStrictEqual({ id });
    expect(parsed.requests).toStrictEqual([]);
    expect(parsed.decorations.length).toBe(0);
  }, 60000);

  it('should be possible to send raw messages via SQS', async () => {
    const id = uuidv4();

    const payload = { id, message: 'raw.success' };

    await sqs.send(new SendMessageCommand({
      MessageBody: JSON.stringify(payload),
      QueueUrl: queueUrl
    }));

    const response = await getSqsRecord(sqs, responseQueueUrl, 50000);
    expect(response).toBeDefined();

    const parsed = JSON.parse(response);
    expect(parsed).toStrictEqual(payload);
  });

  it('should be possible to send raw messages via SQS with error', async () => {
    const id = uuidv4();

    const payload = { id, message: 'raw.error' };

    await sqs.send(new SendMessageCommand({
      MessageBody: JSON.stringify(payload),
      QueueUrl: queueUrl
    }));

    const response = await getSqsRecord(sqs, requestDlqUrl, 50000);

    const parsed = JSON.parse(response);
    expect(parsed).toStrictEqual(payload);
  }, 60000);

  it('should process function url requests', async () => {
    const id = uuidv4();
    const res = await axios.post(funcUrl, {
      id,
    });

    expect(res.status).toBe(200);
    expect(res.data).toStrictEqual({ id });
  });
});

async function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function publishKinesis(
  kinesis: KinesisClient,
  streamName: string,
  data: any,
) {
  const enc = new TextEncoder();

  const input: PutRecordCommandInput = {
    // PutRecordInput
    StreamName: streamName,
    Data: enc.encode(JSON.stringify(data)),
    PartitionKey: 'test',
  };

  return kinesis.send(new PutRecordCommand(input));
}

async function getKinesisRecord(
  kinesis: KinesisClient,
  streamName: string,
  shardId: string,
  sequenceNumber: string,
) {
  const { ShardIterator } = await kinesis.send(
    new GetShardIteratorCommand({
      ShardId: shardId,
      ShardIteratorType: 'AFTER_SEQUENCE_NUMBER',
      StreamName: streamName,
      StartingSequenceNumber: sequenceNumber,
    }),
  );

  let wait = true;
  sleep(20000).then(() => {
    wait = false;
  });

  let records;
  while (wait) {
    records = await kinesis.send(
      new GetRecordsCommand({
        ShardIterator,
        Limit: 1,
      }),
    );

    if (records.Records?.length !== 0) {
      break;
    }
  }

  if (!records?.Records?.[0]) {
    throw new Error('no records found');
  }

  const dec = new TextDecoder('utf8');
  return dec.decode(records.Records?.[0].Data);
}

async function getSqsRecord(
  sqs: SQSClient,
  queueUrl: string,
  waitTimeMs: number,
) {
  let wait = true;
  sleep(waitTimeMs).then(() => {
    wait = false;
  });

  while (wait) {
    const { Messages } = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 2,
      }),
    );

    if (!Messages?.[0]) {
      continue;
    }

    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: Messages[0].ReceiptHandle || '',
      }),
    );

    return Messages[0].Body || '';
  }

  throw new Error('no messages found');
}
