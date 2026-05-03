import { CoreV1Api, AppsV1Api, NetworkingV1Api } from '@kubernetes/client-node';
import { getKubeClients } from './client.js';
import { recordSimulationStep } from '../simulations/steps.js';

export interface StepRef {
  simulationId: string;
  name: string;
  failureType: string;
}

const DEFAULT_TIMEOUT_MS = 30000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs = DEFAULT_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutId);
        reject(new Error('AbortError'));
      }
      signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        reject(new Error('AbortError'));
      }, { once: true });
    }
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}


export interface PatchSpec {
  body: unknown;
  contentType: string;
}

const DEFAULT_NAMESPACE = 'default';

function ensureNamespace(namespace: string | null | undefined): string {
  if (!namespace) return DEFAULT_NAMESPACE;
  if (namespace === 'undefined' || namespace === 'null') return DEFAULT_NAMESPACE;
  return namespace;
}

export function strategicMergePatch(body: unknown): PatchSpec {
  return {
    body,
    contentType: 'application/strategic-merge-patch+json',
  };
}

export function jsonMergePatch(body: unknown): PatchSpec {
  return {
    body,
    contentType: 'application/merge-patch+json',
  };
}

// BUG-19 fix: Cached patch API clients keyed by content type.
const patchClientCache = new Map<string, any>();

function getCachedPatchClient(appsApi: AppsV1Api, contentType: string): any {
  const cached = patchClientCache.get(contentType);
  if (cached) return cached;

  try {
    const { Configuration, AppsV1Api: FreshAppsApi } = require('@kubernetes/client-node');
    const originalConfig = (appsApi as any).configuration;
    if (originalConfig) {
      const patchApi = new FreshAppsApi(new Configuration({
        baseServer: originalConfig.baseServer,
        authMethods: originalConfig.authMethods,
        httpApi: originalConfig.httpApi,
        middleware: [
          ...(originalConfig.middleware || []),
          {
            pre: async (context: any) => {
              context.setHeaderParam('Content-Type', contentType);
            }
          }
        ]
      }));
      patchClientCache.set(contentType, patchApi);
      return patchApi;
    }
  } catch (e) {
    console.warn('[K8s Ops] Failed to create cached patch client, falling back:', e);
  }
  return appsApi;
}

export async function scaleDeployment(
  namespace: string,
  deploymentName: string,
  replicas: number,
  ref?: StepRef,
  signal?: AbortSignal
): Promise<void> {
  const { apps } = getKubeClients();
  const ns = ensureNamespace(namespace);
  const start = Date.now();

  try {
    const appsApi = apps as AppsV1Api;
    console.log(`[K8s Ops] Scaling deployment ${deploymentName} in ${ns} to ${replicas}...`);

    await withTimeout(
      (appsApi as any).replaceNamespacedDeploymentScale({
        name: deploymentName,
        namespace: ns,
        body: {
          apiVersion: 'autoscaling/v1',
          kind: 'Scale',
          metadata: {
            name: deploymentName,
            namespace: ns
          },
          spec: {
            replicas
          }
        }
      }),
      DEFAULT_TIMEOUT_MS,
      signal
    );

    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'execution',
        status: 'success',
        command: `kubectl scale deployment ${deploymentName} --replicas=${replicas} -n ${ns}`,
        message: `Scaled deployment to ${replicas}`,
        resourceType: 'Deployment',
        resourceName: deploymentName,
        namespace: ns,
        durationMs: Date.now() - start,
      });
    }

  } catch (e: any) {
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'execution',
        status: 'failed',
        command: `kubectl scale deployment ${deploymentName} --replicas=${replicas} -n ${ns}`,
        error: e.message ?? String(e),
        resourceType: 'Deployment',
        resourceName: deploymentName,
        namespace: ns,
        durationMs: Date.now() - start,
      });
    }

    throw e;
  }
}

export async function readDeployment(
  namespace: string,
  deploymentName: string,
  signal?: AbortSignal
): Promise<any> {
  const { apps } = getKubeClients();
  const ns = ensureNamespace(namespace);

  console.log(`[K8s Ops] Reading deployment ${deploymentName} in ${ns}...`);
  const dep = await withTimeout((apps as any).readNamespacedDeployment({
    name: deploymentName,
    namespace: ns
  }), DEFAULT_TIMEOUT_MS, signal) as any;

  return dep.body ?? dep;
}

