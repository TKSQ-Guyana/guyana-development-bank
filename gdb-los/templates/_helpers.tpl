{{/* ---------------- names & labels ---------------- */}}

{{- define "gdb.name" -}}
{{- default .Release.Name .Values.nameOverride | trunc 40 | trimSuffix "-" -}}
{{- end -}}

{{- define "gdb.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
app.kubernetes.io/name: gdb-los
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: gdb-los
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* usage: include "gdb.selectorLabels" (dict "root" $ "component" "frontend") */}}
{{- define "gdb.selectorLabels" -}}
app.kubernetes.io/name: gdb-los
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* Every pod that mounts the sites volume carries this label (RWO co-location). */}}
{{- define "gdb.sitesLabel" -}}
gdb-los/sites-volume: "true"
{{- end -}}

{{- define "gdb.secretName" -}}
{{- default (printf "%s-secrets" (include "gdb.name" .)) .Values.secrets.name -}}
{{- end -}}

{{- define "gdb.sitesClaim" -}}
{{- default (printf "%s-sites" (include "gdb.name" .)) .Values.backend.sites.existingClaim -}}
{{- end -}}

{{- define "gdb.mariadbName" -}}
{{- printf "%s-mariadb" (include "gdb.name" .) -}}
{{- end -}}

{{- define "gdb.dbHost" -}}
{{- printf "%s-primary" (include "gdb.mariadbName" .) -}}
{{- end -}}

{{/* ---------------- images (pinned tags enforced) ---------------- */}}
{{/* usage: include "gdb.image" (dict "img" .Values.images.backend "key" "backend") */}}
{{- define "gdb.image" -}}
{{- if not .img.tag -}}
{{- fail (printf "images.%s.tag is required - use the pinned CI tag" .key) -}}
{{- end -}}
{{- if contains "latest" (toString .img.tag) -}}
{{- fail (printf "images.%s.tag=%s - production must pin an exact build, not a *latest tag" .key .img.tag) -}}
{{- end -}}
{{- printf "%s:%s" .img.repository (toString .img.tag) -}}
{{- end -}}

{{- define "gdb.imagePullSecrets" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{/* ---------------- scheduling ---------------- */}}

{{/* Pin every pod to the labelled GDB worker nodes (values: nodeSelector / tolerations). */}}
{{- define "gdb.placement" -}}
{{- with .Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{/* Prefer one replica per node. usage: (dict "root" $ "component" "x") */}}
{{- define "gdb.spreadAffinity" -}}
podAntiAffinity:
  preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      podAffinityTerm:
        topologyKey: kubernetes.io/hostname
        labelSelector:
          matchLabels:
            {{- include "gdb.selectorLabels" . | nindent 12 }}
{{- end -}}

{{/*
Backend pods: with RWX sites -> spread across nodes.
With RWO sites -> ALL sites-volume pods must share one node (block volume
attaches to a single node), so spreading is replaced by required co-location.
*/}}
{{- define "gdb.backendAffinity" -}}
{{- if eq .root.Values.backend.sites.accessMode "ReadWriteOnce" -}}
podAffinity:
  requiredDuringSchedulingIgnoredDuringExecution:
    - topologyKey: kubernetes.io/hostname
      labelSelector:
        matchLabels:
          app.kubernetes.io/instance: {{ .root.Release.Name }}
          gdb-los/sites-volume: "true"
{{- else -}}
{{- include "gdb.spreadAffinity" . -}}
{{- end -}}
{{- end -}}

{{/* ---------------- backend shared pieces ---------------- */}}

{{- define "gdb.sitesVolumes" -}}
- name: sites
  persistentVolumeClaim:
    claimName: {{ include "gdb.sitesClaim" . }}
- name: logs
  emptyDir: {}
{{- end -}}

{{- define "gdb.sitesMounts" -}}
- name: sites
  mountPath: /home/frappe/frappe-bench/sites
- name: logs
  mountPath: /home/frappe/frappe-bench/logs
{{- end -}}

{{/*
A PVC (unlike a Docker named volume) is NOT pre-filled from the image, and
must not keep stale build output across upgrades. This init container:
  1. copies this image's built assets into an emptyDir (fresh every rollout)
  2. overwrites apps.txt / apps.json so the app list always matches the image
  3. seeds any other file the image ships in sites/ - never overwriting
*/}}
{{- define "gdb.prepareSites" -}}
- name: prepare-sites
  image: {{ include "gdb.image" (dict "img" .Values.images.backend "key" "backend") }}
  imagePullPolicy: {{ .Values.images.backend.pullPolicy }}
  command: ["bash", "-c"]
  args:
    - |
      set -e
      SRC=/home/frappe/frappe-bench/sites
      for f in apps.txt apps.json; do
        if [ -f "$SRC/$f" ]; then cp -f "$SRC/$f" "/pvc/$f"; fi
      done
      for f in "$SRC"/*; do
        b=$(basename "$f")
        if [ -f "$f" ] && [ ! -e "/pvc/$b" ]; then cp "$f" "/pvc/$b"; fi
      done
      echo "sites volume prepared"
  volumeMounts:
    - name: sites
      mountPath: /pvc
  resources:
    requests: {cpu: 50m, memory: 64Mi}
    limits: {cpu: 500m, memory: 256Mi}
{{- end -}}

{{/*
Secret env for backend containers.
usage: include "gdb.backendEnv" (dict "root" $ "bootstrap" true)
bootstrap=true adds what site creation needs (web pods run start-backend.sh).
*/}}
{{- define "gdb.backendEnv" -}}
{{- $s := include "gdb.secretName" .root -}}
{{- if .bootstrap }}
- name: DB_ROOT_PASSWORD
  valueFrom:
    secretKeyRef: {name: {{ $s }}, key: db-root-password}
- name: ADMIN_PASSWORD
  valueFrom:
    secretKeyRef: {name: {{ $s }}, key: admin-password}
- name: GDB_PLATFORM_ADMIN_PASSWORD
  valueFrom:
    secretKeyRef: {name: {{ $s }}, key: platform-admin-password, optional: true}
{{- end }}
{{- $optional := dict
    "KEYCLOAK_CLIENT_SECRET" "keycloak-client-secret"
    "KEYCLOAK_STAFF_CLIENT_SECRET" "keycloak-staff-client-secret"
    "KEYCLOAK_ADMIN_CLIENT_SECRET" "keycloak-admin-client-secret"
    "KEYCLOAK_CITIZEN_ADMIN_CLIENT_SECRET" "keycloak-citizen-admin-client-secret"
    "DCRA_API_KEY" "dcra-api-key"
    "BANK_REGISTRY_API_KEY" "bank-registry-api-key" }}
{{- range $env, $key := $optional }}
- name: {{ $env }}
  valueFrom:
    secretKeyRef: {name: {{ $s }}, key: {{ $key }}, optional: true}
{{- end }}
{{- with .root.Values.backend.extraEnv }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/* Worker/scheduler: wait until web pods have created the site, then exec. */}}
{{- define "gdb.waitForSite" -}}
until [ -f "sites/${SITE_NAME}/site_config.json" ]; do
  echo "waiting for site ${SITE_NAME} to be created by the web pods..."; sleep 10
done
{{- end -}}
