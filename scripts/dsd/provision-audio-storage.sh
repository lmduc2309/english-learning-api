#!/usr/bin/env zsh
# Provision the DSD audio object store: bucket, versioning, encryption, and the
# three least-privilege roles.
#
# Idempotent. `plan` prints what it would do and changes nothing; `apply` makes
# it so; `status` reports what exists.
#
# Works against MinIO (development) and AWS S3 (production). The role
# capabilities it creates are measured, not assumed — see
# scripts/dsd/audio-storage-permissions.spec.ts.
#
# USAGE
#   zsh scripts/dsd/provision-audio-storage.sh plan
#   zsh scripts/dsd/provision-audio-storage.sh apply
#   zsh scripts/dsd/provision-audio-storage.sh status
#
# ENVIRONMENT
#   DSD_AUDIO_S3_BUCKET     bucket name                        (required)
#   DSD_AUDIO_S3_REGION     region                             (default us-east-1)
#   DSD_AUDIO_S3_ENDPOINT   S3 endpoint; set for MinIO         (optional)
#   DSD_AUDIO_KMS_KEY_ID    KMS key for SSE-KMS; AWS only      (optional locally)
#   DSD_MINIO_CONTAINER     MinIO container name for `mc`      (default dsd-minio)
set -euo pipefail

COMMAND="${1:-status}"
BUCKET="${DSD_AUDIO_S3_BUCKET:-}"
REGION="${DSD_AUDIO_S3_REGION:-us-east-1}"
ENDPOINT="${DSD_AUDIO_S3_ENDPOINT:-}"
KMS_KEY="${DSD_AUDIO_KMS_KEY_ID:-}"
MINIO="${DSD_MINIO_CONTAINER:-dsd-minio}"

SCRIPT_DIR="${0:a:h}"
POLICY_DIR="$SCRIPT_DIR/audio-storage-policies"

if [[ -z "$BUCKET" ]]; then
  print -u2 "DSD_AUDIO_S3_BUCKET is required."
  exit 1
fi

# zsh does not word-split unquoted parameters, so the endpoint flag has to be an
# array rather than a string.
AWS_FLAGS=(--region "$REGION")
[[ -n "$ENDPOINT" ]] && AWS_FLAGS+=(--endpoint-url "$ENDPOINT")

# Roles, and the environment variables their credentials belong in.
ROLES=(generator api operator)

is_minio() { [[ -n "$ENDPOINT" ]] }

banner() { print "\n── $1 ─────────────────────────────────────────" }

status() {
  banner "bucket"
  if aws "${AWS_FLAGS[@]}" s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
    print "  $BUCKET exists"
    local versioning
    versioning="$(aws "${AWS_FLAGS[@]}" s3api get-bucket-versioning --bucket "$BUCKET" \
      --query 'Status' --output text 2>/dev/null || print 'None')"
    print "  versioning: $versioning"
    if aws "${AWS_FLAGS[@]}" s3api get-bucket-encryption --bucket "$BUCKET" >/dev/null 2>&1; then
      print "  encryption: configured"
    else
      print "  encryption: NOT configured"
      is_minio && print "    (plain MinIO has no KMS; encryption at rest is not verifiable locally)"
    fi
  else
    print "  $BUCKET does not exist"
  fi

  banner "roles"
  if is_minio; then
    for role in "${ROLES[@]}"; do
      if docker exec "$MINIO" mc admin user info local "dsd-$role" >/dev/null 2>&1; then
        print "  dsd-$role exists"
      else
        print "  dsd-$role missing"
      fi
    done
  else
    print "  AWS: create IAM roles from $POLICY_DIR and attach them to the"
    print "  generator, API and operator principals. This script does not create"
    print "  IAM identities in AWS on purpose — that belongs to whoever owns the"
    print "  account, not to a corpus tool."
  fi
}

plan() {
  banner "plan"
  print "  create bucket           $BUCKET ($REGION)"
  print "  enable versioning       so an overwrite or delete stays recoverable"
  if [[ -n "$KMS_KEY" ]]; then
    print "  enable SSE-KMS          $KMS_KEY"
  else
    print "  enable SSE-S3           (no DSD_AUDIO_KMS_KEY_ID set)"
    is_minio && print "                          plain MinIO will refuse this; see status"
  fi
  print "  block public access     no anonymous listing, ever"
  for role in "${ROLES[@]}"; do
    print "  policy dsd-audio-$role  from ${POLICY_DIR#$PWD/}/$role.json"
  done
  print "\nNothing was changed. Re-run with 'apply'."
}

