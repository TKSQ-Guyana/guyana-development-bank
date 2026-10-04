# gdb-los bootstrap (run once, before the Helm chart)

```bash
export KUBECONFIG=~/.kube/gdb-prod.yaml

# 0. Confirm Traefik's / Prometheus' namespace; edit 01-namespace.yaml if not "kommander"
kubectl get pods -A | grep -Ei "traefik|prometheus"

# 1. Namespace, quota, default limits, pod security, network policies
kubectl apply -f 01-namespace.yaml

# 2. Retain storage class for database disks
chmod +x 02-storageclass-retain.sh && ./02-storageclass-retain.sh

# 3. OPTIONAL - only if you set nodeSelector in values-prod.yaml
chmod +x 04-label-nodes.sh && ./04-label-nodes.sh

# 4. Secrets (see 03-create-secrets.sh header)
./03-create-secrets.sh

# 5. Images -> ravinadh/gdb-* (run from the REPO ROOT), then the pull secret
( cd .. && DOCKERHUB_TOKEN=<rw-token> ./gdb-los-bootstrap/05-push-images.sh v1 )
DOCKERHUB_PULL_TOKEN=<ro-token> ./06-pull-secret.sh

# 6. Verify
kubectl get ns gdb-los --show-labels
kubectl describe resourcequota -n gdb-los
kubectl get netpol -n gdb-los
kubectl get sc
```

| Item | Value |
| --- | --- |
| Namespace | `gdb-los` (dedicated) |
| Nodes | 4 workers labelled `gdb-los/workload=true` |
| CPU / memory (requests) | 24 vCPU / 96 GiB cap (baseline ~10 / ~38, rest is autoscaling room) |
| CPU / memory (limits) | 48 vCPU / 128 GiB cap |
| Storage | 1.5 TiB cap (plan uses ~730 GiB) |
| Block storage class | `nutanix-volume-retain` (MariaDB, Redis) |
| Shared (RWX) class | pending — Nutanix Files, for `sites/` |

Raise the quota numbers if the cluster's worker pool is scaled up.
