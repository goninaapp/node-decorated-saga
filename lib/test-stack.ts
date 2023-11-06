import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Stream } from 'aws-cdk-lib/aws-kinesis';
import { DecoratedSagaInfrastructure } from "../src/cdk";
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { FunctionUrlAuthType } from "aws-cdk-lib/aws-lambda";

export interface TestStackProps extends cdk.StackProps {}

export class TestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: TestStackProps) {
    super(scope, id, props);

    const stream = new Stream(this, 'MessageBus', {});

    const dlq = new Queue(this, 'RequestDlq', {});
    const queue = new Queue(this, 'Queue', {
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 1,
      }
    });

    const responseQueue = new Queue(this, 'ResponseQueue', {});

    // Lambda function
    const fn = new lambda.Function(this, 'TestLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('dist.test'),
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
    });

    fn.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
      },
    });

    new DecoratedSagaInfrastructure(this, 'DecoratedSaga', {
      fn,
      stream,
      batchSize: 1,
      debug: true,
    });

    fn.addEventSource(
      new SqsEventSource(queue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      }),
    );

    responseQueue.grantSendMessages(fn);
    fn.addEnvironment('RESPONSE_QUEUE_URL', responseQueue.queueUrl);
  }
}
