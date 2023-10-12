import { Handler, Result, Payload } from '../src';
import { APIGatewayProxyEventV2 } from "aws-lambda";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({ region: 'eu-central-1' });

const h = new Handler('test');
export const handler = h.handler.bind(h);

h.registerProvider('provider.success', async (payload: Payload) => {
  return { success: true };
});

h.registerProvider('provider.error', async (payload: Payload) => {
  throw new Error('provider.error');
});

h.registerHandler('saga.success', async (payload: Payload, alreadyProcessed: boolean) => {
  if(alreadyProcessed) {
    return;
  }

  return new Result('saga.object', { success: true });
});

h.registerHandler('saga.error', async (payload: Payload, alreadyProcessed: boolean ) => {
  throw new Error('saga.error');
});

h.registerRawHandler(async (payload: any) => {
  console.log('rawHandler', payload);
  const data = JSON.parse(payload);
  if (data.message !== 'raw.success') {
    throw new Error('raw.error');
  }

  await sqs.send(new SendMessageCommand({
    QueueUrl: process.env.RESPONSE_QUEUE_URL,
    MessageBody: payload,
  }));
});

h.registerApiGatewayHandler(async (event: APIGatewayProxyEventV2) => {
  console.log('apiGatewayHandler', event);

  return {
    statusCode: 200,
    body: event.body,
  }
});
