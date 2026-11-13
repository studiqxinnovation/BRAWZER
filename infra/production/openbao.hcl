# OpenBao, server mode, for the self-hosted services stack (services.yaml).
# Reached only on the compose network; the API talks to it over that network.
ui = false
# mlock is gone from OpenBao 2.6; the host has no swap.

storage "file" {
  path = "/openbao/file"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = true
}

api_addr = "http://openbao:8200"
