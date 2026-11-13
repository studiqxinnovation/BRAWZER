#!/bin/sh
# Makes the certificates for one runtime host's engine (ADR 0016): a CA,
# the engine's server certificate for <host>, and the API's client
# certificate. Output in ./certs. Keep the CA key offline after use.
set -eu
host="${1:?usage: make-certs.sh <engine host name or address>}"
out="${2:-certs}"
mkdir -p "$out" && cd "$out"
days=825
openssl ecparam -genkey -name prime256v1 -out ca-key.pem
openssl req -x509 -new -key ca-key.pem -days 1825 -subj "/CN=Brawzer runtime CA" -out ca.pem
openssl ecparam -genkey -name prime256v1 -out server-key.pem
openssl req -new -key server-key.pem -subj "/CN=$host" -out server.csr
case "$host" in
  *[!0-9.]*) san="DNS:$host" ;;
  *) san="IP:$host" ;;
esac
printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$san" > server-ext.cnf
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -days "$days" -extfile server-ext.cnf -out server-cert.pem
openssl ecparam -genkey -name prime256v1 -out key.pem
openssl req -new -key key.pem -subj "/CN=brawzer-api" -out client.csr
printf 'extendedKeyUsage=clientAuth\n' > client-ext.cnf
openssl x509 -req -in client.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -days "$days" -extfile client-ext.cnf -out cert.pem
rm -f server.csr client.csr server-ext.cnf client-ext.cnf ca.srl
chmod 600 ca-key.pem server-key.pem key.pem
echo "Engine: ca.pem server-cert.pem server-key.pem   API: ca.pem cert.pem key.pem"
