import { KubeConfig, CoreV1Api, AppsV1Api, NetworkingV1Api, Exec } from '@kubernetes/client-node';

export interface KubeClients {
  kc: KubeConfig;
  core: CoreV1Api;
  apps: AppsV1Api;
  net: NetworkingV1Api;
  exec: Exec;
}

export function getKubeClients(): KubeClients {
  const kc = new KubeConfig();
  try {
    kc.loadFromCluster();
  } catch {
    kc.loadFromDefault();
  }

  return {
    kc,
    core: kc.makeApiClient(CoreV1Api),
    apps: kc.makeApiClient(AppsV1Api),
    net: kc.makeApiClient(NetworkingV1Api),
    exec: new Exec(kc),
  };
}
