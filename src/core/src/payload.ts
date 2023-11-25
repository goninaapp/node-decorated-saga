import {
  KinesisStreamEvent,
  KinesisStreamRecord,
  SNSEvent,
  SNSEventRecord,
  SNSMessage,
  SQSEvent,
  SQSRecord,
} from 'aws-lambda';

export class RawPayload {
  messageId: string;
  payload: string;

  constructor(messageId: string, payload: string) {
    this.messageId = messageId;
    this.payload = payload;
  }
}

export function extract(
  event: KinesisStreamEvent | SQSEvent | SNSEvent,
): RawPayload[] {
  if (!hasKeys(event, 'Records')) {
    throw new Error('invalid event');
  }

  return event.Records.map((record) => {
    const messageId = getMessageId(record);
    const payload = deepExtract(record);

    return new RawPayload(messageId, payload);
  });
}

function getMessageId(
  event: SQSRecord | SNSEventRecord | SNSMessage | KinesisStreamRecord,
): string {
  if (hasKeys(event, 'messageId', 'body')) {
    // SQS
    event = event as SQSRecord;
    return event.messageId;
  }

  if (hasKeys(event, 'kinesis')) {
    // Kinesis
    event = event as KinesisStreamRecord;
    return event.kinesis.sequenceNumber;
  }

  if (hasKeys(event, 'Sns')) {
    // SNSEventRecord
    event = event as SNSEventRecord;
    return event.Sns.MessageId;
  }

  if (hasKeys(event, 'Message', 'MessageId')) {
    // SNSMessage
    event = event as SNSMessage;
    return event.MessageId;
  }

  return '';
}

function hasKeys(obj: any, ...keys: string[]) {
  return keys.every((key) => obj.hasOwnProperty(key));
}

function deepExtract(input: any): string {
  let event = input;
  if (typeof input === 'string') {
    try {
      event = JSON.parse(event);
    } catch (e) {
      return event;
    }
  }

  if (hasKeys(event, 'messageId', 'body')) {
    // SQS
    event = event as SQSRecord;
    return deepExtract(event.body);
  }

  if (hasKeys(event, 'kinesis')) {
    // Kinesis
    event = event as KinesisStreamRecord;
    const data = Buffer.from(event.kinesis.data, 'base64');

    let res = event.kinesis.data;
    if (isUtf8(data)) {
      res = data.toString('utf-8');
    }

    return deepExtract(res);
  }

  if (hasKeys(event, 'Sns')) {
    // SNSEventRecord
    return deepExtract(event.Sns);
  }

  if (hasKeys(event, 'Message', 'MessageId')) {
    // SNSMessage
    event = event as SNSMessage;
    return deepExtract(event.Message);
  }

  return input;
}

function isUtf8(buffer: Buffer): boolean {
  try {
    new TextDecoder('utf8', { fatal: true }).decode(buffer);
    return true;
  } catch (e) {
    return false;
  }
}
