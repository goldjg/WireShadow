export const COLAB_KERNEL_SOCKET_URL =
  "wss://runtime-sanitized.prod.colab.dev/api/kernels/sanitized-kernel/channels";
export const COLAB_LSP_SOCKET_URL = "wss://runtime-sanitized.prod.colab.dev/colab/lsp";

export const JUPYTER_EXECUTE_REQUEST_WITH_CODE = JSON.stringify({
  header: { msg_id: "sanitized", msg_type: "execute_request" },
  content: {
    code: "import requests\nrequests.post('https://api.github.com/repos/org/repo/issues', json={'k':'v'})\n"
  }
});

export const JUPYTER_EXECUTE_REQUEST_NESTED = JSON.stringify({
  envelope: {
    outer: {
      payload: {
        header: { msg_id: "nested", msg_type: "execute_request" },
        parent_header: { msg_id: "parent-nested" },
        content: {
          code: "import socket\nsocket.socket()\n"
        }
      }
    }
  }
});

export const JUPYTER_EXECUTE_REQUEST_ARRAY_WRAPPED = JSON.stringify([
  {
    type: "meta",
    value: "x"
  },
  {
    header: { msg_id: "arr", msg_type: "execute_request" },
    parent_header: { msg_id: "arr-parent" },
    content: {
      code: "import requests\nrequests.get('https://api.github.com/user')\n"
    }
  }
]);

export const JUPYTER_EXECUTE_REQUEST_STRINGIFIED_NESTED = JSON.stringify({
  transport: {
    payloadJson: JSON.stringify({
      header: { msg_id: "str", msg_type: "execute_request" },
      content: {
        code: "import httpx\nhttpx.get('https://api.github.com/repos/org/repo')\n"
      }
    })
  }
});

export const JUPYTER_EXECUTE_REQUEST_PREFIXED = `42|{"header":{"msg_id":"prefixed","msg_type":"execute_request"},"parent_header":{"msg_id":"prefixed-parent"},"content":{"code":"import requests\\nrequests.get('https://api.github.com/user')\\n"}}`;

export const JUPYTER_EXECUTE_REQUEST_EMPTY_CODE = JSON.stringify({
  header: { msg_id: "sanitized-empty", msg_type: "execute_request" },
  content: { code: "   " }
});

export const JUPYTER_STATUS_MESSAGE = JSON.stringify({
  header: { msg_id: "sanitized-status", msg_type: "status" },
  content: { execution_state: "busy" }
});

export const LSP_DID_OPEN_MESSAGE = JSON.stringify({
  method: "textDocument/didOpen",
  params: {
    textDocument: {
      uri: "untitled:sanitized.py",
      languageId: "python",
      text: "import httpx\nhttpx.get('https://example.com')"
    }
  }
});

export const MALFORMED_JSON_FRAME = "{\"header\":{\"msg_type\":\"execute_request\",";

export const ORDINARY_COLAB_XHR_PAYLOAD = JSON.stringify({
  event: "heartbeat",
  session_id: "runtime-session-sanitized-1234",
  notebook_id: "notebook-sanitized-5678"
});

const LARGE_FUNCTION_BODY = [
  "import urllib.request",
  "def upload_to_github(data, owner, repo_path, token):",
  "  req = urllib.request.Request(",
  "    'https://api.github.com/repos/' + owner + '/contents/' + repo_path,",
  "    method='PUT',",
  "    headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}",
  "  )",
  "  return urllib.request.urlopen(req)"
].join("\\n");

export const LARGE_JUPYTER_EXECUTE_REQUEST_WITH_CODE = JSON.stringify({
  header: { msg_id: "sanitized-large", msg_type: "execute_request" },
  content: {
    code: `${LARGE_FUNCTION_BODY}\\nFILLER='${"A".repeat(7000)}'`
  }
});
