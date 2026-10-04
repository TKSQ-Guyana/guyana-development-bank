#!/usr/bin/env bash
# Creates "nutanix-volume-retain": identical to the default nutanix-volume
# class (same Nutanix storage container + CSI secret), but with
# reclaimPolicy: Retain, so deleting a PVC or a Helm release can NEVER
# delete the MariaDB / Redis data disks on Nutanix.
#
# Usage:  ./02-storageclass-retain.sh          (needs kubectl + python3)
set -euo pipefail

SRC=nutanix-volume
DST=nutanix-volume-retain

if kubectl get storageclass "$DST" >/dev/null 2>&1; then
  echo "StorageClass $DST already exists - nothing to do."
  exit 0
fi

# Copy the existing class, keep its parameters, change name/policy/default flag.
kubectl get storageclass "$SRC" -o json | python3 -c '
import json, sys
sc = json.load(sys.stdin)
meta = sc["metadata"]
sc["metadata"] = {
    "name": "'"$DST"'",
    "labels": {"app.kubernetes.io/part-of": "gdb-los"},
    # must NOT become a second default class
    "annotations": {"storageclass.kubernetes.io/is-default-class": "false"},
}
sc["reclaimPolicy"] = "Retain"
sc["allowVolumeExpansion"] = True
sc["volumeBindingMode"] = "WaitForFirstConsumer"
json.dump(sc, sys.stdout)
' | kubectl apply -f -

echo
echo "Created. Parameters copied from $SRC:"
kubectl get storageclass "$DST" -o jsonpath='{.parameters}'; echo
kubectl get storageclass