export async function replaceDeployment(
  namespace: string,
  deploymentName: string,
  body: any,
  ref?: StepRef,
  signal?: AbortSignal
): Promise<void> {
  const { apps } = getKubeClients();
  const ns = ensureNamespace(namespace);
  const start = Date.now();

  try {
    const appsApi = apps as AppsV1Api;
    console.log(`[K8s Ops] Replacing deployment ${deploymentName} in ${ns}...`);
    // BUG-27 fix: Strip cluster-assigned fields to avoid 409 Conflict on stale resourceVersion.
    const cleanBody = JSON.parse(JSON.stringify(body));
    if (cleanBody.metadata) {
      delete cleanBody.metadata.resourceVersion;
      delete cleanBody.metadata.managedFields;
      delete cleanBody.metadata.uid;
      delete cleanBody.metadata.creationTimestamp;
      delete cleanBody.metadata.generation;
    }
    delete cleanBody.status;
    if (!cleanBody.metadata) cleanBody.metadata = {};
    cleanBody.metadata.name = deploymentName;
    cleanBody.metadata.namespace = ns;

    await withTimeout((appsApi as any).replaceNamespacedDeployment({
      name: deploymentName,
      namespace: ns,
      body: cleanBody
    }), DEFAULT_TIMEOUT_MS, signal);
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'rollback',
        status: 'success',
        command: `kubectl replace deployment ${deploymentName} -n ${ns}`,
        message: 'Restored deployment from snapshot',
        resourceType: 'Deployment',
        resourceName: deploymentName,
        namespace: ns,
        durationMs: Date.now() - start,
      });
    }
  } catch (e: any) {
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'rollback',
        status: 'failed',
        command: `kubectl replace deployment ${deploymentName} -n ${ns}`,
        error: e.message ?? String(e),
        resourceType: 'Deployment',
        resourceName: deploymentName,
        namespace: ns,
        durationMs: Date.now() - start,
      });
    }
    throw e;
  }
}

export async function listPodsBySelector(
  namespace: string,
  labelSelector: string,
  signal?: AbortSignal
): Promise<any[]> {
  const { core } = getKubeClients();
  const coreApi = core as any;
  const ns = ensureNamespace(namespace);
  const res = await withTimeout(coreApi.listNamespacedPod({
    namespace: ns,
    labelSelector
  }), DEFAULT_TIMEOUT_MS, signal) as any;
  return res?.body?.items || res?.items || [];
}

export async function deletePodsBySelector(
  namespace: string,
  labelSelector: string,
  ref?: StepRef,
  signal?: AbortSignal
): Promise<number> {
  const ns = ensureNamespace(namespace);
  const start = Date.now();
  try {
    const items = await listPodsBySelector(ns, labelSelector, signal);
    const { core } = getKubeClients();

    let deletedCount = 0;
    for (const pod of items) {
      if (!pod?.metadata?.name) continue;

      // BUG-31 fix: Skip pods without ownerReferences (bare pods)
      if (!pod.metadata.ownerReferences || pod.metadata.ownerReferences.length === 0) {
        console.warn(`[K8s Ops] Skipping bare pod ${pod.metadata.name} (no owner controller, deletion is irreversible)`);
        continue;
      }

      const coreApi = core as CoreV1Api;
      console.log(`[K8s Ops] Deleting pod ${pod.metadata.name!} in ${ns}...`);
      await withTimeout((coreApi as any).deleteNamespacedPod({
        name: pod.metadata.name!,
        namespace: ns
      }), DEFAULT_TIMEOUT_MS, signal);
      deletedCount++;
    }

    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'execution',
        status: 'success',
        command: `kubectl delete pod -l ${labelSelector} -n ${ns}`,
        message: `Deleted ${deletedCount} managed pods (skipped bare pods)`,
        resourceType: 'Pod',
        resourceName: labelSelector,
        namespace: ns,
        durationMs: Date.now() - start,
      });
    }
    return deletedCount;
  } catch (e: any) {
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'execution',
        status: 'failed',
        command: `kubectl delete pod -l ${labelSelector} -n ${ns}`,
        error: e.message ?? String(e),
        resourceType: 'Pod',
        resourceName: labelSelector,
        namespace: ns,
        durationMs: Date.now() - start,
      });
    }
    throw e;
  }
}

