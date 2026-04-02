import { CoreV1Api, AppsV1Api, NetworkingV1Api } from '@kubernetes/client-node';
import { getKubeClients } from './client.js';
import { recordSimulationStep } from '../simulations/steps.js';

export interface StepRef {
  simulationId: string;
  name: string;
  failureType: string;
}

const DEFAULT_TIMEOUT_MS = 30000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}


export interface PatchSpec {
  body: unknown;
  contentType: string;
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

export async function scaleDeployment(
  namespace: string,
  deploymentName: string,
  replicas: number,
  ref?: StepRef
): Promise<void> {
  const { apps } = getKubeClients();
  const start = Date.now();

  try {
    const appsApi = apps as AppsV1Api;
    console.log(`[K8s Ops] Scaling deployment ${deploymentName} in ${namespace || 'default'} to ${replicas}...`);
    
    await withTimeout(
      (appsApi as any).patchNamespacedDeploymentScale(
        {
          name: deploymentName,
          namespace: namespace || 'default',
          body: [
            {
              op: 'replace',
              path: '/spec/replicas',
              value: replicas
            }
          ]
        },
        {
          headers: {
            'Content-Type': 'application/json-patch+json'
          }
        }
      )
    );

    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'execution',
        status: 'success',
        command: `kubectl scale deployment ${deploymentName} --replicas=${replicas} -n ${namespace || 'default'}`,
        message: `Scaled deployment to ${replicas}`,
        resourceType: 'Deployment',
        resourceName: deploymentName,
        namespace: namespace || 'default',
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
        command: `kubectl scale deployment ${deploymentName} --replicas=${replicas} -n ${namespace || 'default'}`,
        error: e.message ?? String(e),
        resourceType: 'Deployment',
        resourceName: deploymentName,
        namespace: namespace || 'default',
        durationMs: Date.now() - start,
      });
    }

    throw e;
  }
}

export async function readDeployment(
  namespace: string,
  deploymentName: string
): Promise<any> {
  const { apps } = getKubeClients();

  console.log(`[K8s Ops] Reading deployment ${deploymentName} in ${namespace || 'default'}...`);
  const dep = await withTimeout((apps as any).readNamespacedDeployment({
    name: deploymentName,
    namespace: namespace || 'default',
  })) as any;

  return dep.body ?? dep;
}

export async function replaceDeployment(
  namespace: string,
  deploymentName: string,
  body: any,
  ref?: StepRef
): Promise<void> {
  const { apps } = getKubeClients();

  const start = Date.now();
  try {
    const appsApi = apps as AppsV1Api;
    console.log(`[K8s Ops] Replacing deployment ${deploymentName} in ${namespace || 'default'}...`);
    await withTimeout(appsApi.replaceNamespacedDeployment({
      name: deploymentName,
      namespace: namespace || 'default',
      body,
    }));
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'rollback',
        status: 'success',
        command: `kubectl replace deployment ${deploymentName} -n ${namespace || 'default'}`,
        message: 'Restored deployment from snapshot',
        resourceType: 'Deployment',
        resourceName: deploymentName,
        namespace: namespace || 'default',
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
        command: `kubectl replace deployment ${deploymentName} -n ${namespace || 'default'}`,
        error: e.message ?? String(e),
        resourceType: 'Deployment',
        resourceName: deploymentName,
        namespace: namespace || 'default',
        durationMs: Date.now() - start,
      });
    }
    throw e;
  }
}

export async function deletePodsBySelector(
  namespace: string,
  labelSelector: string,
  ref?: StepRef
): Promise<number> {
  const { core } = getKubeClients();
  const start = Date.now();
  try {
    console.log(`[K8s Ops] Listing pods for namespace: ${namespace || 'default'}, selector: ${labelSelector}`);
    const coreApi = core as any;
    console.log(`[K8s Ops] Listing pods for namespace: ${namespace || 'default'}, selector: ${labelSelector}`);
    
    const res = await withTimeout(coreApi.listNamespacedPod({
      namespace: namespace || 'default',
      labelSelector,
    })) as any;

    console.log(`[K8s Ops] Found pods for selector ${labelSelector}`);
    const items = res?.body?.items || res?.items || [];

    for (const pod of items) {
      if (!pod?.metadata?.name) continue;

      const coreApi = core as CoreV1Api;
      console.log(`[K8s Ops] Deleting pod ${pod.metadata.name!} in ${namespace || 'default'}...`);
      await withTimeout(coreApi.deleteNamespacedPod({
        name: pod.metadata.name!,
        namespace: namespace || 'default',
      }));
    }

    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'execution',
        status: 'success',
        command: `kubectl delete pod -l ${labelSelector} -n ${namespace || 'default'}`,
        message: `Deleted ${items.length} pods matching selector`,
        resourceType: 'Pod',
        resourceName: labelSelector,
        namespace: namespace || 'default',
        durationMs: Date.now() - start,
      });
    }
    return items.length;
  } catch (e: any) {
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'execution',
        status: 'failed',
        command: `kubectl delete pod -l ${labelSelector} -n ${namespace || 'default'}`,
        error: e.message ?? String(e),
        resourceType: 'Pod',
        resourceName: labelSelector,
        namespace: namespace || 'default',
        durationMs: Date.now() - start,
      });
    }
    throw e;
  }
}

