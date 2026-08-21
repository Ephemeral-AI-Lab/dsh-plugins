# How to Route DSH Codex and xAI Through Veee

This guide records the working macOS setup for:

- DeepSeek Harness and its Codex Coding Plan provider;
- the Codex CLI;
- the Grok CLI and `x.ai` authentication endpoints.

It does not require any change to the DeepSeek Harness source repository.

## Known local endpoints

Veee exposes these loopback proxies:

| Protocol | Endpoint |
|---|---|
| HTTP/HTTPS | `http://127.0.0.1:15236` |
| SOCKS5 | `socks5://127.0.0.1:15235` |

The setup below uses the HTTP endpoint. Keep localhost traffic outside the
proxy so DSH can continue to serve its UI and API locally.

## 1. Correct the Veee rule for xAI

The broken Veee PAC data contained contradictory suffix rules:

```diff
 global:
   suffix:
-    - x.ai
 proxy:
   suffix:
+    - x.ai
     - auth.x.ai
     - grok.com
     - cli-chat-proxy.grok.com
```

`x.ai` under `global.suffix` means **DIRECT** in Veee's renderer, even when
Veee is in Global mode. That broad rule wins over the narrower proxy entries,
so `auth.x.ai`, `api.x.ai`, and other xAI hosts bypass Veee and time out.

The durable rule is therefore:

1. Remove `x.ai` from `global.suffix`.
2. Add `x.ai` to `proxy.suffix`.
3. Keep the existing `auth.x.ai`, `grok.com`, and
   `cli-chat-proxy.grok.com` proxy entries.
4. Reconnect Veee so its native proxy core reloads the PAC.

The local repair is stored in:

```text
~/Library/Application Support/veee-desktop/Local Storage/leveldb
```

under Veee's `vPac` local-storage key. It survives Veee and macOS restarts.
Do not edit the LevelDB files directly while Veee is running and do not patch
the signed `Veee.app` bundle. Use Veee's supported rule editor when available,
or its Electron renderer/local-storage interface while the application is
stopped and then reconnect it.

### Upstream permanent fix

Veee can replace `vPac` when its server publishes a new `ruleVersion`. The
fully permanent fix is for Veee to make the same change in its distributed
PAC data. A concise support report is:

> Veee's macOS PAC places `x.ai` in `global.suffix`, which the renderer sends
> to the native core as `directDomains` even in Global mode. The same PAC
> places `auth.x.ai` in `proxy.suffix`, but the broader direct `x.ai` rule
> wins. Please remove `x.ai` from `global.suffix` and add `x.ai` to
> `proxy.suffix`.

Changing Veee countries or nodes does not correct this problem because the
same routing rule follows every node. `/etc/hosts`, hard-coded Cloudflare IPs,
and DNS changes also do not correct it; the failure is route selection, not
DNS resolution.

## 2. Make DSH and Codex use Veee

Add these definitions to `~/.zshrc`:

```zsh
# Codex CLI through Veee.
alias codex='http_proxy=http://127.0.0.1:15236 https_proxy=http://127.0.0.1:15236 HTTP_PROXY=http://127.0.0.1:15236 HTTPS_PROXY=http://127.0.0.1:15236 no_proxy=localhost,127.0.0.1,::1 NO_PROXY=localhost,127.0.0.1,::1 command codex'

# DSH source checkout through Veee.
dsh() {
  (
    local proxy="${VEEE_HTTP_PROXY:-http://127.0.0.1:15236}"
    cd /Users/yifanxu/Ephemeral-AI-Lab/deepseek-harness &&
      NODE_USE_ENV_PROXY=1 \
      HTTP_PROXY="$proxy" HTTPS_PROXY="$proxy" \
      http_proxy="$proxy" https_proxy="$proxy" \
      NO_PROXY="localhost,127.0.0.1,::1" \
      no_proxy="localhost,127.0.0.1,::1" \
      command pnpm dsh "$@"
  )
}

# Grok CLI through Veee.
grok() {
  local proxy="${VEEE_HTTP_PROXY:-http://127.0.0.1:15236}"
  HTTP_PROXY="$proxy" HTTPS_PROXY="$proxy" \
  http_proxy="$proxy" https_proxy="$proxy" \
  ALL_PROXY="$proxy" all_proxy="$proxy" \
  NO_PROXY="localhost,127.0.0.1,::1" \
  no_proxy="localhost,127.0.0.1,::1" \
  command grok "$@"
}
```

Reload the shell:

```sh
source ~/.zshrc
```

`NODE_USE_ENV_PROXY=1` is required for the Node.js `fetch` calls used by DSH.
Setting `HTTP_PROXY` alone is insufficient for those calls. Override the Veee
port without editing the function when necessary:

```sh
export VEEE_HTTP_PROXY=http://127.0.0.1:NEW_PORT
```

## 3. Enable the Codex Coding Plan provider

The local plugin is:

```text
/Users/yifanxu/Ephemeral-AI-Lab/dsh-plugins/coding-plan/codex
```

Configure Codex to keep its login in the file-backed credential store. Add to
`~/.codex/config.toml`:

```toml
cli_auth_credentials_store = "file"
```

Then authenticate and install the plugin into the DSH Web profile:

```sh
codex login
codex login status

dsh plugin --profile web add \
  /Users/yifanxu/Ephemeral-AI-Lab/dsh-plugins/coding-plan/codex
```

Start or restart the DSH Web host through the proxy-aware wrapper:

```sh
dsh web
```

The plugin reads `$CODEX_HOME/auth.json`, or `~/.codex/auth.json` when
`CODEX_HOME` is unset. It validates and refreshes the ChatGPT OAuth session,
then supplies only the current access token to DSH's existing credential
service as `CODEX_CODING_PLAN_ACCESS_TOKEN`. The token is never placed in the
plugin configuration or sent to the browser, and it is removed from the DSH
credential service on a clean shutdown.

Do not copy the Codex token into the Models page. After the Host reloads, the
Models page should show **Codex Coding Plan** as available automatically.

## 4. Verify the complete route

Check the Veee listener first:

```sh
lsof -nP -iTCP:15236 -sTCP:LISTEN
```

Then check the xAI endpoints through Veee:

```sh
curl --proxy http://127.0.0.1:15236 \
  --connect-timeout 10 --max-time 20 \
  --output /dev/null --silent --show-error \
  --write-out 'auth.x.ai HTTP %{http_code}\n' \
  https://auth.x.ai/

curl --proxy http://127.0.0.1:15236 \
  --connect-timeout 10 --max-time 20 \
  --output /dev/null --silent --show-error \
  --write-out 'api.x.ai HTTP %{http_code}\n' \
  https://api.x.ai/
```

Any completed HTTP response proves the route reached the server. An HTTP
`401`, `404`, or `421` can be expected from an unauthenticated or invalid root
request and is different from a timeout or TLS connection failure.

Finally:

1. Open the DSH Models page.
2. Confirm **Codex Coding Plan** is green and lists Codex models.
3. Run a short request with one Codex model.
4. Restart Veee and DSH, then repeat both the xAI and Codex checks.

If xAI fails again after Veee downloads a rule update, inspect `vPac` for a
reintroduced `global.suffix` entry named exactly `x.ai` and apply the rule
correction in section 1 again.
