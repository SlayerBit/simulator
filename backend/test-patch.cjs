const { AppsV1Api, KubeConfig } = require('@kubernetes/client-node');

const kc = new KubeConfig();
kc.loadFromDefault();
const k8sApi = kc.makeApiClient(AppsV1Api);

async function test() {
  try {
    const deploymentName = 'simulator-test-dep';
    const ns = 'default';
    
    // Create dummy deployment
    try {
      await k8sApi.createNamespacedDeployment(ns, {
        metadata: { name: deploymentName },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'test' } },
          template: {
            metadata: { labels: { app: 'test' } },
            spec: {
              containers: [{
                name: 'nginx',
                image: 'nginx:latest'
              }]
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
      spec: {
        template: {
          spec: {
            containers: [{
              name: 'nginx',
              command: ['sh', '-c', 'exit 137']
            }]
          }
        }
      }
    };

    console.log('Patching...');
    // test the patch via the same method
    const options = { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } };
    await k8sApi.patchNamespacedDeployment(
      deploymentName,
      ns,
      patchBody,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      options
    );
    console.log('Patch succeeded!');
    
    // test with the generated object argument (if applicable)
    console.log('Patching with object arg...');
    try {
      // NOTE: typescript-axios clients sometimes do not support single-object args unless it's a newer version.
      // Wait, in version 1.4.0, maybe they only support positional args?
      await k8sApi.patchNamespacedDeployment({
        name: deploymentName,
        namespace: ns,
        body: patchBody,
        options
      });
      console.log('Object arg succeeded!');
    } catch(e) {
      console.log('Object arg failed:', e.message);
    }
    
  } catch (e) {
    console.error('Test failed:', e.body || e.message);
  }
}
test();