/** Triggers a rolling restart via merge-patch on pod template annotations (avoids broken strategic patches). */
export async function rolloutRestartDeployment(
  namespace: string,
  deploymentName: string,
  ref?: StepRef,
  signal?: AbortSignal
): Promise<void> {
  const dep = await readDeployment(namespace, deploymentName, signal);
  const now = new Date().toISOString();
  const existing = dep?.spec?.template?.metadata?.annotations ?? {};
  const annotations = {
    ...existing,
    'kubectl.kubernetes.io/restartedAt': now,
    restartedAt: now,
  };
  await patchDeploymentTemplate(
    namespace,
    deploymentName,
    {
      contentType: 'application/merge-patch+json',
      body: {
        spec: {
          template: {
            metadata: {
              annotations,
            },
          },
        },
      },
    },
    ref,
    signal
  );
}

export async function patchDeploymentTemplate(
  namespace: string,
  deploymentName: string,
  patch: PatchSpec,
  ref?: StepRef,
  signal?: AbortSignal
): Promise<void> {
  const { apps } = getKubeClients();
  const ns = ensureNamespace(namespace);
  const start = Date.now();

  try {
    const appsApi = apps as AppsV1Api;
    console.log(`[K8s Ops] Patching deployment ${deploymentName} in ${ns}...`);

    // BUG-19 fix: Use cached patch client instead of creating a new one per call.
    const patchApi = getCachedPatchClient(appsApi, patch.contentType);

    await withTimeout(patchApi.patchNamespacedDeployment({
      name: deploymentName,
      namespace: ns,
      body: patch.body
    }), DEFAULT_TIMEOUT_MS, signal);
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'execution',
        status: 'success',
        command: `kubectl patch deployment ${deploymentName} -n ${ns} --type merge --patch '...'`,
        message: 'Patched deployment successfully',
        resourceType: 'Deployment',
        resourceName: deploymentName,
        namespace: ns,
        durationMs: Date.now() - start,
      });
    }
  } catch (e: any) {
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'execution',
        status: 'failed',
        command: `kubectl patch deployment ${deploymentName} -n ${ns} --type merge --patch '...'`,
        error: e.message ?? String(e),
        resourceType: 'Deployment',
        resourceName: deploymentName,
        namespace: ns,
        durationMs: Date.now() - start,
      });
    }
    throw e;
  }
}

export async function readNetworkPolicy(
  namespace: string,
  policyName: string,
  signal?: AbortSignal
): Promise<any | null> {
  const { net } = getKubeClients();
  const ns = ensureNamespace(namespace);

  try {
    const netApi = net as any;
    const res: any = await withTimeout(netApi.readNamespacedNetworkPolicy({
      name: policyName,
      namespace: ns
    }), DEFAULT_TIMEOUT_MS, signal);

    return res?.body ?? res;
  } catch (e: any) {
    // BUG-24 fix: Only treat 404 as "not found". Rethrow auth/server errors.
    const status = e?.statusCode ?? e?.response?.statusCode ?? e?.body?.code;
    if (status === 404) return null;
    console.error(`[K8s Ops] Failed to read NetworkPolicy ${policyName} in ${ns}:`, e?.message ?? e);
    throw e;
  }
}

export async function applyNetworkPolicy(
  namespace: string,
  body: any,
  ref?: StepRef,
  signal?: AbortSignal
): Promise<void> {
  const { net } = getKubeClients();
  const ns = ensureNamespace(namespace);
  const start = Date.now();
  const netApi = net as any;

  try {
    console.log(`[K8s Ops] Creating NetworkPolicy in ${ns}...`);
    const cleanBody = JSON.parse(JSON.stringify(body));
    if (!cleanBody.metadata) cleanBody.metadata = {};
    if (!cleanBody.metadata.name) {
       // fallback to body.name or other if exists, but usually body IS the policy object
    }
    cleanBody.metadata.namespace = ns;

    await withTimeout(netApi.createNamespacedNetworkPolicy({
      namespace: ns,
      body: cleanBody
    }), DEFAULT_TIMEOUT_MS, signal);
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'execution',
        status: 'success',
        command: `kubectl apply -f [network policy config] -n ${ns}`,
        message: `Created NetworkPolicy ${body.metadata?.name ?? 'unknown'}`,
        resourceType: 'NetworkPolicy',
        resourceName: body.metadata?.name ?? 'unknown',
        namespace: ns,
        durationMs: Date.now() - start,
      });
    }
  } catch (e: any) {
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'execution',
        status: 'failed',
        command: `kubectl apply -f [network policy config] -n ${ns}`,
        error: e.message ?? String(e),
        resourceType: 'NetworkPolicy',
        resourceName: body.metadata?.name ?? 'unknown',
        namespace: ns,
        durationMs: Date.now() - start,
      });
    }
    throw e;
  }
}

