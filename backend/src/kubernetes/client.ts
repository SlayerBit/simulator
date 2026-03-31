import { KubeConfig, CoreV1Api, AppsV1Api, NetworkingV1Api, Exec } from '@kubernetes/client-node';

export interface KubeClients {
  kc: KubeConfig;
  core: CoreV1Api;
  apps: AppsV1Api;
  net: NetworkingV1Api;
  exec: Exec;
}

// Cached singleton — avoids re-reading kubeconfig on every API call.
let cached: KubeClients | undefined;

export function getKubeClients(): KubeClients {
  if (cached) return cached;

  const kc = new KubeConfig();
  try {
    kc.loadFromCluster();
    console.log('[K8s] Loaded in-cluster config');
  } catch {
    kc.loadFromDefault();
    const contexts = kc.getContexts();
    const current = kc.getCurrentContext();
    if (!current && contexts.length > 0) {
      kc.setCurrentContext(contexts[0]!.name);
    }
    console.log(`[K8s] Loaded default kube config (Context: ${kc.getCurrentContext()})`);
  }

  cached = {
    kc,
    core: kc.makeApiClient(CoreV1Api),
    apps: kc.makeApiClient(AppsV1Api),
    net: kc.makeApiClient(NetworkingV1Api),
    exec: new Exec(kc),
  };

  return cached;
}

/** Call this if the cluster context changes at runtime (e.g. rotated credentials). */
export function resetKubeClients(): void {
  cached = undefined;
}
