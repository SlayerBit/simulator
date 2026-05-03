const { AppsV1Api, KubeConfig } = require('@kubernetes/client-node');

const kc = new KubeConfig();
kc.loadFromDefault();
const k8sApi = kc.makeApiClient(AppsV1Api);

async function test() {
  try {
    const deploymentName = 'simulator-test-dep2';
    const ns = 'default';
    
    // Create dummy deployment
    try {
      await k8sApi.createNamespacedDeployment({
        namespace: ns,
        body: {
          metadata: { name: deploymentName },
          spec: {
            replicas: 1,
            selector: { matchLabels: { app: 'test2' } },
            template: {
              metadata: { labels: { app: 'test2' } },
              spec: { containers: [{ name: 'nginx', image: 'nginx:latest' }] }
            }
          }
        }
      });
      console.log('Created dummy deployment');
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.log('Deployment might already exist');
    }

    const patchBody = {
      spec: { template: { spec: { containers: [{ name: 'nginx', command: ['sh', '-c', 'exit 137'] }] } } }
    };

    console.log('Patching with object arg + options...');
    const options = { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } };
    await k8sApi.patchNamespacedDeployment({
      name: deploymentName,
      namespace: ns,
      body: patchBody,
      options
    });
    console.log('Object arg succeeded!');
    
  } catch (e) {
    console.error('Test failed:', e.body || e.message);
  }
}
test();
