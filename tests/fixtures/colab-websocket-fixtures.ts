export const COLAB_KERNEL_SOCKET_URL =
  "wss://runtime-sanitized.prod.colab.dev/api/kernels/sanitized-kernel/channels";
export const COLAB_LSP_SOCKET_URL = "wss://runtime-sanitized.prod.colab.dev/colab/lsp";

export const JUPYTER_EXECUTE_REQUEST_WITH_CODE = JSON.stringify({
  header: { msg_id: "sanitized", msg_type: "execute_request" },
  content: {
    code: "import requests\nrequests.post('https://api.github.com/repos/org/repo/issues', json={'k':'v'})\n"
  }
});

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