apply() {
  banner "bucket"
  if aws "${AWS_FLAGS[@]}" s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
    print "  $BUCKET already exists"
  else
    if [[ "$REGION" == "us-east-1" || -n "$ENDPOINT" ]]; then
      aws "${AWS_FLAGS[@]}" s3api create-bucket --bucket "$BUCKET" >/dev/null
    else
      aws "${AWS_FLAGS[@]}" s3api create-bucket --bucket "$BUCKET" \
        --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
    fi
    print "  created $BUCKET"
  fi

  aws "${AWS_FLAGS[@]}" s3api put-bucket-versioning --bucket "$BUCKET" \
    --versioning-configuration Status=Enabled
  print "  versioning enabled"

  local encryption
  if [[ -n "$KMS_KEY" ]]; then
    encryption="{\"Rules\":[{\"ApplyServerSideEncryptionByDefault\":{\"SSEAlgorithm\":\"aws:kms\",\"KMSMasterKeyID\":\"$KMS_KEY\"},\"BucketKeyEnabled\":true}]}"
  else
    encryption='{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  fi
  if aws "${AWS_FLAGS[@]}" s3api put-bucket-encryption --bucket "$BUCKET" \
      --server-side-encryption-configuration "$encryption" >/dev/null 2>&1; then
    print "  default encryption enabled"
  else
    # Not silently tolerated: the audit reports it as a critical finding, so a
    # store without encryption cannot pass the release gate.
    print "  WARNING: default encryption could not be set."
    is_minio && print "    Plain MinIO has no KMS. Encryption at rest is not verifiable locally;"
    is_minio && print "    the storage audit will report encryption_disabled, which is correct."
  fi

  # Public access is denied by default on a new bucket; assert it rather than
  # assume it, because a bucket may be reused.
  if ! is_minio; then
    aws "${AWS_FLAGS[@]}" s3api put-public-access-block --bucket "$BUCKET" \
      --public-access-block-configuration \
      'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true' >/dev/null
    print "  public access blocked"
  fi

  banner "roles"
  if is_minio; then
    docker exec "$MINIO" mc alias set local http://localhost:9000 \
      "${MINIO_ROOT_USER:-dsdadmin}" "${MINIO_ROOT_PASSWORD:-dsdadmin-secret}" >/dev/null
    for role in "${ROLES[@]}"; do
      local rendered="/tmp/dsd-audio-$role.json"
      sed "s/\${DSD_AUDIO_BUCKET}/$BUCKET/g" "$POLICY_DIR/$role.json" > "$rendered"
      docker cp "$rendered" "$MINIO:/tmp/" >/dev/null

      # Replace rather than skip. `policy create` fails when the name exists, and
      # tolerating that failure silently leaves the OLD policy in place — which
      # still points at whatever bucket it was created for. Re-provisioning
      # against a different bucket then looks successful and grants nothing.
      if ! docker exec "$MINIO" mc admin policy create local "dsd-audio-$role" \
            "/tmp/dsd-audio-$role.json" >/dev/null 2>&1; then
        docker exec "$MINIO" mc admin policy detach local "dsd-audio-$role" \
          --user "dsd-$role" >/dev/null 2>&1 || true
        docker exec "$MINIO" mc admin policy rm local "dsd-audio-$role" >/dev/null 2>&1 || true
        docker exec "$MINIO" mc admin policy create local "dsd-audio-$role" \
          "/tmp/dsd-audio-$role.json" >/dev/null
      fi

      docker exec "$MINIO" mc admin user add local "dsd-$role" "dsd-$role-secret123" >/dev/null 2>&1 || true
      docker exec "$MINIO" mc admin policy attach local "dsd-audio-$role" --user "dsd-$role" >/dev/null 2>&1 || true
      rm -f "$rendered"
      print "  dsd-$role provisioned with dsd-audio-$role"
    done
    print "\nDevelopment credentials are dsd-<role> / dsd-<role>-secret123."
    print "Verify the capability matrix:"
    print "  DSD_AUDIO_GENERATOR_KEY=dsd-generator DSD_AUDIO_GENERATOR_SECRET=dsd-generator-secret123 \\"
    print "  DSD_AUDIO_API_KEY=dsd-api DSD_AUDIO_API_SECRET=dsd-api-secret123 \\"
    print "  DSD_AUDIO_OPERATOR_KEY=dsd-operator DSD_AUDIO_OPERATOR_SECRET=dsd-operator-secret123 \\"
    print "    npx jest --config jest.scripts.config.js audio-storage-permissions --runInBand"
  else
    print "  AWS: attach the rendered policies to your three principals."
    print "  This script deliberately does not create IAM identities in AWS —"
    print "  that belongs to whoever owns the account."
    for role in "${ROLES[@]}"; do
      print "\n  --- dsd-audio-$role ---"
      sed "s/\${DSD_AUDIO_BUCKET}/$BUCKET/g" "$POLICY_DIR/$role.json"
    done
  fi
}

case "$COMMAND" in
  plan) plan ;;
  apply) apply ;;
  status) status ;;
  *)
    print -u2 "Unknown command '$COMMAND'. Use plan, apply or status."
    exit 1
    ;;
esac
