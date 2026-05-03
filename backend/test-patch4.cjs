const { AppsV1Api, KubeConfig } = require('@kubernetes/client-node');

const kc = new KubeConfig();
kc.loadFromDefault();
const k8sApi = kc.makeApiClient(AppsV1Api);

async function test() {
  try {
    const deploymentName = 'simulator-test-dep2';
    const ns = 'default';

    const patchBody = {
      spec: { template: { spec: { containers: [{ name: 'nginx', command: ['sh', '-c', 'exit 137'] }] } } }
    };

    console.log('Patching with options as second arg...');
    const options = { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } };
    await k8sApi.patchNamespacedDeployment({
      name: deploymentName,
      namespace: ns,
      body: patchBody
    }, options);
    console.log('Object arg succeeded!');
    
  } catch (e) {
    console.error('Test failed:', e.body || e.message);
  }
}
test();
