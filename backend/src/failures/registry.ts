import type { FailureMethod, FailureParams } from './types.js';
import { isVisibleFailureMethod } from './allowlist.js';

const methods: FailureMethod[] = [];

export function registerFailureMethod(method: FailureMethod): void {
  methods.push(method);
}

export function getFailureMethods(): FailureMethod[] {
  return methods.slice();
}

/** Methods exposed to the UI and allowed for new simulations / templates. */
export function getVisibleFailureMethods(): FailureMethod[] {
  return methods.filter((m) => isVisibleFailureMethod(m.supports, m.id));
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
