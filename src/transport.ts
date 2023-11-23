import { CustomTransportStrategy, Server } from '@nestjs/microservices';
import { Handler, Publisher, Result } from './index';
import { isObservable } from 'rxjs';

export class DecoratedSagaTransport
  extends Server
  implements CustomTransportStrategy
{
  private _handler: Handler;
  private _publisher: Publisher;

  constructor(serviceName: string) {
    super();

    this._handler = new Handler(serviceName);
    this._publisher = new Publisher(serviceName);
  }

  async handler(payload: any) {
    return this._handler.handler(payload);
  }

  /**
   * This method is triggered when you run "app.listen()".
   */
  listen(callback: () => void) {
    this.messageHandlers.forEach((handler, saga) => {
      if (handler.isEventHandler && saga !== 'raw') {
        this._handler.registerHandler(
          saga,
          async (payload: any): Promise<Result | undefined> => {
            const result = await handler(payload, this._publisher);

            if (isObservable(result)) {
              throw new Error('Observable not supported');
            }

            if (result === undefined) {
              return;
            }

            if (
              result.hasOwnProperty('type') &&
              result.hasOwnProperty('payload')
            ) {
              return result as Result;
            }

            throw new Error('Invalid result');
          },
        );
      } else if (handler.isEventHandler && saga === 'raw') {
        this._handler.registerRawHandler(async (payload: any) => {
          await handler(payload, this._publisher);
        });
      } else {
        this._handler.registerProvider(
          saga,
          async (payload: any): Promise<Object | undefined> => {
            const result = await handler(payload, this._publisher);

            if (isObservable(result)) {
              throw new Error('Observable not supported');
            }

            return result;
          },
        );
      }
    });

    callback();
  }

  close() {}
}
