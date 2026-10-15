#!/usr/bin/env bash
# Regenerates the C2PA signing CA + leaf cert pair in keys/.
#
# c2pa-rs rejects self-signed certs at sign time (certificate_profile.rs:329),
# so we use a private CA that signs a leaf/signer cert. The leaf has
# CA:FALSE, digitalSignature key usage, and emailProtection EKU — the profile
# c2pa-rs requires (see has_allowed_eku in certificate_trust_policy.rs).
#
# Resulting files (all gitignored via keys/):
#   c2pa-ca.pem            — CA cert (public)
#   c2pa-ca-key.pem        — CA private key (secret)
#   c2pa-signer.pem        — leaf/signer cert (public)
#   c2pa-signer-key.pem    — leaf private key (secret)
#   c2pa-signer-chain.pem  — leaf + CA concatenated (what C2PA_SIGN_CERT points to)
#
# Usage: bash scripts/regen-c2pa-certs.sh
set -euo pipefail

KEYS_DIR="$(cd "$(dirname "$0")/.." && pwd)/keys"
mkdir -p "$KEYS_DIR"
cd "$KEYS_DIR"

DAYS=3650

echo "1. Generating self-signed CA (P-256, ${DAYS} days)..."
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
  -keyout c2pa-ca-key.pem -x509 -out c2pa-ca.pem \
  -days "$DAYS" -nodes \
  -subj "/CN=content-pipeline-c2pa-CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"

echo "2. Generating leaf/signer CSR..."
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
  -keyout c2pa-signer-key.pem -out c2pa-signer-csr.pem \
  -nodes -subj "/CN=content-pipeline-signer"

echo "3. Signing leaf cert with CA..."
openssl x509 -req -in c2pa-signer-csr.pem \
  -CA c2pa-ca.pem -CAkey c2pa-ca-key.pem -CAcreateserial \
  -out c2pa-signer.pem -days "$DAYS" -sha256 \
  -extfile <(printf "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=emailProtection\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer")

echo "4. Building chain (leaf + CA)..."
cat c2pa-signer.pem c2pa-ca.pem > c2pa-signer-chain.pem

echo "5. Verifying chain..."
openssl verify -CAfile c2pa-ca.pem c2pa-signer.pem

echo "6. Cleaning up CSR/serial..."
rm -f c2pa-signer-csr.pem c2pa-ca.srl

echo ""
echo "Done. Files in $KEYS_DIR:"
ls -la c2pa-*.pem
echo ""
echo "Env config should be:"
echo "  C2PA_SIGN_CERT=./keys/c2pa-signer-chain.pem"
echo "  C2PA_SIGN_KEY=./keys/c2pa-signer-key.pem"
echo ""
echo "After regenerating, restart pm2: pm2 restart pipeline"
