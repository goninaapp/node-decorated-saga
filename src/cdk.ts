import { Environment, Stack } from 'aws-cdk-lib';
import { Function, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { IStream } from 'aws-cdk-lib/aws-kinesis';
import {
  KinesisEventSource,
  SqsDlq,
  SqsEventSource,
} from 'aws-cdk-lib/aws-lambda-event-sources';
import { Queue } from 'aws-cdk-lib/aws-sqs';

export function deploy(
  stack: Stack,
  env: Environment,
  fn: Function,
  stream: IStream,
  batchSize: number,
  debug: boolean,
) {
  const dlq = new Queue(stack, 'Dlq', {});

  const queue = new Queue(stack, 'KinesisDlq', {
    deadLetterQueue: {
      maxReceiveCount: debug ? 1 : 3,
      queue: dlq,
    },
  });

  fn.addToRolePolicy(
    new PolicyStatement({
      sid: 'AccessToMessageBus',
      effect: Effect.ALLOW,
      actions: [
        'kinesis:PutRecord',
        'kinesis:GetShardIterator',
        'kinesis:GetRecords',
      ],
      resources: [stream.streamArn],
    }),
  );

  fn.addEventSource(
    new KinesisEventSource(stream, {
      batchSize: batchSize,
      retryAttempts: debug ? 1 : 3,
      bisectBatchOnError: false,
      startingPosition: StartingPosition.TRIM_HORIZON,
      reportBatchItemFailures: true,
      onFailure: new SqsDlq(queue),
    }),
  );

  fn.addEventSource(
    new SqsEventSource(queue, {
      batchSize: batchSize,
      reportBatchItemFailures: true,
    }),
  );

  queue.grantSendMessages(fn);
  fn.addEnvironment('SQS_QUEUE_URL', queue.queueUrl);
  fn.addEnvironment('KINESIS_STREAM_NAME', stream.streamName);

  if (debug) {
    fn.addEnvironment('DEBUG', '*');
  }
}
