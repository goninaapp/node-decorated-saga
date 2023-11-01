import { CustomTransportStrategy, Server } from '@nestjs/microservices';
import { Handler, Result } from './index';
import { isObservable } from 'rxjs';

export class DecoratedSagaTransport
  extends Server
  implements CustomTransportStrategy
{
  public handler: Handler;

  constructor(serviceName: string) {
    super();

    this.handler = new Handler(serviceName);
  }

  /**
   * This method is triggered when you run "app.listen()".
   */
  listen(callback: () => void) {
    this.messageHandlers.forEach((handler, saga) => {
      if (handler.isEventHandler) {
        this.handler.registerHandler(
          saga,
          async (payload: any): Promise<Result | undefined> => {
            const result = await handler(payload);

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
      } else {
        this.handler.registerProvider(
          saga,
          async (payload: any): Promise<Object | undefined> => {
            const result = await handler(payload);

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

  /**
   * This method is triggered on application shutdown.
   */
  close() {}
}
