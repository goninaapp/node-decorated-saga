import { Payload } from './types';

describe('types', () => {
  it('should correctly append', () => {
    const payload = new Payload('test');
    expect(payload.next()).toBeUndefined();

    payload.addRequest('test2');
    expect(payload.next()).toBe('test2');

    payload.addRequest('test3');
    expect(payload.next()).toBe('test2');

    payload.decorations.push({
      timestamp: 0,
      type: 'test2',
      service: 'test',
      payload: {},
    });
    expect(payload.next()).toBe('test3');

    expect(payload.hasDecoration('test2')).toBe(true);
    expect(payload.hasDecoration('test3')).toBe(false);

    expect(payload.processedByService('test')).toBe(true);
    expect(payload.processedByService('test2')).toBe(false);

    expect(payload.getDecoration('test2')).toBeDefined();
    expect(payload.getDecoration('test3')).toBeUndefined();

    const decoration = payload.getDecoration('test2');
    expect(decoration).toBeDefined();
    expect(decoration?.type).toBe('test2');
    expect(decoration?.service).toBe('test');
    expect(decoration?.timestamp).toBe(0);
    expect(decoration?.payload).toStrictEqual({});
  });
});