export async function replaceNetworkPolicy(
  namespace: string,
  policyName: string,
  body: any,
  ref?: StepRef,
  signal?: AbortSignal
): Promise<void> {
  const { net } = getKubeClients();
  const ns = ensureNamespace(namespace);
  const start = Date.now();
  const netApi = net as any;

  try {
    console.log(`[K8s Ops] Replacing NetworkPolicy ${policyName} in ${ns}...`);
    const cleanBody = JSON.parse(JSON.stringify(body));
    if (!cleanBody.metadata) cleanBody.metadata = {};
    const meta = cleanBody.metadata;
    delete meta.resourceVersion;
    delete meta.uid;
    delete meta.managedFields;
    delete meta.creationTimestamp;
    delete meta.generation;
    delete cleanBody.status;

    meta.name = policyName;
    meta.namespace = ns;

    await withTimeout(netApi.replaceNamespacedNetworkPolicy({
      name: policyName,
      namespace: ns,
      body: cleanBody
    }), DEFAULT_TIMEOUT_MS, signal);
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'rollback',
        status: 'success',
        command: `kubectl replace -f [network policy config] -n ${ns}`,
        message: `Restored NetworkPolicy ${policyName}`,
        resourceType: 'NetworkPolicy',
        resourceName: policyName,
        namespace: ns,
        durationMs: Date.now() - start,
      });
    }
  } catch (e: any) {
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'rollback',
        status: 'failed',
        command: `kubectl replace -f [network policy config] -n ${ns}`,
        error: e.message ?? String(e),
        resourceType: 'NetworkPolicy',
        resourceName: policyName,
        namespace: ns,
        durationMs: Date.now() - start,
      });
    }
    throw e;
  }
}

function k8sHttpStatus(err: any): number {
  return Number(err?.statusCode ?? err?.response?.statusCode ?? err?.body?.code ?? err?.body?.status ?? 0);
}

export async function upsertNetworkPolicy(
  namespace: string,
  policyName: string,
  spec: any,
  ref?: StepRef,
  signal?: AbortSignal
): Promise<void> {
  const { net } = getKubeClients();
  const ns = ensureNamespace(namespace);
  const start = Date.now();
  const netApi = net as any;

  /** Strip cluster-managed fields before create/replace (never send stale resourceVersion). */
  function cleanForSubmit(src: any): any {
    const body = JSON.parse(JSON.stringify(src));
    if (!body.metadata) body.metadata = {};
    const m = body.metadata;
    delete m.resourceVersion;
    delete m.uid;
    delete m.managedFields;
    delete m.creationTimestamp;
    delete m.generation;
    delete body.status;
    m.name = policyName;
    m.namespace = ns;
    return body;
  }

  try {
    const body = cleanForSubmit(spec);
    // Production order: CREATE first (avoids replace-on-missing 404), then REPLACE on conflict.
    try {
      await withTimeout(netApi.createNamespacedNetworkPolicy({
        namespace: ns,
        body,
      }), DEFAULT_TIMEOUT_MS, signal);
    } catch (createErr: any) {
      const cst = k8sHttpStatus(createErr);
      if (cst === 409 || cst === 422) {
        await withTimeout(netApi.replaceNamespacedNetworkPolicy({
          name: policyName,
          namespace: ns,
          body,
        }), DEFAULT_TIMEOUT_MS, signal);
      } else {
        throw createErr;
      }
    }

    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'execution',
        status: 'success',
        command: `kubectl apply -f [network policy config] -n ${ns}`,
        message: `Upserted NetworkPolicy ${policyName} (create-or-replace)`,
        resourceType: 'NetworkPolicy',
        resourceName: policyName,
        namespace: ns,
        durationMs: Date.now() - start,
      });
    }
  } catch (e: any) {
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'execution',
        status: 'failed',
        command: `kubectl apply -f [network policy config] -n ${ns}`,
        error: e.message ?? String(e),
        resourceType: 'NetworkPolicy',
        resourceName: policyName,
        namespace: ns,
        durationMs: Date.now() - start,
      });
    }
    throw e;
  }
}