export async function patchDeploymentTemplate(
  namespace: string,
  deploymentName: string,
  patch: PatchSpec,
  ref?: StepRef
): Promise<void> {
  const { apps } = getKubeClients();
  const start = Date.now();

  try {
    const appsApi = apps as AppsV1Api;
    console.log(`[K8s Ops] Patching deployment ${deploymentName} in ${namespace || 'default'}...`);
    await withTimeout(appsApi.patchNamespacedDeployment(
      {
        name: deploymentName,
        namespace: namespace || 'default',
        body: patch.body,
      },
      {
        headers: {
          'Content-Type': patch.contentType
        }
      } as any
    ));
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'execution',
        status: 'success',
        command: `kubectl patch deployment ${deploymentName} -n ${namespace || 'default'} --type merge --patch '...'`,
        message: 'Patched deployment successfully',
        resourceType: 'Deployment',
        resourceName: deploymentName,
        namespace: namespace || 'default',
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
        command: `kubectl patch deployment ${deploymentName} -n ${namespace || 'default'} --type merge --patch '...'`,
        error: e.message ?? String(e),
        resourceType: 'Deployment',
        resourceName: deploymentName,
        namespace: namespace || 'default',
        durationMs: Date.now() - start,
      });
    }
    throw e;
  }
}

export async function readNetworkPolicy(
  namespace: string,
  policyName: string
): Promise<any | null> {
  const { net } = getKubeClients();

  try {
    const netApi = net as NetworkingV1Api;
    const res = await netApi.readNamespacedNetworkPolicy({
      name: policyName,
      namespace: namespace || 'default',
    });

    return res;
  } catch {
    return null;
  }
}

export async function applyNetworkPolicy(
  namespace: string,
  body: any,
  ref?: StepRef
): Promise<void> {
  const { net } = getKubeClients();
  const start = Date.now();

  try {
    console.log(`[K8s Ops] Creating NetworkPolicy ${body.metadata?.name ?? 'unknown'} in ${namespace || 'default'}...`);
    await withTimeout((net as any).createNamespacedNetworkPolicy({
      namespace: namespace || 'default',
      body,
    }));
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'execution',
        status: 'success',
        command: `kubectl apply -f [network policy config] -n ${namespace || 'default'}`,
        message: `Created NetworkPolicy ${body.metadata?.name ?? 'unknown'}`,
        resourceType: 'NetworkPolicy',
        resourceName: body.metadata?.name ?? 'unknown',
        namespace: namespace || 'default',
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
        command: `kubectl apply -f [network policy config] -n ${namespace || 'default'}`,
        error: e.message ?? String(e),
        resourceType: 'NetworkPolicy',
        resourceName: body.metadata?.name ?? 'unknown',
        namespace: namespace || 'default',
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
  ref?: StepRef
): Promise<void> {
  const { net } = getKubeClients();
  const start = Date.now();

  try {
    console.log(`[K8s Ops] Replacing NetworkPolicy ${policyName} in ${namespace || 'default'}...`);
    await withTimeout((net as any).replaceNamespacedNetworkPolicy({
      name: policyName,
      namespace: namespace || 'default',
      body,
    }));
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'rollback',
        status: 'success',
        command: `kubectl replace -f [network policy config] -n ${namespace || 'default'}`,
        message: `Restored NetworkPolicy ${policyName}`,
        resourceType: 'NetworkPolicy',
        resourceName: policyName,
        namespace: namespace || 'default',
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
        command: `kubectl replace -f [network policy config] -n ${namespace || 'default'}`,
        error: e.message ?? String(e),
        resourceType: 'NetworkPolicy',
        resourceName: policyName,
        namespace: namespace || 'default',
        durationMs: Date.now() - start,
      });
    }
    throw e;
  }
}

export async function upsertNetworkPolicy(
  namespace: string,
  policyName: string,
  spec: any,
  ref?: StepRef
): Promise<void> {
  const { net } = getKubeClients();
  const start = Date.now();

  try {
    try {
      await (net as any).readNamespacedNetworkPolicy({
        name: policyName,
        namespace: namespace || 'default'
      });

      await (net as any).replaceNamespacedNetworkPolicy({
        name: policyName,
        namespace: namespace || 'default',
        body: spec
      });
    } catch {
      await (net as any).createNamespacedNetworkPolicy({
        namespace: namespace || 'default',
        body: spec
      });
    }

    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'execution',
        status: 'success',
        command: `kubectl apply -f [network policy config] -n ${namespace || 'default'}`,
        message: `Upserted NetworkPolicy ${policyName}`,
        resourceType: 'NetworkPolicy',
        resourceName: policyName,
        namespace: namespace || 'default',
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
        command: `kubectl apply -f [network policy config] -n ${namespace || 'default'}`,
        error: e.message ?? String(e),
        resourceType: 'NetworkPolicy',
        resourceName: policyName,
        namespace: namespace || 'default',
        durationMs: Date.now() - start,
      });
    }
    throw e;
  }
}

export async function deleteNetworkPolicy(
  namespace: string,
  policyName: string,
  ref?: StepRef
): Promise<void> {
  const { net } = getKubeClients();
  const start = Date.now();

  try {
    console.log(`[K8s Ops] Deleting NetworkPolicy ${policyName} in ${namespace || 'default'}...`);
    await withTimeout((net as any).deleteNamespacedNetworkPolicy({
      name: policyName,
      namespace: namespace || 'default'
    }));
    if (ref) {
      await recordSimulationStep({
        simulationId: ref.simulationId,
        name: ref.name,
        failureType: ref.failureType,
        stepType: 'rollback',
        status: 'success',
        command: `kubectl delete networkpolicy ${policyName} -n ${namespace || 'default'}`,
        message: `Deleted NetworkPolicy ${policyName}`,
        resourceType: 'NetworkPolicy',
        resourceName: policyName,
        namespace: namespace || 'default',
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
        command: `kubectl delete networkpolicy ${policyName} -n ${namespace || 'default'}`,
        error: e.message ?? String(e),
        resourceType: 'NetworkPolicy',
        resourceName: policyName,
        namespace: namespace || 'default',
        durationMs: Date.now() - start,
      });
    }
  }
}