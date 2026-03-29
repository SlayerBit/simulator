import type { FailureMethod, FailureParams } from './types.js';

const methods: FailureMethod[] = [];

export function registerFailureMethod(method: FailureMethod): void {
  methods.push(method);
}

export function getFailureMethods(): FailureMethod[] {
  return methods.slice();
}

export function findFailureMethod(failureType: FailureParams['failureType'], methodId: string): FailureMethod {
  const m = methods.find((x) => x.supports === failureType && x.id === methodId);
  if (!m) {
    const err: any = new Error('Unknown failure method');
    err.status = 400;
    throw err;
  }
  return m;
}