export async function deleteNetworkPolicy(
  namespace: string,
  policyName: string,
  ref?: StepRef,
  signal?: AbortSignal
): Promise<void> {
  const { net } = getKubeClients();
  const ns = ensureNamespace(namespace);
  const start = Date.now();
  const netApi = net as any;

  try {
    console.log(`[K8s Ops] Deleting NetworkPolicy ${policyName} in ${ns}...`);
    await withTimeout(netApi.deleteNamespacedNetworkPolicy({
      name: policyName,
      namespace: ns
    }), DEFAULT_TIMEOUT_MS, signal);
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'rollback',
        status: 'success',
        command: `kubectl delete networkpolicy ${policyName} -n ${ns}`,
        message: `Deleted NetworkPolicy ${policyName}`,
        resourceType: 'NetworkPolicy',
        resourceName: policyName,
        namespace: ns,
        durationMs: Date.now() - start,
      });
    }
  } catch (e: any) {
    const status = e?.statusCode ?? e?.response?.statusCode ?? e?.body?.code;
    if (status === 404) {
      console.log(`[K8s Ops] NetworkPolicy ${policyName} not found during delete (ignoring 404)`);
      if (ref) {
        await recordSimulationStep({
          simulationId: ref.simulationId,
          name: ref.name,
          failureType: ref.failureType,
          stepType: 'rollback',
          status: 'success',
          command: `kubectl delete networkpolicy ${policyName} -n ${ns}`,
          message: `NetworkPolicy ${policyName} was already deleted`,
          resourceType: 'NetworkPolicy',
          resourceName: policyName,
          namespace: ns,
          durationMs: Date.now() - start,
        });
      }
      return;
    }

    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'rollback',
        status: 'failed',
        command: `kubectl delete networkpolicy ${policyName} -n ${ns}`,
        error: e.message ?? String(e),
        resourceType: 'NetworkPolicy',
        resourceName: policyName,
        namespace: ns,
        durationMs: Date.now() - start,
      });
    }
    // BUG-21 fix: Rethrow so the caller knows deletion failed.
    throw e;
  }
}

export async function execCommandInPod(
  namespace: string,
  podName: string,
  containerName: string,
  command: string[],
  ref?: StepRef,
  signal?: AbortSignal
): Promise<{ stdout: string; stderr: string; code: number }> {
  const { exec } = getKubeClients();
  const ns = ensureNamespace(namespace);
  const start = Date.now();

  // BUG-23 fix: Add settled flag to prevent double-resolution race.
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutData = '';
    let stderrData = '';

    console.log(`[Simulator:${ref?.simulationId ?? 'unknown'}] [K8s Ops] Executing command in pod ${podName}: ${command.join(' ')}`);

    const stream = new (require('stream').PassThrough)();
    const errStream = new (require('stream').PassThrough)();

    stream.on('data', (chunk: Buffer) => {
      stdoutData += chunk.toString();
    });
    errStream.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString();
    });

    const execPromise = exec.exec(
      ns,
      podName,
      containerName,
      command,
      stream,
      errStream,
      null,
      false,
      (status: any) => {
        if (settled) return;
        settled = true;
        const code = status?.status === 'Success' ? 0 : (status?.code ?? 1);
        const duration = Date.now() - start;

        console.log(`[Simulator:${ref?.simulationId ?? 'unknown'}] [K8s Ops] Exec command finished with code ${code}. Output length: ${stdoutData.length}, Error length: ${stderrData.length}`);

        if (ref) {
          void recordSimulationStep({
            simulationId: ref.simulationId,
            name: ref.name,
            failureType: ref.failureType,
            stepType: 'execution',
            status: code === 0 ? 'success' : 'failed',
            command: `kubectl exec -n ${ns} ${podName} -c ${containerName} -- ${command.join(' ')}`,
            message: code === 0 ? `Executed command successfully: ${stdoutData.slice(0, 50)}...` : `Command failed: ${stderrData.slice(0, 100)}`,
            resourceType: 'Pod',
            resourceName: podName,
            namespace: ns,
            durationMs: duration,
          });
        }

        resolve({ stdout: stdoutData, stderr: stderrData, code });
      }
    );

    if (signal) {
      signal.addEventListener('abort', () => {
        if (settled) return;
        settled = true;
        console.log(`[Simulator:${ref?.simulationId ?? 'unknown'}] [K8s Ops] Aborting exec command in pod ${podName}`);
        reject(new Error('AbortError'));
      }, { once: true });
    }

    execPromise.catch((err) => {
      if (settled) return;
      settled = true;
      console.error(`[Simulator:${ref?.simulationId ?? 'unknown'}] [K8s Ops] Exec exception in pod ${podName}:`, err);
      reject(err);
    });
  });
}