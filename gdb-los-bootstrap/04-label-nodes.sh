#!/usr/bin/env bash
# Marks the 4 worker nodes (NKP node pool md-0) as GDB nodes. Every gdb-los pod
# carries nodeSelector gdb-los/workload=true, so it can ONLY run on these.
# Control-plane nodes are never labelled -> the app never lands there.
set -euo pipefail

NODES=(
  prodcluster-md-0-njskx-mzqmz-6slhr
  prodcluster-md-0-njskx-mzqmz-hql6p
  prodcluster-md-0-njskx-mzqmz-ks8tr
  prodcluster-md-0-njskx-mzqmz-mc6ks
)

for n in "${NODES[@]}"; do
  kubectl label node "$n" gdb-los/workload=true --overwrite
done

echo
echo "== GDB nodes =="
kubectl get nodes -l gdb-los/workload=true \
  -o custom-columns=NAME:.metadata.name,CPU:.status.allocatable.cpu,MEMORY:.status.allocatable.memory

echo
echo "== Control-plane taints (expect NoSchedule on all three) =="
kubectl get nodes -l node-role.kubernetes.io/control-plane \
  -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints[*].effect

# NOTE: NKP may replace worker VMs (upgrade, repair, scale). New VMs have new
# names and NO label - re-run this script, or better, set the label on the
# node pool itself so new machines get it automatically:
#   NKP UI -> Clusters -> prodcluster -> Node Pools -> md-0 -> Edit -> Labels
#   gdb-los/workload=true
