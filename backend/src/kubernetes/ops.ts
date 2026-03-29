import { getKubeClients } from './client.js';

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

export async function scaleDeployment(namespace: string, deploymentName: string, replicas: number): Promise<void> {
  const { apps } = getKubeClients();
  await apps.patchNamespacedDeploymentScale(
    { name: deploymentName, namespace, body: { spec: { replicas } } } as any,
    { headers: { 'Content-Type': 'application/merge-patch+json' } } as any,
  );
}

export async function readDeployment(namespace: string, deploymentName: string): Promise<any> {
  const { apps } = getKubeClients();
  const dep = await apps.readNamespacedDeployment({ name: deploymentName, namespace } as any);
  return dep;
}

export async function replaceDeployment(namespace: string, deploymentName: string, body: any): Promise<void> {
  const { apps } = getKubeClients();
  await apps.replaceNamespacedDeployment({ name: deploymentName, namespace, body } as any);
}

export async function deletePodsBySelector(namespace: string, labelSelector: string): Promise<number> {
  const { core } = getKubeClients();
  const pods = await core.listNamespacedPod({ namespace, labelSelector });
  const items = pods.items ?? [];
  for (const pod of items) {
    if (!pod.metadata?.name) continue;
    await core.deleteNamespacedPod({ name: pod.metadata.name, namespace });
  }
  return items.length;
}

export async function patchDeploymentTemplate(namespace: string, deploymentName: string, patch: PatchSpec): Promise<void> {
  const { apps } = getKubeClients();
  await apps.patchNamespacedDeployment(
    { name: deploymentName, namespace, body: patch.body } as any,
    { headers: { 'Content-Type': patch.contentType } } as any,
  );
}

export async function readNetworkPolicy(namespace: string, policyName: string): Promise<any | null> {
  const { net } = getKubeClients();
  try {
    return await net.readNamespacedNetworkPolicy({ name: policyName, namespace } as any);
  } catch {
    return null;
  }
}

export async function applyNetworkPolicy(namespace: string, body: any): Promise<void> {
  const { net } = getKubeClients();
  await net.createNamespacedNetworkPolicy({ namespace, body } as any);
}

export async function replaceNetworkPolicy(namespace: string, policyName: string, body: any): Promise<void> {
  const { net } = getKubeClients();
  await net.replaceNamespacedNetworkPolicy({ name: policyName, namespace, body } as any);
}

export async function upsertNetworkPolicy(namespace: string, policyName: string, spec: any): Promise<void> {
  const { net } = getKubeClients();
  try {
    await net.readNamespacedNetworkPolicy({ name: policyName, namespace });
    await net.replaceNamespacedNetworkPolicy({ name: policyName, namespace, body: spec });
  } catch {
    await net.createNamespacedNetworkPolicy({ namespace, body: spec });
  }
}

export async function deleteNetworkPolicy(namespace: string, policyName: string): Promise<void> {
  const { net } = getKubeClients();
  try {
    await net.deleteNamespacedNetworkPolicy({ name: policyName, namespace });
  } catch {
    // ignore
  }
}
