import { Handler, Payload } from './index';
import { KinesisStreamEvent } from 'aws-lambda';

describe('index', () => {
  let handler: Handler;

  beforeEach(async () => {
    handler = new Handler('test');
  });

  it('happy path', async () => {
    const event: KinesisStreamEvent = {
      Records: [
        {
          kinesis: {
            sequenceNumber: '3247',
            data: 'eyJ2ZXJzaW9uIjoidjEiLCJjb3JyZWxhdGlvbklkIjoiYTdhNTQ5ODktYTdmYy00NzFiLWFmMjAtODk4NTdiY2QxNTFlIiwicHVibGlzaFRpbWUiOjE2OTY1MjgyMjEwMDAsInNhZ2EiOiJzdHJpcGUuY3VzdG9tZXIiLCJjb250ZXh0Ijp7InR5cGUiOiJzdHJpcGUuY3VzdG9tZXIiLCJzZXJ2aWNlIjoic3RyaXBlIiwidGltZXN0YW1wIjoxNjk2NTI4MzIxMDAwLCJwYXlsb2FkIjp7InVzZXJJZCI6ImU3NjJiMGYzLTdlMTEtNDdhNC05OWU1LTMyNTI3ZDAxYjU3NSIsInN0cmlwZUlkIjoiY3VzX09rV2ZuaEExY0pHTldTIn19LCJkZWNvcmF0aW9ucyI6W119',
          },
        },
      ],
    } as unknown as KinesisStreamEvent;

    let called = false;
    handler.registerHandler(
      'stripe.customer',
      async (payload: Payload): Promise<Error | undefined> => {
        called = true;

        expect(payload).toBeDefined();
        expect(payload.version).toBe('v1');
        expect(payload.correlationId).toBe(
          'a7a54989-a7fc-471b-af20-89857bcd151e',
        );
        expect(payload.publishTime).toBe(1696528221000);
        expect(payload.saga).toBe('stripe.customer');
        expect(payload.context).toBeDefined();
        expect(payload.context.type).toBe('stripe.customer');
        expect(payload.context.service).toBe('stripe');
        expect(payload.context.payload.userId).toBe(
          'e762b0f3-7e11-47a4-99e5-32527d01b575',
        );
        expect(payload.context.payload.stripeId).toBe('cus_OkWfnhA1cJGNWS');
        expect(payload.decorations).toBeDefined();
        expect(payload.decorations.length).toBe(0);

        expect(payload.wasProcessedByService('test')).toBe(false);
        expect(payload.wasProcessedByService('stripe')).toBe(true);

        payload.decorate('auth.email', {
          primaryEmail: 'ferdinand.vonhagen@gonina.com',
          verified: true,
        });

        expect(payload.decorations.length).toBe(1);
        expect(payload.decorations[0].type).toBe('auth.email');
        expect(payload.decorations[0].service).toBe('test');
        expect(payload.decorations[0].payload.primaryEmail).toBe(
          'ferdinand.vonhagen@gonina.com',
        );
        expect(payload.decorations[0].payload.verified).toBe(true);

        payload.decorations[0].timestamp = 1696529142788;

        expect(payload.stringify()).toBe(
          '{"version":"v1","correlationId":"a7a54989-a7fc-471b-af20-89857bcd151e","publishTime":1696528221000,"saga":"stripe.customer","context":{"type":"stripe.customer","service":"stripe","timestamp":1696528321000,"payload":{"userId":"e762b0f3-7e11-47a4-99e5-32527d01b575","stripeId":"cus_OkWfnhA1cJGNWS"}},"decorations":[{"type":"auth.email","service":"test","timestamp":1696529142788,"payload":{"primaryEmail":"ferdinand.vonhagen@gonina.com","verified":true}}]}',
        );

        const t1 = payload.getDecoration('auth.email');
        expect(t1).toBeDefined();
        expect(t1?.type).toBe('auth.email');

        const t2 = payload.getDecoration('auth.email2');
        expect(t2).toBeUndefined();

        const t3 = payload.getDecoration('stripe.customer');
        expect(t3).toBeDefined();
        expect(t3?.type).toBe('stripe.customer');

        expect(payload.wasProcessedByService('test')).toBe(true);
        expect(payload.wasProcessedByService('stripe')).toBe(true);

        return;
      },
    );

    const result = await handler.handler(event);
    expect(result).toBeDefined();
    expect(called).toBe(true);
  });

  it('not so happy path', async () => {
    // It has the wrong version (v0 vs v1)
    const event: KinesisStreamEvent = {
      Records: [
        {
          kinesis: {
            sequenceNumber: '3247',
            data: 'eyJ2ZXJzaW9uIjoidjAiLCJjb3JyZWxhdGlvbklkIjoiYTdhNTQ5ODktYTdmYy00NzFiLWFmMjAtODk4NTdiY2QxNTFlIiwicHVibGlzaFRpbWUiOjE2OTY1MjgyMjEwMDAsInNhZ2EiOiJzdHJpcGUuY3VzdG9tZXIiLCJjb250ZXh0Ijp7InR5cGUiOiJzdHJpcGUuY3VzdG9tZXIiLCJzZXJ2aWNlIjoic3RyaXBlIiwidGltZXN0YW1wIjoxNjk2NTI4MzIxMDAwLCJwYXlsb2FkIjp7InVzZXJJZCI6ImU3NjJiMGYzLTdlMTEtNDdhNC05OWU1LTMyNTI3ZDAxYjU3NSIsInN0cmlwZUlkIjoiY3VzX09rV2ZuaEExY0pHTldTIn19LCJkZWNvcmF0aW9ucyI6W119',
          },
        },
      ],
    } as unknown as KinesisStreamEvent;

    let called = false;
    handler.registerHandler(
      'stripe.customer',
      async (payload: Payload): Promise<Error | undefined> => {
        called = true;
        return;
      },
    );

    const result = await handler.handler(event);
    expect(result).toBeDefined();
    expect(called).toBe(false);
  });
});
